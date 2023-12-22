'use strict';
const { createId } = require('../id');
/**
 * @typedef OpOptions
 * @property {string} [id] -
 * @property {string} type -
 * @property {string} status -
 * @property {import('./execution').Execution[]} executions -
 */

class Op {
  /**
   * @param {OpOptions} options -
   */
  constructor(options) {
    this.id = options.id || createId();
    this.type = options.type;
    this.status = options.status || 'WAITING';
    this.executions = options.executions || [];
  }

  /**
   * @returns {string} -
   */
  toString() {
    return this.id;
  }

  /**
   * @returns {string} -
   */
  serialize() {
    return JSON.stringify(this);
  }

  /**
   * @param {string} serializedOp -
   * @returns {Op} -
   */
  static deserialize(serializedOp) {
    const parsed = JSON.parse(serializedOp);
    return new Op(parsed);
  }
}

module.exports = Op;
