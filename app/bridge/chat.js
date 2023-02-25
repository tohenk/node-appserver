/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2023 Toha <tohenk@yahoo.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
 * of the Software, and to permit persons to whom the Software is furnished to do
 * so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

const fs      = require('fs');
const path    = require('path');
const io      = require('socket.io-client');
const Queue   = require('@ntlab/work/queue');
const Work    = require('@ntlab/work/work');
const Bridge  = require('./bridge');
const { Client, LocalAuth, MessageAck } = require('whatsapp-web.js');

class ChatGateway extends Bridge {

    consumers = []
    queue = null
    notifyQueue = null
    notifyCmd = null
    ready = false

    onInit() {
        this.queueFilename = path.join(this.getApp().queueDir, 'messages.json');
        this.createQueue();
        this.setupWAWeb(this.getConfig('whatsapp'));
        this.setupSMSGateway(this.getConfig('smsgw'));
        this.setupSMSNotifier(this.getConfig('text-client'));
    }

    onFinalize() {
        this.saveQueue();
    }

    setupWAWeb(config) {
        if (config) {
            const wa = new WAWeb(this);
            wa.initialize(config);
            this.consumers.push(wa);
        }
    }

    setupSMSGateway(config) {
        if (config && config.url) {
            const smsgw = new SMSGateway(this);
            smsgw.initialize(config);
            this.consumers.push(smsgw);
        }
    }

    setupSMSNotifier(config) {
        if (config) {
            this.notifyCmd = this.getApp().getCmd(config, ['%CMD%', '%DATA%']);
            console.log('Text client using %s', this.notifyCmd.getId());
        }
    }

    handleServer(con) {
        con.on('text-message', data => {
            this.getApp().log('SVR: %s: Send text to %s "%s"...', con.id, data.number, data.message);
            if (this.queue) {
                this.queue.requeue([data]);
            }
        });
    }

    createQueue() {
        const queues = this.loadQueue();
        this.queue = new Queue(queues, data => {
            const msg = {
                hash: data.hash,
                address: data.number,
                data: data.message
            }
            this.consume(msg, data.attr)
                .then(() => this.queue.next())
                .catch(err => {
                    if (err) console.error(err);
                    this.queue.next();
                });
        }, () => {
            if (!this.ready) {
                this.getApp().log('CHAT: Not ready!');
            }
            return this.ready;
        });
    }

    loadQueue() {
        let queues = [];
        if (fs.existsSync(this.queueFilename)) {
            queues = JSON.parse(fs.readFileSync(this.queueFilename));
            if (queues.length) {
                fs.writeFileSync(this.queueFilename, JSON.stringify([]));
                this.getApp().log('CHAT: %s queue(s) loaded from %s...', queues.length, this.queueFilename);
            }
        }
        return queues;
    }

    saveQueue() {
        if (this.queue && this.queue.queues.length) {
            fs.writeFileSync(this.queueFilename, JSON.stringify(this.queue.queues));
            this.getApp().log('CHAT: Queue saved to %s...', this.queueFilename);
        }
    }

    consume(msg, retry) {
        return new Promise((resolve, reject) => {
            let handler;
            const q = new Queue([...this.consumers], consumer => {
                if (consumer.canHandle(msg)) {
                    this.getApp().log('CHAT: %s handling %s...', consumer.constructor.name, JSON.stringify(msg));
                    handler = consumer;
                    consumer.canConsume(msg, retry)
                        .then(res => {
                            if (res) {
                                q.done();
                                resolve();
                            } else {
                                q.next();
                            }
                        })
                        .catch(err => reject(err));
                } else {
                    q.next();
                }
            });
            q.once('done', () => {
                if (!handler) {
                    reject('No queue handler!');
                }
            });
        });
    }

