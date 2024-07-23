'use strict';

const Reconcilable = require('./reconcilable');
const { putWithThroughputRetry, docClient } = require('../../dynamo/');

const { isEqual } = require('es-toolkit');

/**
 * @typedef BaseResourceOptions
 * @property {string} name -
 * @property {Reconcilable.Status} [status] -
 * @property {Reconcilable[]} [dependsOn] -
 * @property {Object<string, any> & import('../typedefs').SharedProperties} properties -
 */
class BaseResource extends Reconcilable {
  /**
   * @param {BaseResourceOptions} options - BaseResource Class Options
   */
  constructor({ name, status, dependsOn = [], properties }) {
    super({ name, status, dependsOn });
    this.resourceType = this.constructor.name;
    this.properties = properties || {};
  }

  /**
   * @param {any} value -
   * @returns {any} -
   */
  _resolveProperty(value) {
    if (typeof value === 'function') {
      return value();
    } else if (Array.isArray(value)) {
      return value.map((item) => this._resolveProperty(item));
    } else if (value !== null && typeof value === 'object') {
      return Object.keys(value).reduce((acc, key) => {
        // @ts-ignore
        acc[key] = this._resolveProperty(value[key]);
        return acc;
      }, {});
    }
    return value;
  }

  /**
   * @param {string} key -
   * @param {any} [defaultReturn] -
   * @returns {any} -
   */
  get(key, defaultReturn) {
    if (!(key in this.properties) && defaultReturn) {
      return defaultReturn;
    }
    const value = this.properties[key];

    return this._resolveProperty(value);
  }

  /**
   * @param {string} key -
   * @param {any} value -
   */
  set(key, value) {
    this.properties[key] = value;
  }

  /**
   * @param {string} key -
   * @returns {boolean} -
   */
  has(key) {
    return key in this.properties;
  }

  /**
   * @param {string} key -
   * @param {any} newValue -
   * @returns {boolean} -
   */
  assert(key, newValue) {
    const oldValue = this.get(key);
    const resolvedNewValue = this._resolveProperty(newValue);
    return isEqual(oldValue, resolvedNewValue);
  }

  /**
   * @param {any} other -
   * @returns {boolean} -
   */
  checkPropertyEquality(other) {
    Object.keys(this.properties).forEach((key) => {
      if (!this.assert(key, other[key])) {
        return false;
      }
    });
    return true;
  }

  /**
   * @returns {Object<string,any>} -
   */
  resolveProperties() {
    /** @type {Object<string,any>} */
    const resolvedProperties = {};

    for (const key in this.properties) {
      resolvedProperties[key] = this.get(key);
    }

    return resolvedProperties;
  }

  /**
   * @returns {any} -
   */
  serialize() {
    return {
      name: this.name,
      status: this.status,
      dependsOn: this.dependsOn.map((dep) => dep.name),
      properties: this.resolveProperties(),
      resourceType: this.resourceType,
    };
  }

  async _pre_reconcile() {
    if (this.get('_INTERNAL_STATE_RESOURCE')) {
      return;
    }
    await this.save();
  }

  async _post_reconcile() {
    await this.save();
  }

  async _pre_destroy() {
    await this.save();
  }

  async _post_destroy() {
    if (this.get('_INTERNAL_STATE_RESOURCE')) {
      return;
    }
    await this.save();
  }

  async save() {
    if (!this.has('deployment') || !this.get('deployment')) return;
    const { stateTable, version } = this.get('deployment');

    let sort_key = this.name;
    if (this.has('project')) {
      sort_key = this.get('project').name;
    } else if (this.has('deployment')) {
      sort_key = this.get('deployment').name;
    }

    await putWithThroughputRetry({
      TableName: stateTable,
      Item: {
        name: this.name,
        sort_key,
        status: this.status,
        version,
      },
      ReturnValues: 'NONE',
    });
  }

  async delete() {
    if (!this.has('deployment') || !this.get('deployment')) return;
    const { stateTable } = this.get('deployment');

    let sort_key = this.name;
    if (this.has('project')) {
      sort_key = this.get('project').name;
    } else if (this.has('deployment')) {
      sort_key = this.get('deployment').name;
    }

    await docClient.delete({
      TableName: stateTable,
      Key: {
        name: this.name,
        sort_key,
      },
    });
  }

  async cache() {}
}

module.exports = BaseResource;
