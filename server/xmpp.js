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
 * App Server Handler for XMPP
 */

var fs    = require('fs');
var path  = require('path');
var u     = require('util');
var cmd   = require('./../lib/cmd');
var util  = require('./../lib/util');
var xmpp  = require('node-xmpp-client');
var debug = require('debug')('appserver-xmpp');

module.exports = exports = AppServer;

function AppServer() {
    var server = {
        id: 'xmpp',
        createApp: function(name, options) {
            var title = options.title || name;
            var module = options.module;
            var params = options.params || {};
            var factory = function(ns, params) {
                return XmppConnection(options);
            }
            var logdir = path.resolve(path.dirname(this.config), options.logdir ? options.logdir : cmd.get('logdir'));
            var stdout = fs.createWriteStream(logdir + path.sep + name + '.log');
            var stderr = fs.createWriteStream(logdir + path.sep + name + '-error.log');
            var logger = new console.Console(stdout, stderr);
            console.log('');
            console.log(title);
            console.log('='.repeat(79));
            console.log('');
            var instance = require('./../' + module)(this, factory, logger, params);
            console.log('');
            console.log('-'.repeat(79));
            instance.name = name;

            return instance;
        },
        run: function() {
            var self = this;
            var cnt = 0;
            self.config = cmd.get('config') || process.env[global.ENV_CONFIG];
            if (!self.config) {
                self.config = path.dirname(process.argv[1]) + path.sep + 'app.json';
            }
            console.log('Checking configuration %s', self.config);
            if (self.config && util.fileExist(self.config)) {
                console.log('Reading configuration %s', self.config);
                var apps = JSON.parse(fs.readFileSync(self.config));
                for (name in apps) {
                    var options = apps[name];
                    if (!typeof options == 'object') {
                        throw new Error('Application configuration must be an object.');
                    }
                    if (typeof options.module == 'undefined') {
                        throw new Error('Application module for ' + name + ' not defined.');
                    }
                    if (typeof options.enabled != 'undefined' && !options.enabled) {
                        continue;
                    }
                    self.createApp(name, options);
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
    var handler = {
        con: null,
        id: null,
        events: [],
        connect: function() {
            var self = this;
            self.jid = options.jid;
            self.password = options.password;
            self.room = options.room + '@conference.' + self.jid.substr(self.jid.indexOf('@') + 1);
            self.uid = options.uid || 'u' + Math.floor(Math.random() * 10000000);
            self.con = new xmpp.Client({
                jid: self.jid,
                password: self.password,
                host: self.jid.substr(self.jid.indexOf('@') + 1)
            });
            self.con.on('online', function(data) {
                self.id = data.jid;
                var presence = new xmpp.Stanza('presence', {
                    to: self.room + '/' + self.uid
                });
                presence.c('x', { xmlns: 'http://jabber.org/protocol/muc' });
                self.con.send(presence);
            });
            self.con.on('stanza', function(stanza) {
                if (stanza.is('presence')) {
                    self.onPresence(stanza);
                }
                if (stanza.is('message')) {
                    self.onMessage(stanza);
                }
                if (stanza.is('roster')) {
                    self.onRoster(stanza);
                }
                if (stanza.is('iq')) {
                    var ping = stanza.getChild('ping', 'urn:xmpp:ping');
                    if (ping) {
                        var pong = new xmpp.Stanza('iq', {
                            from: self.id.toString(),
                            to: stanza.attrs.from,
                            id: stanza.attrs.id,
                            type: 'result'
                        });
                        self.con.send(pong);
                        debug('Send PING response to SERVER.');
                    }
                }
            });
            self.con.on('error', function(err) {
                console.error(err);
                process.exit();
            })
        },
        getPayload: function(value) {
            var self = this;
            if (typeof value == 'object') {
                if (value.children.length > 0) {
                    var data = {};
                    var idx = 0;
                    for (var i = 0; i < value.children.length; i++) {
                        var c = value.children[i];
                        var v = self.getPayload(c);
                        if (value.children.length == 1 && typeof c == 'string') {
                            data = v;
                            break;
                        }
                        var key = c.name;
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
            var self = this;
            if (Array.isArray(value) || typeof value == 'object') {
                for (key in value) {
                    var num = key.toString().match(/^(\d+)$/) ? true : false;
                    var c = node.c(num ? 'VALUE' : key);
                    self.buildPayload(c, value[key]);
                }
            } else {
                node.t(value);
            }
        },
        trigger: function(event, data) {
            var self = this;
            debug('Trigger event: ' + event + ' with: ' + u.inspect(data));
            for (var i = 0; i < self.events.length; i++) {
                var ev = self.events[i];
                if (event == ev.name) {
                    if (typeof ev.handler == 'function') {
                        var trigger = true;
                        if (typeof data != 'undefined' && typeof data.uid != 'undefined' && data.uid != self.uid) {
                            trigger = false;
                        }
                        if (trigger) {
                            if (typeof data == 'undefined') {
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
            var self = this;
            try {
                debug('onMessage: ' + message.toString());
                var bd = message.getChild('body');
                if (bd) {
                    var event = bd.getText();
                    var payload = message.getChild('payload');
                    if (payload) {
                        data = self.getPayload(payload);
                    }
                    // handle push notification
                    if (event == 'push-notification' && typeof data != 'undefined') {
                        var event = data.name;
                        var data = data.data;
                    }
                    if (typeof data != 'undefined') {
                        self.trigger(event, data);
                    } else {
                        self.trigger(event);
                    }
                }
            } catch(e) {
                console.error('onMessage: ' + e.message);
            }
        },
        onPresence: function(presence) {
            var self = this;
            try {
                debug('onPresence: ' + presence.toString());
                var jid = presence.attrs.from;
                if (jid) {
                    var uid = jid.substr(jid.indexOf('/') + 1);
                    var type = presence.attrs.type;
                    if (uid == self.uid) {
                        if (type == 'error') {
                            var err = presence.getChild('error');
                            if (err) {
                                console.error('Error: ' + err.getText());
                            }
                        } else {
                            debug('Successfully joined the room: ' + self.room);
                            if (typeof self.onConnected == 'function') {
                                self.onConnected();
                            }
                        }
                    } else {
                        switch (type) {
                            case 'error':
                                break;
                            case 'unavailable':
                                self.trigger('user-offline', uid);
                                break;
                            default:
                                self.trigger('user-online', uid);
                                break;
                        }
                    }
                }
            } catch(e) {
                console.error('onPresence: ' + e.message);
            }
        },
        onRoster: function(roster) {
            var self = this;
            try {
                debug('onRooster: ' + roster.toString());
            } catch(e) {
                console.error('onRoster: ' + e.message);
            }
        },
        on: function(event, handler) {
            var self = this;
            self.events.push({ name: event, handler: handler });
        },
        emit: function(event, data) {
            var self = this;
            if (self.con) {
                var msg = new xmpp.Stanza('message', {
                    to: self.room,
                    type: 'groupchat'
                }).c('body').t(event).root();
                if (self._to) {
                    if (typeof data == 'undefined') {
                        var data = {}
                    }
                    data.uid = self._to;
                    self._to = null;
                }
                if (data) {
                    self.buildPayload(msg.c('payload'), data);
                }
                self.con.send(msg);
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