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
 * App Server Handler for socket.io
 */

var fs    = require('fs');
var path  = require('path');
var cmd   = require('./../lib/cmd');
var util  = require('./../lib/util');

module.exports = exports = AppServer;

var Servers = {};

cmd.addVar('port', 'p', 'Specify server listen port, default is port 8080', 'port');
cmd.addBool('secure', 's', 'Use HTTPS server');
cmd.addVar('ssl-key', '', 'Set SSL private key');
cmd.addVar('ssl-cert', '', 'Set SSL public key');
cmd.addVar('ssl-ca', '', 'Set SSL CA key');

function AppServer() {
    var server = {
        id: 'socket.io',
        util: util,
        create: function(options) {
            var server;
            var options = options || {};
            var port = options.port || cmd.get('port');
            var secure = options.secure || cmd.get('secure');
            // check instance in server pool
            if (Servers[port]) {
                if (Servers[port]['secure'] != secure) {
                    throw new Error('Can\'t recreate server on port ' + port + '.');
                }
                return Servers[port]['server'];
            }
            // validate secure server
            if (secure) {
                var err = null;
                if (!cmd.get('ssl-key') || !this.util.fileExist(cmd.get('ssl-key'))) {
                    err = 'No SSL private key supplied or file not found.';
                } else if (!cmd.get('ssl-cert') || !this.util.fileExist(cmd.get('ssl-cert'))) {
                    err = 'No SSL public key supplied or file not found.';
                } else if (cmd.get('ssl-ca') && !this.util.fileExist(cmd.get('ssl-ca'))) {
                    err = 'SSL CA key file not found.';
                }
                if (err) {
                    throw new Error(err);
                }
            }
            var f = function() {
                console.log("%s server listening on port %d...", secure ? 'HTTPS' : 'HTTP', server.address().port);
                if (typeof options.callback == 'function') {
                    options.callback(server);
                }
            }
            if (secure) {
                var c = {
                    key: fs.readFileSync(cmd.get('ssl-key')),
                    cert: fs.readFileSync(cmd.get('ssl-cert'))
                };
                if (cmd.get('ssl-ca')) {
                    c.ca = fs.readFileSync(cmd.get('ssl-ca'));
                }
                var https = require('https');
                server = https.createServer(c);
                server.secure = true;
            } else {
                var http = require('http');
                server = http.createServer();
                server.secure = false;
            }
            server.listen(port, f);
            Servers[port] = {
                port: port,
                secure: secure,
                server: server,
                apps: []
            }
            return server;
        },
        createApp: function(server, name, options) {
            if (!server) {
                throw new Error('No server available, probably wrong configuration.');
            }
            var title = options.title || name;
            var module = options.module;
            var namespace = options.path;
            var params = options.params || {};
            var socket = this.createSocket(server);
            var factory = function(ns, options) {
                var tmp = [];
                if (namespace) tmp.push(namespace);
                if (ns) tmp.push(ns);
                var s = '/' + tmp.join('/');
                var addr = server.address();
                console.log('Socket listening on %s:%d%s', addr.family == 'IPv4' ? addr.address : '[' + addr.address + ']', addr.port, s);

                return socketWrap(tmp.length ? socket.of(s) : socket.sockets, options);
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
            Servers[server.address().port].apps.push(instance);

            return instance;
        },
        createSocket: function(server) {
            if (!server) {
                throw new Error('Socket IO need a server to be assigned.');
            }
            var io = null;
            var port = server.address().port;
            if (Servers[port]) {
                io = Servers[port]['io'];
            }
            if (!io) {
                io = require('socket.io').listen(server);
            }
            if (!Servers[port]['io']) {
                Servers[port]['io'] = io;
            }
            return io;
        },
        notifyAppClose: function() {
            for (var port in Servers) {
                console.log('Notify application exit for server on port %s', port);
                for (var i = 0; i < Servers[port].apps.length; i++) {
                    console.log('Notify application %s', Servers[port].apps[i].name);
                    if (typeof Servers[port].apps[i].doClose == 'function') {
                        Servers[port].apps[i].doClose(Servers[port].server);
                    }
                }
            }
        },
        run: function() {
            var self = this;
            var cnt = 0;
            self.config = cmd.get('config') || process.env[global.ENV_CONFIG];
            if (!self.config) {
                self.config = path.dirname(process.argv[1]) + path.sep + 'app.json';
            }
            console.log('Checking configuration %s', self.config);
            if (self.config && self.util.fileExist(self.config)) {
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
                    self.server = self.create(options);
                    self.createApp(self.server, name, options);
                    cnt++;
                }
                console.log('');
                console.log('Running %d applications(s)', cnt);
                console.log('');
            }
            process.on('exit', function(code) {
                self.notifyAppClose();
            });
            process.on('SIGTERM', function() {
                self.notifyAppClose();
            });
            process.on('SIGINT', function() {
                process.exit();
            });
            return cnt;
        }
    }
    return server;
}

function socketWrap(socket, options) {
    return socket;
}