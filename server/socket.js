/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2022 Toha <tohenk@yahoo.com>
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

const fs    = require('fs');
const path  = require('path');
const cmd   = require('@ntlab/ntlib/cmd');
const util  = require('@ntlab/ntlib/util');

cmd.addVar('port', 'p', 'Specify server listen port, default is port 8080', 'port');
cmd.addBool('secure', 's', 'Use HTTPS server');
cmd.addVar('ssl-key', '', 'Set SSL private key');
cmd.addVar('ssl-cert', '', 'Set SSL public key');
cmd.addVar('ssl-ca', '', 'Set SSL CA key');
cmd.addVar('ssl-passphrase', '', 'Set SSL private key passphrase');

const Servers = {};

/**
 * App Server Handler for socket.io.
 */
class AppServer {

    id = 'socket.io'

    create(options) {
        options = options || {};
        let server;
        let port = options.port || cmd.get('port');
        let secure = options.secure || cmd.get('secure');
        // check instance in server pool
        if (Servers[port]) {
            if (Servers[port]['secure'] != secure) {
                throw new Error('Can\'t recreate server on port ' + port + '.');
            }
            return Servers[port]['server'];
        }
        // validate secure server
        if (secure) {
            let err = null;
            if (!cmd.get('ssl-key') || !util.fileExist(cmd.get('ssl-key'))) {
                err = 'No SSL private key supplied or file not found.';
            } else if (!cmd.get('ssl-cert') || !util.fileExist(cmd.get('ssl-cert'))) {
                err = 'No SSL public key supplied or file not found.';
            } else if (cmd.get('ssl-ca') && !util.fileExist(cmd.get('ssl-ca'))) {
                err = 'SSL CA key file not found.';
            }
            if (err) {
                throw new Error(err);
            }
        }
        const f = () => {
            console.log("%s server listening on %s...", secure ? 'HTTPS' : 'HTTP', this.getAddress(server));
            if (typeof options.callback == 'function') {
                options.callback(server);
            }
        }
        if (secure) {
            const c = {
                key: fs.readFileSync(cmd.get('ssl-key')),
                cert: fs.readFileSync(cmd.get('ssl-cert'))
            };
            if (cmd.get('ssl-ca')) {
                c.ca = fs.readFileSync(cmd.get('ssl-ca'));
            }
            if (cmd.get('ssl-passphrase')) {
                c.passphrase = cmd.get('ssl-passphrase');
            }
            const https = require('https');
            server = https.createServer(c);
            server.secure = true;
        } else {
            const http = require('http');
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
    }

    getAddress(server) {
        const addr = server.address();
        return addr.family == 'IPv4' ? addr.address : '[' + addr.address + ']' + ':' + addr.port;
    }

    createApp(server, name, options) {
        if (!server) {
            throw new Error('No server available, probably wrong configuration.');
        }
        const title = options.title || name;
        const module = options.module;
        const namespace = options.path;
        const configs = options.params || {};
        const params = {};
        const port = options.port;
        const socket = this.createSocket(server, port, options.cors ? {cors: options.cors} : {});
        const factory = (ns, options) => {
            const tmp = [];
            if (namespace) tmp.push(namespace);
            if (ns) tmp.push(ns);
            const s = '/' + tmp.join('/');
            return this.socketWrap(tmp.length ? socket.of(s) : socket.sockets, options);
        }
        if (params.logdir == undefined) {
            params.logdir = path.resolve(path.dirname(this.config),
                options.logdir ? options.logdir : cmd.get('logdir'));
        }
        console.log('');
        console.log(title);
        console.log('='.repeat(79));
        console.log('');
        const AppClass = require('./../' + module);
        const instance = new AppClass(this, factory, configs, params);
        console.log('');
        console.log('-'.repeat(79));
        instance.name = name;
        Servers[port].apps.push(instance);
        return instance;
    }

    createSocket(server, port, options) {
        if (!server) {
            throw new Error('Socket IO need a server to be assigned.');
        }
        let io;
        if (Servers[port]) {
            io = Servers[port]['io'];
        }
        if (!io) {
            let opts = {};
            if (options && options.cors) {
                opts.cors = options.cors;
            }
            const { Server } = require('socket.io');
            io = new Server(server, opts);
        }
        if (!Servers[port]['io']) {
            Servers[port]['io'] = io;
        }
        return io;
    }

    socketWrap(socket, options) {
        return socket;
    }

    notifyAppClose() {
        for (let port in Servers) {
            console.log('Notify application exit for server on port %s', port);
            for (let i = 0; i < Servers[port].apps.length; i++) {
                console.log('Notify application %s', Servers[port].apps[i].name);
                if (typeof Servers[port].apps[i].doClose == 'function') {
                    Servers[port].apps[i].doClose(Servers[port].server);
                }
            }
        }
    }

    run() {
        let cnt = 0;
        this.config = cmd.get('config') || process.env[global.ENV_CONFIG];
        if (!this.config) {
            this.config = path.dirname(process.argv[1]) + path.sep + 'app.json';
        }
        console.log('Checking configuration %s', this.config);
        if (this.config && util.fileExist(this.config)) {
            console.log('Reading configuration %s', this.config);
            const apps = JSON.parse(fs.readFileSync(this.config));
            for (let name in apps) {
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
                if (!options.port) options.port = cmd.get('port') || 8080;
                this.server = this.create(options);
                this.createApp(this.server, name, options);
                cnt++;
            }
            console.log('');
            console.log('Running %d applications(s)', cnt);
            console.log('');
        }
        process.on('exit', (code) => {
            this.notifyAppClose();
        });
        process.on('SIGTERM', () => {
            this.notifyAppClose();
        });
        process.on('SIGINT', () => {
            process.exit();
        });
        return cnt;
    }

}

module.exports = AppServer;