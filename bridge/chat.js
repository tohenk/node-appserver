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
 * @typedef {Object} ChatMessage
 * @property {string} hash Message hash
 * @property {string} address Destination address
 * @property {string} data Message content
 * @property {?ChatConsumer} consumer Message consumer
 */

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
        const wawebConfig = this.getConfig('whatsapp');
        if (wawebConfig) {
            const puppeteer = this.getConfig('puppeteer');
            if (puppeteer && wawebConfig.puppeteer === undefined) {
                wawebConfig.puppeteer = puppeteer;
            }
        }
        this.createQueue();
        this.setupWAWeb(wawebConfig);
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
        con
            .on('text-message-attachment', data => {
                const res = {success: false};
                if (data.hash) {
                    if (this.attachments === undefined) {
                        this.attachments = {};
                    }
                    let buff = Buffer.from(data.content);
                    if (this.attachments[data.hash] !== undefined) {
                        buff = Buffer.concat([this.attachments[data.hash], buff]);
                    }
                    this.attachments[data.hash] = buff;
                    res.success = true;
                    res.length = buff.byteLength;
                    this.getApp().log('SVR: %s: Attachment %s (%d bytes)...', con.id, data.hash, res.length);
                }
                con.emit('text-message-attachment', res);
            })
            .on('text-message', data => {
                this.getApp().log('SVR: %s: Send text to %s "%s"...', con.id, data.number, data.message);
                if (this.attachments !== undefined && this.attachments[data.hash] !== undefined) {
                    if (data.attr.attachment) {
                        data.attr.attachment.content = this.attachments[data.hash];
                        delete this.attachments[data.hash];
                    }
                }
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

    /**
     * Consume chat message.
     *
     * @param {ChatMessage} msg Message
     * @param {object} flags Message flags
     * @returns {Promise<undefined>}
     */
    consume(msg, flags) {
        return new Promise((resolve, reject) => {
            let handler;
            const q = new Queue([...this.consumers], consumer => {
                if (consumer.canHandle(msg)) {
                    this.getApp().log('CGW: %s handling %s...', consumer.constructor.name, JSON.stringify(msg));
                    consumer.canConsume(msg, flags)
                        .then(res => {
                            if (res) {
                                handler = consumer;
                                q.done();
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
                } else {
                    resolve();
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