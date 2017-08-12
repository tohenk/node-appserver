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

var path  = require('path');

module.exports = exports = ReportServer;

function ReportServer(appserver, factory, logger, options) {
    var app = {
        appserver: appserver,
        util: appserver.util,
        logger: logger,
        options: options || {},
        log: function() {
            var args = Array.from(arguments);
            if (args.length) args[0] = this.util.formatDate(new Date(), '[yyyy-MM-dd HH:mm:ss.zzz]') + ' ' + args[0];
            this.logger.log.apply(null, args);
        },
        listen: function(ns, con, params) {
            var self = this;
            var configPath = path.dirname(self.appserver.config);
            var cli = require('../lib/cli')({
                paths: [__dirname, configPath],
                args: ['ntreport:generate', '--application=%APP%', '--env=%ENV%', '%REPORTID%'],
                values: {
                    'APP': 'frontend',
                    'ENV': typeof v8debug == 'object' ? 'dev' : 'prod'
                }
            });
            cli.init(params);
            // show information
            console.log('Serving %s...', ns);
            if (cli.values.CLI) console.log('Using CLI %s...', cli.values.CLI);
            // handle con
            con.on('connection', function(client) {
                client.on('report', function(data) {
                    self.log('%s: Generating report %s...', client.id, data.hash);
                    var p = cli.exec({
                        REPORTID: data.hash
                    });
                    p.on('exit', function(code) {
                        self.log('%s: %s status is %s...', client.id, data.hash, code);
                        client.emit('done', {code: code});
                    });
                    p.stdout.on('data', function(line) {
                        var line = self.util.cleanBuffer(line);
                        self.log('%s: %s', client.id, line);
                        // monitor progress
                        var re = /Progress\:\s+(\d+)\%/g;
                        var matches = re.exec(line);
                        if (matches) {
                            var progress = parseInt(matches[1]);
                            client.emit('progress', {progress: progress});
                        }
                    });
                    p.stderr.on('data', function(line) {
                        var line = self.util.cleanBuffer(line);
                        self.log('%s: %s', client.id, line);
                    });
                });
            });
        },
        init: function() {
            for (var ns in this.options) {
                this.listen(ns, factory(ns), this.options[ns]);
            }
        }
    }
    app.init();

    return app;
}

// EOF