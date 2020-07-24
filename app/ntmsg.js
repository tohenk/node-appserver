/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2020 Toha <tohenk@yahoo.com>
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
const Logger  = require('../lib/logger');
const Bridge  = require('./bridge/bridge');

const Connections = {};

class MessagingServer {

    CON_SERVER = 1
    CON_CLIENT = 2

    appserver = null
    con = null
    config = null
    options = null
    registerTimeout = 60
    serverRoom = 'server'
    bridges = []

    constructor(appserver, factory, config, options) {
        this.appserver = appserver;
        this.factory = factory;
        this.config = config || {};
        this.options = options || {};
        this.init();
    }

    init() {
        if (this.appserver.id == 'socket.io') {
            if (this.config.key == undefined) {
                throw new Error('Server key not defined!');
            }
            this.serverKey = this.config.key;
        }
        if (this.config.timeout != undefined) {
            this.registerTimeout = this.config.timeout;
        }
        this.queueDir = path.join(path.dirname(this.appserver.config), 'queue');
        if (!fs.existsSync(this.queueDir)) {
            fs.mkdirSync(this.queueDir);
        }
        this.initializeLogger();
        this.createBridges();
        const ns = this.config.namespace || null;
        this.con = this.factory(ns);
        this.listen(this.con);
    }

    initializeLogger() {
        this.logdir = this.options.logdir || path.join(__dirname, 'logs');
        this.logfile = path.join(this.logdir, 'ntmsg.log');
        this.logger = new Logger(this.logfile);
    }

    createBridges() {
        if (this.config.bridges) {
            this.config.bridges.forEach((bridge) => {
                const BridgeClass = require(bridge);
                const br = new BridgeClass(this);
                if (br instanceof Bridge) {
                    br.initialize(this.config);
                    this.bridges.push(br);
                }
            });
        }
    }

    log() {
        this.logger.log.apply(this.logger, Array.from(arguments));
    }

    getPaths() {
        return [__dirname, path.dirname(this.appserver.config)];
    }

    getCmd(config, args, values) {
        return require('../lib/command')(config, {
            paths: this.getPaths(),
            args: args,
            values: values
        });
    }

