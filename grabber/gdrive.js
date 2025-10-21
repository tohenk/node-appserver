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
const mime = require('mime-types');
const path = require('path');
const puppeteer = require('puppeteer');

/**
 * Download file from Google Drive.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class GDriveGrabber {

    GDRIVE_URL = 'https://drive.google.com/file/d/'
    GDRIVE_DOWNLOAD = 'https://drive.usercontent.google.com/download?'

    canHandle(url) {
        return url.startsWith(this.GDRIVE_URL);
    }

    getPriority() {
        return 10;
    }

    async grab(url, options) {
        this.state = {};
        const loopdelay = options.loopdelay || 100;
        const opdelay = options.opdelay || 500;
        const downloadPath = path.dirname(options.outfile);
        let browser, err, done = false, started = false;
        try {
            browser = await puppeteer.launch({
                headless: true,
                defaultViewport: {
                    width: 1024,
                    height: 768
                },
                ...(options.puppeteer || {})
            });
            const cdp = await browser.target().createCDPSession();
            await cdp.send('Browser.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath,
                eventsEnabled: true,
            });
            cdp
                .on('Browser.downloadWillBegin', e => {
                    started = true;
                    if (typeof options.doOnStart === 'function') {
                        options.doOnStart(this.asMeta(e));
                    }
                })
                .on('Browser.downloadProgress', e => {
                    if (typeof options.doOnData === 'function') {
                        options.doOnData(this.asMeta(e));
                    }
                    if (['completed', 'cancelled'].includes(e.state)) {
                        done = true;
                    }
                });
            const pages = await browser.pages();
            const page = pages.length ? pages[0] : await browser.newPage();
            await page.goto(url, {waitUntil: 'load'});
            const title = await page.title();
            if (title && title.includes('Sign-in')) {
                throw new Error('To download the URL, you need to be signed in Google Drive!');
            }
            await page.click('[aria-label="Download"]');
            await page.waitForNetworkIdle();
            await new Promise((resolve, reject) => {
                /** @type {puppeteer.Target} */
                let dtarget;
                const f = async () => {
                    if (done) {
                        resolve();
                    } else {
                        if (!started) {
                            if (dtarget === undefined) {
                                dtarget = browser.targets().find(target => target.url().startsWith(this.GDRIVE_DOWNLOAD));
                            }
                            if (dtarget) {
                                const dpage = await dtarget.page();
                                const clicker = await dpage.waitForSelector('#uc-download-link');
                                if (clicker) {
                                    await clicker.click();
                                    await dpage.waitForTimeout(opdelay);
                                }
                            }
                        }
                        setTimeout(f, loopdelay);
                    }
                }
                f();
            });
            if (started) {
                const filename = path.join(downloadPath, this.state.name);
                if (fs.existsSync(filename)) {
                    fs.renameSync(filename, options.outfile);
                }
            }
        }
        catch (e) {
            err = e;
        }
        if (browser) {
            await browser.close();
        }
        if (err) {
            throw err;
        }
        return {success: fs.existsSync(options.outfile), ...this.state};
    }

    asMeta(data) {
        const res = {};
        if (data.suggestedFilename && this.state.name === undefined) {
            this.state.name = data.suggestedFilename;
        }
        if (this.state.name) {
            if (!this.state.mime) {
                this.state.mime = mime.lookup(this.state.name);
            }
            res.name = this.state.name;
            res.mime = this.state.mime;
        }
        if (data.receivedBytes) {
            res.done = data.receivedBytes;
        }
        if (data.totalBytes) {
            res.size = data.totalBytes;
        }
        Object.assign(this.state, res);
        return res;
    }
}

module.exports = GDriveGrabber;