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
    /** @type {object[]} */
    messages = []

    initialize(config) {
        this.id = 'wa';
        this.workdir = path.dirname(this.parent.getApp().queueDir);
        this.numbers = new WANumber(path.join(this.workdir, 'wa.json'));
        this.terms = new WANumber(path.join(this.workdir, 'wa-tc.json'));
        if (config['delay'] !== undefined) {
            if (!(typeof config['delay'] === 'number' || Array.isArray(config['delay']))) {
                throw new Error('Delay only accept number or array of [min, max]!');
            }
            this.delay = config['delay'];
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
                const idx = this.getMsgIndex(msg);
                if (idx >= 0) {
                    const time = new Date();
                    if (!this.messages[idx].ack) {
                        this.messages[idx].ack = {};
                    }
                    if (ack === MessageAck.ACK_SERVER) {
                        this.messages[idx].ack.sent = time;
                    }
                    if (ack >= MessageAck.ACK_DEVICE) {
                        this.messages[idx].ack.received = time;
                        const data = {};
                        if (this.messages[idx].data.hash) {
                            data.hash = this.messages[idx].data.hash;
                        }
                        data.number = this.messages[idx].data.address;
                        data.code = config['ack-success'] !== undefined ? config['ack-success'] : ack;
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
        return Work.works([
            ['contact', w => this.getWAContact(number)],
            ['has-chat', w => this.isChatExist(w.getRes('contact')), w => w.getRes('contact')],
            ['tc', w => this.isTermAndConditionPending(number, w.getRes('contact')), w => !w.getRes('has-chat')],
            ['no-tc', w => Promise.resolve(false), w => !w.getRes('has-chat')],
            ['send-msg', w => this.client.sendMessage(w.getRes('contact'), msg.data), w => w.getRes('has-chat')],
            ['push-msg', w => Promise.resolve(this.messages.push({data: msg, msg: w.getRes('send-msg')})), w => w.getRes('has-chat')],
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

    isTermAndConditionPending(number, contact) {
        return Work.works([
            [w => Promise.resolve(this.terms.exist(number))],
            [w => this.client.sendMessage(contact, this.eula), w => !w.getRes(0)],
            [w => Promise.resolve(this.terms.add(number)), w => !w.getRes(0) && w.getRes(1)],
            [w => Promise.resolve(true), w => !w.getRes(0)],
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

    getMsgIndex(msg) {
        for (let i = 0; i < this.messages.length; i++) {
            if (this.messages[i].msg && this.messages[i].msg.id) {
                if (this.messages[i].msg.id.id === msg.id.id) {
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