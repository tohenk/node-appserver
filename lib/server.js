/*
 * HTTP Server Handler for socket.io
 * (c) 2016 Toha <tohenk@yahoo.com>
 */

var fs    = require('fs');
var path  = require('path');
var cmd   = require('./cmd');
var util  = require('./util');

module.exports = exports = AppServer;

var Servers = {};

cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
cmd.addVar('port', 'p', 'Specify server listen port, default is port 8080', 'port');
cmd.addVar('config', 'c', 'Read app configuration from file', 'config-file');
cmd.addBool('secure', 's', 'Use HTTPS server');
cmd.addVar('ssl-key', '', 'Set SSL private key');
cmd.addVar('ssl-cert', '', 'Set SSL public key');
cmd.addVar('ssl-ca', '', 'Set SSL CA key');
cmd.addVar('logdir', 'l', 'Set the log file location', 'directory');

function AppServer(app) {
    var server = {
        ENV_CONFIG: 'NT_APP_CONFIG',
        app: app,
        cmd: cmd,
        util: util,
        create: function(options) {
            var server;
            var options = options || {};
            var port = options.port || this.app.get('port');
            var secure = options.secure || this.cmd.get('secure');
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
                if (!this.cmd.get('ssl-key') || !this.util.fileExist(this.cmd.get('ssl-key'))) {
                    err = 'No SSL private key supplied or file not found.';
                } else if (!this.cmd.get('ssl-cert') || !this.util.fileExist(this.cmd.get('ssl-cert'))) {
                    err = 'No SSL public key supplied or file not found.';
                } else if (this.cmd.get('ssl-ca') && !this.util.fileExist(this.cmd.get('ssl-ca'))) {
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
                    key: fs.readFileSync(this.cmd.get('ssl-key')),
                    cert: fs.readFileSync(this.cmd.get('ssl-cert'))
                };
                if (this.cmd.get('ssl-ca')) {
                    c.ca = fs.readFileSync(this.cmd.get('ssl-ca'));
                }
                var https = require('https');
                server = https.createServer(c, app);
                server.secure = true;
            } else {
                var http = require('http');
                server = http.createServer(app);
                server.secure = false;
            }
            server.listen(port, f);
            Servers[port] = {
                port: port,
                secure: secure,
                server: server
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
            var io = this.createSocket(server);
            var socket_creator = function(ns) {
                var tmp = [];
                if (namespace) tmp.push(namespace);
                if (ns) tmp.push(ns);
                var s = '/' + tmp.join('/');
                var addr = server.address();
                console.log('Socket listening on %s:%d%s', addr.family == 'IPv4' ? addr.address : '[' + addr.address + ']', addr.port, s);
                return tmp.length ? io.of(s) : io.sockets;
            }
            var logdir = path.resolve(path.dirname(this.config), options.logdir ? options.logdir : this.cmd.get('logdir'));
            var stdout = fs.createWriteStream(logdir + path.sep + name + '.log');
            var stderr = fs.createWriteStream(logdir + path.sep + name + '-error.log');
            var logger = new console.Console(stdout, stderr);
            console.log('');
            console.log(title);
            console.log('='.repeat(79));
            console.log('');
            var instance = require(module)(this, socket_creator, logger, params);
            console.log('');
            console.log('-'.repeat(79));

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
        run: function() {
            var cnt = 0;
            this.config = this.cmd.get('config') || process.env[this.ENV_CONFIG];
            if (!this.config) {
                this.config = path.dirname(process.argv[1]) + path.sep + 'app.json';
            }
            console.log('Checking configuration %s', this.config);
            if (this.config && this.util.fileExist(this.config)) {
                console.log('Reading configuration %s', this.config);
                var apps = JSON.parse(fs.readFileSync(this.config));
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
                    this.server = this.create(options);
                    this.createApp(this.server, name, options);
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