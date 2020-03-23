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

/*
 * App Server Handler for XMPP
 */

const fs    = require('fs');
const path  = require('path');
const u     = require('util');
const cmd   = require('./../lib/cmd');
const util  = require('./../lib/util');
const xmpp  = require('node-xmpp-client');
const debug = require('debug')('appserver-xmpp');

module.exports = exports = AppServer;

function AppServer() {
    const server = {
        id: 'xmpp',
        createApp: function(name, options) {
            const title = options.title || name;
            const module = options.module;
            const configs = options.params || {};
            const params = {};
            const factory = (ns, params) => {
                return XmppConnection(options);
            }
            if (params.logdir == undefined) {
                params.logdir = path.resolve(path.dirname(this.config),
                    options.logdir ? options.logdir : cmd.get('logdir'));
            }
            console.log('');
            console.log(title);
            console.log('='.repeat(79));
            console.log('');
            const instance = require('./../' + module)(this, factory, configs, params);
            console.log('');
            console.log('-'.repeat(79));
            instance.name = name;
            return instance;
        },
        run: function() {
            let cnt = 0;
            this.config = cmd.get('config') || process.env[global.ENV_CONFIG];
            if (!this.config) {
                this.config = path.dirname(process.argv[1]) + path.sep + 'app.json';
            }
            console.log('Checking configuration %s', this.config);
            if (this.config && util.fileExist(this.config)) {
                console.log('Reading configuration %s', this.config);
                const apps = JSON.parse(fs.readFileSync(this.config));
                for (name in apps) {
                    let options = apps[name];
                    if (!typeof options == 'object') {
                        throw new Error('Application configuration must be an object.');
                    }
                    if (options.module == undefined) {
                        throw new Error('Application module for ' + name + ' not defined.');
                    }
                    if (options.enabled != undefined && !options.enabled) {
                        continue;
                    }
                    this.createApp(name, options);
                    cnt++;
                }
                console.log('');
                console.log('Running %d applications(s)', cnt);
                console.log('');
            }
            return cnt;
        }
    }
    return server;
}

