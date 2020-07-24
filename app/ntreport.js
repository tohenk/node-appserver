/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2014-2020 Toha <tohenk@yahoo.com>
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

const path    = require('path');
const util    = require('../lib/util');
const Logger  = require('../lib/logger');

class ReportServer {

    config = null
    options = null
    handlers = {}

    constructor(appserver, factory, config, options) {
        this.appserver = appserver;
        this.factory = factory;
        this.config = config || {};
        this.options = options || {};
        this.init();
    }

    init() {
        this.initializeLogger();
        for (let ns in this.config) {
            let cmd = this.createHandler(ns, this.config[ns]);
            console.log('Serving %s...', ns);
            console.log('Using command %s...', cmd.getId());
        }
        const con = this.factory();
        if (this.appserver.id == 'socket.io') {
            con.on('connection', (client) => {
                this.handleCon(client);
            });
        } else {
            this.handleCon(con);
        }
    }

    initializeLogger() {
        this.logdir = this.options.logdir || path.join(__dirname, 'logs');
        this.logfile = path.join(this.logdir, 'ntreport.log');
        this.logger = new Logger(this.logfile);
    }

    log() {
        this.logger.log.apply(this.logger, Array.from(arguments));
    }

    handleCon(con, cmd) {
        con.on('report', (data) => {
            this.log('%s: Generating report %s...', con.id, data.hash);
            if (cmd == undefined && data.namespace) {
                cmd = this.handlers[data.namespace];
            }
            if (cmd == undefined) return;
            const p = cmd.exec({REPORTID: data.hash});
            p.on('exit', (code) => {
                this.log('%s: %s status is %s...', con.id, data.hash, code);
                con.emit('done', { hash: data.hash, code: code });
            });
            p.stdout.on('data', (line) => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.log('%s: %s', con.id, lines[i]);
                }
                // monitor progress
                const re = /Progress\:\s+(\d+)\%/g;
                const matches = re.exec(line);
                if (matches) {
                    const progress = parseInt(matches[1]);
                    con.emit('progress', { hash: data.hash, progress: progress });
                }
            });
            p.stderr.on('data', (line) => {
                const lines = util.cleanBuffer(line).split('\n');
                for (let i = 0; i < lines.length; i++) {
                    this.log('%s: %s', con.id, lines[i]);
                }
            });
        });
    }

    createHandler(name, options) {
        const configPath = path.dirname(this.appserver.config);
        const cmd = require('../lib/command')(options, {paths: [__dirname, configPath], args: ['%REPORTID%']});
        this.handlers[name] = cmd;
        return cmd;
    }

}

module.exports = ReportServer;