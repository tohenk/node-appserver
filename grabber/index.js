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

/**
 * Url grabber handler.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Grabber {

    grabbers = []

    constructor() {
        this.initialize();
    }

    /**
     * Do initialize.
     */
    initialize() {
        const entries = fs.readdirSync(__dirname, {withFileTypes: true});
        for (const entry of entries) {
            if (entry.name.endsWith('.js')) {
                const grabber = entry.name.substr(0, entry.name.length - 3);
                if (grabber !== 'index') {
                    const GrabberClass = require(path.join(__dirname, grabber));
                    const GrabberInstance = new GrabberClass();
                    this.grabbers.push(GrabberInstance);
                }
            }
        }
    }

    /**
     * Grab file from URL.
     *
     * @param {string} url URL to grab
     * @param {object} options The options
     * @returns {Promise<any>}
     */
    grab(url, options) {
        const grabbers = this.grabbers
            .filter(g => g.canHandle(url))
            .sort((a, b) => a.getPriority() - b.getPriority());
        if (!grabbers.length) {
            return Promise.reject(`No grabber can handle ${url}!`);
        }
        return grabbers[0].grab(url, options);
    }
}

module.exports = new Grabber();