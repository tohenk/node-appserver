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

const UrlDownloader = require('@ntlab/urllib/download');

/**
 * Handle file download from URL.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class UrlGrabber {

    canHandle(url) {
        return true;
    }

    getPriority() {
        return 50;
    }

    async grab(url, options) {
        return new UrlFileGrabber(url, options)
            .start();
    }
}

/**
 * Grab file from URL.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class UrlFileGrabber {

    constructor(url, options) {
        this.url = url;
        this.options = options || {};
    }

    async start() {
        this.state = {};
        const downloader = new UrlDownloader();
        const res = await downloader.fetch(this.url, {
            onstart: async data => await this.options.doOnStart(this.asMeta(data)),
            ondata: async data => await this.options.doOnData(this.asMeta(data)),
            ...this.options
        });
        return this.asResult(res);
    }

    asMeta(data) {
        const res = {};
        if (data.code) {
            res.code = data.code;
            if (data.status) {
                res.status = data.status;
            }
        }
        if (data.headers) {
            Object.assign(res, this.extractFileInfo(data.headers));
        }
        if (data.stream) {
            res.done = data.stream.bytesWritten;
        }
        Object.assign(this.state, res);
        return res;
    }

    asResult(data) {
        const res = {success: this.state.code >= 200 && this.state.code < 400};
        if (data.stream) {
            res.done = data.stream.bytesWritten;
        }
        if (!res.success) {
            res.error = `${this.state.code} ${this.state.status}`;
        }
        return res;
    }

    extractFileInfo(headers) {
        const info = {};
        if (headers['content-disposition']) {
            const filename = UrlDownloader.getFilenameOrUrl(headers['content-disposition']);
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
}

module.exports = UrlGrabber;