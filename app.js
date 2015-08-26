/**
 * Copyright (c) 2014-2015 Toha <tohenk@yahoo.com>
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
 * Report generation mechanism.
 *
 * 1. Client connect to server, register client connection.
 * 2. Client emit event `report` with parameter the hash id to generate.
 * 3. Server create a child process and monitor the process for completion.
 * 4. Examine the exit code of child process and serve the client based on the
 *    result, then disconnect the client
 * 5. Client redirecting to download location if success or show the error message
 *    and go to previous report page.
 */

// === const ===

const
    PARAM_VAR    = 1,
    PARAM_BOOL   = 2;

// === module dependencies ===

var
    express      = require('express'),
    path         = require('path'),
    favicon      = require('serve-favicon'),
    logger       = require('morgan'),
    cookieParser = require('cookie-parser'),
    bodyParser   = require('body-parser'),
    routes       = require('./routes/index'),
    fs           = require('fs'),
    spawn        = require('child_process').spawn,
    app          = express();

// === variables ===

var
    php          = path.sep == '\\' ? 'php.exe' : 'php',
    io           = null,
    args         = process.argv.slice(2),
    params       = {};

// === command line arguments ===

cmdRegisterBoolArg('help', 'h', 'Show program usage');
cmdRegisterVarArg('port', 'p', 'Specify server listen port, default is port 81');
cmdRegisterVarArg('config', 'c', 'Read report configuration from file');

if (!parseArgs() || (cmdGetArg('help') && usage())) {
    process.exit();
}

// === configuration ===

app.set('port', cmdGetArg('port') || process.env.PORT || 81);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'jade');

//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: false}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// === routes ===

app.use('/', routes);

// === error handlers ===

// catch 404 and forward to error handler
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

// development error handler
if (app.get('env') === 'development') {
    app.use(function(err, req, res, next) {
        res.status(err.status || 500);
        res.render('error', {
            message: err.message,
            error: err
        });
    });
}

// production error handler
app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
        message: err.message,
        error: {}
    });
});

// === server initialization ===

var server = app.listen(app.get('port'), function() {
    console.log('ntReport Server (c) 2014-2015 Toha <tohenk@yahoo.com>');
    console.log("Listening on port %d in %s mode", server.address().port, app.settings.env);
    console.log('');

    if (!run()) {
        server.close();
    }
});

// === socket.io implementation ===

function run() {
    var cnt = 0;
    var cfg = cmdGetArg('config') || process.env.NT_REPORT_CONFIG;
    if (cfg && fileExist(cfg)) {
        console.log('Using config file %s', cfg);
        var configPath = path.dirname(cfg);
        var namespaces = JSON.parse(fs.readFileSync(cfg));
        for (index in namespaces) {
            var cli = findCLI(path.normalize(namespaces[index]), [__dirname, configPath]);
            createReportServer(index, cli);
            cnt++;
        }
    } else {
        if (process.env.NT_REPORT_CLI && fileExist(process.env.NT_REPORT_CLI)) {
            var cli = process.env.NT_REPORT_CLI;
        } else {
            console.log('No CLI specified, please set environment variable NT_REPORT_CLI.');
            return;
        }
        createReportServer(null, cli);
        cnt++;
    }

    return cnt;
}

function fileExist(filename) {
    return fs.existsSync(filename);
}

function findCLI(cli, paths) {
    if (!fileExist(cli)) {
        for (var i = 0; i < paths.length; i++) {
            if (fileExist(path.normalize([paths[i], cli].join(path.sep)))) {
                cli = path.normalize([paths[i], cli].join(path.sep))
                break;
            }
        }
    }

    return cli;
}

