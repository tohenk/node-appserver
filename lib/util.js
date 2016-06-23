/*
 * HTTP Server Handler
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
