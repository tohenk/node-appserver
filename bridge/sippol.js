/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2026 Toha <tohenk@yahoo.com>
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

const io = require('socket.io-client');
const Bridge = require('.');

class SippolBridge extends Bridge {

    /** @type {io.Socket} */
    sippol = null
    /** @type {boolean} */
    connected = false

    onInit() {
        this.setupSippol(this.getConfig('sippol'));
        this.clientHandlers = {
            'sippol-notify': async ({con, data}) => {
                if (this.sippol && !this.clients.includes(con)) {
                    this.clients.push(con);
                    this.sippol.emit('status');
                }
            },
            'sippol-status': async ({con, data}) => {
                if (this.sippol && this.clients.includes(con)) {
                    this.sippol.emit('status');
                }
            },
            'sippol-logs': async ({con, data}) => {
                if (this.sippol && this.clients.includes(con)) {
                    this.sippol.emit('logs', {id: con.id});
                }
            }
        }
    }

    setupSippol(config) {
        if (config && config.url) {
            console.log('SIPPOL Bridge at %s', config.url);
            this.sippol = this.createSocketClient(config);
            this.sippol
                .on('connect', () => {
                    console.log('SIPPOL: Connected to %s', config.url);
                    this.sippol.emit('notify');
                    this.connected = true;
                })
                .on('disconnect', () => {
                    console.log('SIPPOL: Disconnected from %s', config.url);
                    this.connected = false;
                })
                .on('status', status => {
                    this.clients.forEach(con => {
                        con.emit('sippol-status', status);
                    });
                })
                .on('logs', data => {
                    this.clients.forEach(con => {
                        if (data.ref === con.id && data.logs) {
                            con.emit('sippol-logs', data.logs);
                        }
                    });
                })
            ;
        }
    }
}

module.exports = SippolBridge;