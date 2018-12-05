/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2017-2018 Toha <tohenk@yahoo.com>
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
 * HTTP command
 */

const args = process.argv.slice(2);
const data = JSON.parse(args[0]);

if (data.url) {
    const url = require('url').parse(data.url);
    const http = require('https:' == url.protocol ? 'https' : 'http');
    var method = data.method || 'GET';
    const options = {
        hostname: url.hostname,
        path: url.path,
        method: method.toUpperCase()
    }
    const params = data.params;
    const content = require('querystring').stringify(params);
    if (content.length) {
        options.headers = {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Content-Length': Buffer.byteLength(content)
        }
    }
    console.log('URL: %s', data.url);
    console.log('METHOD: %s', method.toUpperCase());
    console.log('DATA: %s', content);
    var response = null;
    const req = http.request(options, (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
            if (null == response) {
                response = chunk;
            } else {
                response = response + chunk;
            }
        });
        res.on('end', () => {
            console.log('STATUS: %s', res.statusCode);
            console.log('HEADERS: %s', JSON.stringify(res.headers));
            console.log('BODY: %s', response);
            contentType = res.headers['content-type'];
            if (/^application\/json/.test(contentType)) {
                result = JSON.parse(response);
                process.send(result);
            }
        });
    });
    req.on('error', (e) => {
        console.error('Error: %s', e.message);
    });
    // write data to request body
    if (content.length) {
        req.write(content);
    }
    req.end();
}