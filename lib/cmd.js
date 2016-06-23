/*
 * Command line utility
 * (c) 2016 Toha <tohenk@yahoo.com>
 */

const CmdParser = module.exports = exports;

var Cmds = {};
var LastCmd = null;

CmdParser.PARAM_VAR = 1;
CmdParser.PARAM_BOOL = 2;

CmdParser.register = function(type, name, shortname, desc, varname) {
    if (!Cmds[name]) {
        Cmds[name] = {
            name: name,
            shortname: shortname,
            description: desc,
            type: type || PARAM_BOOL,
            value: null,
            varname: varname || null,
            accessible: true
        }
        LastCmd = name;
    }
    return this;
}

CmdParser.addBool = function(name, shortname, desc) {
    return this.register(this.PARAM_BOOL, name, shortname, desc);
}

CmdParser.addVar = function(name, shortname, desc, varname) {
    return this.register(this.PARAM_VAR, name, shortname, desc, varname);
}

CmdParser.setAccessible = function(accessible) {
    if (LastCmd && Cmds[LastCmd]) {
        Cmds[LastCmd].accessible = accessible;
    }
    return this;
}

CmdParser.get = function(name) {
    if (Cmds[name]) {
        return Cmds[name]['value'];
    }
}

CmdParser.has = function(name) {
    return Cmds[name] ? true : false;
}

CmdParser.hasShort = function(shortname) {
    for (var name in Cmds) {
        if (Cmds[name]['shortname'] == shortname) return name;
    }
}

CmdParser.dump = function() {
    var str, len = 0, _res = [], _cmds = [], _descs = [];
    for (var name in Cmds) {
        var Cmd = Cmds[name];
        if (!Cmd.accessible) continue;
        str = this.cmdStr(Cmd, false);
        if (Cmd.shortname) {
            str += ', ' + this.cmdStr(Cmd, true);
        }
        if (str.length > len) len = str.length;
        _cmds.push(str);
        _descs.push(Cmd.description);
    }
    len += 2;
    for (var i = 0; i < _cmds.length; i++) {
        str = _cmds[i];
        if (str.length < len) {
            str += ' '.repeat(len - str.length);
        }
        _res.push(str + _descs[i]);
    }
    return _res.join("\n");
}

CmdParser.cmdStr = function(Cmd, shortCmd) {
    var str = shortCmd ? '-' + Cmd.shortname : '--' + Cmd.name;
    if (Cmd.type == this.PARAM_VAR) {
        str += '=' + (Cmd.varname ? Cmd.varname : Cmd.name);
    }
    return str; 
}

CmdParser.parse = function(arguments) {
    var arguments = arguments || process.argv.slice(2);
    var err = null;
    while (true) {
        if (!arguments.length) break;
        var arg = arguments[0];
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
            var longname = this.hasShort(param);
            if (longname) param = longname;
        }
        // check the existence of parameter
        if (!this.has(param)) {
            err = 'Unknown argument "' + param + '".';
            break;
        }
        // validate parameter
        if (Cmds[param]['type'] == this.PARAM_VAR && !value) {
            err = 'Argument "' + param + '" need a value to be assigned.';
            break;
        }
        if (Cmds[param]['type'] == this.PARAM_BOOL && value) {
            err = 'Argument "' + param + '" doesn\'t accept a value.';
            break;
        }
        // set the value
        Cmds[param]['value'] = value ? value : true;
        // remove processed parameter
        arguments = arguments.slice(1);
    }
    if (err) {
        console.log(err);
        console.log('');
    }

    return err ? false : true;
}
