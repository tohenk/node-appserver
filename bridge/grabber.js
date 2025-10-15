/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2025 Toha <tohenk@yahoo.com>
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
const UrlDownload = require('@ntlab/urllib/download');

/**
 * Fetch file from url.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class UrlGrabber extends Bridge {

    FILENAME = '~file'

    onInit() {
        this.workdir = path.join(this.config.workdir, '.grabber');
        this.statusFilename = path.join(this.workdir, 'status.json');
        if (!fs.existsSync(this.workdir)) {
            fs.mkdirSync(this.workdir, {recursive: true});
        }
        this.statuses = {};
        if (fs.existsSync(this.statusFilename)) {
            try {
                this.statuses = JSON.parse(fs.readFileSync(this.statusFilename));
            }
            catch (err) {
                console.error(err);
            }
        }
    }

    handleServer(con) {
        con
            .on('grab-file', data => {
                const res = {success: false};
                if (data.url) {
                    this.getApp().log('GRB: %s: Grab %s...', con.id, data.url);
                    Object.assign(res, this.getFile(con.info.group, data.url, data.callback));
                }
                con.emit('grab-file', res);
            })
            .on('grab-status', data => {
                const res = {success: false};
                if (data.queue && this.statuses[data.queue] !== undefined) {
                    res.success = true;
                    if (this.statuses[data.queue].error) {
                        res.error = this.statuses[data.queue].error;
                    } else {
                        const bytesTotal = this.statuses[data.queue].size;
                        if (bytesTotal > 0) {
                            const bytesDone = this.statuses[data.queue].done || 0;
                            res.progress = Math.ceil(bytesDone / bytesTotal * 100);
                        }
                    }
                }
                con.emit('grab-status', res);
            })
            .on('grab-get', async data => {
                const res = {success: false};
                if (data.queue && this.statuses[data.queue] !== undefined) {
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
                        console.error(`grab-get: ${err}!`);
                    }
                }
                con.emit('grab-get', res);
            })
            .on('grab-clean', data => {
                const res = {success: false};
                if (data.queue && this.statuses[data.queue] !== undefined) {
                    try {
                        const outdir = path.join(this.workdir, data.queue);
                        fs.rmSync(outdir, {recursive: true, force: true});
                        delete this.statuses[data.queue];
                        this.saveStatuses();
                        res.success = true;
                    }
                    catch (err) {
                        console.error(`grab-clean: ${err}!`);
                    }
                }
                con.emit('grab-clean', res);
            });
    }

    getFile(group, url, callback) {
        const res = {queue: this.genId()};
        this.statuses[res.queue] = {};
        if (group) {
            this.statuses[res.queue].group = group;
        }
        if (callback) {
            this.statuses[res.queue].callback = callback;
        }
        const outdir = path.join(this.workdir, res.queue);
        fs.mkdirSync(outdir, {recursive: true});
        const downloader = new UrlDownload();
        downloader.fetch(url,
            {
                outfile: path.join(outdir, this.FILENAME),
                onstart: async data => this.storeStatus(res.queue, data),
                ondata: async data => this.storeStatus(res.queue, data)
            })
            .then(data => this.storeResult(res.queue, data))
            .catch(err => this.storeError(res.queue, err));
        this.saveStatuses();
        return res;
    }

    storeStatus(id, data) {
        if (this.statuses[id] !== undefined) {
            let updated = false;
            if (data.code) {
                if (this.statuses[id].code !== data.code) {
                    this.statuses[id].code = data.code;
                    if (data.status) {
                        this.statuses[id].status = data.status;
                    }
                    if (!updated) {
                        updated = true;
                    }
                }
            }
            if (data.headers) {
                const info = this.extractFileInfo(data.headers);
                for (const [k, v] of Object.entries(info)) {
                    if (this.statuses[id][k] !== v) {
                        this.statuses[id][k] = v;
                        if (!updated) {
                            updated = true;
                        }
                    }
                }
            }
            if (data.stream) {
                this.statuses[id].done = data.stream.bytesWritten;
                if (!updated) {
                    updated = true;
                }
            }
            if (updated) {
                this.saveStatuses();
            }
        }
    }

    storeResult(id, data) {
        if (this.statuses[id] !== undefined) {
            if (data.stream) {
                this.statuses[id].done = data.stream.bytesWritten;
                if (this.statuses[id].code >= 200 && this.statuses[id].code < 400) {
                    this.saveStatuses();
                    this.sendResult(id, this.statuses[id]);
                } else {
                    this.storeError(id, `${this.statuses[id].code} ${this.statuses[id].status}`);
                }
            }
        }
    }

    storeError(id, data) {
        if (this.statuses[id] !== undefined) {
            this.statuses[id].error = data instanceof Error ? data.toString() : data;
            this.saveStatuses();
            console.log(`📂 ${id}: Got error ${this.statuses[id].error}!`);
        }
    }

    saveStatuses() {
        try {
            fs.writeFileSync(this.statusFilename, JSON.stringify(this.statuses));
        }
        catch (err) {
            console.error(`Unable to save ${this.statusFilename}: ${err}!`);
        }
    }

    extractFileInfo(headers) {
        const info = {};
        if (headers['content-disposition']) {
            const filename = UrlFetch.getFilenameOrUrl(headers['content-disposition']);
            if (filename) {
                info.name = filename;
            }
        }
        if (headers['content-type']) {
            info.mime = headers['content-type'];
            if (info.mime.includes(';')) {
                info.mime = info.mime.substr(0, info.mime.indexOf(';')).trim();
            }
        }
        if (headers['content-length']) {
            info.size = parseInt(headers['content-length']);
        }
        return info;
    }

    /**
     * Send grabber result.
     *
     * @param {string} id Queue id
     * @param {object} data Queue data
     */
    sendResult(id, data) {
        if (data.name) {
            console.log(`📂 ${id}: Saved as ${data.name}...`);
        } else {
            console.log(`📂 ${id}: Completed...`);
        }
        const payload = {queue: id};
        for (const prop of ['name', 'mime', 'size']) {
            if (data[prop] !== undefined) {
                payload[prop] = data[prop];
            }
        }
        if (data.callback) {
            let url, token;
            if (data.callback.url) {
                url = data.callback.url;
                if (data.callback.token) {
                    token = data.callback.token;
                }
            } else {
                url = data.callback;
            }
            const params = {
                method: 'POST',
                data: Buffer.from(JSON.stringify(payload)),
                dataType: 'application/json',
            }
            if (token) {
                params.headers = {
                    authorization: `Bearer ${token}`
                }
            }
            const callback = new UrlFetch();
            callback.fetch(url, params)
                .then(res => {
                    if (res) {
                        console.log(`🔔 ${url}: Got reply ${res}`);
                    }
                })
                .catch(err => {
                    console.log(`🔔 ${url}: Callback error ${err}`);
                });
        } else {
            this.getApp().doCmd(data.group, 'grabber', ['%DATA%'], {DATA: JSON.stringify(payload)});
        }
    }

    genId() {
        return require('crypto')
            .createHash('sha1')
            .update((new Date().getTime() + Math.random()).toString())
            .digest('hex')
            .substring(0, 8);
    }
}

module.exports = UrlGrabber;