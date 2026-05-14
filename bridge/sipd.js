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

class SipdBridge extends Bridge {

    /** @type {io.Socket} */
    sipd = null
    /** @type {boolean} */
    connected = false

    onInit() {
        this.setupSipd(this.getConfig('sipd'));
        this.clientHandlers = {
            'sipd-notify': async ({con, data}) => {
                if (this.sipd && !this.clients.includes(con)) {
                    this.clients.push(con);
                    this.sipd.emit('status');
                }
            },
            'sipd-status': async ({con, data}) => {
                if (this.sipd && this.clients.includes(con)) {
                    this.sipd.emit('status');
                }
            },
            'sipd-captcha': async ({con, data}) => {
                if (this.sipd && this.clients.includes(con)) {
                    this.sipd.emit('captcha', Object.assign({id: con.id}, data));
                }
            },
            'sipd-logs': async ({con, data}) => {
                if (this.sipd && this.clients.includes(con)) {
                    this.sipd.emit('logs', {id: con.id});
                }
            }
        }
    }

    setupSipd(config) {
        if (config && config.url) {
            console.log('SIPD Bridge at %s', config.url);
            this.sipd = this.createSocketClient(config);
            this.sipd
                .on('connect', () => {
                    console.log('SIPD: Connected to %s', config.url);
                    this.sipd.emit('notify');
                    this.connected = true;
                })
                .on('disconnect', () => {
                    console.log('SIPD: Disconnected from %s', config.url);
                    this.connected = false;
                })
                .on('status', status => {
                    this.clients.forEach(con => {
                        con.emit('sipd-status', status);
                    });
                })
                .on('captcha', data => {
                    this.clients.forEach(con => {
                        if (data.ref === con.id) {
                            delete data.ref;
                            con.emit('sipd-captcha', data);
                        }
                    });
                })
                .on('logs', data => {
                    this.clients.forEach(con => {
                        if (data.ref === con.id && data.logs) {
                            con.emit('sipd-logs', data.logs);
                        }
                    });
                })
            ;
        }
    }
}

module.exports = SipdBridge;