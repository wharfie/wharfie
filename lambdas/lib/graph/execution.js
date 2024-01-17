const { createId } = require('../id');

/**
 * @typedef ExecutionOptions
 * @property {string} [id] -
 */

class Execution {
  /**
   * @param {ExecutionOptions} options -
   */
  constructor(options = {}) {
    this.execution_id = options.id || createId();
  }

  toString() {
    return this.execution_id;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify({ execution_id: this.execution_id });
  }

  /**
   * @param {string} serializedExecution -
   * @returns {Execution} -
   */
  static deserialize(serializedExecution) {
    const parsed = JSON.parse(serializedExecution);
    return new Execution(parsed);
  }
}

class AthenaQuery extends Execution {
  /**
   * @param {string} sql -
   * @param {ExecutionOptions} options -
   */
  constructor(sql, options) {
    super(options);
    this.sql = sql;
  }

  serialize() {
    const superClassData = JSON.parse(super.serialize());
    return JSON.stringify({ ...superClassData, sql: this.sql });
  }

  /**
   * @param {string} serializedAthenaQuery -
   * @returns {AthenaQuery} -
   */
  static deserialize(serializedAthenaQuery) {
    const parsed = JSON.parse(serializedAthenaQuery);
    return new AthenaQuery(parsed.sql, parsed);
  }
}

module.exports = {
  Execution,
  AthenaQuery,
};