    addNotification(cmd, data) {
        const queue = {CMD: cmd, DATA: data};
        if (!this.notifyQueue) {
            this.notifyQueue = new Queue([queue], q => {
                if (this.notifyCmd) {
                    this.getApp().execCmd(this.notifyCmd, q)
                        .then(() => {
                            this.notifyQueue.next();
                        })
                    ;
                }
            });
        } else {
            this.notifyQueue.requeue([queue]);
        }
    }

    onState(sender) {
        let cnt = 0;
        this.consumers.forEach(consumer => {
            if (consumer.isConnected()) {
                cnt++;
            }
        });
        this.ready = cnt > 0;
        if (this.ready) {
            this.getApp().log('CHAT: Ready for processing...');
            this.queue.next();
        }
    }

    onMessage(data) {
        this.addNotification('MESG', JSON.stringify(data));
    }

    onReport(data) {
        this.addNotification('DELV', JSON.stringify(data));
    }
}

class ChatConsumer {

    id = null
    parent = null
    connected = false

    constructor(parent) {
        this.parent = parent;
    }

    initialize(config) {
    }

    getId() {
        return this.id;
    }

    isConnected() {
        return this.connected;
    }

    canHandle(msg) {
        if (msg.consumer) {
            return msg.consumer == this.id;
        }
        return true;
    }

    canConsume(msg, retry) {
        return Promise.reject('Not handled!');
    }
}

class WAWeb extends ChatConsumer {

    client = null
    numbers = null
    messages = []

    initialize(config) {
        this.id = 'wa';
        this.waNumbersFile = path.join(path.dirname(this.parent.getApp().queueDir), 'wanumbers.json');
        const params = {authStrategy: new LocalAuth()};
        if (config.puppeteer) {
            params.puppeteer = config.puppeteer;
        }
        this.client = new Client(params);
        this.client
            .on('qr', qr => {
                const qrcode = require('qrcode-terminal');
                qrcode.generate(qr, {small: true});
                if (config.admin) {
                    const time = new Date();
                    const message = 'WhatsApp Web requires QR Code authentication';
                    const hash = this.getHash(time, config.admin, message);
                    this.parent.queue.requeue([{hash: hash, number: config.admin, message: message, consumer: 'sms'}]);
                }
            })
            .on('ready', () => {
                console.log('WhatsApp Web is ready...');
                this.connected = true;
                this.parent.onState(this);
            })
            .on('disconnected', () => {
                this.connected = false;
                this.parent.onState(this);
            })
            .on('message', msg => {
                const time = new Date();
                Work.works([
                    [w => Promise.resolve(msg.getContact())]
                ])
                .then(contact => {
                    const number = '+' + contact.number;
                    const hash = this.getHash(time, number, msg.body);
                    const data = {date: time, number: number, message: msg.body, hash: hash};
                    this.parent.getApp().log('WAWEB: New message %s', JSON.stringify(data));
                    this.parent.onMessage(data);
                })
                .catch(err => console.error(err));
            })
            .on('message_ack', (msg, ack) => {
                const idx = this.getMsgIndex(msg);
                if (idx >= 0) {
                    const time = new Date();
                    if (ack == MessageAck.ACK_SERVER) {
                        if (!this.messages[idx].ack) {
                            this.messages[idx].ack = {};
                        }
                        this.messages[idx].ack.sent = time;
                    }
                    if (ack >= MessageAck.ACK_DEVICE) {
                        this.messages[idx].ack.received = time;
                        const data = {};
                        if (this.messages[idx].data.hash) {
                            data.hash = this.messages[idx].data.hash;
                        }
                        data.number = this.messages[idx].data.address;
                        data.code = ack;
                        data.sent = this.messages[idx].ack.sent;
                        data.received = this.messages[idx].ack.received;
                        this.parent.getApp().log('WAWEB: Message ack %s', JSON.stringify(data));
                        this.parent.onReport(data);
                        this.messages.splice(idx);
                    }
                }
            })
            .initialize()
        ;
    }

