/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2017 Toha <tohenk@yahoo.com>
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

/*
 * Terminal Gateway (GSM) client utility
 */

const net   = require('net');
const token = require('./token');
const util  = require('./util');

const ntGw = module.exports = exports;

ntGw.connect = function(params) {
    const client = {
        CMD_SEPARATOR: ' ',
        CMD_EOL: '\r\n',
        CMD_WMSG: 'WMSG',
        CMD_AUTH: 'AUTH',
        CMD_READY: 'READY',
        CMD_TEXT: 'TEXT',
        CMD_DELIVERED: 'DELV',
        CMD_MESSAGE: 'MESG',
        CMD_GROUP: 'GRUP',
        options: params || {},
        socket: null,
        connected: false,
        ready: false,
        busy: false,
        queues: [],
        timeout: null,
        authenticated: null,
        log: function() {
            var args = Array.from(arguments);
            if (typeof this.options.log == 'function') {
                this.options.log.apply(null, args);
            } else {
                console.log.apply(null, args);
            }
        },
        handleData: function(data) {
            if (data.length) {
                var lines = data.split(this.CMD_EOL);
                while (lines.length) {
                    var line = lines.shift();
                    this.processData(line);
                }
            }
        },
        processData: function(data) {
            var s = data.indexOf(this.CMD_SEPARATOR);
            if (s > 0) {
                var cmd = data.substr(0, s);
                var params = token.split(data.substr(s + 1));
                if (cmd == this.CMD_WMSG) {
                    this.log(params.join(''));
                } else if (cmd == this.CMD_AUTH && params.length > 0) {
                    // check auth state
                    this.log('Authenticated: %s', params[0]);
                    this.authenticated = 'OK' == params[0] ? true : false;
                    if (this.authenticated && this.options.group) {
                        this.send(this.CMD_GROUP + this.CMD_SEPARATOR + this.options.group);
                    }
                } else if (cmd == this.CMD_DELIVERED && params.length > 4) {
                    if (typeof this.options.delivered == 'function') {
                        // hash, number, code (0 = success), sent, received
                        this.options.delivered(params[0], params[1], params[2], params[3], params[4]);
                    }
                } else if (cmd == this.CMD_MESSAGE && params.length > 3) {
                    if (typeof this.options.message == 'function') {
                        // date, number, message, hash
                        this.options.message(params[0], params[1], params[2], params[3]);
                    }
                } else if (cmd == this.CMD_READY && params.length > 0) {
                    this.ready = params[0] == 'OK';
                    if (this.ready) {
                        // immediatelly process queue if exists
                        if (this.queue.length) {
                            this.log('Text server is ready, processing queue...');
                            this.processQueue();
                        }
                    }
                } else {
                    this.log('Got command "%s" with parameters "%s"', cmd, params.join(', '));
                }
            }
        },
        processQueue: function() {
            const f = () => {
                this.timeout = null;
                if (this.connected && this.ready) {
                    if (!this.busy && this.queues.length) {
                        this.busy = true;
                        const data = this.queues.shift();
                        this.send(data);
                    }
                }
                if (this.queues.length) {
                    this.timeout = setTimeout(f, 100);
                }
            }
            if (null == this.timeout) f();
        },
        send: function(data) {
            this.log('Send "%s"', data);
            if (this.socket.write(data + this.CMD_EOL)) {
                this.busy = false;
            }
        },
        queue: function(cmd, params) {
            const data = cmd + this.CMD_SEPARATOR + params.join(util.SEP);
            this.log('Queue "%s"', data);
            this.queues.push(data);
            this.processQueue();
        },
        sendText: function(number, message, hash, attr) {
            if (typeof attr != 'undefined') {
                this.queue(self.CMD_TEXT, [number, token.quote(message), hash, attr]);
            } else if (typeof hash != 'undefined') {
                this.queue(self.CMD_TEXT, [number, token.quote(message), hash]);
            } else {
                this.queue(self.CMD_TEXT, [number, token.quote(message)]);
            }
        },
        init: function() {
            this.socket = new net.Socket();
            const f = () => {
                this.log('Connecting to %s:%d...', this.options['host'], this.options['port']);
                this.socket.connect({
                    host: this.options['host'],
                    port: this.options['port']
                });
            }
            const r = () => {
                var interval = this.options.retry || 30;
                this.log('Will reconnect in %d second(s)', interval);
                setTimeout(f, interval * 1000);
            }
            this.socket.on('error', (err) => {
                this.log('Error: %s', err.message);
                r();
            });
            this.socket.on('connect', () => {
                this.connected = true;
                this.log('Connected to %s:%d',
                    this.socket.remoteFamily == 'IPv4' ? this.socket.remoteAddress : '[' + this.socket.remoteAddress + ']',
                    this.socket.remotePort);
                if (typeof this.options.securekey != 'undefined') {
                    this.send(this.CMD_AUTH + this.CMD_SEPARATOR + this.options.securekey);
                }
                if (typeof this.options.connect == 'function') {
                    this.options.connect(this.socket);
                }
            });
            this.socket.on('end', (hasError) => {
                this.connected = false;
                this.ready = false;
                this.log('Connection to %s:%d ended.',
                    this.socket.remoteFamily == 'IPv4' ? this.socket.remoteAddress : '[' + this.socket.remoteAddress + ']',
                    this.socket.remotePort);
                r();
            });
            this.socket.on('data', (buffer) => {
                const data = util.cleanBuffer(buffer);
                this.handleData(data);
            });
            this.socket.on('drain', () => {
                this.busy = false;
            });
            f();
            return this;
        }
    }
    return client.init();
}
