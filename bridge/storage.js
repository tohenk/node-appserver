/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025-2026 Toha <tohenk@yahoo.com>
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

const fs = require('fs');
const path = require('path');
const Bridge = require('.');
const UrlFetch = require('@ntlab/urllib/fetch');
const GrabHandler = require('../grabber');
const util = require('../lib/util');

/**
 * Storage backend handling such as grab file or extract zip.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Storage extends Bridge {

    FILENAME = '~file'

    onInit() {
        this.workdir = path.join(this.config.workdir, '.storage');
        this.queueFilename = path.join(this.workdir, 'queue.json');
        if (!fs.existsSync(this.workdir)) {
            fs.mkdirSync(this.workdir, {recursive: true});
        }
        this.queue = {};
        if (fs.existsSync(this.queueFilename)) {
            try {
                this.queue = JSON.parse(fs.readFileSync(this.queueFilename));
            }
            catch (err) {
                console.error(util.errmsg(err));
            }
        }
        this.handlers = {
            'stor:grab-file': async ({con, data}) => {
                const res = {success: false};
                if (data.url) {
                    this.getApp().log('STO: %s: Grab %s...', con.id, data.url);
                    Object.assign(res, this.getFile(con.info.group, data.url, data.callback));
                }
                return res;
            },
            'stor:grab-status': async ({data}) => {
                const res = {success: false};
                if (data.queue && this.queue[data.queue] !== undefined) {
                    res.success = true;
                    if (this.queue[data.queue].error) {
                        res.error = this.queue[data.queue].error;
                    } else {
                        const bytesTotal = this.queue[data.queue].size;
                        if (bytesTotal > 0) {
                            const bytesDone = this.queue[data.queue].done || 0;
                            res.progress = Math.ceil(bytesDone / bytesTotal * 100);
                        } else {
                            res.progress = 0;
                        }
                    }
                }
                return res;
            },
            'stor:grab-get': async ({data}) => {
                const res = {success: false};
                if (data.queue && this.queue[data.queue] !== undefined) {
                    try {
                        const outfile = path.join(this.workdir, data.queue, this.FILENAME);
                        if (fs.existsSync(outfile)) {
                            const buffer = fs.readFileSync(outfile);
                            const chunk = 1 * 1024 * 1024; // 1MB each
                            const size = buffer.byteLength;
                            const segment = Math.ceil(size / chunk);
                            const seq = data.seq || 1;
                            const len = Math.min(size, chunk);
                            const start = (seq - 1) * chunk;
                            const end = Math.min(start + len, size);
                            res.success = true;
                            res.seq = seq;
                            res.segment = segment;
                            res.buff = buffer.subarray(start, end);
                        }
                    }
                    catch (err) {
                        console.error(`grab-get: ${util.errmsg(err)}!`);
                    }
                }
                return res;
            },
            'stor:grab-clean': async ({data}) => {
                const res = {success: false};
                if (data.queue && this.queue[data.queue] !== undefined) {
                    try {
                        const outdir = path.join(this.workdir, data.queue);
                        fs.rmSync(outdir, {recursive: true, force: true});
                        delete this.queue[data.queue];
                        this.saveQueue();
                        res.success = true;
                    }
                    catch (err) {
                        console.error(`grab-clean: ${util.errmsg(err)}!`);
                    }
                }
                return res;
            },
            'stor:extract': async ({con, data}) => {
                const res = {success: false};
                if (data.zip && fs.existsSync(data.zip)) {
                    this.getApp().log('STO: %s: Extract %s...', con.id, data.zip);
                    const params = {};
                    if (data.count) {
                        params.count = data.count;
                    }
                    Object.assign(res, this.extractZip(con.info.group, data.zip, params, data.callback));
                }
                return res;
            },
            'stor:extract-status': async ({data}) => {
                const res = {success: false};
                if (data.queue && this.queue[data.queue] !== undefined) {
                    res.success = true;
                    if (this.queue[data.queue].error) {
                        res.error = this.queue[data.queue].error;
                    } else {
                        const filesTotal = this.queue[data.queue].total;
                        if (filesTotal > 0) {
                            const filesDone = this.queue[data.queue].done || 0;
                            res.progress = Math.ceil(filesDone / filesTotal * 100);
                        } else {
                            res.progress = 0;
                        }
                    }
                }
                return res;
            }
        }
    }

    handleServer(con) {
        for (const [event, handler] of Object.entries(this.handlers)) {
            con.on(event, async data => {
                const res = await handler({con, data});
                con.emit(event, res);
            });
        }
    }

    getFile(group, url, callback) {
        const res = {queue: util.genId()};
        this.queue[res.queue] = {op: 'move'};
        if (group) {
            this.queue[res.queue].group = group;
        }
        if (callback) {
            this.queue[res.queue].callback = callback;
        }
        const outdir = path.join(this.workdir, res.queue);
        fs.mkdirSync(outdir, {recursive: true});
        const options = {
            doOnStart: async data => this.storeQueue(res.queue, data),
            doOnData: async data => this.storeQueue(res.queue, data),
            outfile: path.join(outdir, this.FILENAME),
        }
        const puppeteer = this.getConfig('puppeteer');
        if (puppeteer) {
            options.puppeteer = puppeteer;
        }
        GrabHandler.grab(url, options)
            .then(data => this.storeResult(res.queue, data, this.getGrabResult(res.queue, data)))
            .catch(err => this.storeError(res.queue, err));
        this.saveQueue();
        return res;
    }

    extractZip(group, filename, params, callback) {
        const res = {queue: util.genId()};
        this.queue[res.queue] = {op: 'files'};
        if (group) {
            this.queue[res.queue].group = group;
        }
        if (callback) {
            this.queue[res.queue].callback = callback;
        }
        const targetdir = path.dirname(filename);
        const JSZip = require('jszip');
        fs.readFile(filename, (err, data) => {
            if (err) {
                return this.storeError(res.queue, err);
            }
            JSZip.loadAsync(data)
                .then(zip => {
                    const files = [];
                    zip.forEach((name, file) => {
                        let okay = !file.dir;
                        if (okay && params.count && files.length === params.count) {
                            okay = false;
                        } 
                        if (okay) {
                            files.push(file);
                        }
                    });
                    this.storeQueue(res.queue, {done: 0, total: files.length});
                    return files;
                })
                .then(async files => {
                    const { contentType } = require('mime-types');
                    const result = [];
                    let count = 0;
                    for await (const file of files) {
                        const filename = path.join(targetdir, file.name);
                        if (!fs.existsSync(filename)) {
                            const buffer = await file.async('nodebuffer');
                            fs.writeFileSync(filename, buffer);
                            result.push({
                                name: file.name,
                                mime: contentType(filename),
                                size: fs.statSync(filename).size
                            });
                        }
                        count++;
                        this.storeQueue(res.queue, {done: count});
                    }
                    this.storeResult(res.queue, {success: true}, result);
                    return result;
                })
                .catch(err => this.storeError(res.queue, err));
        });
        this.saveQueue();
        return res;
    }

    storeQueue(id, data) {
        if (this.queue[id] !== undefined) {
            let updated = false;
            for (const [k, v] of Object.entries(data)) {
                if (this.queue[id][k] !== v) {
                    this.queue[id][k] = v;
                    if (!updated) {
                        updated = true;
                    }
                }
            }
            if (updated) {
                this.saveQueue();
            }
            return updated;
        }
    }

    storeResult(id, data, payload) {
        if (this.queue[id] !== undefined) {
            if (data.done) {
                this.queue[id].done = data.done;
            }
            if (data.success) {
                this.saveQueue();
                if (payload) {
                    this.notify(this.queue[id].op, {
                        group: this.queue[id].group,
                        callback: this.queue[id].callback,
                    }, {queue: id, result: payload});
                }
            } else if (data.error) {
                this.storeError(id, data.error);
            }
        }
    }

    storeError(id, data) {
        if (this.queue[id] !== undefined) {
            this.queue[id].error = data instanceof Error ? data.toString() : data;
            this.saveQueue();
            console.log(`📂 ${id}: Got error ${util.errmsg(data)}!`);
        }
    }

    saveQueue() {
        try {
            fs.writeFileSync(this.queueFilename, JSON.stringify(this.queue));
        }
        catch (err) {
            console.error(`Unable to save ${this.queueFilename}: ${util.errmsg(err)}!`);
        }
    }

    /**
     * Send grabber result.
     *
     * @param {string} id Queue id
     * @param {object} data Queue data
     */
    getGrabResult(id, data) {
        if (data.name) {
            console.log(`📂 ${id}: Saved as ${data.name}...`);
        } else {
            console.log(`📂 ${id}: Completed...`);
        }
        const result = {queue: id, tempname: this.FILENAME};
        for (const prop of ['name', 'mime', 'size']) {
            if (data[prop] !== undefined) {
                result[prop] = data[prop];
            }
        }
        return result;
    }

    /**
     * Notify operation result.
     *
     * @param {string} op Operation mode
     * @param {object} cb Callback data
     * @param {object} data Payload data
     */
    notify(op, cb, data) {
        if (cb.callback) {
            let url, token;
            if (cb.callback.url) {
                url = cb.callback.url;
                if (cb.callback.token) {
                    token = cb.callback.token;
                }
            } else {
                url = cb.callback;
            }
            const params = {
                method: 'POST',
                data: Buffer.from(JSON.stringify(data)),
                dataType: 'application/json',
            }
            if (token) {
                params.headers = {
                    authorization: `Bearer ${token}`
                }
            }
            const fetcher = new UrlFetch();
            fetcher.fetch(`${url}?op=${op}`, params)
                .then(res => {
                    if (res) {
                        console.log(`🔔 ${url}: Got reply ${res}`);
                    }
                })
                .catch(err => {
                    console.log(`🔔 ${url}: Callback error ${util.errmsg(err)}`);
                });
        } else {
            this.getApp().doCmd(cb.group, 'storage', ['%DATA%'], {
                OP: op,
                DATA: JSON.stringify(data),
            });
        }
    }
}

module.exports = Storage;