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
const mime = require('mime-types');
const Work = require('@ntlab/work/work');
const Queue = require('@ntlab/work/queue');
const Util = require('../lib/util');
const { ChatConsumer } = require('.');
const { ChatStorage } = require('./storage');
const { Client, Events, LocalAuth, Message, MessageAck, MessageMedia } = require('whatsapp-web.js');

/**
 * @typedef {Object} Attachment
 * @property {Buffer|string} content
 * @property {string} filename
 */

/**
 * A message consumer through WhatsApp.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class WAWebChat extends ChatConsumer {

    /** @type {WAWeb[]} */
    wawebs = []

    initialize(config) {
        this.id = 'wa';
        this.workdir = this.createWorkdir('.waweb');
        this.storage = new ChatStorage('waweb', this.workdir);
        let seq = 0;
        for (const cfg of Array.isArray(config['']) ? config[''] : [config]) {
            seq++;
            if (cfg.enabled !== undefined && !cfg.enabled) {
                continue;
            }
            this.wawebs.push(new WAWeb({
                name: `waweb-${seq}`,
                parent: this.parent,
                storage: this.storage,
                workdir: this.workdir,
                onState: () => this.updateState(),
                ...cfg
            }));
        }
        const q = new Queue([...this.wawebs], waweb => {
            waweb.initialize()
                .then(() => q.next())
                .catch(err => {
                    console.error(`${waweb.name}: WhatsApp Web initialization error: ${err}!`);
                    q.next();
                });
        });
        this.onRestart = cb => {
            this.close()
                .then(() => cb())
                .catch(err => console.error(err));
        }
    }

    createWorkdir(dir) {
        const workdir = path.join(this.parent.config.workdir, dir);
        fs.mkdirSync(workdir, {recursive: true});
        return workdir;
    }

    updateState() {
        let cnt = 0;
        for (const waweb of this.wawebs) {
            if (waweb.connected) {
                cnt++;
            }
        }
        this.connected = cnt > 0;
        this.parent.onState();
    }

    /**
     * Consume message.
     *
     * @param {import('../bridge/chat').ChatMessage} msg Message
     * @param {object} flags Mesage flags
     * @returns {Promise<boolean>}
     */
    canConsume(msg, flags) {
        let handler;
        // if message is a special type, check for handler which can accept it
        if (flags.type) {
            handler = this.wawebs
                .filter(waweb => waweb.connected &&
                    (
                        (Array.isArray(waweb.accept) && waweb.accept.includes(flags.type)) ||
                        waweb.accept === flags.type
                    )
                );
            if (!handler.length) {
                handler = undefined;
            }
        }
        // fallback to wildcard handler
        if (!handler) {
            handler = this.wawebs.filter(waweb => waweb.connected && waweb.accept === undefined);
        }
        if (!handler.length) {
            return Promise.resolve(false);
        }
        const idx = Math.floor(Math.random() * (handler.length - 1));
        return handler[idx].canConsume(msg, flags);
    }

    getState() {
        const state = [];
        for (const waweb of this.wawebs) {
            state.push(waweb.getState());
        }
        return state;
    }

    setState(state) {
        if (Array.isArray(state)) {
            for (let i = 0; i < state.length; i++) {
                if (this.wawebs.length > i) {
                    this.wawebs[i].setState(state[i]);
                }
            }
        }
    }

    close() {
        return new Promise((resolve, reject) => {
            const q = new Queue([...this.wawebs], waweb => {
                waweb.close()
                    .then(() => q.next())
                    .catch(err => {
                        console.error(`${waweb.name}: WhatsApp Web close error: ${err}!`);
                        q.next();
                    });
            });
            q.once('done', () => resolve());
        });
    }
}

