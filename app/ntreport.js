/**
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

var path    = require('path');
var util    = require('../lib/util');

module.exports = exports = ReportServer;

function ReportServer(appserver, factory, logger, options) {
    var app = {
        options: options || {},
        handlers: {},
        log: function() {
            var args = Array.from(arguments);
            if (args.length) args[0] = util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            logger.log.apply(null, args);
        },
        handleCon: function(con, cli) {
            var self = this;
            con.on('report', function(data) {
                self.log('%s: Generating report %s...', con.id, data.hash);
                if (typeof cli == 'undefined' && data.namespace) {
                    var cli = self.handlers[data.namespace];
                }
                if (typeof cli == 'undefined') return;
                var p = cli.exec({
                    REPORTID: data.hash
                });
                p.on('exit', function(code) {
                    self.log('%s: %s status is %s...', con.id, data.hash, code);
                    con.emit('done', { hash: data.hash, code: code });
                });
                p.stdout.on('data', function(line) {
                    var line = util.cleanBuffer(line);
                    self.log('%s: %s', con.id, line);
                    // monitor progress
                    var re = /Progress\:\s+(\d+)\%/g;
                    var matches = re.exec(line);
                    if (matches) {
                        var progress = parseInt(matches[1]);
                        con.emit('progress', { hash: data.hash, progress: progress });
                    }
                });
                p.stderr.on('data', function(line) {
                    var line = util.cleanBuffer(line);
                    self.log('%s: %s', con.id, line);
                });
            });
        },
        createHandler: function(name, options) {
            var self = this;
            var configPath = path.dirname(appserver.config);
            var cli = require('../lib/cli')({
                paths: [__dirname, configPath],
                args: ['ntreport:generate', '--application=%APP%', '--env=%ENV%', '%REPORTID%'],
                values: {
                    'APP': 'frontend',
                    'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                }
            });
            cli.init(options);
            self.handlers[name] = cli;

            return cli;
        },
        init: function() {
            var self = this;
            for (var ns in this.options) {
                var cli = self.createHandler(ns, self.options[ns]);
                console.log('Serving %s...', ns);
                if (cli.values.CLI) console.log('Using CLI %s...', cli.values.CLI);
            }
            var con = factory();
            if (appserver.id == 'socket.io') {
                con.on('connection', function(client) {
                    self.handleCon(client);
                });
            } else {
                self.handleCon(con);
            }

            return this;
        }
    }

    return app.init();
}

// EOF