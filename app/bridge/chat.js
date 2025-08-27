/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2025 Toha <tohenk@yahoo.com>
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
const Queue = require('@ntlab/work/queue');
const Bridge = require('.');
const { ChatFactory, ChatConsumer } = require('../chat');
const SMSGateway = require('../chat/smsgw');
const WAWeb = require('../chat/waweb');

/**
 * Chat gateway provide a message channel for client through SMS or WhatsApp chat.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatGateway extends Bridge {

    /** @type {ChatConsumer[]} */
    consumers = []
    /** @type {Queue} */
    queue = null
    /** @type {Queue} */
    notifyQueue = null

    onInit() {
        this.createQueue();
        this.setupWAWeb(this.getConfig('whatsapp'));
        this.setupSMSGateway(this.getConfig('smsgw'));
    }

    onFinalize() {
        this.saveQueue();
    }

    setupWAWeb(config) {
        if (config && (config.enabled === undefined || config.enabled)) {
            this.createFactory({factory: WAWeb, config});
        }
    }

    setupSMSGateway(config) {
        if (config && (config.enabled === undefined || config.enabled) && config.url) {
            this.createFactory({factory: SMSGateway, config});
        }
    }

    createFactory(data) {
        const factory = new ChatFactory(this, data);
        return factory.create();
    }

    handleServer(con) {
        con.on('text-message', data => {
            this.getApp().log('SVR: %s: Send text to %s "%s"...', con.id, data.number, data.message);
            this.queue.requeue([data]);
        });
    }

    createQueue() {
        this.queueFilename = path.join(this.config.workdir, 'queue', 'messages.json');
        if (!fs.existsSync(path.dirname(this.queueFilename))) {
            fs.mkdirSync(path.dirname(this.queueFilename), {recursive: true});
        }
        const queues = this.loadQueue();
        this.queue = new Queue(queues, data => {
            this.getApp().log('CGW: Processing %s', data);
            const msg = {
                hash: data.hash,
                address: data.number,
                data: data.message
            }
            if (data.consumer) {
                msg.consumer = data.consumer;
            }
            const flags = {};
            if (typeof data.attr === 'number') {
                flags.retry = data.attr;
            } else if (typeof data.attr === 'object') {
                Object.assign(flags, data.attr);
            }
            this.consume(msg, flags)
                .then(() => this.queue.next())
                .catch(err => {
                    if (err) {
                        console.error(err);
                    }
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

    consume(msg, flags) {
        return new Promise((resolve, reject) => {
            let handler;
            const q = new Queue([...this.consumers], consumer => {
                if (consumer.canHandle(msg)) {
                    this.getApp().log('CGW: %s handling %s...', consumer.constructor.name, JSON.stringify(msg));
                    handler = consumer;
                    consumer.canConsume(msg, flags)
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
                    reject(`No consumer can handle message ${JSON.stringify(msg)}!`);
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

module.exports = ChatGateway;