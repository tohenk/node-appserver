/*
 * Token utility
 * (c) 2016 Toha <tohenk@yahoo.com>
 */

Token = module.exports = exports;

Token.Q = '"';
Token.SEP = ',';
Token.quote = function(str) {
    var self = this;
    if (str.length) {
        var str = Token.Q + str.replace(Token.Q, Token.Q + Token.Q) + Token.Q;
    }
    return str;
}
Token.split = function(str, delimeter) {
    var self = this;
    var tokens = [];
    var delimeter = delimeter != undefined ? delimeter : Token.SEP;
    var i = 0, j = str.length - 1, cnt = 0, p = 0, s = 0;
    var started = false, enclosed = false, quoted = false;
    // s => the start position of next check
    // p => the last position of checked
    // i => the start position of checked
    while (true) {
        if (i > j) break;
        if (!started) {
            started = true;
            cnt = 0;
            enclosed = str.substr(i, 1) == '(';
            if (enclosed) {
                i++;
                cnt++;
            } else {
                quoted = str.substr(i, 1) == Token.Q;
                if (quoted) i++;
            }
            s = i;
            p = s;
        }
        if (started) {
            if (quoted) {
                while (true) {
                    p = str.indexOf(Token.Q, s);
                    if (p < 0 || p == j) {
                        p = j;
                        break;
                    }
                    if (p < j) {
                        if (str.substr(p + 1, 1) != Token.Q) {
                            break;
                        } else {
                            s = p + 2;
                        }
                    }
                }
            }
            if (enclosed) {
                if (quoted) p++;
                quoted = str.substr(p, 1) == Token.Q;
                if (quoted) {
                    p++;
                    s = p;
                    continue;
                }
                if (str.substr(p, 1) == delimeter) {
                    p++;
                    s = p;
                    continue;
                }
                while (cnt > 0) {
                    p++;
                    if (str.substr(p, 1) == '(') cnt++;
                    if (str.substr(p, 1) == ')') cnt--;
                }
            }
            if (!quoted && !enclosed) {
                p = str.indexOf(delimeter, s);
                if (p < 0) {
                    p = j + 1;
                }
            }
            var part = str.substr(i, p - i);
            if (quoted) part = part.replace(Token.Q + Token.Q, Token.Q);
            tokens.push(part);
            i = p + 1;
            if (str.substr(i, 1) == delimeter) i++;
            started = false;
        }
    }

    return tokens;
}
