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

var fs    = require('fs');
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
        textCLI: null,
        emailCLI: null,
        userNotifierCLI: null,
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
        getCliPaths: function() {
            var self = this;
            return [__dirname, path.dirname(self.appserver.config)];
        },
        getTextCLI: function(config) {
            var self = this;
            if (self.textCLI == null) {
                self.textCLI = require('../lib/cli')({
                    paths: self.getCliPaths(),
                    args: ['ntucp:messaging', '--application=%APP%', '--env=%ENV%', '%CMD%', '%DATA%'],
                    values: {
                        'APP': 'frontend',
                        'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                    }
                });
                self.textCLI.init(config);
                if (self.textCLI.values.CLI) console.log('Text client CLI %s...', self.textCLI.values.CLI);
            }
            return self.textCLI;
        },
        getEmailCLI: function(config) {
            var self = this;
            if (self.emailCLI == null) {
                self.emailCLI = require('../lib/cli')({
                    paths: self.getCliPaths(),
                    args: ['ntucp:deliver-email', '--application=%APP%', '--env=%ENV%', '%HASH%'],
                    values: {
                        'APP': 'frontend',
                        'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                    }
                });
                self.emailCLI.init(config);
                if (self.emailCLI.values.CLI) console.log('Email delivery using %s...', self.emailCLI.values.CLI);
            }
            return self.emailCLI;
        },
        getUserNotifierCLI: function(config) {
            var self = this;
            if (self.userNotifierCLI == null) {
                self.userNotifierCLI = require('../lib/cli')({
                    paths: self.getCliPaths(),
                    args: ['ntucp:signin-notify', '--application=%APP%', '--env=%ENV%', '%ACTION%', '%DATA%'],
                    values: {
                        'APP': 'frontend',
                        'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                    }
                });
                self.userNotifierCLI.init(config);
                if (self.userNotifierCLI.values.CLI) console.log('Signin notifier using %s...', self.userNotifierCLI.values.CLI);
            }
            return self.userNotifierCLI;
        },
        execCLI: function(cli, values) {
            var self = this;
            var p = cli.exec(values);
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
                    var cli = self.getTextCLI(self.options['text-client']);
                    params.delivered = function(hash, number, code, sent, received) {
                        self.log('%s: Delivery status for %s is %s', hash, number, code);
                        self.execCLI(cli, {
                            CMD: 'DELV',
                            DATA: JSON.stringify({hash: hash, number: number, code: code, sent: sent, received: received})
                        });
                    }
                    params.message = function(date, number, message, hash) {
                        self.log('%s: New message from %s', hash, number);
                        self.execCLI(cli, {
                            CMD: 'MESG',
                            DATA: JSON.stringify({date: date, number: number, message: message, hash: hash})
                        });
                    }
                }
                self.textClient = new client.connect(params);
                if (fs.existsSync(self.queueData)) {
                    var queues = JSON.parse(fs.readFileSync(self.queueData));
                    for (var i = 0; i < queues.length; i++) {
                        self.textClient.queues.push(queues[i]);
                    }
                    fs.unlinkSync(self.queueData);
                    self.log('%s queue(s) loaded from %s...', queues.length, this.queueData);
                }
            }
        },
        deliverEmail: function(hash) {
            var self = this;
            if (typeof self.options['email-sender'] != 'undefined') {
                var cli = self.getEmailCLI(self.options['email-sender']);
                self.execCLI(cli, {
                    HASH: hash
                });
            }
        },
        notifySignin: function(action, data) {
            var self = this;
            if (typeof self.options['user-notifier'] != 'undefined') {
                var cli = self.getUserNotifierCLI(self.options['user-notifier']);
                self.execCLI(cli, {
                    ACTION: action,
                    DATA: JSON.stringify(data)
                });
            }
        },
        getUsers: function() {
            var users = [];
            var uids = [];
            for (id in Sockets) {
                if (Sockets[id].type == this.CON_CLIENT) {
                    if (uids.indexOf(Sockets[id].uid) < 0) {
                        users.push({uid: Sockets[id].uid, time: Sockets[id].time});
                        uids.push(Sockets[id].uid);
                    }
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
                var users = self.getUsers();
                socket.emit('whos-online', users);
                for (var i = 0; i < users.length; i++) {
                    self.log('%s: [Server] User: %s, time: %d', socket.id, users[i].uid, users[i].time);
                }
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
            socket.on('deliver-email', function(data) {
                self.log('%s: [Server] Deliver email %s...', socket.id, data.hash);
                self.deliverEmail(data.hash);
            });
            socket.on('user-signin', function(data) {
                self.log('%s: [Server] User signin %s...', socket.id, data.username);
                self.notifySignin('SIGNIN', data);
            });
            socket.on('user-signout', function(data) {
                self.log('%s: [Server] User signout %s...', socket.id, data.username);
                self.notifySignin('SIGNOUT', data);
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
        doClose: function(server) {
            var self = this;
            if (self.textClient && self.textClient.queues.length) {
                fs.writeFileSync(self.queueData, JSON.stringify(self.textClient.queues));
                self.log('Queue saved to %s...', this.queueData);
            }
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
            this.queueData = path.dirname(appserver.config) + path.sep + 'queue' + path.sep + 'text.json';
            if (!fs.existsSync(path.dirname(this.queueData))) {
                fs.mkdirSync(path.dirname(this.queueData));
            }
        }
    }
    app.init();

    return app;
}

// EOF