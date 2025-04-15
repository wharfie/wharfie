const lmdb = require('lmdb');
const path = require('node:path');
const paths = require('../paths');

const dbPath = path.join(paths.data, 'database');

class LocalDB {
  /**
   * @param {import('lmdb').Database} [db] -
   */
  constructor(db) {
    if (!LocalDB.ROOT_DB) {
      LocalDB.ROOT_DB = lmdb.open({
        path: dbPath,
      });
    }
    if (db) {
      this.db = db;
    } else {
      this.db = LocalDB.ROOT_DB;
    }
  }

  /**
   * @param {string} dbName -
   * @param {import('lmdb').DatabaseOptions} options -
   * @returns {LocalDB} -
   */
  static open(dbName, options = {}) {
    if (!LocalDB.ROOT_DB) {
      LocalDB.ROOT_DB = lmdb.open({
        path: dbPath,
      });
    }
    return new LocalDB(LocalDB.ROOT_DB.openDB(dbName, options));
  }

  /**
   * @returns {Promise<void>} -
   */
  async close() {
    await this.db.close();
  }

  /**
   * @param {string} key -
   * @returns {any} -
   */
  get(key) {
    return this.db.get(key);
  }

  /**
   * @param {string} key -
   * @param {any} value -
   * @returns {Promise<void>} -
   */
  async put(key, value) {
    const success = await this.db.put(key, value);
    if (!success) {
      throw new Error('failed to put value');
    }
  }

  /**
   * @param {string} key -
   * @param {any} updates -
   * @returns {Promise<void>} -
   */
  async update(key, updates) {
    await this.db.transaction(() => {
      let current = this.db.get(key);
      if (!current) return false;
      current = {
        ...current,
        ...updates,
      };
      this.db.put(key, current);
      return true;
    });
  }

  /**
   * @typedef KeyValuePair
   * @property {import('lmdb').Key} key -
   * @property {any} value -
   * @property {number} [version] -
   */

  /**
   * @param {string} prefix -
   * @returns {Promise<KeyValuePair[]>} -
   */
  async getBeginsWith(prefix) {
    return await this.db
      .getRange()
      .filter(({ key }) => key.toString().startsWith(prefix)).asArray;
  }

  /**
   * @param {string} key -
   * @returns {Promise<void>} -
   */
  async delete(key) {
    await this.db.remove(key);
    // await this.db.flushed
  }
}

/** @type {import('lmdb').RootDatabase | undefined} */
LocalDB.ROOT_DB = undefined;

module.exports = LocalDB;
