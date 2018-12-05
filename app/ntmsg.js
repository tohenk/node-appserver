/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2018 Toha <tohenk@yahoo.com>
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

const io      = require('socket.io-client');
const fs      = require('fs');
const path    = require('path');
const util    = require('../lib/util');
const Logger  = require('../lib/logger');
const Queue   = require('../lib/queue');

module.exports = exports = MessagingServer;

const Connections = {};

function MessagingServer(appserver, factory, configs, options) {
    const app = {
        CON_SERVER: 1,
        CON_CLIENT: 2,
        con: null,
        configs: configs || {},
        options: options || {},
        registerTimeout: 60,
        serverRoom: 'server',
        textCmd: null,
        emailCmd: null,
        userNotifierCmd: null,
        smsgw: null,
        smsgwConnected: false,
        log: function() {
            this.logger.log.apply(this.logger, Array.from(arguments));
        },
        getPaths: function() {
            return [__dirname, path.dirname(appserver.config)];
        },
        getTextCmd: function(config) {
            if (this.textCmd == null) {
                this.textCmd = require('../lib/command')(config, {
                    paths: this.getPaths(),
                    args: ['ntucp:messaging', '--application=%APP%', '--env=%ENV%', '%CMD%', '%DATA%'],
                    values: {
                        'APP': 'frontend',
                        'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                    }
                });
                console.log('Text client using %s...', this.textCmd.getId());
            }
            return this.textCmd;
        },
        getEmailCmd: function(config) {
            if (this.emailCmd == null) {
                this.emailCmd = require('../lib/command')(config, {
                    paths: this.getPaths(),
                    args: ['ntucp:deliver-email', '--application=%APP%', '--env=%ENV%', '%HASH%'],
                    values: {
                        'APP': 'frontend',
                        'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                    }
                });
                console.log('Email delivery using %s...', this.emailCmd.getId());
            }
            return this.emailCmd;
        },
        getUserNotifierCmd: function(config) {
            if (this.userNotifierCmd == null) {
                this.userNotifierCmd = require('../lib/command')(config, {
                    paths: this.getPaths(),
                    args: ['ntucp:signin-notify', '--application=%APP%', '--env=%ENV%', '%ACTION%', '%DATA%'],
                    values: {
                        'APP': 'frontend',
                        'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                    }
                });
                console.log('Signin notifier using %s...', this.userNotifierCmd.getId());
            }
            return this.userNotifierCmd;
        },
        execCmd: function(cmd, values) {
            return new Promise((resolve, reject) => {
                const p = cmd.exec(values);
                p.on('message', (data) => {
                    console.log('Message from process: %s', JSON.stringify(data));
                });
                p.on('exit', (code) => {
                    this.log('Result %s...', code);
                    resolve(code);
                });
                p.stdout.on('data', (line) => {
                    var line = util.cleanBuffer(line);
                    this.log(line);
                });
                p.stderr.on('data', (line) => {
                    var line = util.cleanBuffer(line);
                    this.log(line);
                });
            });
        },
        connectSMSGateway: function() {
            if (this.configs['smsgw'] == undefined) return;
            if (null == this.smsgw) {
                const params = this.configs['smsgw'];
                const url = params.url;
                this.smsgw = io(url);
                this.smsgw.on('connect', () => {
                    console.log('Connected to SMS Gateway at %s', url);
                    this.smsgwConnected = true;
                    this.smsgw.emit('auth', params.secret);
                });
                this.smsgw.on('disconnect', () => {
                    console.log('Disconnected from SMS Gateway at %s', url);
                    this.smsgwConnected = false;
                });
                this.smsgw.on('auth', (success) => {
                    if (!success) {
                        console.log('Authentication with SMS Gateway failed!');
                    } else {
                        if (params.group) {
                            this.smsgw.emit('group', params.group);
                        }
                    }
                });
                if (this.configs['text-client'] != undefined) {
                    this.smscmd = this.getTextCmd(this.configs['text-client']);
                    this.smsgw.on('message', (hash, number, message, time) => {
                        this.log('%s: New message from %s', hash, number);
                        this.smsQueue('MESG', JSON.stringify({date: time, number: number, message: message, hash: hash}));
                    });
                    this.smsgw.on('status-report', (data) => {
                        if (data.hash) {
                            this.log('%s: Delivery status for %s is %s', data.hash, data.address, data.code);
                            this.smsQueue('DELV', JSON.stringify({hash: data.hash, number: data.address, code: data.code, sent: data.sent, received: data.received}));
                        }
                    });
                }
                const queues = [];
                if (fs.existsSync(this.gwQueueFilename)) {
                    const savedQueues = JSON.parse(fs.readFileSync(this.gwQueueFilename));
                    if (savedQueues.length) {
                        Array.prototype.push.apply(queues, savedQueues);
                        fs.writeFileSync(this.gwQueueFilename, JSON.stringify([]));
                        this.log('GW: %s queue(s) loaded from %s...', savedQueues.length, this.gwQueueFilename);
                    }
                }
                this.smsgwq = new Queue(queues, (data) => {
                    const msg = {
                        hash: data.hash,
                        address: data.number,
                        data: data.message
                    }
                    if (data.attr) {
                        // resend or checking existing message
                        this.smsgw.emit('message-retry', msg);
                    } else {
                        this.smsgw.emit('message', msg);
                    }
                    this.smsgwq.next();
                }, () => {
                    return this.smsgwConnected;
                });
            }
        },
        smsQueue: function(cmd, data) {
            const queue = {
                CMD: cmd,
                DATA: data
            }
            if (!this.smsq) {
                this.smsq = new Queue([queue], (q) => {
                    this.execCmd(this.smscmd, q)
                        .then(() => {
                            this.smsq.next();
                        })
                    ;
                });
            } else {
                this.smsq.requeue([queue]);
            }
        },
        deliverEmail: function(hash, attr) {
            if (this.configs['email-sender'] != undefined) {
                const cmd = this.getEmailCmd(this.configs['email-sender']);
                const params = {
                    HASH: hash
                };
                if (attr != undefined) {
                    params.ATTR = attr;
                }
                return this.execCmd(cmd, params);
            } else {
                Promise.resolve();
            }
        },
        notifySignin: function(action, data) {
            if (this.configs['user-notifier'] != undefined) {
                const cmd = this.getUserNotifierCmd(this.configs['user-notifier']);
                return this.execCmd(cmd, {
                    ACTION: action,
                    DATA: JSON.stringify(data)
                });
            } else {
                Promise.resolve();
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
            con.on('whos-online', () => {
                this.log('%s: [Server] Query whos-online...', con.id);
                var users = this.getUsers();
                con.emit('whos-online', users);
                for (var i = 0; i < users.length; i++) {
                    this.log('%s: [Server] User: %s, time: %d', con.id, users[i].uid, users[i].time);
                }
            });
            con.on('notification', (data) => {
                this.log('%s: [Server] New notification for %s...', con.id, data.uid);
                const notif = {
                    message: data.message
                }
                if (data.code) notif.code = data.code;
                if (data.referer) notif.referer = data.referer;
                this.con.to(data.uid).emit('notification', notif);
            });
            con.on('push-notification', (data) => {
                this.log('%s: [Server] Push notification: %s...', con.id, JSON.stringify(data));
                if (data.name != undefined) {
                    this.con.emit(data.name, data.data != undefined ? data.data : {});
                }
            });
            con.on('message', (data) => {
                this.log('%s: [Server] New message for %s...', con.id, data.uid);
                this.con.to(data.uid).emit('message');
            });
            con.on('text-message', (data) => {
                this.log('%s: [Server] Send text to %s "%s"...', con.id, data.number, data.message);
                this.smsgwq.requeue([data]);
            });
            con.on('deliver-email', (data) => {
                this.log('%s: [Server] Deliver email %s...', con.id, data.hash);
                if (data.attr) {
                    this.deliverEmail(data.hash, data.attr);
                } else {
                    this.deliverEmail(data.hash);
                }
            });
            con.on('user-signin', (data) => {
                this.log('%s: [Server] User signin %s...', con.id, data.username);
                this.notifySignin('SIGNIN', data);
            });
            con.on('user-signout', (data) => {
                this.log('%s: [Server] User signout %s...', con.id, data.username);
                this.notifySignin('SIGNOUT', data);
            });
        },
        handleClientCon: function(con) {
            con.on('notification-read', (data) => {
                if (data.uid) {
                    this.con.to(data.uid).emit('notification-read', data);
                }
            });
            con.on('message-sent', (data) => {
                if (data.uid) {
                    this.con.to(data.uid).emit('message-sent', data);
                }
            });
        },
        setupCon: function(con) {
            // disconnect if not registered within timeout
            const t = setTimeout(function() {
                con.disconnect(true);
            }, this.registerTimeout * 1000);
            con.on('register', (data) => {
                var dismiss = true;
                const info = {};
                // is it a server connection?
                if (data.sid) {
                    if (data.sid == this.serverKey) {
                        dismiss = false;
                        info.sid = data.sid;
                        info.type = this.CON_SERVER;
                        con.join(this.serverRoom);
                        this.handleServerCon(con);
                        this.log('%s: Server connected...', con.id);
                    } else {
                        this.log('%s: Server didn\'t send correct key...', con.id);
                    }
                } else if (data.uid) {
                    dismiss = false;
                    info.uid = data.uid;
                    info.type = this.CON_CLIENT;
                    con.join(data.uid);
                    this.handleClientCon(con);
                    // notify other users someone is online
                    this.con.emit('user-online', data.uid);
                    this.log('%s: User %s connected...', con.id, data.uid);
                } else {
                    this.log('%s: Invalid registration...', con.id, data.uid);
                }
                if (dismiss) {
                    con.disconnect(true);
                    this.log('%s: Forced disconnect...', con.id);
                } else {
                    this.addCon(con, info);
                    clearTimeout(t);
                }
            });
            con.on('disconnect', () => {
                this.removeCon(con);
            });
        },
        listen: function(con) {
            if (appserver.id == 'socket.io') {
                con.on('connection', (client) => {
                    this.setupCon(client);
                });
            } else {
                this.handleServerCon(con);
            }
        },
        doClose: function(server) {
            if (this.smsgwq && this.smsgwq.queues.length) {
                fs.writeFileSync(this.gwQueueFilename, JSON.stringify(this.smsgwq.queues));
                this.log('Gateway queue saved to %s...', this.gwQueueFilename);
            }
        },
        initializeLogger: function() {
            this.logdir = this.options.logdir || path.join(__dirname, 'logs');
            this.logfile = path.join(this.logdir, 'ntmsg.log');
            this.logger = new Logger(this.logfile);
        },
        init: function() {
            if (appserver.id == 'socket.io') {
                if (this.configs.key == undefined) {
                    throw new Error('Server key not defined!');
                }
                this.serverKey = this.configs.key;
            }
            if (this.configs.timeout != undefined) {
                this.registerTimeout = this.configs.timeout;
            }
            this.initializeLogger();
            const ns = this.configs.namespace || null;
            this.queueDir = path.join(path.dirname(appserver.config), 'queue');
            if (!fs.existsSync(this.queueDir)) {
                fs.mkdirSync(this.queueDir);
            }
            this.textQueueFilename = path.join(this.queueDir, 'text.json');
            this.gwQueueFilename = path.join(this.queueDir, 'messages.json');
            this.con = factory(ns);
            this.listen(this.con);
            this.connectSMSGateway();
            return this;
        }
    }
    return app.init();
}

// EOF