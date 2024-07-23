/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2024 Toha <tohenk@yahoo.com>
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

const fs = require('fs');
const path = require('path');
const util = require('@ntlab/ntlib/util');
const Logger = require('@ntlab/ntlib/logger');
const Bridge = require('./bridge/bridge');
const Queue = require('@ntlab/work/queue');

const Connections = {};

const CON_SERVER = 1
const CON_LISTENER = 2
const CON_CLIENT = 3

class MessagingServer {

    appserver = null
    con = null
    config = null
    options = null
    registerTimeout = 60
    serverRoom = 'server'
    listenerRoom = 'listener'
    bridges = []
    cmds = {}

    constructor(appserver, factory, config, options) {
        this.appserver = appserver;
        this.factory = factory;
        this.config = config || {};
        this.options = options || {};
        this.init();
    }

    init() {
        if (this.appserver.id === 'socket.io') {
            if (this.config.key === undefined) {
                throw new Error('Server key not defined!');
            }
            this.serverKey = this.config.key;
        }
        if (this.config.timeout !== undefined) {
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
            this.config.bridges.forEach(bridge => {
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
        return require('@ntlab/ntlib/command')(config, {
            paths: this.getPaths(),
            args: args,
            values: values
        });
    }

    execCmd(name, cmd, values) {
        return new Promise((resolve, reject) => {
            const p = cmd.exec(values);
            p.on('message', data => {
                console.log(`${name}: %s`, data);
            });
            p.on('exit', code => {
                this.log(`${name}: Exit code %s...`, code);
                resolve(code);
            });
            p.on('error', err => {
                this.log(`${name}: ERR: %s...`, err);
                reject(err);
            });
            p.stdout.on('data', line => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.log(`${name}: 1> %s`, lines[i]);
                }
            });
            p.stderr.on('data', line => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.log(`${name}: 2> %s`, lines[i]);
                }
            });
        });
    }

    doCmd(group, name, args, data, callback = null) {
        if (this.cmds[name] === undefined) {
            this.cmds[name] = [];
            if (this.config[name] !== undefined) {
                const cmd = {cmd: this.getCmd(this.config[name], args)};
                if (this.config[name].group) {
                    cmd.group = this.config[name].group;
                }
                this.cmds[name].push(cmd);
                console.log('Handle %s using %s...', name, cmd.cmd.bin ? cmd.cmd.bin : cmd.cmd.url);
            } else {
                Object.values(this.config).forEach(cfg => {
                    if (cfg.type === name) {
                        const cmd = {cmd: this.getCmd(cfg, args)};
                        if (cfg.group) {
                            cmd.group = cfg.group;
                        }
                        this.cmds[name].push(cmd);
                        console.log('Handle %s using %s...', name, cmd.cmd.bin ? cmd.cmd.bin : cmd.cmd.url);
                    }
                });
            }
        }
        if (this.cmds[name].length) {
            const q = new Queue([...this.cmds[name]], cmd => {
                if ((group && cmd.group !== group) || (!group && cmd.group)) {
                    q.next();
                } else {
                    this.execCmd(name, cmd.cmd, data)
                        .then(() => q.next)
                        .catch(err => {
                            console.error(err);
                            if (typeof callback === 'function') {
                                callback(err);
                            }
                        });
                }
            });
            if (typeof callback === 'function') {
                q.once('done', () => callback(true));
            }
            return true;
        } else {
            if (typeof callback === 'function') {
                callback();
            }
        }
    }

    deliverEmail(group, hash, attr) {
        const data = {HASH: hash};
        if (attr !== undefined) {
            data.ATTR = attr;
        }
        return this.doCmd(group, 'email-sender', ['%HASH%'], data);
    }

    deliverData(group, id, params) {
        return this.doCmd(group, id, ['%DATA%'], {DATA: JSON.stringify(params)});
    }

    notifySignin(group, action, data) {
        return this.doCmd(group, 'user-notifier', ['%ACTION%', '%DATA%'], {ACTION: action, DATA: JSON.stringify(data)});
    }

    getRoom(room, group) {
        return group ? [group, room].join('-') : room;
    }

    getUsers(group = null) {
        const users = [];
        const uids = [];
        for (const id in Connections) {
            if (Connections[id].type === CON_CLIENT) {
                if (group && Connections[id].group !== group) {
                    continue;
                }
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
            const info = Connections[con.id];
            switch (info.type) {
                case CON_SERVER:
                    con.leave(this.getRoom(this.serverRoom, info.group));
                    this.log('SVR: %s: Disconnected...', con.id);
                    break;
                case CON_LISTENER:
                    con.leave(this.getRoom(this.listenerRoom, info.group));
                    this.log('LST: %s: Disconnected...', con.id);
                    break;
                case CON_CLIENT:
                    con.leave(this.getRoom(info.uid, info.group));
                    // notify other users someone is offline
                    if (info.group) {
                        con.leave(this.getRoom(info.group));
                        this.con.to(info.group).emit('user-offline', info.uid);
                    } else {
                        this.con.emit('user-offline', info.uid);
                    }
                    this.log('USR: %s: %s disconnected...', con.id, info.uid);
                    break;
            }
            delete Connections[con.id];
        }
    }

    handleServerCon(con) {
        const info = Connections[con.id];
        con.on('whos-online', () => {
            this.log('SVR: %s: Query whos-online...', con.id);
            const users = this.getUsers(info.group);
            con.emit('whos-online', users);
            for (let i = 0; i < users.length; i++) {
                this.log('SVR: %s: User: %s, time: %d', con.id, users[i].uid, users[i].time);
            }
        });
        con.on('notification', data => {
            this.log('SVR: %s: New notification for %s...', con.id, data.uid);
            const notif = {
                message: data.message
            }
            if (data.code) {
                notif.code = data.code;
            }
            if (data.referer) {
                notif.referer = data.referer;
            }
            this.con.to(this.getRoom(data.uid, info.group)).emit('notification', notif);
        });
        con.on('push-notification', data => {
            this.log('SVR: %s: Push notification: %s...', con.id, JSON.stringify(data));
            if (data.name !== undefined) {
                if (info.group) {
                    this.con.to(info.group).emit(data.name, data.data != undefined ? data.data : {});
                } else {
                    this.con.emit(data.name, data.data != undefined ? data.data : {});
                }
            }
        });
        con.on('message', data => {
            this.log('SVR: %s: New message for %s...', con.id, data.uid);
            this.con.to(this.getRoom(data.uid, info.group)).emit('message');
        });
        con.on('deliver-email', data => {
            this.log('SVR: %s: Deliver email %s...', con.id, data.hash);
            if (data.attr) {
                this.deliverEmail(info.group, data.hash, data.attr);
            } else {
                this.deliverEmail(info.group, data.hash);
            }
        });
        con.on('user-signin', data => {
            this.log('SVR: %s: User signin %s...', con.id, data.username);
            this.notifySignin(info.group, 'SIGNIN', data);
        });
        con.on('user-signout', data => {
            this.log('SVR: %s: User signout %s...', con.id, data.username);
            this.notifySignin(info.group, 'SIGNOUT', data);
        });
        con.on('data', data => {
            this.log('SVR: %s: Receiving data %s...', con.id, JSON.stringify(data));
            if (data.id && data.params) {
                this.deliverData(info.group, data.id, data.params);
            }
            this.con.to(this.getRoom(this.listenerRoom, info.group)).emit('data', data);
        });
        // handle bridges server connection
        this.bridges.forEach(bridge => {
            bridge.handleServer(con);
        });
    }

    handleClientCon(con) {
        const info = Connections[con.id];
        con.on('notification-read', data => {
            if (data.uid) {
                this.con.to(this.getRoom(data.uid, info.group)).emit('notification-read', data);
            }
        });
        con.on('message-sent', data => {
            if (data.uid) {
                this.con.to(this.getRoom(data.uid, info.group)).emit('message-sent', data);
            }
        });
        // handle bridges client connection
        this.bridges.forEach(bridge => {
            bridge.handleClient(con);
        });
    }

    setupCon(con) {
        // disconnect if not registered within timeout
        const t = setTimeout(() => {
            con.disconnect(true);
        }, this.registerTimeout * 1000);
        con.on('register', data => {
            let info;
            // is it a server connection?
            if (data.sid) {
                info = this.regCon(con, data, CON_SERVER, 'sid', this.serverRoom, true);
                if (info) {
                    this.log('SVR: %s: Connected...', con.id);
                } else {
                    this.log('SVR: %s: Didn\'t send correct key...', con.id);
                }
            } else if (data.xid) {
                info = this.regCon(con, data, CON_LISTENER, 'xid', this.listenerRoom, true);
                if (info) {
                    this.log('LTR: %s: Connected...', con.id);
                } else {
                    this.log('LTR: %s: Didn\'t send correct key...', con.id);
                }
            } else if (data.uid) {
                info = this.regCon(con, data, CON_CLIENT, 'uid');
                con.join(this.getRoom(data.uid, info.group));
                if (info.group) {
                    con.join(info.group);
                }
                // notify other users someone is online
                if (info.group) {
                    this.con.to(info.group).emit('user-online', data.uid);
                } else {
                    this.con.emit('user-online', data.uid);
                }
                this.log('USR: %s: %s connected...', con.id, data.uid);
            } else {
                this.log('ERR: %s: Invalid registration...', con.id);
            }
            if (info) {
                clearTimeout(t);
                this.addCon(con, info);
                switch (info.type) {
                    case CON_SERVER:
                        this.handleServerCon(con);
                        break;
                    case CON_CLIENT:
                        this.handleClientCon(con);
                        break;
                }
            } else {
                con.disconnect(true);
                this.log('ERR: %s: Forced disconnect...', con.id);
            }
        });
        con.on('disconnect', () => {
            this.removeCon(con);
            this.bridges.forEach(bridge => {
                bridge.disconnect(con);
            });
        });
    }

    regCon(con, data, type, key, room, authenticate) {
        const info = {};
        if (authenticate && data[key] !== this.serverKey) {
            return;
        }
        info.type = type;
        info[key] = data[key];
        if (data.group) {
            info.group = data.group;
        }
        if (room) {
            con.join(this.getRoom(room, data.group));
        } else {
            con.join(this.getRoom(data[key], data.group));
        }
        return info;
    }

    listen(con) {
        if (this.appserver.id === 'socket.io') {
            con.on('connection', client => {
                this.setupCon(client);
            });
        } else {
            this.handleServerCon(con);
        }
    }

    doClose(server) {
        this.bridges.forEach(bridge => {
            bridge.finalize();
        });
    }
}

module.exports = MessagingServer;