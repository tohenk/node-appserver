/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2020-2022 Toha <tohenk@yahoo.com>
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

const fs      = require('fs');
const path    = require('path');
const io      = require('socket.io-client');
const Queue   = require('@ntlab/ntlib/queue');
const Bridge  = require('./bridge');

class SMSGateway extends Bridge {

    gw = null
    connected = false
    queue = null
    notifyQueue = null
    notifyCmd = null

    onInit() {
        this.queueFilename = path.join(this.getApp().queueDir, 'messages.json');
        this.setupSMSGateway(this.getConfig('smsgw'));
        this.setupSMSNotifier(this.getConfig('text-client'));
    }

    onFinalize() {
        if (this.queue && this.queue.queues.length) {
            fs.writeFileSync(this.queueFilename, JSON.stringify(this.queue.queues));
            this.getApp().log('GWY: Queue saved to %s...', this.queueFilename);
        }
    }

    setupSMSGateway(config) {
        if (config && config.url) {
            console.log('SMS Gateway at %s', config.url);
            this.gw = io(config.url);
            this.gw
                .on('connect', () => {
                    console.log('Connected to SMS Gateway at %s', config.url);
                    this.gw.emit('auth', config.secret);
                    this.connected = true;
                })
                .on('disconnect', () => {
                    console.log('Disconnected from SMS Gateway at %s', config.url);
                    this.connected = false;
                })
                .on('auth', (success) => {
                    if (!success) {
                        console.log('Authentication with SMS Gateway failed!');
                    } else {
                        if (config.group) {
                            this.gw.emit('group', config.group);
                        }
                        setTimeout(() => {
                            if (this.queue && this.queue.queues.length) {
                                console.log('Processing %d queue(s)...', this.queue.queues.length);
                                this.queue.next();
                            }
                        }, 100);
                    }
                })
                .on('message', (hash, number, message, time) => {
                    this.getApp().log('SMS: %s: New message from %s', hash, number);
                    this.addNotification('MESG', JSON.stringify({date: time, number: number, message: message, hash: hash}));
                })
                .on('status-report', (data) => {
                    if (data.hash) {
                        this.getApp().log('SMS: %s: Delivery status for %s is %s', data.hash, data.address, data.code);
                        this.addNotification('DELV', JSON.stringify({hash: data.hash, number: data.address, code: data.code, sent: data.sent, received: data.received}));
                    }
                })
            ;
            this.createQueue();
        }
    }

    setupSMSNotifier(config) {
        if (config) {
            this.notifyCmd = this.getApp().getCmd(config, ['%CMD%', '%DATA%']);
            console.log('Text client using %s', this.notifyCmd.getId());
        }
    }

    createQueue() {
        const queues = [];
        if (fs.existsSync(this.queueFilename)) {
            const savedQueues = JSON.parse(fs.readFileSync(this.queueFilename));
            if (savedQueues.length) {
                Array.prototype.push.apply(queues, savedQueues);
                fs.writeFileSync(this.queueFilename, JSON.stringify([]));
                this.getApp().log('GWY: %s queue(s) loaded from %s...', savedQueues.length, this.queueFilename);
            }
        }
        this.queue = new Queue(queues, (data) => {
            const msg = {
                hash: data.hash,
                address: data.number,
                data: data.message
            }
            if (data.attr) {
                // resend or checking existing message
                this.gw.emit('message-retry', msg);
            } else {
                this.gw.emit('message', msg);
            }
            this.queue.next();
        }, () => {
            if (!this.connected) {
                this.getApp().log('GWY: Gateway not connected!');
            }
            return this.connected;
        });
    }

    addNotification(cmd, data) {
        const queue = {
            CMD: cmd,
            DATA: data
        }
        if (!this.notifyQueue) {
            this.notifyQueue = new Queue([queue], (q) => {
                if (this.notifyCmd) {
                    this.getApp().execCmd(this.notifyCmd, q)
                        .then(() => {
                            this.notifyQueue.next();
                        })
                    ;
                }
            });
        } else {
            this.notifyQueue.requeue([queue]);
        }
    }

    handleServer(con) {
        con.on('text-message', (data) => {
            this.getApp().log('SVR: %s: Send text to %s "%s"...', con.id, data.number, data.message);
            if (this.queue) {
                this.queue.requeue([data]);
            }
        });
    }

}

module.exports = SMSGateway;