/**
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

var net   = require('net');
var token = require('./token');
var util  = require('./util');

ntGw = module.exports = exports;

ntGw.connect = function(params) {
    var client = {
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
            var self = this;
            var args = Array.from(arguments);
            if (typeof self.options.log == 'function') {
                self.options.log.apply(null, args);
            } else {
                console.log.apply(null, args);
            }
        },
        handleData: function(data) {
            var self = this;
            if (data.length) {
                var lines = data.split(self.CMD_EOL);
                while (lines.length) {
                    var line = lines.shift();
                    self.processData(line);
                }
            }
        },
        processData: function(data) {
            var self = this;
            var s = data.indexOf(self.CMD_SEPARATOR);
            if (s > 0) {
                var cmd = data.substr(0, s);
                var params = token.split(data.substr(s + 1));
                if (cmd == self.CMD_WMSG) {
                    self.log(params.join(''));
                } else if (cmd == self.CMD_AUTH && params.length > 0) {
                    // check auth state
                    self.log('Authenticated: %s', params[0]);
                    self.authenticated = 'OK' == params[0] ? true : false;
                    if (self.authenticated && self.options.group) {
                        self.send(self.CMD_GROUP + self.CMD_SEPARATOR + self.options.group);
                    }
                } else if (cmd == self.CMD_DELIVERED && params.length > 4) {
                    if (typeof self.options.delivered == 'function') {
                        // hash, number, code (0 = success), sent, received
                        self.options.delivered(params[0], params[1], params[2], params[3], params[4]);
                    }
                } else if (cmd == self.CMD_MESSAGE && params.length > 3) {
                    if (typeof self.options.message == 'function') {
                        // date, number, message, hash
                        self.options.message(params[0], params[1], params[2], params[3]);
                    }
                } else if (cmd == self.CMD_READY && params.length > 0) {
                    self.ready = params[0] == 'OK';
                    if (self.ready) {
                        // immediatelly process queue if exists
                        if (self.queue.length) {
                            self.log('Text server is ready, processing queue...');
                            self.processQueue();
                        }
                    }
                } else {
                    self.log('Got command "%s" with parameters "%s"', cmd, params.join(', '));
                }
            }
        },
        processQueue: function() {
            var self = this;
            var f = function() {
                self.timeout = null;
                if (self.connected && self.ready) {
                    if (!self.busy && self.queues.length) {
                        self.busy = true;
                        var data = self.queues.shift();
                        self.send(data);
                    }
                }
                if (self.queues.length) {
                    self.timeout = setTimeout(f, 100);
                }
            }
            if (null == self.timeout) f();
        },
        send: function(data) {
            var self = this;
            self.log('Send "%s"', data);
            if (self.socket.write(data + self.CMD_EOL)) {
                self.busy = false;
            }
        },
        queue: function(cmd, params) {
            var self = this;
            var data = cmd + self.CMD_SEPARATOR + params.join(util.SEP);
            self.log('Queue "%s"', data);
            self.queues.push(data);
            self.processQueue();
        },
        sendText: function(number, message, hash, attr) {
            var self = this;
            if (typeof attr != 'undefined') {
                self.queue(self.CMD_TEXT, [number, token.quote(message), hash, attr]);
            } else if (typeof hash != 'undefined') {
                self.queue(self.CMD_TEXT, [number, token.quote(message), hash]);
            } else {
                self.queue(self.CMD_TEXT, [number, token.quote(message)]);
            }
        },
        init: function() {
            var self = this;
            self.socket = new net.Socket();
            var f = function() {
                self.log('Connecting to %s:%d...', self.options['host'], self.options['port']);
                self.socket.connect({
                    host: self.options['host'],
                    port: self.options['port']
                });
            }
            var r = function() {
                var interval = self.options.retry || 30;
                self.log('Will reconnect in %d second(s)', interval);
                setTimeout(f, interval * 1000);
            }
            self.socket.on('error', function(err) {
                self.log('Error: %s', err.message);
                r();
            });
            self.socket.on('connect', function() {
                self.connected = true;
                self.log('Connected to %s:%d',
                    self.socket.remoteFamily == 'IPv4' ? self.socket.remoteAddress : '[' + self.socket.remoteAddress + ']',
                    self.socket.remotePort);
                if (typeof self.options.securekey != 'undefined') {
                    self.send(self.CMD_AUTH + self.CMD_SEPARATOR + self.options.securekey);
                }
                if (typeof self.options.connect == 'function') {
                    self.options.connect(self.socket);
                }
            });
            self.socket.on('end', function(hasError) {
                self.connected = false;
                self.ready = false;
                self.log('Connection to %s:%d ended.',
                    self.socket.remoteFamily == 'IPv4' ? self.socket.remoteAddress : '[' + self.socket.remoteAddress + ']',
                    self.socket.remotePort);
                r();
            });
            self.socket.on('data', function(buffer) {
                var data = util.cleanBuffer(buffer);
                self.handleData(data);
            });
            self.socket.on('drain', function() {
                self.busy = false;
            });
            f();
            return this;
        }
    }
    return client.init();
}
