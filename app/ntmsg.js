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

var Connections = {};

function MessagingServer(appserver, factory, logger, options) {
    var app = {
        CON_SERVER: 1,
        CON_CLIENT: 2,
        appserver: appserver,
        util: appserver.util,
        logger: logger,
        con: null,
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
        deliverEmail: function(hash, attr) {
            var self = this;
            if (typeof self.options['email-sender'] != 'undefined') {
                var cli = self.getEmailCLI(self.options['email-sender']);
                var params = {
                    HASH: hash
                };
                if (typeof attr != 'undefined') {
                    params.ATTR = attr;
                }
                self.execCLI(cli, params);
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
            for (id in Connections) {
                if (Connections[id].type == this.CON_CLIENT) {
                    if (uids.indexOf(Connections[id].uid) < 0) {
                        users.push({uid: Connections[id].uid, time: Connections[id].time});
                        uids.push(Connections[id].uid);
                    }
                }
            }
            return users;
        },
        addCon: function(con, data) {
            if (!Connections[con.id]) {
                data.con = con;
                data.time = Date.now();
                Connections[con.id] = data;
            }
        },
        removeCon: function(con) {
            if (Connections[con.id]) {
                var data = Connections[con.id];
                switch (data.type) {
                    case this.CON_SERVER:
                        con.leave(this.serverRoom);
                        this.log('%s: Server disconnected...', con.id);
                        break;
                    case this.CON_CLIENT:
                        con.leave(data.uid);
                        // notify other users someone is offline
                        this.con.emit('user-offline', data.uid);
                        this.log('%s: User %s disconnected...', con.id, data.uid);
                        break;
                }
                delete Connections[con.id];
            }
        },
        handleServerCon: function(con) {
            var self = this;
            con.on('whos-online', function() {
                self.log('%s: [Server] Query whos-online...', con.id);
                var users = self.getUsers();
                con.emit('whos-online', users);
                for (var i = 0; i < users.length; i++) {
                    self.log('%s: [Server] User: %s, time: %d', con.id, users[i].uid, users[i].time);
                }
            });
            con.on('notification', function(data) {
                self.log('%s: [Server] New notification for %s...', con.id, data.uid);
                var notif = {
                    message: data.message
                }
                if (data.code) notif.code = data.code;
                if (data.referer) notif.referer = data.referer;
                self.con.to(data.uid).emit('notification', notif);
            });
            con.on('message', function(data) {
                self.log('%s: [Server] New message for %s...', con.id, data.uid);
                self.con.to(data.uid).emit('message');
            });
            con.on('text-message', function(data) {
                self.log('%s: [Server] Send text to %s "%s"...', con.id, data.number, data.message);
                if (self.textClient) {
                    if (data.attr) {
                        self.textClient.sendText(data.number, data.message, data.hash, data.attr);
                    } else {
                        self.textClient.sendText(data.number, data.message, data.hash);
                    }
                }
            });
            con.on('deliver-email', function(data) {
                self.log('%s: [Server] Deliver email %s...', con.id, data.hash);
                if (data.attr) {
                    self.deliverEmail(data.hash, data.attr);
                } else {
                    self.deliverEmail(data.hash);
                }
            });
            con.on('user-signin', function(data) {
                self.log('%s: [Server] User signin %s...', con.id, data.username);
                self.notifySignin('SIGNIN', data);
            });
            con.on('user-signout', function(data) {
                self.log('%s: [Server] User signout %s...', con.id, data.username);
                self.notifySignin('SIGNOUT', data);
            });
        },
        handleClientCon: function(con) {
            var self = this;
            con.on('notification-read', function(data) {
                if (data.uid) {
                    self.con.to(data.uid).emit('notification-read', data);
                }
            });
            con.on('message-sent', function(data) {
                if (data.uid) {
                    self.con.to(data.uid).emit('message-sent', data);
                }
            });
        },
        setupCon: function(con) {
            var self = this;
            // disconnect if not registered within timeout
            var t = setTimeout(function() {
                con.disconnect(true);
            }, self.registerTimeout * 1000);
            con.on('register', function(data) {
                var dismiss = true;
                var info = {};
                // is it a server connection?
                if (data.sid) {
                    if (data.sid == self.serverKey) {
                        dismiss = false;
                        info.sid = data.sid;
                        info.type = self.CON_SERVER;
                        con.join(self.serverRoom);
                        self.handleServerCon(con);
                        self.log('%s: Server connected...', con.id);
                    } else {
                        self.log('%s: Server didn\'t send correct key...', con.id);
                    }
                } else if (data.uid) {
                    dismiss = false;
                    info.uid = data.uid;
                    info.type = self.CON_CLIENT;
                    con.join(data.uid);
                    self.handleClientCon(con);
                    // notify other users someone is online
                    self.con.emit('user-online', data.uid);
                    self.log('%s: User %s connected...', con.id, data.uid);
                } else {
                    self.log('%s: Invalid registration...', con.id, data.uid);
                }
                if (dismiss) {
                    con.disconnect(true);
                    self.log('%s: Forced disconnect...', con.id);
                } else {
                    self.addCon(con, info);
                    clearTimeout(t);
                }
            });
            con.on('disconnect', function() {
                self.removeCon(con);
            });
        },
        listen: function(con) {
            var self = this;
            con.on('connection', function(client) {
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
            var self = this;
            if (typeof self.options.key == 'undefined') {
                throw new Error('Server key not defined!');
            }
            if (typeof self.options.timeout != 'undefined') {
                self.registerTimeout = self.options.timeout;
            }
            self.serverKey = self.options.key;
            var ns = self.options.namespace || null;
            self.con = factory(ns);
            self.listen(self.con);
            self.connectTextServer();
            self.queueData = path.dirname(appserver.config) + path.sep + 'queue' + path.sep + 'text.json';
            if (!fs.existsSync(path.dirname(self.queueData))) {
                fs.mkdirSync(path.dirname(self.queueData));
            }
        }
    }
    app.init();

    return app;
}

// EOF