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

const ChatGateway = require('../bridge/chat');

/**
 * Chat factory.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatFactory {

    /** @type {ChatGateway} */
    parent = null
    /** @type {typeof ChatConsumer} */
    factory = null
    /** @type {object} */
    config = null
    /** @type {ChatConsumer} */
    instance = null

    /**
     * Constructor.
     *
     * @param {ChatGateway} parent The owner
     * @param {object} data Factory data
     */
    constructor(parent, data) {
        this.parent = parent;
        this.factory = data.factory;
        this.config = data.config;
    }

    /**
     * Create an instance.
     *
     * @returns {ChatConsumer}
     */
    create() {
        if (this.instance === null) {
            this.instance = new this.factory(this.parent);
            if (!this.instance instanceof ChatConsumer) {
                throw new Error(`${this.instance.constructor.name} must be a sub class of ChatConsumer.`);
            }
            this.instance.priority = this.config.priority;
            this.instance.initialize(this.config);
            if (this.config['restart-every']) {
                setTimeout(() => {
                    const idx = this.parent.consumers.indexOf(this.instance);
                    if (idx >= 0) {
                        const delay = this.config['restart-delay'] || 60000;
                        setTimeout(() => {
                            let state;
                            this.parent.consumers.splice(idx, 1);
                            try {
                                state = this.instance.getState();
                                this.instance.close();
                            }
                            catch (err) {
                                console.error(`Error closing ${this.factory.name}: ${err}!`);
                            }
                            this.instance = null;
                            this.create();
                            if (state) {
                                this.instance.setState(state);
                            }
                        }, delay);
                        console.log(`Restart for ${this.factory.name} scheduled in ${delay / 1000}s...`);
                    }
                }, this.config['restart-every']);
            }
            this.parent.consumers.push(this.instance);
        }
        return this.instance;
    }
}

/**
 * Chat consumer.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatConsumer {

    /** @type {string} */
    id = null
    /** @type {ChatGateway} */
    parent = null
    /** @type {string} */
    connected = false

    /**
     * Constructor.
     *
     * @param {ChatGateway} parent The owner
     */
    constructor(parent) {
        this.parent = parent;
    }

    /**
     * Initialize consumer.
     *
     * @param {object} config Configuration
     */
    initialize(config) {
    }

    /**
     * Get consumer id.
     *
     * @returns {string}
     */
    getId() {
        return this.id;
    }

    /**
     * Is consumer connected?
     *
     * @returns {boolean}
     */
    isConnected() {
        return this.connected;
    }

    /**
     * Get current state.
     *
     * @returns {object|undefined}
     */
    getState() {
    }

    /**
     * Set current state.
     *
     * @param {object} state Saved state
     * @returns {void}
     */
    setState(state) {
    }

    /**
     * Is consumer can handle the message?
     *
     * @param {import('../bridge/chat').ChatMessage} msg Message
     * @returns {boolean}
     */
    canHandle(msg) {
        if (this.isConnected()) {
            if (msg.consumer) {
                return msg.consumer === this.id;
            }
            return true;
        }
        return false;
    }

    /**
     * Consume message.
     *
     * @param {import('../bridge/chat').ChatMessage} msg Message
     * @param {object} flags Mesage flags
     * @returns {Promise<boolean>}
     */
    canConsume(msg, flags) {
        return Promise.reject('Not handled!');
    }

    /**
     * End consumer session.
     */
    close() {
    }
}

module.exports = {
    ChatFactory,
    ChatConsumer
}