function XmppConnection(options) {
    const handler = {
        con: null,
        id: null,
        events: [],
        skipHistory: true,
        connect: function() {
            this.jid = options.jid;
            this.password = options.password;
            this.room = options.room + '@conference.' + this.jid.substr(this.jid.indexOf('@') + 1);
            this.uid = options.uid || 'u' + Math.floor(Math.random() * 10000000);
            this.con = new xmpp.Client({
                jid: this.jid,
                password: this.password,
                host: this.jid.substr(this.jid.indexOf('@') + 1)
            });
            this.con.on('online', (data) => {
                this.id = data.jid;
                const presence = new xmpp.Stanza('presence', {
                    to: this.room + '/' + this.uid
                });
                presence.c('x', { xmlns: 'http://jabber.org/protocol/muc' });
                this.con.send(presence);
            });
            this.con.on('stanza', (stanza) => {
                if (stanza.is('presence')) {
                    this.onPresence(stanza);
                }
                if (stanza.is('message')) {
                    this.onMessage(stanza);
                }
                if (stanza.is('roster')) {
                    this.onRoster(stanza);
                }
                if (stanza.is('iq')) {
                    const ping = stanza.getChild('ping', 'urn:xmpp:ping');
                    if (ping) {
                        const pong = new xmpp.Stanza('iq', {
                            from: this.id.toString(),
                            to: stanza.attrs.from,
                            id: stanza.attrs.id,
                            type: 'result'
                        });
                        this.con.send(pong);
                        debug('Send PING response to SERVER.');
                    }
                }
            });
            this.con.on('error', (err) => {
                console.error(err);
                // retry on error
                debug('Retrying connection in 30 seconds.');
                setTimeout(function() {
                    this.connect();
                }, 30000);
            })
        },
        getPayload: function(value) {
            if (typeof value == 'object') {
                if (value.children.length > 0) {
                    let data = {};
                    let idx = 0;
                    for (let i = 0; i < value.children.length; i++) {
                        let c = value.children[i];
                        let v = this.getPayload(c);
                        if (value.children.length == 1 && typeof c == 'string') {
                            data = v;
                            break;
                        }
                        let key = c.name;
                        if (key == 'VALUE') {
                            data[idx] = v;
                            idx++;
                        } else {
                            data[key] = v;
                        }
                    }
                    return data;
                }
            } else {
                return value;
            }
        },
        buildPayload: function(node, value) {
            if (Array.isArray(value) || typeof value == 'object') {
                for (key in value) {
                    let num = key.toString().match(/^(\d+)$/) ? true : false;
                    let c = node.c(num ? 'VALUE' : key);
                    this.buildPayload(c, value[key]);
                }
            } else {
                node.t(value);
            }
        },
        trigger: function(event, data) {
            debug('Trigger event: ' + event + ' with: ' + u.inspect(data));
            for (let i = 0; i < this.events.length; i++) {
                let ev = this.events[i];
                if (event == ev.name) {
                    if (typeof ev.handler == 'function') {
                        let trigger = true;
                        if (data != undefined && data.uid != undefined && data.uid != this.uid) {
                            trigger = false;
                        }
                        if (trigger) {
                            if (data == undefined) {
                                ev.handler();
                            } else {
                                ev.handler(data);
                            }
                        }
                    }
                }
            }
        },
        onMessage: function(message) {
            try {
                debug('onMessage: ' + message.toString());
                if (this.skipHistory && message.getChild('delay')) {
                    debug('Message skipped');
                    return;
                }
                let bd = message.getChild('body');
                if (bd) {
                    let event = bd.getText();
                    let payload = message.getChild('payload');
                    let data;
                    if (payload) {
                        data = this.getPayload(payload);
                    }
                    // handle push notification
                    if (event == 'push-notification' && data != undefined) {
                        event = data.name;
                        data = data.data;
                    }
                    if (data != undefined) {
                        this.trigger(event, data);
                    } else {
                        this.trigger(event);
                    }
                }
            } catch(e) {
                console.error('onMessage: ' + e.message);
            }
        },
        onPresence: function(presence) {
            try {
                debug('onPresence: ' + presence.toString());
                let jid = presence.attrs.from;
                if (jid) {
                    let uid = jid.substr(jid.indexOf('/') + 1);
                    let type = presence.attrs.type;
                    if (uid == this.uid) {
                        if (type == 'error') {
                            let err = presence.getChild('error');
                            if (err) {
                                console.error('Error: ' + err.getText());
                            }
                        } else {
                            debug('Successfully joined the room: ' + this.room);
                            if (typeof this.onConnected == 'function') {
                                this.onConnected();
                            }
                        }
                    } else {
                        switch (type) {
                            case 'error':
                                break;
                            case 'unavailable':
                                this.trigger('user-offline', uid);
                                break;
                            default:
                                this.trigger('user-online', uid);
                                break;
                        }
                    }
                }
            } catch(e) {
                console.error('onPresence: ' + e.message);
            }
        },
        onRoster: function(roster) {
            try {
                debug('onRooster: ' + roster.toString());
            } catch(e) {
                console.error('onRoster: ' + e.message);
            }
        },
        on: function(event, handler) {
            this.events.push({name: event, handler: handler});
        },
        emit: function(event, data) {
            if (this.con) {
                const msg = new xmpp.Stanza('message', {
                    to: this.room,
                    type: 'groupchat'
                }).c('body').t(event).root();
                if (this._to) {
                    if (data == undefined) {
                        data = {}
                    }
                    data.uid = this._to;
                    this._to = null;
                }
                if (data) {
                    this.buildPayload(msg.c('payload'), data);
                }
                this.con.send(msg);
            }
        },
        to: function(uid) {
            this._to = uid;
            return this;
        }
    }
    handler.connect();
    return handler;
}