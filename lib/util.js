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

/**
 * Utility library.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class Util {

    /**
     * Make milliseconds from number or array of number.
     *
     * @param {number} sec Second
     * @returns {number}
     */
    static ms(sec) {
        if (Array.isArray(sec)) {
            sec = sec.map(a => this.ms(a));
        }
        if (typeof sec === 'number') {
            sec *= 1000;
        }
        return sec;
    }

    /**
     * Get error message.
     *
     * @param {Error|string} err Error object or message
     * @param {bool} verbose Get verbose error from stack
     * @returns {string}
     */
    static errmsg(err, verbose = true) {
        if (err instanceof Error) {
            if (verbose && err.stack) {
                err = err.stack;
            } else {
                err = err.toString();
            }
        }
        return err;
    }

    /**
     * Generate unique id.
     *
     * @returns {string}
     */
    static genId() {
        return require('crypto')
            .createHash('sha1')
            .update((new Date().getTime() + Math.random()).toString())
            .digest('hex')
            .substring(0, 8);
    }
}

module.exports = Util;