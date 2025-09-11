const fs = require('fs');
const path = require('path');
const { createId } = require('../id');
const paths = require('../paths');

const dbFilePath = path.join(paths.data, 'database.json');

/**
 * @typedef {Object.<string, any>} DBRoot
 */

/**
 * Global work queue for serializing file operations.
 * @type {Promise<void>}
 */
let workQueue = Promise.resolve();

/**
 * Queues an asynchronous operation so that operations execute sequentially.
 * @param {() => Promise<void>} operation The operation to run next.
 * @returns {Promise<void>}
 */
function addToQueue(operation) {
  // Ensure that even if one operation rejects, the chain continues.
  workQueue = workQueue.then(operation, operation);
  return workQueue;
}

/**
 * Atomically writes the entire root store to disk.
 * @param {DBRoot} root The in-memory representation of the entire database.
 * @returns {Promise<void>}
 */
function flush(root) {
  return addToQueue(() => {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify(root);
      const tempFilePath = dbFilePath + `.${createId()}` + '.tmp';
      fs.writeFile(tempFilePath, data, 'utf8', (writeErr) => {
        if (writeErr) {
          return reject(writeErr);
        }
        // The rename should be atomic on most filesystems.
        fs.rename(tempFilePath, dbFilePath, (renameErr) => {
          if (renameErr) {
            return reject(renameErr);
          }
          resolve();
        });
      });
    });
  });
}

class LocalDB {
  /**
   * Constructs a LocalDB instance over a given sub-database.
   * @param {DBRoot} subdb The object holding key/value pairs for this sub-database.
   */
  constructor(subdb) {
    /**
     * @private
     * @type {DBRoot}
     */
    this.subdb = subdb;
  }

  /**
   * Synchronously loads the root database from disk if not already loaded.
   * @returns {DBRoot} The in-memory root database object.
   */
  static loadRoot() {
    if (LocalDB.ROOT_DB === null) {
      if (fs.existsSync(dbFilePath)) {
        try {
          const data = fs.readFileSync(dbFilePath, 'utf8');
          LocalDB.ROOT_DB = JSON.parse(data);
        } catch (err) {
          LocalDB.ROOT_DB = {};
        }
      } else {
        LocalDB.ROOT_DB = {};
      }
    }
    return LocalDB.ROOT_DB;
  }

  /**
   * Synchronously opens (or creates) a sub-database by name.
   * @param {string} dbName Name of the sub-database.
   * @returns {LocalDB} -
   */
  static open(dbName) {
    LocalDB.loadRoot();
    if (!LocalDB.ROOT_DB[dbName]) {
      LocalDB.ROOT_DB[dbName] = {};
      // Queue a flush without waiting; errors will be logged.
      flush(LocalDB.ROOT_DB).catch((err) => {
        console.error('Error flushing database:', err);
      });
    }
    return new LocalDB(LocalDB.ROOT_DB[dbName]);
  }

  /**
   * Flushes all changes to disk and "closes" the database.
   * @returns {Promise<void>}
   */
  async close() {
    return flush(LocalDB.ROOT_DB);
  }

  /**
   * Retrieves the value for a given key.
   * @param {string} key -
   * @returns {any} -
   */
  get(key) {
    return this.subdb[key];
  }

  /**
   * Puts a value in the database under the specified key.
   * @param {string} key -
   * @param {any} value -
   * @returns {Promise<void>}
   */
  async put(key, value) {
    this.subdb[key] = value;
    return flush(LocalDB.ROOT_DB);
  }

  /**
   * Updates an existing key by merging the current value with the provided updates.
   * @param {string} key -
   * @param {Object.<string, any>} updates -
   * @returns {Promise<boolean>} Returns false if the key does not exist.
   */
  async update(key, updates) {
    const current = this.subdb[key];
    if (current === undefined) {
      return false;
    }
    this.subdb[key] = { ...current, ...updates };
    await flush(LocalDB.ROOT_DB);
    return true;
  }

  /**
   * Gets an array of all key/value pairs whose keys begin with a given prefix.
   * @param {string} prefix -
   * @returns {Promise<Array<{ key: string, value: any }>>} -
   */
  async getBeginsWith(prefix) {
    const result = [];
    for (const key in this.subdb) {
      if (key.startsWith(prefix)) {
        result.push({ key, value: this.subdb[key] });
      }
    }
    return result;
  }

  /**
   * Deletes the specified key from the database.
   * @param {string} key -
   * @returns {Promise<void>}
   */
  async delete(key) {
    delete this.subdb[key];
    return flush(LocalDB.ROOT_DB);
  }
}

/**
 * The root database object.
 * @type {DBRoot}
 */
LocalDB.ROOT_DB = null;

module.exports = LocalDB;
