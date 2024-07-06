'use strict';

const Reconcilable = require('./reconcilable');
const { putWithThroughputRetry } = require('../../dynamo/');

/**
 * @typedef BaseResourceOptions
 * @property {string} name -
 * @property {Reconcilable.Status} [status] -
 * @property {Reconcilable[]} [dependsOn] -
 * @property {Object<string, any> & import('../typedefs').SharedDeploymentProperties} properties -
 */
class BaseResource extends Reconcilable {
  /**
   * @param {BaseResourceOptions} options - BaseResource Class Options
   */
  constructor({ name, status, dependsOn = [], properties }) {
    super({ name, status, dependsOn });
    // if (!properties.deployment && this.constructor.name !== 'WharfieDeployment')
    //   throw new Error('deployment property required for base resource');
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

    await putWithThroughputRetry({
      TableName: stateTable,
      Item: {
        name: this.name,
        sort_key: this.properties.deployment
          ? this.properties.deployment.name
          : this.name,
        status: this.status,
        version,
      },
      ReturnValues: 'NONE',
    });
  }

  async cache() {}
}

module.exports = BaseResource;
