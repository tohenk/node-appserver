/**
 * Copyright (c) 2014-2016 Toha <tohenk@yahoo.com>
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

// === module dependencies ===

var
    path         = require('path'),
    appserver    = require('./lib/server')();

if (!appserver.cmd.parse() || (appserver.cmd.get('help') && usage())) {
    process.exit();
}

appserver.run();

function usage() {
    console.log('Usage:');
    console.log('  node %s [options]', path.basename(process.argv[1]));
    console.log('');
    console.log('Options:');
    console.log(appserver.cmd.dump());
    console.log('');
    console.log('Alternativelly, application configuration file can be passed using environment');
    console.log('variable %s.', appserver.ENV_CONFIG);
    console.log('');
    console.log('Application configuration expect a JSON file format.');
    console.log('The content of configuration shown as following example:');
    console.log('');
    console.log('{');
    console.log('    "myapp": {');
    console.log('        "title": "MyApp Server",');
    console.log('        "module": "/path/to/my/app",');
    console.log('        "secure": true,');
    console.log('        "port": 8081,');
    console.log('        "params": {');
    console.log('            "param1": "something",');
    console.log('            "param2": {');
    console.log('                "other": "other",');
    console.log('                "example": true');
    console.log('            }');
    console.log('        }');
    console.log('    }');
    console.log('}');
    console.log('');

    return true;
}

// EOF