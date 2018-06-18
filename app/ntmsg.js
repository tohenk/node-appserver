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

const fs      = require('fs');
const path    = require('path');
const util    = require('../lib/util');
const client  = require('../lib/ntgw.client');

module.exports = exports = MessagingServer;

const Connections = {};

function MessagingServer(appserver, factory, logger, options) {
    const app = {
        CON_SERVER: 1,
        CON_CLIENT: 2,
        con: null,
        options: options || {},
        registerTimeout: 60,
        serverRoom: 'server',
        textClient: null,
        textCmd: null,
        emailCmd: null,
        userNotifierCmd: null,
        log: function() {
            const args = Array.from(arguments);
            if (args.length) args[0] = util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            logger.log.apply(null, args);
        },
        error: function() {
            const args = Array.from(arguments);
            if (args.length) args[0] = util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            logger.error.apply(null, args);
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
            const p = cmd.exec(values);
            p.on('message', (data) => {
                console.log('Message from process: %s', JSON.stringify(data));
            });
            p.on('exit', (code) => {
                this.log('Result %s...', code);
            });
            p.stdout.on('data', (line) => {
                var line = util.cleanBuffer(line);
                this.log(line);
            });
            p.stderr.on('data', (line) => {
                var line = util.cleanBuffer(line);
                this.log(line);
            });
        },
        connectTextServer: function() {
            if (typeof this.options['text-server'] == 'undefined') return;
            if (null == this.textClient) {
                const params = this.options['text-server'];
                params.log = this.error;
                if (typeof this.options['text-client'] != 'undefined') {
                    var cmd = this.getTextCmd(this.options['text-client']);
                    params.delivered = (hash, number, code, sent, received) => {
                        this.log('%s: Delivery status for %s is %s', hash, number, code);
                        this.execCmd(cmd, {
                            CMD: 'DELV',
                            DATA: JSON.stringify({hash: hash, number: number, code: code, sent: sent, received: received})
                        });
                    }
                    params.message = (date, number, message, hash) => {
                        this.log('%s: New message from %s', hash, number);
                        this.execCmd(cmd, {
                            CMD: 'MESG',
                            DATA: JSON.stringify({date: date, number: number, message: message, hash: hash})
                        });
                    }
                }
                this.textClient = new client.connect(params);
                if (fs.existsSync(this.queueData)) {
                    var queues = JSON.parse(fs.readFileSync(this.queueData));
                    for (var i = 0; i < queues.length; i++) {
                        this.textClient.queues.push(queues[i]);
                    }
                    fs.unlinkSync(this.queueData);
                    this.log('%s queue(s) loaded from %s...', queues.length, this.queueData);
                }
            }
        },
        deliverEmail: function(hash, attr) {
            if (typeof this.options['email-sender'] != 'undefined') {
                const cmd = this.getEmailCmd(this.options['email-sender']);
                const params = {
                    HASH: hash
                };
                if (typeof attr != 'undefined') {
                    params.ATTR = attr;
                }
                this.execCmd(cmd, params);
            }
        },
        notifySignin: function(action, data) {
            if (typeof this.options['user-notifier'] != 'undefined') {
                const cmd = this.getUserNotifierCmd(this.options['user-notifier']);
                this.execCmd(cmd, {
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
                if (typeof data.name != 'undefined') {
                    this.con.emit(data.name, typeof data.data != 'undefined' ? data.data : {});
                }
            });
            con.on('message', (data) => {
                this.log('%s: [Server] New message for %s...', con.id, data.uid);
                this.con.to(data.uid).emit('message');
            });
            con.on('text-message', (data) => {
                this.log('%s: [Server] Send text to %s "%s"...', con.id, data.number, data.message);
                if (this.textClient) {
                    if (data.attr) {
                        this.textClient.sendText(data.number, data.message, data.hash, data.attr);
                    } else {
                        this.textClient.sendText(data.number, data.message, data.hash);
                    }
                }
            });
            con.on('deliver-email', (data) => {
                selthis.log('%s: [Server] Deliver email %s...', con.id, data.hash);
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
            if (this.textClient && this.textClient.queues.length) {
                fs.writeFileSync(this.queueData, JSON.stringify(this.textClient.queues));
                this.log('Queue saved to %s...', this.queueData);
            }
        },
        init: function() {
            if (appserver.id == 'socket.io') {
                if (typeof this.options.key == 'undefined') {
                    throw new Error('Server key not defined!');
                }
                this.serverKey = this.options.key;
            }
            if (typeof this.options.timeout != 'undefined') {
                this.registerTimeout = this.options.timeout;
            }
            var ns = this.options.namespace || null;
            this.con = factory(ns);
            this.listen(this.con);
            this.connectTextServer();
            this.queueData = path.join(path.dirname(appserver.config), 'queue', 'text.json');
            if (!fs.existsSync(path.dirname(this.queueData))) {
                fs.mkdirSync(path.dirname(this.queueData));
            }
            return this;
        }
    }
    return app.init();
}

// EOF