/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2016-2018 Toha <tohenk@yahoo.com>
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
 * Command Executor
 */

const path  = require('path');
const util  = require('./util');
const fork  = require('child_process').fork;

module.exports = exports = CommandExecutor;

function CommandExecutor(cmd, options) {
    if (typeof cmd == 'string') {
        if (cmd.indexOf('http://') == 0 || cmd.indexOf('https://') == 0) {
            return HttpExecutor(cmd, options);
        } else {
            return CliExecutor(cmd, options);
        }
    }
    if (cmd.url != undefined) {
        return HttpExecutor(cmd, options);
    } else {
        return CliExecutor(cmd, options);
    }
}

function CliExecutor(cmd, options) {
    const command = {
        bin: null,
        args: null,
        defaultArgs: ['-f', '%CLI%', '--'],
        values: [],
        paths: [],
        addPath: function(name) {
            this.paths.push(name);
        },
        addDefaultArg: function(arg) {
            this.defaultArgs.push(arg);
        },
        addValue: function(name, value) {
            this.values[name] = value;
        },
        findCLI: function(cli) {
            return util.findCLI(path.normalize(cli), this.paths);
        },
        exec: function(parameters) {
            var values = this.values;
            for (key in parameters) {
                values[key] = parameters[key];
            }
            return util.exec(this.bin ? this.bin : 'php', this.args ? this.args : this.defaultArgs, values);
        },
        getId: function() {
            if (this.values.CLI) {
                return this.values.CLI;
            }
        },
        init: function(config) {
            // config is cli itself
            if (typeof config == 'string') {
                this.values.CLI = this.findCLI(config);
            }
            // config is array (bin, cli, and args)
            if (typeof config == 'object') {
                if (config.bin) this.bin = config.bin;
                if (config.cli) this.values.CLI = this.findCLI(config.cli);
                if (config.args != undefined) this.args = Array.from(config.args);
            }
            return this;
        }
    }
    if (options.paths != undefined) {
        for (var i = 0; i < options.paths.length; i++) {
            command.addPath(options.paths[i]);
        }
    }
    if (options.args != undefined) {
        for (var i = 0; i < options.args.length; i++) {
            command.addDefaultArg(options.args[i]);
        }
    }
    if (options.values != undefined) {
        for (key in options.values) {
            command.addValue(key, options.values[key]);
        }
    }
    return command.init(cmd);
}

function HttpExecutor(cmd, options) {
    const command = {
        url: null,
        method: null,
        defaults: {},
        addDefault: function(key, value) {
            this.defaults[key] = value;
        },
        exec: function(parameters) {
            var params = {};
            for (key in this.defaults) {
                params[key] = util.trans(this.defaults[key], parameters);
            }
            return fork(__dirname + path.sep + 'httpcmd', [JSON.stringify({
                url: this.url,
                method: this.method || 'get',
                params: params
            })], { stdio: ['pipe', 'pipe', 'pipe', 'ipc'] });
        },
        getId: function() {
            return this.url;
        },
        init: function(config) {
            if (typeof config == 'string') {
                this.url = config;
            } else {
                if (config.url) {
                    this.url = config.url;
                }
                if (config.method) {
                    this.method = config.method;
                }
                if (config.data != undefined) {
                    for (key in config.data) {
                        this.addDefault(key, config.data[key]);
                    }
                }
            }
            return this;
        }
    }
    return command.init(cmd);
}