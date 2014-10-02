/**
 * Copyright (c) 2014 Toha <tohenk@yahoo.com>
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
    io           = null;

// === configuration ===

app.set('port', process.env.PORT || 81);
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
    console.log('ntReport Server (c) 2014 Toha <tohenk@yahoo.com>');
    console.log("Listening on port %d in %s mode", server.address().port, app.settings.env);
    console.log('');

    run();
});

// === socket.io implementation ===

function run() {
    if (process.env.NT_REPORT_CONFIG && fs.existsSync(process.env.NT_REPORT_CONFIG)) {
        console.log('Using config file %s', process.env.NT_REPORT_CONFIG);
        var namespaces = JSON.parse(fs.readFileSync(process.env.NT_REPORT_CONFIG));
        for (index in namespaces) {
            createReportServer(index, path.normalize(namespaces[index]));
        }
    } else {
        var cli = path.normalize([__dirname, '..', '..', '..', 'symfony'].join(path.sep));
        createReportServer(null, cli);
    }
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

// EOF