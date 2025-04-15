const path = require('node:path');
const paths = require('../paths');
const { DatabaseSync } = require('node:sqlite');

const dbPath = path.join(paths.data, 'database.sqlite');

class LocalDB {
  /**
   * @param {DatabaseSync} [db] - Optionally provide a database instance.
   */
  constructor(db) {
    if (!LocalDB.ROOT_DB) {
      throw new Error('LocalDB not initialized. Call LocalDB.init() first.');
    }
    // Use the provided database instance or the root one.
    this.db = db || LocalDB.ROOT_DB;
    // Namespace prefix for keys (empty string for the root).
    this.namespace = '';
  }

  /**
   * Initializes the root SQLite database.
   * Creates the "store" table if it does not exist.
   * @returns {LocalDB} A LocalDB instance wrapping the root database.
   */
  static init() {
    if (!LocalDB.ROOT_DB) {
      // Open or create the SQLite database file.
      LocalDB.ROOT_DB = new DatabaseSync(dbPath, {
        // Options: open defaults to true, enableForeignKeyConstraints defaults to true.
        enableForeignKeyConstraints: true,
      });
      // Create the key/value store table if it doesn't exist.
      LocalDB.ROOT_DB.exec(`
        CREATE TABLE IF NOT EXISTS store (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
    }
    return new LocalDB(LocalDB.ROOT_DB);
  }

  /**
   * Opens a namespaced "sub‑database" by prefixing keys with dbName.
   * @param {string} dbName - The namespace to use.
   * @param {object} [options] - Ignored in this implementation.
   * @returns {LocalDB} A new instance with the specified namespace.
   */
  static open(dbName, options = {}) {
    const instance = new LocalDB(LocalDB.ROOT_DB);
    instance.namespace = dbName + ':';
    return instance;
  }

  /**
   * Closes the database connection.
   * If this is the root instance, the connection is closed and the static reference is reset.
   */
  close() {
    this.db.close();
    if (this.db === LocalDB.ROOT_DB) {
      LocalDB.ROOT_DB = undefined;
    }
  }

  /**
   * Retrieves a value by key.
   * @param {string} key - The key to retrieve.
   * @returns {any} The stored value, or undefined if not found.
   */
  get(key) {
    const stmt = this.db.prepare('SELECT value FROM store WHERE key = ?');
    const row = stmt.get(this.namespace + key);
    return row ? JSON.parse(row.value) : undefined;
  }

  /**
   * Inserts or replaces a value.
   * @param {string} key - The key to store.
   * @param {any} value - The value to store; it will be stringified.
   * @throws {Error} If no rows were modified.
   */
  put(key, value) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO store (key, value) VALUES (?, ?)'
    );
    const result = stmt.run(this.namespace + key, JSON.stringify(value));
    if (!result || result.changes === 0) {
      throw new Error('failed to put value');
    }
  }

  /**
   * Updates an existing record by merging new updates with the current record.
   * If no record exists for the key, nothing is done.
   * @param {string} key - The key to update.
   * @param {any} updates - An object containing properties to merge into the stored value.
   */
  update(key, updates) {
    const current = this.get(key);
    if (!current) return;
    const merged = { ...current, ...updates };
    this.put(key, merged);
  }

  /**
   * Retrieves all key/value pairs whose keys begin with a given prefix.
   * @param {string} prefix - The prefix to match.
   * @returns {Array<{ key: string, value: any }>} An array of key/value pairs.
   */
  getBeginsWith(prefix) {
    const stmt = this.db.prepare(
      'SELECT key, value FROM store WHERE key LIKE ?'
    );
    const rows = stmt.all(this.namespace + prefix + '%');
    return rows.map((row) => ({
      key: row.key,
      value: JSON.parse(row.value),
    }));
  }

  /**
   * Deletes a value by key.
   * @param {string} key - The key to delete.
   */
  delete(key) {
    const stmt = this.db.prepare('DELETE FROM store WHERE key = ?');
    stmt.run(this.namespace + key);
  }
}

/** @type {DatabaseSync | undefined} */
LocalDB.ROOT_DB = undefined;

module.exports = LocalDB;