    loadNumbers(force = false) {
        if (this.numbers == null || force) {
            if (fs.existsSync(this.waNumbersFile)) {
                this.numbers = JSON.parse(fs.readFileSync(this.waNumbersFile));
            } else {
                this.numbers = [];
            }
        }
    }

    saveNumbers(phone = null) {
        if (phone != null) {
            if (!this.numbers) {
                this.numbers = [];
            }
            this.numbers.push(phone);
        }
        if (this.numbers) {
            fs.writeFileSync(this.waNumbersFile, JSON.stringify(this.numbers));
        }
    }

    canConsume(msg, retry) {
        const number = this.normalizeNumber(msg.address);
        return new Promise((resolve, reject) => {
            Work.works([
                [w => Promise.resolve(this.isWANumber(number))],
                [w => this.client.getNumberId(number), w => w.getRes(0)],
                [w => this.client.sendMessage(w.getRes(1)._serialized, msg.data), w => w.getRes(0)],
                [w => Promise.resolve(this.messages.push({data: msg, msg: w.getRes(2)})), w => w.getRes(0)],
                [w => Promise.resolve(w.getRes(2) ? true : false), w => w.getRes(0)],
            ])
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
    }

    isWANumber(number) {
        return Work.works([
            [w => Promise.resolve(this.loadNumbers())],
            [w => Promise.resolve(this.numbers.indexOf(number) >= 0)],
            // check if number is using WA
            [w => this.client.isRegisteredUser(number), w => !w.getRes(1)],
            // using WA?
            [w => Promise.resolve(this.saveNumbers(number)), w => !w.getRes(1) && w.getRes(2)],
            [w => Promise.resolve(true), w => !w.getRes(1) && w.getRes(2)],
            // not using WA?
            [w => Promise.resolve(false), w => !w.getRes(1) && !w.getRes(2)],
        ]);
    }

    normalizeNumber(number) {
        if (number.substr(0, 1) == '+') {
            number = number.substr(1);
        }
        return number;
    }

    getMsgIndex(msg) {
        for (let i = 0; i < this.messages.length; i++) {
            if (this.messages[i].msg && this.messages[i].msg.id) {
                if (this.messages[i].msg.id.id == msg.id.id) {
                    return i;
                }
            }
        }
        return -1;
    }

    getHash(dt, number, message) {
        const shasum = require('crypto').createHash('sha1');
        shasum.update([dt.toISOString(), number, message].join(''));
        return shasum.digest('hex');
    }
}

class SMSGateway extends ChatConsumer {

    io = null

    initialize(config) {
        this.id = 'sms';
        if (config.url) {
            console.log('SMS Gateway at %s', config.url);
            this.io = io(config.url);
            this.io
                .on('connect', () => {
                    console.log('Connected to SMS Gateway at %s', config.url);
                    this.io.emit('auth', config.secret);
                    this.connected = true;
                })
                .on('disconnect', () => {
                    console.log('Disconnected from SMS Gateway at %s', config.url);
                    this.connected = false;
                })
                .on('auth', success => {
                    if (!success) {
                        console.log('Authentication with SMS Gateway failed!');
                    } else {
                        if (config.group) {
                            this.io.emit('group', config.group);
                        }
                        this.parent.onState(this);
                    }
                })
                .on('message', (hash, number, message, time) => {
                    this.parent.getApp().log('SMS: %s: New message from %s', hash, number);
                    this.parent.onMessage({date: time, number: number, message: message, hash: hash});
                })
                .on('status-report', data => {
                    if (data.hash) {
                        this.parent.getApp().log('SMS: %s: Delivery status for %s is %s', data.hash, data.address, data.code);
                        this.parent.onReport({hash: data.hash, number: data.address, code: data.code, sent: data.sent, received: data.received});
                    }
                })
            ;
        }
    }

    canConsume(msg, retry) {
        return new Promise((resolve, reject) => {
            if (retry) {
                this.io.emit('message-retry', msg);
            } else {
                this.io.emit('message', msg);
            }
            resolve(true);
        });
    }
}

module.exports = ChatGateway;