function createReportServer(namespace, cli) {
    console.log("Serving \"%s\" using %s.", namespace ? namespace : 'GLOBAL', cli);
    var _io = createSocketIo();
    var s = namespace ? _io.of('/' + namespace) : _io.sockets; 
    s.on('connection', function(socket) {
        socket.on('report', function(data) {
            console.log('%s: Generating report %s...', socket.id, data.hash);
            var p = spawn(php, ['-f', cli, '--', 'ntreport:generate', '--application=frontend', '--env=' + (app.settings.env == 'development' ? 'dev' : 'prod'), data.hash]);
            p.on('exit', function(code) {
                console.log('%s: %s status is %s...', socket.id, data.hash, code);
                socket.emit('done', {code: code});
            });
            p.stdout.on('data', function(line) {
                var line = cleanBuffer(line);
                console.log('%s: %s', socket.id, line);
                // monitor progress
                var re = /Progress\:\s+(\d+)\%/g;
                var matches = re.exec(line);
                if (matches) {
                    var progress = parseInt(matches[1]);
                    socket.emit('progress', {progress: progress});
                }
            });
            p.stderr.on('data', function(line) {
                var line = cleanBuffer(line);
                console.log('%s: %s', socket.id, line);
            });
        });
    });

    return s;
}

function createSocketIo() {
    if (!io) {
        io = require('socket.io').listen(server);
    }

    return io;
}

function cleanBuffer(buffer) {
    if (Buffer.isBuffer(buffer)) {
        var buffer = buffer.toString(); 
    }

    return buffer.trim();
}

// === command line helper ===

function cmdRegisterArg(name, shortname, desc, type, value) {
    if (!params[name]) {
        params[name] = {
            name: name,
            shortname: shortname,
            description: desc,
            type: type || PARAM_BOOL,
            value: value || null
        }
    }
}

function cmdRegisterBoolArg(name, shortname, desc, value) {
    return cmdRegisterArg(name, shortname, desc, PARAM_BOOL, value);
}

function cmdRegisterVarArg(name, shortname, desc, value) {
    return cmdRegisterArg(name, shortname, desc, PARAM_VAR, value);
}

function cmdGetArg(name) {
    if (params[name]) {
        return params[name]['value'];
    }
}

function cmdHasArg(name) {
    return params[name] ? true : false;
}

function cmdHasShortArg(shortname) {
    for (var a in params) {
        if (params[a]['shortname'] == shortname) return a;
    }
}

function parseArgs() {
    var err = null;
    while (true) {
        if (!args.length) break;
        var arg = args[0];
        var param = null;
        var value = null;
        var shortparam = false;
        // check for long parameter format
        if ('--' == arg.substr(0, 2)) {
            param = arg.substr(2);
        // check for short parameter format
        } else if ('-' == arg.substr(0, 1)) {
            param = arg.substr(1);
            shortparam = true;
        }
        // not parameter, just give up
        if (!param) break;
        // check for parameter separator
        if (param.indexOf('=') > 0) {
            value = param.substr(param.indexOf('=') + 1);
            param = param.substr(0, param.indexOf('='));
        }
        // try to get the standard parameter name
        if (shortparam) {
            var longname = cmdHasShortArg(param);
            if (longname) param = longname;
        }
        // check the existence of parameter
        if (!cmdHasArg(param)) {
            err = 'Unknown argument "' + param + '".';
            break;
        }
        // validate parameter
        if (params[param]['type'] == PARAM_VAR && !value) {
            err = 'Argument "' + param + '" need a value to be assigned.';
            break;
        }
        if (params[param]['type'] == PARAM_BOOL && value) {
            err = 'Argument "' + param + '" doesn\'t accept a value.';
            break;
        }
        // set the value
        params[param]['value'] = value ? value : true;
        // remove processed parameter
        args = args.slice(1);
    }
    if (err) {
        console.log(err);
        console.log('');
    }

    return err ? false : true;
}

function usage() {
    console.log('Usage:');
    console.log(' ' + process.argv[1] + ' [options]');
    console.log('');
    console.log('Options:');
    console.log('--port=port, -p=port       Set the server port, default to 81 if not specified');
    console.log('--config=file, -c=file     Read report configuration from file');
    console.log('');
    console.log('Alternativelly, report configuration file can be passed using environment');
    console.log('variable NT_REPORT_CONFIG, or for a single usage report serving, pass');
    console.log('NT_REPORT_CLI instead.');
    console.log('');

    return true;
}

// EOF