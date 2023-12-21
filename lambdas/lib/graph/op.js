'use strict';
class Op {
  /**
   * @param {string} id -
   * @param {any} data -
   */
  constructor(id, data) {
    this.id = id;
    this.data = data;
  }

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
    return new Op(parsed.id, parsed.data);
  }
}

module.exports = Op;
