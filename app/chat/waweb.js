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
const Work = require('@ntlab/work/work');
const Queue = require('@ntlab/work/queue');
const { ChatConsumer } = require('.');
const { ChatStorage, ChatContact } = require('./storage');
const { Client, LocalAuth, Message, MessageAck } = require('whatsapp-web.js');

/**
 * A message consumer through WhatsApp.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class WAWeb extends ChatConsumer {

    STOR_WA_NUMBERS = 'wa'
    STOR_WA_TERMS = 'wa-tc'

    /** @type {Client} */
    client = null
    /** @type {number} */
    qrcount = 0
    /** @type {number} */
    delay = 0
    /** @type {object} */
    messages = {}
    /** @type {ChatStorage} */
    storage = null

    initialize(config) {
        this.id = 'wa';
        this.workdir = path.dirname(this.parent.getApp().queueDir);
        this.storage = new ChatStorage('waweb', this.workdir);
        this.numbers = this.storage.get(this.STOR_WA_NUMBERS);
        /** @type {string} */
        this.eula = config.eula || 'To improve user experience for our services, we will send the message through this channel.\nReply with *YES* to agree.';
        /** @type {number} */
        this.qrinterval = config['qr-notify-interval'] || 600000; // 10 minutes
        /** @type {number} */
        this.qrretry = config['qr-notify-retry'] || 3;
        if (config.delay !== undefined) {
            if (!(typeof config.delay === 'number' || Array.isArray(config.delay))) {
                throw new Error('Delay only accept number or array of [min, max]!');
            }
            this.delay = config.delay;
        }
        this.bdelay = config['broadcast-delay'] || [60000, 120000]; // 1-2 minutes
        const params = {authStrategy: new LocalAuth()};
        if (config.puppeteer) {
            params.puppeteer = config.puppeteer;
        }
        this.client = new Client(params);
        this.client
            .on('qr', qr => {
                if (this.isTime('qrnotify', this.qrinterval)) {
                    const qrcode = require('qrcode-terminal');
                    qrcode.generate(qr, {small: true});
                    if (config.admin && this.qrcount++ < this.qrretry) {
                        const message = `WhatsApp Web requires QR Code authentication: ${qr}`;
                        const hash = this.getHash(time, config.admin, message);
                        this.parent.queue.requeue([{hash, number: config.admin, message, consumer: 'sms'}]);
                    }
                }
            })
            .on('ready', () => {
                console.log('WhatsApp Web is ready...');
                this.connected = true;
                /**
                 * {
                 *     server: 'c.us',
                 *     user: '6281234567890',
                 *     _serialized: '6281234567890@c.us'
                 * }
                 */
                this.info = this.client.info;
                this.terms = this.storage.get(this.STOR_WA_TERMS, this.info.wid.user);
                this.parent.onState(this);
                this.migrateStorage(this.numbers);
                this.migrateStorage(this.terms);
                console.log('WhatsApp Web:', this.info.pushname, this.info.wid.user);
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
                    const data = {date: time, number, message: msg.body, hash};
                    this.parent.getApp().log('WAW: New message %s', JSON.stringify(data));
                    this.parent.onMessage(data);
                })
                .catch(err => console.error(err));
            })
            .on('message_ack', (msg, ack) => {
                const info = this.messages[msg.id.id];
                if (info) {
                    const time = new Date();
                    if (!info.ack) {
                        info.ack = {};
                    }
                    if (ack === MessageAck.ACK_SERVER) {
                        info.ack.sent = time;
                    }
                    if (ack >= MessageAck.ACK_DEVICE) {
                        info.ack.received = time;
                        const data = {};
                        if (info.data.hash) {
                            data.hash = info.data.hash;
                        }
                        data.number = info.data.address;
                        data.code = config['ack-success'] !== undefined ? config['ack-success'] : ack;
                        data.sent = info.ack.sent;
                        data.received = info.ack.received;
                        this.parent.getApp().log('WAW: Message ack %s', JSON.stringify(data));
                        this.parent.onReport(data);
                        delete this.messages[msg.id.id];
                    }
                }
            })
            .initialize()
        ;
        this.createBroadcastQueue();
    }

    /**
     * Create broadcast message queue dispatcher.
     */
    createBroadcastQueue() {
        const delay = () => {
            this.bwait = this.getDelay(this.bdelay);
        }
        /** @type {Queue} */
        this.bq = new Queue([], queue => {
            const f = err => {
                if (err) {
                    console.error(err);
                }
                this.bq.next();
            }
            this.sendChat(queue.contact, queue.msg)
                .then(() => f())
                .catch(err => f(err));
        }, () => this.isTime('btime', this.bwait, delay));
    }

    canConsume(msg, flags) {
        const number = this.normalizeNumber(msg.address);
        // i can't resent message
        if (flags && flags.retry) {
            return Promise.resolve(false);
        }
        return Work.works([
            ['contact', w => this.getWAContact(number)],
            ['broadcast', w => Promise.resolve(this.bq.requeue([{contact: w.getRes('contact'), msg}])),
                w => w.getRes('contact') && flags.broadcast],
            ['send', w => this.sendChat(w.getRes('contact'), msg),
                w => w.getRes('contact') && !flags.broadcast],
            ['resolve', w => Promise.resolve(w.getRes('contact') ? true : false)],
        ]);
    }

    close() {
        this.client.destroy();
    }

    /**
     * Get WhatsApp contact from phone number.
     *
     * @param {string} number Phone number
     * @returns {Promise<string>}
     */
    getWAContact(number) {
        return Work.works([
            [w => Promise.resolve(this.isWANumber(number))],
            [w => this.client.getNumberId(number), w => w.getRes(0)],
            [w => Promise.resolve(w.getRes(1) ? w.getRes(1)._serialized : null)],
        ]);
    }

    /**
     * Is chat exist for WhatsApp contact?
     *
     * @param {string} contact WhatsApp serialized contact
     * @returns {Promise<boolean}
     */
    isChatExist(contact) {
        return Work.works([
            [w => this.client.getChatById(contact)],
            [w => w.getRes(0).fetchMessages({limit: 1, fromMe: false})],
            [w => Promise.resolve(w.getRes(1).length ? true : false)],
        ]);
    }

    /**
     * Send chat message to WhatsApp contact.
     *
     * @param {string} contact WhatsApp serialized contact
     * @param {object} msg Message data
     * @returns {Promise<boolean>}
     */
    sendChat(contact, msg) {
        return Work.works([
            // is chat already present
            ['chat', w => this.isChatExist(contact)],
            // is eula need to send?
            ['eula', w => Promise.resolve(w.getRes('chat') ? false : !this.terms.exist(this.getContactNumber(contact))), w => !w.getRes('chat')],
            // send message
            ['send', w => this.sendMsg(contact, msg, w.getRes('eula') ? this.eula : null)],
            // wait a moment
            ['delay', w => this.noop(), w => w.getRes('send')],
            // save eula send state
            ['save', w => Promise.resolve(this.terms.add(this.getContactNumber(contact))), w => w.getRes('send') && w.getRes('eula')],
            // done
            ['resolve', w => Promise.resolve(w.getRes('send') ? true : false)],
        ]);
    }

    /**
     * Send WhatsApp message.
     *
     * @param {string} contact WhatsApp serialized contact
     * @param {object} msg Message data
     * @param {string} info Additional message to append to message
     * @returns {Promise<boolean>}
     */
    sendMsg(contact, msg, info = null) {
        let message = msg.data;
        if (info) {
            message += '\n\n' + info;
        }
        return Work.works([
            [w => this.client.sendMessage(contact, message)],
            [w => Promise.resolve(this.saveMsg(w.getRes(0), msg)), w => w.getRes(0)],
        ]);
    }

    /**
     * Check if phone number is using WhatsApp.
     *
     * @param {string} number Phone number
     * @returns {Promise<boolean>}
     */
    isWANumber(number) {
        return Work.works([
            [w => Promise.resolve(this.numbers.exist(number))],
            // check if number is using WA
            [w => this.client.isRegisteredUser(number), w => !w.getRes(0)],
            // using WA?
            [w => Promise.resolve(this.numbers.add(number)), w => !w.getRes(0) && w.getRes(1)],
            [w => Promise.resolve(true), w => !w.getRes(0) && w.getRes(1)],
            // not using WA?
            [w => Promise.resolve(false), w => !w.getRes(0) && !w.getRes(1)],
        ]);
    }

    /**
     * @param {ChatContact} storage Contact storage
     */
    migrateStorage(storage) {
        const filename = path.join(this.workdir, `${storage.name}.json`);
        if (fs.existsSync(filename)) {
            return new Promise((resolve, reject) => {
                const datas = JSON.parse(fs.readFileSync(filename));
                if (Array.isArray(datas)) {
                    for (const nr of datas) {
                        storage.add(nr);
                    }
                }
                fs.renameSync(filename, path.join(this.workdir, `${storage.name}~.json`));
                resolve();
            });
        } else {
            return Promise.resolve();
        }
    }

    /**
     * No operation.
     *
     * @returns {Promise<void>}
     */
    noop() {
        const delay = this.getDelay(this.delay);
        if (delay > 0) {
            return this.sleep(delay);
        } else {
            return Promise.resolve();
        }
    }

    /**
     * Sleep for milli seconds.
     *
     * @param {number} ms Time
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(), ms);
        });
    }

    /**
     * Get phone number from WhatsApp contact.
     *
     * @param {string} contact WhatsApp contact
     * @returns {string}
     */
    getContactNumber(contact) {
        return contact.split('@')[0];
    }

    /**
     * Normalize a phone number by removing international number sign (+).
     *
     * @param {string} number Phone number
     * @returns {string}
     */
    normalizeNumber(number) {
        if (number.substr(0, 1) === '+') {
            number = number.substr(1);
        }
        return number;
    }

    /**
     * Save WhatsApp message.
     *
     * @param {Message} msg WhatsApp message
     * @param {object} data Original message data
     * @returns {boolean}
     */
    saveMsg(msg, data) {
        if (msg && msg.id) {
            this.messages[msg.id.id] = {msg, data};
            return true;
        }
        return false;
    }

    /**
     * Check if time is due.
     *
     * @param {string} name Time identifier
     * @param {number} interval Interval
     * @param {any} cb On due callback
     * @returns {boolean}
     */
    isTime(name, interval, cb) {
        const now = new Date();
        /** @type {Date} */
        const time = this[name];
        if (time === undefined || (now.getTime() > time.getTime() + interval)) {
            this[name] = now;
            if (typeof cb === 'function') {
                cb();
            }
            return true;
        }
        return false;
    }

    /**
     * Generate hash.
     *
     * @param {Date} dt Date
     * @param {string} number Phone number
     * @param {string} message Text message
     * @returns {string}
     */
    getHash(dt, number, message) {
        const shasum = require('crypto').createHash('sha1');
        shasum.update([dt.toISOString(), number, message].join(''));
        return shasum.digest('hex');
    }

    /**
     * Get randomized delay.
     *
     * @param {number|number[]} ms Range or fixed delay
     * @returns {number}
     */
    getDelay(ms) {
        if (Array.isArray(ms)) {
            return this.getRnd(ms[0], ms[1]);
        }
        return ms !== undefined ? ms : 0;
    }

    /**
     * Get random number from range.
     *
     * @param {number} min Min
     * @param {number} max Max
     * @returns {number}
     */
    getRnd(min, max) {
        return Math.floor(Math.random() * (max - min)) + min;
    }
}

module.exports = WAWeb;