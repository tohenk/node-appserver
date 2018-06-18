/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2014-2017 Toha <tohenk@yahoo.com>
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

module.exports = exports = ReportServer;

function ReportServer(appserver, factory, logger, options) {
    const app = {
        options: options || {},
        handlers: {},
        log: function() {
            var args = Array.from(arguments);
            if (args.length) args[0] = util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            logger.log.apply(null, args);
        },
        handleCon: function(con, cmd) {
            con.on('report', (data) => {
                this.log('%s: Generating report %s...', con.id, data.hash);
                if (typeof cmd == 'undefined' && data.namespace) {
                    var cmd = this.handlers[data.namespace];
                }
                if (typeof cmd == 'undefined') return;
                const p = cmd.exec({
                    REPORTID: data.hash
                });
                p.on('exit', (code) => {
                    this.log('%s: %s status is %s...', con.id, data.hash, code);
                    con.emit('done', { hash: data.hash, code: code });
                });
                p.stdout.on('data', (line) => {
                    var line = util.cleanBuffer(line);
                    this.log('%s: %s', con.id, line);
                    // monitor progress
                    const re = /Progress\:\s+(\d+)\%/g;
                    const matches = re.exec(line);
                    if (matches) {
                        const progress = parseInt(matches[1]);
                        con.emit('progress', { hash: data.hash, progress: progress });
                    }
                });
                p.stderr.on('data', (line) => {
                    var line = util.cleanBuffer(line);
                    this.log('%s: %s', con.id, line);
                });
            });
        },
        createHandler: function(name, options) {
            var configPath = path.dirname(appserver.config);
            var cmd = require('../lib/command')(options, {
                paths: [__dirname, configPath],
                args: ['ntreport:generate', '--application=%APP%', '--env=%ENV%', '%REPORTID%'],
                values: {
                    'APP': 'frontend',
                    'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                }
            });
            this.handlers[name] = cmd;
            return cmd;
        },
        init: function() {
            for (var ns in this.options) {
                var cmd = this.createHandler(ns, this.options[ns]);
                console.log('Serving %s...', ns);
                console.log('Using command %s...', cmd.getId());
            }
            var con = factory();
            if (appserver.id == 'socket.io') {
                con.on('connection', (client) => {
                    this.handleCon(client);
                });
            } else {
                this.handleCon(con);
            }
            return this;
        }
    }
    return app.init();
}

// EOF