/*
 * Common utility
 * (c) 2016 Toha <tohenk@yahoo.com>
 */

var fs    = require('fs');
var path  = require('path');

AppUtil = module.exports = exports;

AppUtil.findCLI = function(cli, paths) {
    if (!this.fileExist(cli)) {
        for (var i = 0; i < paths.length; i++) {
            if (this.fileExist(path.normalize([paths[i], cli].join(path.sep)))) {
                cli = path.normalize([paths[i], cli].join(path.sep))
                break;
            }
        }
    }
    return cli;
}

AppUtil.fileExist = function(filename) {
    return fs.existsSync(filename);
}

AppUtil.cleanBuffer = function(buffer) {
    if (Buffer.isBuffer(buffer)) {
        var buffer = buffer.toString(); 
    }
    return buffer.trim();
}

AppUtil.trans = function(str, vars) {
    for (var n in vars) {
        var re = '%' + n + '%';
        str = str.replace(re, vars[n]);
    }
    return str;
}

// https://gist.github.com/cstipkovic/3983879
AppUtil.formatDate = function(date, format) {
    var day = date.getDate(),
        month = date.getMonth() + 1,
        year = date.getFullYear(),
        hours = date.getHours(),
        minutes = date.getMinutes(),
        seconds = date.getSeconds(),
        mseconds = date.getMilliseconds();
    var pad = function(num, len) {
        var s = num.toString();
        while (s.length < len) s = '0' + s;
        return s;
    }
    var repl = function(fmt, part, value) {
        if (fmt.indexOf(part) >= 0) fmt = fmt.replace(part, value);
        return fmt;
    }
    var values = {
        'yyyy': pad(year, 4),
        'yy': pad(year, 4).substr(2, 2),
        'MM': pad(month, 2),
        'dd': pad(day, 2),
        'HH': pad(hours, 2),
        'hh': pad(hours > 12 ? hours - 12 : (hours == 0 ? 12 : hours), 2),
        't': hours > 11 ? 'pm' : 'am',
        'mm': pad(minutes, 2),
        'ss': pad(seconds, 2),
        'zzz': pad(mseconds, 3)
    }
    if (!format) format = 'MM/dd/yyyy';
    for (var i in values) {
        format = repl(format, i, values[i]);
    }
    return format;
}