    execCmd(cmd, values) {
        return new Promise((resolve, reject) => {
            const p = cmd.exec(values);
            p.on('message', (data) => {
                console.log('Message from process: %s', JSON.stringify(data));
            });
            p.on('exit', (code) => {
                this.log('CLI: Result %s...', code);
                resolve(code);
            });
            p.stdout.on('data', (line) => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.log('CLI: %s', lines[i]);
                }
            });
            p.stderr.on('data', (line) => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.log('CLI: %s', lines[i]);
                }
            });
        });
    }

    deliverEmail(hash, attr) {
        if (this.config['email-sender'] != undefined) {
            if (!this.emailcmd) {
                this.emailcmd = this.getCmd(this.config['email-sender'], ['%HASH%']);
            }
        }
        if (this.emailcmd) {
            const params = {HASH: hash};
            if (attr != undefined) {
                params.ATTR = attr;
            }
            return this.execCmd(this.emailcmd, params);
        } else {
            return Promise.resolve();
        }
    }

    deliverData(id, params) {
        const cmdid = id + 'cmd';
        if (this.config[id] != undefined) {
            if (!this[cmdid]) {
                this[cmdid] = this.getCmd(this.config[id], ['%DATA%']);
            }
        }
        if (this[cmdid]) {
            return this.execCmd(this[cmdid], {DATA: JSON.stringify(params)});
        } else {
            return Promise.resolve();
        }
    }

    notifySignin(action, data) {
        if (this.config['user-notifier'] != undefined) {
            if (!this.signincmd) {
                this.signincmd = this.getCmd(this.config['user-notifier'], ['%ACTION%', '%DATA%']);
            }
        }
        if (this.signincmd) {
            return this.execCmd(this.signincmd, {ACTION: action, DATA: JSON.stringify(data)});
        } else {
            return Promise.resolve();
        }
    }

    getUsers() {
        const users = [];
        const uids = [];
        for (let id in Connections) {
            if (Connections[id].type == this.CON_CLIENT) {
                if (uids.indexOf(Connections[id].uid) < 0) {
                    users.push({uid: Connections[id].uid, time: Connections[id].time});
                    uids.push(Connections[id].uid);
                }
            }
        }
        return users;
    }

    addCon(con, data) {
        if (!Connections[con.id]) {
            data.con = con;
            data.time = Date.now();
            Connections[con.id] = data;
        }
    }

    removeCon(con) {
        if (Connections[con.id]) {
            const data = Connections[con.id];
            switch (data.type) {
                case this.CON_SERVER:
                    con.leave(this.serverRoom);
                    this.log('SVR: %s: Disconnected...', con.id);
                    break;
                case this.CON_CLIENT:
                    con.leave(data.uid);
                    // notify other users someone is offline
                    this.con.emit('user-offline', data.uid);
                    this.log('USR: %s: %s disconnected...', con.id, data.uid);
                    break;
            }
            delete Connections[con.id];
        }
    }

    handleServerCon(con) {
        con.on('whos-online', () => {
            this.log('SVR: %s: Query whos-online...', con.id);
            const users = this.getUsers();
            con.emit('whos-online', users);
            for (let i = 0; i < users.length; i++) {
                this.log('SVR: %s: User: %s, time: %d', con.id, users[i].uid, users[i].time);
            }
        });
        con.on('notification', (data) => {
            this.log('SVR: %s: New notification for %s...', con.id, data.uid);
            const notif = {
                message: data.message
            }
            if (data.code) notif.code = data.code;
            if (data.referer) notif.referer = data.referer;
            this.con.to(data.uid).emit('notification', notif);
        });
        con.on('push-notification', (data) => {
            this.log('SVR: %s: Push notification: %s...', con.id, JSON.stringify(data));
            if (data.name != undefined) {
                this.con.emit(data.name, data.data != undefined ? data.data : {});
            }
        });
        con.on('message', (data) => {
            this.log('SVR: %s: New message for %s...', con.id, data.uid);
            this.con.to(data.uid).emit('message');
        });
        con.on('deliver-email', (data) => {
            this.log('SVR: %s: Deliver email %s...', con.id, data.hash);
            if (data.attr) {
                this.deliverEmail(data.hash, data.attr);
            } else {
                this.deliverEmail(data.hash);
            }
        });
        con.on('user-signin', (data) => {
            this.log('SVR: %s: User signin %s...', con.id, data.username);
            this.notifySignin('SIGNIN', data);
        });
        con.on('user-signout', (data) => {
            this.log('SVR: %s: User signout %s...', con.id, data.username);
            this.notifySignin('SIGNOUT', data);
        });
        con.on('data', (data) => {
            this.log('SVR: %s: Receiving data %s...', con.id, JSON.stringify(data));
            if (data.id && data.params) {
                this.deliverData(data.id, data.params);
            }
        });
        // handle bridges server connection
        this.bridges.forEach((bridge) => {
            bridge.handleServer(con);
        });
    }

    handleClientCon(con) {
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
        // handle bridges client connection
        this.bridges.forEach((bridge) => {
            bridge.handleClient(con);
        });
    }

    setupCon(con) {
        // disconnect if not registered within timeout
        const t = setTimeout(() => {
            con.disconnect(true);
        }, this.registerTimeout * 1000);
        con.on('register', (data) => {
            let dismiss = true;
            const info = {};
            // is it a server connection?
            if (data.sid) {
                if (data.sid == this.serverKey) {
                    dismiss = false;
                    info.sid = data.sid;
                    info.type = this.CON_SERVER;
                    con.join(this.serverRoom);
                    this.handleServerCon(con);
                    this.log('SVR: %s: Connected...', con.id);
                } else {
                    this.log('SVR: %s: Didn\'t send correct key...', con.id);
                }
            } else if (data.uid) {
                dismiss = false;
                info.uid = data.uid;
                info.type = this.CON_CLIENT;
                con.join(data.uid);
                this.handleClientCon(con);
                // notify other users someone is online
                this.con.emit('user-online', data.uid);
                this.log('USR: %s: %s connected...', con.id, data.uid);
            } else {
                this.log('ERR: %s: Invalid registration...', con.id, data.uid);
            }
            if (dismiss) {
                con.disconnect(true);
                this.log('ERR: %s: Forced disconnect...', con.id);
            } else {
                this.addCon(con, info);
                clearTimeout(t);
            }
        });
        con.on('disconnect', () => {
            this.removeCon(con);
            this.bridges.forEach((bridge) => {
                bridge.disconnect(con);
            });
        });
    }

    listen(con) {
        if (this.appserver.id == 'socket.io') {
            con.on('connection', (client) => {
                this.setupCon(client);
            });
        } else {
            this.handleServerCon(con);
        }
    }

    doClose(server) {
        this.bridges.forEach((bridge) => {
            bridge.finalize();
        });
    }

}

module.exports = MessagingServer;