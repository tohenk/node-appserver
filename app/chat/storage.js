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
 * Chat contact number.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatContact {

    /** @type {string} */
    name = null
    /** @type {string} */
    owner = null

    /**
     * Constructor.
     *
     * @param {string} name Contact name
     * @param {string} owner Contact owner
     * @param {ChatStorageBackend} storage Storage backend
     */
    constructor(name, owner, storage) {
        this.name = name;
        this.owner = owner;
        this.storage = storage;
    }

    /**
     * Add or save the entire numbers to file.
     *
     * @param {string} number The phone number
     * @returns {ChatContact}
     */
    add(number) {
        this.storage.store(this.owner, number);
        return this;
    }

    /**
     * Is phone number exist?
     *
     * @param {string} number The phone number
     * @returns {boolean}
     */
    exist(number) {
        const numbers = this.storage.read(this.owner, number);
        return numbers.indexOf(number) >= 0;
    }
}

/**
 * Chat data storage.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatStorage {

    name = null
    storages = {}

    /**
     * Constructor.
     *
     * @param {string} name Storage name
     * @param {string} datadir Storage path
     */
    constructor(name, datadir) {
        this.name = name;
        this.datadir = datadir;
    }

    /**
     * Get chat contact storage.
     *
     * @param {string} name Contact storage name
     * @param {string} owner Contact owner
     * @returns {ChatContact}
     */
    get(name, owner = null) {
        if (this.storages[name] === undefined) {
            let storage;
            const ver = process.versions.node.split('.').map(Number);
            // node:sqlite is available since v22.5
            if ((ver[0] === 22 && ver[1] >= 5) || ver[0] > 22) {
                storage = new ChatStorageSQLite(this, name);
            } else {
                storage = new ChatStorageLocal(this, name);
            }
            this.storages[name] = new ChatContact(name, owner, storage);
        }
        return this.storages[name];
    }
}

/**
 * Chat data storage backend.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatStorageBackend {

    /**
     * Constructor.
     *
     * @param {ChatStorage} storage Storage
     * @param {string} name Storage name
     */
    constructor(storage, name) {
        this.storage = storage;
        this.name = name;
        this.initialize();
    }

    initialize() {
    }

    /**
     * Store contact number.
     *
     * @param {string} owner Contact owner
     * @param {string} number Contact number
     */
    store(owner, number) {
        return this.onStore(owner, number);
    }

    /**
     * Read contact number.
     *
     * @param {string} owner Contact owner
     * @param {string} number Contact number
     * @returns {string[]}
     */
    read(owner, number) {
        return this.onRead(owner, number);
    }
}

/**
 * Chat local data storage.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatStorageLocal extends ChatStorageBackend {

    initialize() {
        this.id = 'local';
        this.filename = path.join(this.storage.datadir, `${this.name}.json`);
        this.onStore = (owner, number) => {
            if (number) {
                this.load();
                if (owner) {
                    if (this.numbers[owner] === undefined) {
                        this.numbers[owner] = [];
                    }
                    if (this.numbers[owner].indexOf(number) < 0) {
                        this.numbers[owner].push(number);
                    }
                } else {
                    if (this.numbers.indexOf(number) < 0) {
                        this.numbers.push(number);
                    }
                }
            }
            if (this.numbers) {
                fs.writeFileSync(this.filename, JSON.stringify(this.numbers));
            }
        }
        this.onRead = (owner, number) => {
            this.load();
            if (owner) {
                return this.numbers[owner] || [];
            }
            return this.numbers;
        }
    }

    /**
     * Load numbers from file.
     *
     * @param {boolean} force True to force load
     * @returns {ChatStorageBackend}
     */
    load(force = null) {
        if (this.numbers === undefined || force) {
            if (fs.existsSync(this.filename)) {
                this.numbers = JSON.parse(fs.readFileSync(this.filename));
            } else {
                this.numbers = [];
            }
        }
        return this;
    }
}

/**
 * Chat SQLite data storage.
 *
 * @author Toha <tohenk@yahoo.com>
 */
class ChatStorageSQLite extends ChatStorageBackend {

    initialize() {
        this.id = 'sqlite';
        this.name = this.name.replaceAll('-', '_');
        this.filename = path.join(this.storage.datadir, `${this.storage.name}.sqlite`);
        this.db = this.createDatabase();
        this.createTable();
        this.onStore = (owner, number) => {
            if (owner) {
                if (!this.queryOwnedNumber().get(owner, number)) {
                    const stmt = this.db.prepare(`INSERT INTO ${this.name} (orig, nr) VALUES (?, ?)`);
                    stmt.run(owner, number);
                }
            } else {
                if (!this.queryNumber().get(number)) {
                    const stmt = this.db.prepare(`INSERT INTO ${this.name} (nr) VALUES (?)`);
                    stmt.run(number);
                }
            }
        }
        this.onRead = (owner, number) => {
            if (owner) {
                return this.queryOwnedNumber().all(owner, number).map(row => row.nr);
            }
            return this.queryNumber().all(number).map(row => row.nr);
        }
    }

    /**
     * Create SQLite database.
     *
     * @returns {DatabaseSync}
     */
    createDatabase() {
        if (this.storage.db === undefined) {
            const { DatabaseSync } = require('node:sqlite');
            this.storage.db = new DatabaseSync(this.filename);
        }
        return this.storage.db;
    }

    createTable() {
        const stmt = this.db.prepare(`SELECT * FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%';`);
        const tables = stmt.all().map(row => row.tbl_name);
        if (!tables.includes(this.name)) {
            this.db.exec(`
BEGIN;
CREATE TABLE ${this.name} (
id INTEGER PRIMARY KEY AUTOINCREMENT,
nr VARCHAR(50),
orig VARCHAR(50),
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
updated_at TIMESTAMP
);
CREATE INDEX ${this.name}_nr ON ${this.name}(nr);
CREATE INDEX ${this.name}_orig ON ${this.name}(orig);
CREATE TRIGGER ${this.name}_updated_at AFTER UPDATE ON ${this.name}
BEGIN
UPDATE ${this.name} SET updated_at = datetime() WHERE id = NEW.id;
END;
COMMIT;
`);
        }
    }

    queryNumber() {
        return this.db.prepare(`SELECT * FROM ${this.name} WHERE nr = ?`);
    }

    queryOwnedNumber() {
        return this.db.prepare(`SELECT * FROM ${this.name} WHERE orig = ? AND nr = ?`);
    }
}

module.exports = {
    ChatStorage,
    ChatContact
}