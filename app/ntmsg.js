/**
 * Copyright (c) 2016 Toha <tohenk@yahoo.com>
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

var path  = require('path');
var client = require('../lib/ntgw.client');

module.exports = exports = MessagingServer;

var Sockets = {};

function MessagingServer(appserver, socketFactory, logger, options) {
    var app = {
        CON_SERVER: 1,
        CON_CLIENT: 2,
        appserver: appserver,
        util: appserver.util,
        logger: logger,
        io: null,
        options: options || {},
        registerTimeout: 60,
        serverRoom: 'server',
        textClient: null,
        log: function() {
            var args = Array.from(arguments);
            if (args.length) args[0] = this.util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            this.logger.log.apply(null, args);
        },
        error: function() {
            var args = Array.from(arguments);
            if (args.length) args[0] = this.util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            this.logger.error.apply(null, args);
        },
        findCLI: function(cli) {
            var self = this;
            var configPath = path.dirname(self.appserver.config);
            return self.util.findCLI(path.normalize(cli), [__dirname, configPath]);
        },
        execCLI: function(bin, args, values) {
            var self = this;
            var p = self.util.exec(bin, args, values);
            p.on('exit', function(code) {
                self.log('Result %s...', code);
            });
            p.stdout.on('data', function(line) {
                var line = self.util.cleanBuffer(line);
                self.log(line);
            });
            p.stderr.on('data', function(line) {
                var line = self.util.cleanBuffer(line);
                self.log(line);
            });
        },
        connectTextServer: function() {
            var self = this;
            if (typeof self.options['text-server'] == 'undefined') return;
            if (null == self.textClient) {
                var params = self.options['text-server'];
                params.log = function() {
                    // use error log for text server logs
                    self.error.apply(self, Array.from(arguments));
                }
                if (typeof self.options['text-client'] != 'undefined') {
                    var config = self.options['text-client'];
                    var bin = null;
                    var args = null;
                    var defaultArgs = ['-f', '%CLI%', '--', 'ntucp:messaging', '--application=%APP%', '--env=%ENV%', '%CMD%', '%DATA%'];
                    var values = {
                        'APP': 'frontend',
                        'ENV': self.appserver.app.settings.env == 'development' ? 'dev' : 'prod'
                    };
                    // params is cli itself
                    if (typeof config == 'string') {
                        values.CLI = self.findCLI(config);
                    }
                    // params is array (bin, cli, and args)
                    if (typeof config == 'object') {
                        if (config.bin) bin = config.bin;
                        if (config.cli) values.CLI = self.findCLI(config.cli);
                        if (typeof config.args != 'undefined') args = Array.from(config.args);
                    }
                    if (values.CLI) console.log('Text client CLI %s...', values.CLI);
                    params.delivered = function(hash, number, code, sent, received) {
                        self.log('%s: Delivery status for %s is %s', hash, number, code);
                        values.CMD = 'DELV';
                        values.DATA = JSON.stringify({hash: hash, number: number, code: code, sent: sent, received: received});
                        self.execCLI(bin ? bin : 'php', args ? args : defaultArgs, values);
                    }
                    params.message = function(date, number, message, hash) {
                        self.log('%s: New message from %s', hash, number);
                        values.CMD = 'MESG';
                        values.DATA = JSON.stringify({date: date, number: number, message: message, hash: hash});
                        self.execCLI(bin ? bin : 'php', args ? args : defaultArgs, values);
                    }
                }
                self.textClient = new client.connect(params);
            }
        },
        getUsers: function() {
            var users = [];
            for (id in Sockets) {
                if (Sockets[id].type == this.CON_CLIENT) {
                    users.push({uid: Sockets[id].uid, time: Sockets[id].time});
                }
            }
            return users;
        },
        addSocket: function(socket, data) {
            if (!Sockets[socket.id]) {
                data.socket = socket;
                data.time = Date.now();
                Sockets[socket.id] = data;
            }
        },
        removeSocket: function(socket) {
            if (Sockets[socket.id]) {
                var data = Sockets[socket.id];
                switch (data.type) {
                    case this.CON_SERVER:
                        socket.leave(this.serverRoom);
                        this.log('%s: Server disconnected...', socket.id);
                        break;
                    case this.CON_CLIENT:
                        socket.leave(data.uid);
                        // notify other users someone is offline
                        this.io.emit('user-offline', data.uid);
                        this.log('%s: User %s disconnected...', socket.id, data.uid);
                        break;
                }
                delete Sockets[socket.id];
            }
        },
        handleServerCon: function(socket) {
            var self = this;
            socket.on('whos-online', function() {
                self.log('%s: [Server] Query whos-online...', socket.id);
                socket.emit('whos-online', self.getUsers());
            });
            socket.on('notify', function(data) {
                self.log('%s: [Server] New notification for %s...', socket.id, data.uid);
                var notif = {
                    message: data.message
                }
                if (data.code) notif.code = data.code;
                if (data.referer) notif.referer = data.referer;
                self.io.to(data.uid).emit('notification', notif);
            });
            socket.on('message', function(data) {
                self.log('%s: [Server] New message for %s...', socket.id, data.uid);
                self.io.to(data.uid).emit('new-message');
            });
            socket.on('text-message', function(data) {
                self.log('%s: [Server] Send text to %s "%s"...', socket.id, data.number, data.message);
                if (self.textClient) {
                    self.textClient.sendText(data.number, data.message, data.hash);
                }
            });
        },
        handleClientCon: function(socket) {
            var self = this;
            socket.on('notification-read', function(data) {
                if (data.uid) {
                    self.io.to(data.uid).emit('notification-read', data);
                }
            });
            socket.on('message-sent', function(data) {
                if (data.uid) {
                    self.io.to(data.uid).emit('message-sent', data);
                }
            });
        },
        setupCon: function(socket) {
            var self = this;
            // disconnect if not registered within timeout
            var t = setTimeout(function() {
                socket.disconnect(true);
            }, self.registerTimeout * 1000);
            socket.on('register', function(data) {
                var dismiss = true;
                var info = {};
                // is it a server connection?
                if (data.sid) {
                    if (data.sid == self.serverKey) {
                        dismiss = false;
                        info.sid = data.sid;
                        info.type = self.CON_SERVER;
                        socket.join(self.serverRoom);
                        self.handleServerCon(socket);
                        self.log('%s: Server connected...', socket.id);
                    } else {
                        self.log('%s: Server didn\'t send correct key...', socket.id);
                    }
                } else if (data.uid) {
                    dismiss = false;
                    info.uid = data.uid;
                    info.type = self.CON_CLIENT;
                    socket.join(data.uid);
                    self.handleClientCon(socket);
                    // notify other users someone is online
                    self.io.emit('user-online', data.uid);
                    self.log('%s: User %s connected...', socket.id, data.uid);
                } else {
                    self.log('%s: Invalid registration...', socket.id, data.uid);
                }
                if (dismiss) {
                    socket.disconnect(true);
                    self.log('%s: Forced disconnect...', socket.id);
                } else {
                    self.addSocket(socket, info);
                    clearTimeout(t);
                }
            });
            socket.on('disconnect', function() {
                self.removeSocket(socket);
            });
        },
        listen: function(socket) {
            var self = this;
            socket.on('connection', function(client) {
                self.setupCon(client);
            });
        },
        init: function() {
            if (typeof this.options.key == 'undefined') {
                throw new Error('Server key not defined!');
            }
            if (typeof this.options.timeout != 'undefined') {
                this.registerTimeout = this.options.timeout;
            }
            this.serverKey = this.options.key;
            var ns = this.options.namespace || null;
            this.io = socketFactory(ns);
            this.listen(this.io);
            this.connectTextServer();
        }
    }
    app.init();

    return app;
}

// EOF