/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2022-2025 Toha <tohenk@yahoo.com>
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

const path = require('path');
const Cmd = require('@ntlab/ntlib/cmd');

Cmd.addBool('help', 'h', 'Show program usage').setAccessible(false);
Cmd.addVar('config', '', 'Read app configuration from file', 'config-file');

if (!Cmd.parse() || (Cmd.get('help') && usage())) {
    process.exit();
}

const fs = require('fs');
const util = require('@ntlab/ntlib/util');

class App {

    config = {}

    constructor() {
        this.initialize();
        this.cmd = new CommandHandler({
            logger: console,
            paths: [__dirname, this.config.dir]
        });
    }

    initialize() {
        let filename;
        // read configuration from command line values
        if (process.env.APP_CONFIG && fs.existsSync(process.env.APP_CONFIG)) {
            filename = process.env.APP_CONFIG;
        } else if (Cmd.get('config') && fs.existsSync(Cmd.get('config'))) {
            filename = Cmd.get('config');
        } else if (fs.existsSync(path.join(__dirname, 'listener.json'))) {
            filename = path.join(__dirname, 'listener.json');
        }
        if (filename) {
            console.log('Reading configuration %s', filename);
            this.config = JSON.parse(fs.readFileSync(filename));
            this.config.dir = path.dirname(filename); 
        }
    }

    check() {
        if (this.config.url === undefined) {
            console.log('No url in configuration, aborting!');
            return;
        }
        if (this.config.secret === undefined) {
            console.log('No secret in configuration, aborting!');
            return;
        }
        if (typeof this.config.listens !== 'object') {
            console.log('No listens in configuration, aborting!');
            return;
        }
        return true;
    }

    createServer() {
        const net = require('net');
        this.server = net.createServer().listen();
    }

    createListener(group = null) {
        const io = require('socket.io-client');
        const listener = {
            io: io(this.config.url),
            cmds: {},
        }
        for (const key in this.config.listens) {
            const cfg = this.config.listens[key];
            if ((group && cfg.group !== group) || (!group && cfg.group)) {
                continue;
            }
            const event = cfg.type ? cfg.type : key;
            listener.cmds[event] = this.cmd.create(cfg, ['%DATA%']);
        }
        const name = group ? group : 'world';
        listener.io
            .on('connect', () => {
                console.log(`${name}: Connected to %s`, this.config.url);
                const xid = {xid: this.config.secret};
                if (group) {
                    xid.group = group;
                }
                listener.io.emit('register', xid);
            })
            .on('disconnect', () => {
                console.log(`${name}: Disconnected from %s`, this.config.url);
            })
            .on('data', data => {
                const event = data.id;
                const payload = data.params;
                if (listener.cmds[event]) {
                    console.log(`${name}: Event %s`, event);
                    this.cmd.execute(event, listener.cmds[event], {DATA: JSON.stringify(payload)})
                        .catch(err => console.error(`${name}: %s`, err));
                }
            })
        ;
        return listener;
    }

    createListeners() {
        const groups = [];
        Object.values(this.config.listens).forEach(cfg => {
            const group = cfg.group || null;
            if (groups.indexOf(group) < 0) {
                groups.push(group);
            }
        });
        if (groups.length) {
            for (const group of groups) {
                this.createListener(group);
            }
        }
    }

    run() {
        if (this.check()) {
            this.createServer();
            this.createListeners();
            console.log('Listening for %s, press Ctrl + C to stop...', this.config.url);
        }
    }

}

/**
 * A CLI or HTTP command handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class CommandHandler {

    cookies = {}

    constructor({logger, paths}) {
        this.logger = logger;
        this.paths = paths;
    }

    /**
     * Create command from configuration.
     *
     * @param {object} config Configuration
     * @param {string[]} args Argument placeholders
     * @param {string[]} values Argument values
     * @returns {import('@ntlab/ntlib/command')}
     */
    create(config, args, values) {
        return require('@ntlab/ntlib/command')(config, {
            paths: this.paths,
            args,
            values
        });
    }

    /**
     * Execute command.
     *
     * @param {string} name Command name
     * @param {import('@ntlab/ntlib/command')} cmd Command object
     * @param {string[]} values Argument values
     * @returns {Promise<any>}
     */
    execute(name, cmd, values) {
        return new Promise((resolve, reject) => {
            const p = cmd.exec(values);
            p.on('message', data => {
                if (typeof data === 'object' && data.type === 'Buffer' && Array.isArray(data.data)) {
                    data = Buffer.from(data.data);
                }
                if (typeof data === 'object' && data.cmd) {
                    const res = {}, cookie = data.cookie;
                    switch (data.cmd) {
                        case 'request':
                            res.headers = {
                                'x-requested-with': 'XMLHttpRequest'
                            }
                            if (cookie && cookie.domain && cookie.path) {
                                if (this.cookies && this.cookies[cookie.domain]) {
                                    const cookies = {};
                                    for (const cookiePath of Object.keys(this.cookies[cookie.domain])) {
                                        if (cookie.path.startsWith(cookiePath)) {
                                            Object.assign(cookies, this.cookies[cookie.domain][cookiePath]);
                                        }
                                    }
                                    if (Object.keys(cookies).length) {
                                        res.cookie = [];
                                        for (const k of Object.keys(cookies)) {
                                            res.cookie.push(`${k}=${cookies[k]}`);
                                        }
                                    }
                                }
                            }
                            break;
                        case 'response':
                            if (cookie && cookie.domain && cookie.cookie) {
                                /**
                                 * {
                                 *   '/': {Cookie1: 'Value1', Cookie2: 'Value2'
                                 * }
                                 */
                                if (!this.cookies) {
                                    this.cookies = {};
                                }
                                if (!this.cookies[cookie.domain]) {
                                    this.cookies[cookie.domain] = {};
                                }
                                for (const cookiePath of Object.keys(cookie.cookie)) {
                                    if (!this.cookies[cookie.domain][cookiePath]) {
                                        this.cookies[cookie.domain][cookiePath] = {};
                                    }
                                    Object.assign(this.cookies[cookie.domain][cookiePath], cookie.cookie[cookiePath]);
                                }
                            }
                            break;
                    }
                    data = null;
                    if (Object.keys(res).length) {
                        p.send(res);
                    }
                }
                if (data) {
                    console.log(`${name}: %s`, data);
                }
            });
            p.on('exit', code => {
                this.logger.log(`${name}: Exit code %s...`, code);
                resolve(code);
            });
            p.on('error', err => {
                this.logger.log(`${name}: ERR: %s...`, err);
                reject(err);
            });
            p.stdout.on('data', line => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.logger.log(`${name}: 1> %s`, lines[i]);
                }
            });
            p.stderr.on('data', line => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.logger.log(`${name}: 2> %s`, lines[i]);
                }
            });
        });
    }
}

new App().run();

// usage help

function usage() {
    console.log('Usage:');
    console.log('  node %s [options]', path.basename(process.argv[1]));
    console.log('');
    console.log('Options:');
    console.log(Cmd.dump());
    console.log('');
    return true;
}