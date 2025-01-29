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
const { ChatConsumer } = require('.');
const { Client, LocalAuth, MessageAck } = require('whatsapp-web.js');

/**
 * A message consumer through WhatsAppchat.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class WAWeb extends ChatConsumer {

    /** @type {Client} */
    client = null
    /** @type {Date} */
    qrnotify = null
    /** @type {number} */
    qrcount = 0
    /** @type {number} */
    delay = 0
    /** @type {object} */
    messages = {}

    initialize(config) {
        this.id = 'wa';
        this.workdir = path.dirname(this.parent.getApp().queueDir);
        this.numbers = new WANumber(path.join(this.workdir, 'wa.json'));
        this.terms = new WANumber(path.join(this.workdir, 'wa-tc.json'));
        if (config.delay !== undefined) {
            if (!(typeof config.delay === 'number' || Array.isArray(config.delay))) {
                throw new Error('Delay only accept number or array of [min, max]!');
            }
            this.delay = config.delay;
        }
        this.eula = config.eula || 'To improve user experience for our services, we will send the message through this channel.\nReply with *YES* to agree.';
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
                if (this.qrnotify === null || (time.getTime() > this.qrnotify.getTime() + interval)) {
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
    }

    canConsume(msg, flags) {
        const number = this.normalizeNumber(msg.address);
        // i don't like broadcast message
        // i can't resent message
        if (flags && (flags.broadcast || flags.retry)) {
            return Promise.resolve(false);
        }
        return Work.works([
            ['contact', w => this.getWAContact(number)],
            ['has-chat', w => this.isChatExist(w.getRes('contact')), w => w.getRes('contact')],
            ['tc', w => this.isTermAndConditionPending(number, w.getRes('contact'), msg), w => !w.getRes('has-chat')],
            ['no-tc', w => Promise.resolve(w.getRes('tc')), w => !w.getRes('has-chat')],
            ['send-msg', w => this.sendMsg(w.getRes('contact'), msg), w => w.getRes('has-chat')],
            ['delay', w => Promise.resolve(this.getDelay()), w => w.getRes('has-chat')],
            ['sleep', w => this.sleep(w.getRes('delay')), w => w.getRes('has-chat') && w.getRes('delay') > 0],
            ['resolve', w => Promise.resolve(w.getRes('send-msg') ? true : false), w => w.getRes('has-chat')],
        ]);
    }

    close() {
        this.client.destroy();
    }

    sleep(ms) {
        return new Promise((resolve, reject) => {
            setTimeout(() => resolve(), ms);
        });
    }

    getWAContact(number) {
        return Work.works([
            [w => Promise.resolve(this.isWANumber(number))],
            [w => this.client.getNumberId(number), w => w.getRes(0)],
            [w => Promise.resolve(w.getRes(1) ? w.getRes(1)._serialized : null)],
        ]);
    }

    isChatExist(contact) {
        return Work.works([
            [w => this.client.getChatById(contact)],
            [w => w.getRes(0).fetchMessages({limit: 1, fromMe: false})],
            [w => Promise.resolve(w.getRes(1).length ? true : false)],
        ]);
    }

    isTermAndConditionPending(number, contact, msg) {
        return Work.works([
            [w => Promise.resolve(this.terms.exist(number))],
            [w => this.sendMsg(contact, msg, this.eula), w => !w.getRes(0)],
            [w => Promise.resolve(this.terms.add(number)), w => w.getRes(1)],
            [w => Promise.resolve(true), w => !w.getRes(0)],
        ]);
    }

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

    normalizeNumber(number) {
        if (number.substr(0, 1) === '+') {
            number = number.substr(1);
        }
        return number;
    }

    saveMsg(msg, data) {
        if (msg && msg.id) {
            this.messages[msg.id.id] = {msg, data};
            return true;
        }
        return false;
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

/**
 * WhatsApp contact number.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class WANumber {

    /**
     * Constructor.
     *
     * @param {string} filename Filename
     */
    constructor(filename) {
        this.filename = filename;
    }

    /**
     * Load numbers from file.
     *
     * @param {boolean} force True to force load
     * @returns {WANumber}
     */
    load(force = null) {
        if (this.numbers === undefined || force) {
            if (fs.existsSync(this.filename)) {
                this.numbers = JSON.parse(fs.readFileSync(this.filename));
            } else {
                this.numbers = [];
            }
        }
        return this;
    }

    /**
     * Add or save the entire numbers to file.
     *
     * @param {string} number The phone number
     * @returns {WANumber}
     */
    add(number) {
        if (number) {
            this.load();
            this.numbers.push(number);
        }
        if (this.numbers) {
            fs.writeFileSync(this.filename, JSON.stringify(this.numbers));
        }
        return this;
    }

    /**
     * Is phone number exist?
     *
     * @param {string} number The phone number
     * @returns {boolean}
     */
    exist(number) {
        this.load();
        return this.numbers.indexOf(number) >= 0;
    }
}

module.exports = WAWeb;