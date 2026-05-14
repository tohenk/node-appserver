/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2026 Toha <tohenk@yahoo.com>
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

const MessagingServer = require('../app/ntmsg');
const io = require('socket.io-client');
const debug = require('debug')('appserver:bridge');

class MessagingBridge {

    /** @type {MessagingServer} */
    app = null
    /** @type {object} */
    config = {}
    /** @type {io.Socket[]} */
    servers = []
    /** @type {io.Socket[]} */
    clients = []

    constructor(app) {
        this.app = app;
    }

    initialize(config) {
        this.config = config;
        if (typeof this.onInit === 'function') {
            this.onInit();
        }
    }

    finalize() {
        if (typeof this.onFinalize === 'function') {
            this.onFinalize();
        }
    }

    getApp() {
        return this.app;
    }

    getConfig(key) {
        return this.config[key];
    }

    handleServer(con) {
        if (typeof this.serverHandlers === 'object') {
            for (const [event, handler] of Object.entries(this.serverHandlers)) {
                con.on(event, async data => {
                    debug('Handling server event', event, 'from', con.id, 'with', data);
                    const res = await handler({con, data});
                    if (res !== undefined) {
                        con.emit(event, res);
                    }
                });
            }
        }
    }

    handleClient(con) {
        if (typeof this.clientHandlers === 'object') {
            for (const [event, handler] of Object.entries(this.clientHandlers)) {
                con.on(event, async data => {
                    debug('Handling client event', event, 'from', con.id, 'with', data);
                    const res = await handler({con, data});
                    if (res !== undefined) {
                        con.emit(event, res);
                    }
                });
            }
        }
    }

    disconnect(con) {
        let idx = this.servers.indexOf(con);
        if (idx >= 0) {
            this.servers.splice(idx, 1);
        }
        idx = this.clients.indexOf(con);
        if (idx >= 0) {
            this.clients.splice(idx, 1);
        }
    }

    /**
     * Create socket client.
     *
     * @param {object} params Client parameters
     * @param {string} params.url Socket url with namespace
     * @param {object} params.options Socket options
     * @returns {io.Socket}
     */
    createSocketClient(params) {
        let socketUrl = params.url;
        if (socketUrl) {
            const options = params.options || {};
            // guess socket io path automatically
            if (!options.path) {
                const url = new URL(params.url);
                const path = url.pathname
                    .split('/')
                    .filter(a => a.length);
                if (path.length > 1) {
                    // remove namespace
                    const ns = path.pop();
                    // set socket.io path
                    options.path = `/${path.join('/')}/socket.io/`;
                    // update socket url
                    url.pathname = `/${ns}`;
                    socketUrl = url.toString();
                }
            }
            if (params.token) {
                if (!options.extraHeaders) {
                    options.extraHeaders = {};
                }
                options.extraHeaders.Authorization = `Bearer ${params.token}`;
            }
            return io(socketUrl, options);
        } else {
            throw new Error('Unable to create socket client without url!');
        }
    }
}

module.exports = MessagingBridge;