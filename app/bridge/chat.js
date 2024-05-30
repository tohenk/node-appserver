/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2024 Toha <tohenk@yahoo.com>
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

const fs = require('fs');
const path = require('path');
const io = require('socket.io-client');
const Queue = require('@ntlab/work/queue');
const Work = require('@ntlab/work/work');
const Bridge = require('./bridge');
const { Client, LocalAuth, MessageAck } = require('whatsapp-web.js');

class ChatGateway extends Bridge {

    /** @type {ChatConsumer[]} */
    consumers = []
    /** @type {Queue} */
    queue = null
    /** @type {Queue} */
    notifyQueue = null

    onInit() {
        this.queueFilename = path.join(this.getApp().queueDir, 'messages.json');
        this.createQueue();
        this.setupWAWeb(this.getConfig('whatsapp'));
        this.setupSMSGateway(this.getConfig('smsgw'));
    }

    onFinalize() {
        this.saveQueue();
    }

    setupWAWeb(config) {
        if (config) {
            this.createFactory({factory: WAWeb, config: config});
        }
    }

    setupSMSGateway(config) {
        if (config && config.url) {
            this.createFactory({factory: SMSGateway, config: config});
        }
    }

    createFactory(data) {
        const factory = new ChatFactory(this, data);
        return factory.create();
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
            if (data.consumer) {
                msg.consumer = data.consumer;
            }
            this.consume(msg, data.attr)
                .then(() => this.queue.next())
                .catch(err => {
                    if (err) console.error(err);
                    this.queue.next();
                });
        }, () => {
            const cnt = this.countReady();
            if (cnt === 0) {
                this.getApp().log('CGW: Not ready!');
            }
            return cnt > 0;
        });
    }

    loadQueue() {
        let queues = [];
        if (fs.existsSync(this.queueFilename)) {
            queues = JSON.parse(fs.readFileSync(this.queueFilename));
            if (queues.length) {
                fs.writeFileSync(this.queueFilename, JSON.stringify([]));
                this.getApp().log('CGW: %s queue(s) loaded from %s...', queues.length, this.queueFilename);
            }
        }
        return queues;
    }

    saveQueue() {
        if (this.queue && this.queue.queues.length) {
            fs.writeFileSync(this.queueFilename, JSON.stringify(this.queue.queues));
            this.getApp().log('CGW: Queue saved to %s...', this.queueFilename);
        }
    }

    consume(msg, retry) {
        return new Promise((resolve, reject) => {
            let handler;
            const q = new Queue([...this.consumers], consumer => {
                if (consumer.canHandle(msg)) {
                    this.getApp().log('CGW: %s handling %s...', consumer.constructor.name, JSON.stringify(msg));
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
                    reject('No consumer can handle message %s!', JSON.stringify(msg));
                }
            });
        });
    }

    addNotification(cmd, data) {
        const queue = {CMD: cmd, DATA: data};
        if (!this.notifyQueue) {
            this.notifyQueue = new Queue([queue], q => {
                this.getApp().doCmd(null, 'text-client', ['%CMD%', '%DATA%'], q, () => {
                    this.notifyQueue.next();
                });
            });
        } else {
            this.notifyQueue.requeue([queue]);
        }
    }

    countReady() {
        let cnt = 0;
        this.consumers.forEach(consumer => {
            if (consumer.isConnected()) {
                cnt++;
            }
        });
        return cnt;
    }

    onState(sender) {
        if (this.countReady() > 0) {
            this.getApp().log('CGW: Ready for processing...');
            setTimeout(() => this.queue.next(), 5000);
        }
    }

    onMessage(data) {
        this.addNotification('MESG', JSON.stringify(data));
    }

    onReport(data) {
        this.addNotification('DELV', JSON.stringify(data));
    }
}

class ChatFactory {

    /** @type {ChatGateway} */
    parent = null
    /** @type {ChatConsumer} */
    factory = null
    /** @type {object} */
    config = null
    /** @type {ChatConsumer} */
    instance = null

    constructor(parent, data) {
        this.parent = parent;
        this.factory = data.factory;
        this.config = data.config;
    }

    create() {
        if (this.instance == null) {
            this.instance = new this.factory(this.parent);
            if (!this.instance instanceof ChatConsumer) {
                throw new Error(`${this.instance.constructor.name} must be a sub class of ChatConsumer.`);
            }
            this.instance.initialize(this.config);
            if (this.config['restart-every']) {
                setTimeout(() => {
                    let idx = this.parent.consumers.indexOf(this.instance);
                    if (idx >= 0) {
                        this.parent.consumers.splice(idx);
                        this.instance.close();
                        this.instance = null;
                        const delay = this.config['restart-delay'] || 60000;
                        setTimeout(() => this.create(), delay);
                        console.log('Restart for %s scheduled in %d s', this.factory.name, delay / 1000);
                    }
                }, this.config['restart-every']);
            }
            this.parent.consumers.push(this.instance);
        }
        return this.instance;
    }
}

