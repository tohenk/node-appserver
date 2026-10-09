/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2014-2026 Toha <tohenk@yahoo.com>
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
const { ChatConsumer } = require('.');

/**
 * A message consumer through SMS.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class SMSGateway extends ChatConsumer {

    /** @type {io.Socket} */
    io = null

    /**
     * Constructor.
     *
     * @param {object} config Configuration
     */
    initialize(config) {
        this.id = 'sms';
        if (config.url) {
            console.log('SMS Gateway at %s', config.url);
            this.io = this.parent.createSocketClient(config);
            this.io
                .on('connect', () => {
                    console.log('Connected to SMS Gateway at %s', config.url);
                    this.io.emit('auth', config.secret);
                    this.connected = true;
                })
                .on('disconnect', () => {
                    console.log('Disconnected from SMS Gateway at %s', config.url);
                    this.connected = false;
                    this.showStats();
                })
                .on('auth', success => {
                    if (!success) {
                        console.log('Authentication with SMS Gateway failed!');
                    } else {
                        if (config.group) {
                            this.io.emit('group', config.group);
                        }
                        this.parent.onState();
                    }
                })
                .on('message', (hash, number, message, time) => {
                    this.parent.getApp().log('SMS: %s: New message from %s', hash, number);
                    this.parent.onMessage({date: time, number, message, hash});
                    this.incrementStat(SMSGateway.STAT_MSG_RECV);
                })
                .on('status-report', data => {
                    if (data.hash) {
                        this.parent.getApp().log('SMS: %s: Delivery status for %s is %s', data.hash, data.address, data.code);
                        this.parent.onReport({hash: data.hash, number: data.address, code: data.code, sent: data.sent, received: data.received});
                        this.incrementStat(SMSGateway.STAT_MSG_REPORT);
                    }
                })
            ;
        }
    }

    close() {
        if (this.connected) {
            this.io.disconnect();
        }
    }

    /**
     * Consume message.
     *
     * @param {import('../bridge/chat').ChatMessage} msg Message
     * @param {object} flags Mesage flags
     * @returns {Promise<boolean>}
     */
    canConsume(msg, flags) {
        return new Promise((resolve, reject) => {
            if (flags && flags.sender) {
                msg.data = `${flags.sender}: ${msg.data}`;
            }
            if (flags && flags.retry) {
                this.io.emit('message-retry', msg);
                this.incrementStat(SMSGateway.STAT_MSG_RETRY);
            } else {
                this.io.emit('message', msg);
                this.incrementStat(SMSGateway.STAT_MSG_SENT);
            }
            resolve(true);
        });
    }

    /**
     * Increment stat counter.
     *
     * @param {number} id Stat id
     * @returns {SMSGateway}
     */
    incrementStat(id) {
        if (this.stats === undefined) {
            this.stats = {};
        }
        if (this.stats[id] === undefined) {
            this.stats[id] = 0;
        }
        this.stats[id]++;
        return this;
    }

    /**
     * Show stat summary.
     *
     * @param {boolean} reset Do reset
     * @returns {SMSGateway}
     */
    showStats(reset = true) {
        if (this.stats !== undefined) {
            const count = Object.values(this.stats).reduce((a, b) => a += b, 0);
            if (count) {
                const labels = [
                    [SMSGateway.STAT_MSG_SENT, 'Total message sent'],
                    [SMSGateway.STAT_MSG_RETRY, 'Total message retried'],
                    [SMSGateway.STAT_MSG_RECV, 'Total message received'],
                    [SMSGateway.STAT_MSG_REPORT, 'Total message report'],
                ];
                console.log(`Summary of ${this.constructor.name}`);
                for (const [id, label] of labels) {
                    if (this.stats[id] !== undefined) {
                        console.log(`${label}: ${this.stats[id]}`);
                    }
                }
            }
            if (reset) {
                delete this.stats;
            }
        }
        return this;
    }

    static get STAT_MSG_SENT() { return 1 }
    static get STAT_MSG_RETRY() { return 2 }
    static get STAT_MSG_RECV() { return 3 }
    static get STAT_MSG_REPORT() { return 4 }
}

module.exports = SMSGateway;