/**
 * WhatsApp chat handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class WAWeb {

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
    /** @type {import('../bridge/chat')} */
    parent = null

    constructor(config) {
        this.name = config.name;
        this.parent = config.parent;
        this.storage = config.storage;
        this.numbers = this.storage.get(this.STOR_WA_NUMBERS);
        this.workdir = config.workdir;
        this.accept = config.accept;
        this.cleanLock = config.cleanLock !== undefined ? config.cleanLock : true;
        /** @type {string} */
        this.eula = config.eula !== undefined ? config.eula :
            'To improve user experience for our services, we will send the message through this channel.\nReply with *YES* to agree.';
        /** @type {number} */
        this.qrinterval = Util.ms(config['qr-notify-interval'] || 600); // 10 minutes
        /** @type {number} */
        this.qrretry = config['qr-notify-retry'] || 3;
        if (config.delay !== undefined) {
            if (!(typeof config.delay === 'number' || Array.isArray(config.delay))) {
                throw new Error('Delay only accept number or array of [min, max]!');
            }
            this.delay = Util.ms(config.delay);
        }
        this.bdelay = Util.ms(config['broadcast-delay'] || [60, 120]); // 1-2 minutes
        this.bcooldown = config['broadcast-cooldown']; // number of messages sent, last broadcast time delay, cooldown time
        const opts = {
            authStrategy: new LocalAuth({clientId: this.name, dataPath: this.workdir}),
            webVersionCache: {path: path.join(this.workdir, 'cache')}
        }
        if (config.puppeteer) {
            opts.puppeteer = config.puppeteer;
        }
        this.client = new Client(opts);
        this.client
            .on(Events.QR_RECEIVED, qr => {
                if (this.isTime('qrnotify', this.qrinterval)) {
                    console.log(`${this.name}: WhatsApp Web QR Code needed (${new Date()})!`);
                    const qrcode = require('qrcode-terminal');
                    qrcode.generate(qr, {small: true});
                    if (config.admin && this.qrcount++ < this.qrretry) {
                        const message = `${this.name}: WhatsApp Web requires QR Code authentication: ${qr}`;
                        const hash = this.getHash(time, config.admin, message);
                        this.parent.queue.requeue([{hash, number: config.admin, message, consumer: 'sms'}]);
                    }
                }
            })
            .on(Events.READY, () => {
                console.log(`${this.name}: WhatsApp Web is ready...`);
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
                console.log(`${this.name}: WhatsApp Web id is ${this.info.wid.user} (${this.info.pushname})`);
                if (typeof config.onState === 'function') {
                    config.onState(this);
                }
            })
            .on(Events.AUTHENTICATED, () => {
                console.log(`${this.name}: WhatsApp Web is authenticated...`);
            })
            .on(Events.DISCONNECTED, () => {
                console.log(`${this.name}: WhatsApp Web is disconnected...`);
                this.connected = false;
                this.qrcount = 0
                if (typeof config.onState === 'function') {
                    config.onState(this);
                }
            })
            .on(Events.MESSAGE_RECEIVED, msg => {
                if (msg.body) {
                    const time = new Date();
                    Work.works([
                        [w => Promise.resolve(msg.getContact())]
                    ])
                    .then(contact => {
                        const number = '+' + contact.number;
                        const hash = this.getHash(time, number, msg.body);
                        const data = {date: time, number, message: msg.body, hash};
                        this.parent.getApp().log(`${this.name}: WAW: New message %s`, JSON.stringify(data));
                        this.parent.onMessage(data);
                    })
                    .catch(err => console.error(err));
                }
            })
            .on(Events.MESSAGE_ACK, (msg, ack) => {
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
                        this.parent.getApp().log(`${this.name}: WAW: Message ack %s`, JSON.stringify(data));
                        this.parent.onReport(data);
                        delete this.messages[msg.id.id];
                    }
                }
            })
        ;
        this.createBroadcastQueue();
    }

    initialize() {
        return Work.works([
            [w => Promise.resolve(console.log(`${this.name}: WhatsApp Web is initializing...`))],
            [w => Promise.resolve(
                this.client.on(Events.READY, () => {
                    this.client.pupPage.evaluate(() => {
                        if (window.Store.ContactMethods && typeof window.Store.ContactMethods.getIsMyContact !== 'function') {
                            window.Store.ContactMethods = {
                                ...window.Store.ContactMethods,
                                ...window.require('WAWebFrontendContactGetters'),
                            }
                        }
                    });
                })
            )],
            [w => new Promise((resolve, reject) => {
                const authStrategy = this.client.authStrategy;
                if (authStrategy._beforeBrowserInitialized === undefined) {
                    authStrategy._beforeBrowserInitialized = authStrategy.beforeBrowserInitialized;
                    authStrategy.beforeBrowserInitialized = async () => {
                        await authStrategy._beforeBrowserInitialized();
                        if (authStrategy.userDataDir && !this.constructor.isClean(authStrategy.userDataDir)) {
                            console.log(`${this.name}: WhatsApp Web is cleaning lock in ${authStrategy.userDataDir}...`);
                            const files = fs.readdirSync(authStrategy.userDataDir);
                            for (const file of files) {
                                if (file.match('Singleton')) {
                                    const filePath = path.join(authStrategy.userDataDir, file);
                                    try {
                                        fs.unlinkSync(filePath);
                                    }
                                    catch (err) {
                                        console.error(`Unable to unlink ${filePath}: ${err}!`);
                                    }
                                }
                            }
                        }
                    }
                }
                resolve();
            }), w => this.cleanLock],
            [w => this.client.initialize()],
        ]);
    }

    /**
     * Create broadcast message queue dispatcher.
     */
    createBroadcastQueue() {
        const interval = () => {
            if (Array.isArray(this.bcooldown) && this.bcnt >= this.bcooldown[0]) {
                const now = new Date();
                if (now.getTime() < this.blast.getTime() + Util.ms(this.bcooldown[1])) {
                    if (!this.bcool) {
                        this.bcool = true;
                        console.log(`${this.name}: WhatsApp Web is cooling down for ${this.bcooldown[2]}s...`);
                    }
                    return Util.ms(this.bcooldown[2]);
                }
            }
            return this.bwait;
        }
        const callback = () => {
            if (this.bcnt === undefined || this.bcool) {
                this.bcnt = 0;
                if (this.bcool) {
                    this.bcool = false;
                }
            }
            this.bcnt++;
            this.blast = new Date();
            this.bwait = this.getDelay(this.bdelay);
        }
        /** @type {Queue} */
        this.bq = new Queue([], queue => {
            console.log(`${this.name}: Broadcast ${JSON.stringify(queue.msg)}`);
            const f = err => {
                if (err) {
                    console.error(err);
                }
                this.bq.next();
            }
            this.sendChat(queue.contact, queue.msg, queue.flags)
                .then(() => f())
                .catch(err => f(err));
        }, () => this.connected && this.isTime('btime', interval, callback));
    }

    getState() {
        return {
            messages: {...this.messages},
            broadcasts: [...this.bq.queues],
        }
    }

    setState(state) {
        if (state.messages && Object.keys(state.messages).length) {
            this.messages = {...state.messages};
        }
        if (Array.isArray(state.broadcasts)) {
            this.bq.requeue(state.broadcasts);
        }
    }

    /**
     * Consume message.
     *
     * @param {import('../bridge/chat').ChatMessage} msg Message
     * @param {object} flags Mesage flags
     * @returns {Promise<boolean>}
     */
    canConsume(msg, flags) {
        const number = this.normalizeNumber(msg.address);
        return Work.works([
            ['contact', w => this.getWAContact(number)],
            ['broadcast', w => Promise.resolve(this.bq.requeue([{contact: w.getRes('contact'), msg, flags}])),
                w => w.getRes('contact') && flags.broadcast],
            ['send', w => this.sendChat(w.getRes('contact'), msg, flags),
                w => w.getRes('contact') && !flags.broadcast],
            ['resolve', w => Promise.resolve(w.getRes('contact') ? true : false)],
        ]);
    }

    close() {
        if (this.client && this.client.pupBrowser) {
            return this.client.destroy();
        }
        return Promise.resolve();
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
     * @param {import('../bridge/chat').ChatMessage} msg Message data
     * @param {object|null} options Message options
     * @returns {Promise<boolean>}
     */
    sendChat(contact, msg, options = null) {
        options = options || {};
        return Work.works([
            // is chat already present
            ['chat', w => this.isChatExist(contact)],
            // is eula need to send?
            ['eula', w => Promise.resolve(w.getRes('chat') ? false : !this.terms.exist(this.getContactNumber(contact))), w => !w.getRes('chat')],
            // send message
            ['send', w => this.sendMsg(contact, msg, {...options, info: w.getRes('eula') ? this.eula : null, typing: w.getRes('chat')})],
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
     * @param {import('../bridge/chat').ChatMessage} msg Message data
     * @param {object|null} options Message options
     * @param {Attachment} options.attachment Message attachment
     * @param {string} options.info Additional message to append to original message
     * @param {boolean} options.typing Send typing before send the message
     * @returns {Promise<boolean>}
     */
    sendMsg(contact, msg, options = null) {
        options = options || {};
        const params = {};
        let message = msg.data;
        if (options.info) {
            message += '\n\n' + options.info;
        }
        if (options.attachment) {
            /** @type {Attachment} */
            const attachment = options.attachment;
            if (attachment.content && attachment.filename) {
                const data = attachment.content instanceof Buffer ? attachment.content : Buffer.from(attachment.content);
                params.media = new MessageMedia(mime.lookup(attachment.filename), data.toString('base64'), attachment.filename);
            }
        }
        return Work.works([
            ['chat', w => this.client.getChatById(contact), w => options.typing && !options.attachment],
            ['typing', w => w.getRes('chat').sendStateTyping(), w => w.getRes('chat')],
            ['sleep', w => this.sleep(1000), w => w.getRes('chat')],
            ['send', w => this.client.sendMessage(contact, message, params)],
            ['store', w => Promise.resolve(this.saveMsg(w.getRes('send'), msg)), w => w.getRes('send')],
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
     * @param {import('../bridge/chat').ChatMessage} data Original message data
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
     * @param {number|Function} interval Interval
     * @param {Function} cb On due callback
     * @returns {boolean}
     */
    isTime(name, interval, cb) {
        const now = new Date();
        /** @type {Date} */
        const time = this[name];
        if (typeof interval === 'function') {
            interval = interval();
        }
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

    static isClean(dir) {
        if (this.locks === undefined) {
            this.locks = [];
        }
        if (this.locks.includes(dir)) {
            return true;
        }
        this.locks.push(dir);
        return false;
    }
}

module.exports = WAWebChat;