class ChatConsumer {

    /** @type {string} */
    id = null
    /** @type {ChatGateway} */
    parent = null
    /** @type {string} */
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
        if (this.isConnected()) {
            if (msg.consumer) {
                return msg.consumer == this.id;
            }
            return true;
        }
        return false;
    }

    canConsume(msg, retry) {
        return Promise.reject('Not handled!');
    }

    close() {
    }
}

class WAWeb extends ChatConsumer {

    client = null
    numbers = null
    qrnotify = null
    qrcount = 0
    delay = 0
    messages = []

    initialize(config) {
        this.id = 'wa';
        this.waNumbersFile = path.join(path.dirname(this.parent.getApp().queueDir), 'wanumbers.json');
        if (typeof config['delay'] != 'undefined') {
            if (!(typeof config['delay'] == 'number' || Array.isArray(config['delay']))) {
                throw new Error('Delay only accept number or array of [min, max]!');
            }
            this.delay = config['delay'];
        }
        const params = {authStrategy: new LocalAuth()};
        if (config.puppeteer) {
            params.puppeteer = config.puppeteer;
        }
        this.client = new Client(params);
        this.client
            .on('qr', qr => {
                const time = new Date();
                const interval = config['qr-notify-interval'] || 600000; // 10 minutes
                const notifyRetry = config['qr-notify-retry'] || 3;
                if (this.qrnotify == null || (time.getTime() > this.qrnotify.getTime() + interval)) {
                    this.qrnotify = time;
                    const qrcode = require('qrcode-terminal');
                    qrcode.generate(qr, {small: true});
                    if (config.admin && this.qrcount++ < notifyRetry) {
                        const message = `WhatsApp Web requires QR Code authentication: ${qr}`;
                        const hash = this.getHash(time, config.admin, message);
                        this.parent.queue.requeue([{hash: hash, number: config.admin, message: message, consumer: 'sms'}]);
                    }
                }
            })
            .on('ready', () => {
                console.log('WhatsApp Web is ready...');
                this.connected = true;
                this.parent.onState(this);
            })
            .on('authenticated', () => {
                console.log('WhatsApp Web is authenticated...');
            })
            .on('disconnected', () => {
                this.connected = false;
                this.qrcount = 0
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
                    this.parent.getApp().log('WAW: New message %s', JSON.stringify(data));
                    this.parent.onMessage(data);
                })
                .catch(err => console.error(err));
            })
            .on('message_ack', (msg, ack) => {
                const idx = this.getMsgIndex(msg);
                if (idx >= 0) {
                    const time = new Date();
                    if (!this.messages[idx].ack) {
                        this.messages[idx].ack = {};
                    }
                    if (ack == MessageAck.ACK_SERVER) {
                        this.messages[idx].ack.sent = time;
                    }
                    if (ack >= MessageAck.ACK_DEVICE) {
                        this.messages[idx].ack.received = time;
                        const data = {};
                        if (this.messages[idx].data.hash) {
                            data.hash = this.messages[idx].data.hash;
                        }
                        data.number = this.messages[idx].data.address;
                        data.code = typeof config['ack-success'] != 'undefined' ? config['ack-success'] : ack;
                        data.sent = this.messages[idx].ack.sent;
                        data.received = this.messages[idx].ack.received;
                        this.parent.getApp().log('WAW: Message ack %s', JSON.stringify(data));
                        this.parent.onReport(data);
                        this.messages.splice(idx);
                    }
                }
            })
            .initialize()
        ;
    }

    canConsume(msg, retry) {
        const number = this.normalizeNumber(msg.address);
        return new Promise((resolve, reject) => {
            Work.works([
                [w => Promise.resolve(this.isWANumber(number))],
                [w => this.client.getNumberId(number), w => w.getRes(0)],
                [w => this.client.sendMessage(w.getRes(1)._serialized, msg.data), w => w.getRes(0)],
                [w => Promise.resolve(this.messages.push({data: msg, msg: w.getRes(2)})), w => w.getRes(0)],
                [w => Promise.resolve(this.getDelay()), w => w.getRes(0)],
                [w => this.sleep(w.getRes(4)), w => w.getRes(0) && w.getRes(4) > 0],
                [w => Promise.resolve(w.getRes(2) ? true : false), w => w.getRes(0)],
            ])
            .then(res => resolve(res))
            .catch(err => reject(err));
        });
    }

    close() {
        this.client.destroy();
    }

    sleep(ms) {
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(), ms);
        });
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

    getDelay() {
        if (Array.isArray(this.delay)) {
            return this.getRnd(this.delay[0], this.delay[1]);
        }
        return this.delay;
    }

    getRnd(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
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