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
 * CLI Executor
 */

var path  = require('path');
var util  = require('./util');

module.exports = exports = CliExecutor;

function CliExecutor(options) {
    var cli = {
        bin: null,
        args: null,
        defaultArgs: ['-f', '%CLI%', '--'],
        values: [],
        paths: [],
        addPath: function(name) {
            var self = this;
            self.paths.push(name);
        },
        addDefaultArg: function(arg) {
            var self = this;
            self.defaultArgs.push(arg);
        },
        addValue: function(name, value) {
            var self = this;
            self.values[name] = value;
        },
        findCLI: function(cli) {
            var self = this;
            return util.findCLI(path.normalize(cli), self.paths);
        },
        exec: function(parameters) {
            var self = this;
            var values = self.values;
            for (key in parameters) {
                values[key] = parameters[key];
            }
            return util.exec(self.bin ? self.bin : 'php', self.args ? self.args : self.defaultArgs, values);
        },
        init: function(config) {
            var self = this;
            // params is cli itself
            if (typeof config == 'string') {
                self.values.CLI = self.findCLI(config);
            }
            // params is array (bin, cli, and args)
            if (typeof config == 'object') {
                if (config.bin) self.bin = config.bin;
                if (config.cli) self.values.CLI = self.findCLI(config.cli);
                if (typeof config.args != 'undefined') self.args = Array.from(config.args);
            }
        }
    }
    if (typeof options.paths != 'undefined') {
        for (var i = 0; i < options.paths.length; i++) {
            cli.addPath(options.paths[i]);
        }
    }
    if (typeof options.args != 'undefined') {
        for (var i = 0; i < options.args.length; i++) {
            cli.addDefaultArg(options.args[i]);
        }
    }
    if (typeof options.values != 'undefined') {
        for (key in options.values) {
            cli.addValue(key, options.values[key]);
        }
    }
    return cli;
}