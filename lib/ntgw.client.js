/*
 * Terminal Gateway (GSM) client utility
 * (c) 2016 Toha <tohenk@yahoo.com>
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
        CMD_TEXT: 'TEXT',
        CMD_DELIVERED: 'DELV',
        CMD_MESSAGE: 'MESG',
        options: params || {},
        socket: null,
        connected: false,
        busy: false,
        queue: [],
        timeout: null,
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
                var s = data.indexOf(self.CMD_SEPARATOR);
                if (s > 0) {
                    var cmd = data.substr(0, s);
                    var params = token.split(data.substr(s + 1));
                    if (cmd == self.CMD_WMSG) {
                        self.log(params.join(''));
                    } else if (cmd == self.CMD_DELIVERED && params.length > 2) {
                        if (typeof self.options.delivered == 'function') {
                            // date, hash, code (0 = success)
                            self.options.delivered(params[0], params[1], params[2]);
                        }
                    } else if (cmd == self.CMD_MESSAGE && params.length > 3) {
                        if (typeof self.options.message == 'function') {
                            // date, number, message, hash
                            self.options.message(params[0], params[1], params[2], params[3]);
                        }
                    } else {
                        self.log('Got command "%s" with parameters "%s"', cmd, params.join(', '));
                    }
                }
            }
        },
        processQueue: function() {
            var self = this;
            var f = function() {
                if (self.connected) {
                    self.timeout = null;
                    if (!self.busy && self.queue.length) {
                        self.busy = true;
                        var data = self.queue.shift();
                        if (self.socket.write(data)) {
                            self.busy = false;
                        }
                    }
                    if (self.queue.length) {
                        self.timeout = setTimeout(f, 100);
                    }
                }
            }
            if (null == self.timeout) f();
        },
        send: function(cmd, params) {
            var self = this;
            var data = cmd + self.CMD_SEPARATOR + params.join(util.SEP) + self.CMD_EOL;
            self.queue.push(data);
            self.processQueue();
        },
        sendText: function(number, message, hash) {
            var self = this;
            self.send(self.CMD_TEXT, [number, token.quote(message), hash]);
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
                if (typeof self.options.connect == 'function') {
                    self.options.connect(self.socket);
                }
                // immediatelly process queue if exists
                if (self.queue.length) self.processQueue();
            });
            self.socket.on('end', function(hasError) {
                self.connected = false;
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
        }
    }
    client.init();

    return client;
}
