'use strict';

const Reconcilable = require('./reconcilable');
const { putWithThroughputRetry, docClient } = require('../../dynamo/');
// const { query } = require('../../dynamo/');

const { isEqual } = require('es-toolkit');
const jdf = require('jsondiffpatch');

/**
 * @typedef BaseResourceOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {Reconcilable.Status} [status] -
 * @property {Reconcilable[]} [dependsOn] -
 * @property {Object<string, any> & import('../typedefs').SharedProperties} properties -
 */
class BaseResource extends Reconcilable {
  /**
   * @param {BaseResourceOptions} options - BaseResource Class Options
   */
  constructor({ name, parent = '', status, dependsOn = [], properties }) {
    super({ name, status, dependsOn });
    this.parent = parent;
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
    const allKeys = new Set([
      ...Object.keys(other),
      ...Object.keys(this.properties),
    ]);
    for (const key of allKeys) {
      if (!this.assert(key, other[key])) {
        return false;
      }
    }
    return true;
  }

  /**
   * @typedef PropertyDiff
   * @property {any} old -
   * @property {any} new -
   * @property {jdf.Delta | undefined} delta -
   */

  /**
   * @param {string} key -
   * @param {any} otherValue -
   * @returns {PropertyDiff} -
   */
  diffProperty(key, otherValue) {
    const currentPropertyValue = this.get(key);
    const resolvedOtherProperty = this._resolveProperty(otherValue);
    return {
      old: currentPropertyValue,
      new: resolvedOtherProperty,
      delta: jdf.diff(currentPropertyValue, resolvedOtherProperty),
    };
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
   * @returns {import('../typedefs').SerializedBaseResource} -
   */
  serialize() {
    return {
      name: this.name,
      parent: this.parent,
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
    await this.delete();
  }

  async save() {
    if (!this.has('deployment') || !this.get('deployment'))
      throw new Error('cannot save resource without deployment');
    const { stateTable, version, name } = this.get('deployment');

    const resource_key = this.parent
      ? `${this.parent}#${this.name}`
      : this.name;
    await putWithThroughputRetry({
      TableName: stateTable,
      Item: {
        deployment: name,
        resource_key,
        status: this.status,
        serialized: this.serialize(),
        version,
      },
      ReturnValues: 'NONE',
    });
  }

  // async load() {
  //   if (!this.has('deployment') || !this.get('deployment'))
  //     throw new Error('cannot load resource without deployment');
  //   const { stateTable } = this.get('deployment');

  //   const sort_key = this.parent ? `${this.parent}#${this.name}` : this.name;

  //   const { Items } = await query({
  //     TableName: stateTable,
  //     ConsistentRead: true,
  //     KeyConditionExpression: '#name = :name AND begins_with(sort_key, :sort_key)',
  //     ExpressionAttributeValues: {
  //       ':name': this.name,
  //       ':sort_key': sort_key,
  //     },
  //     ExpressionAttributeNames: {
  //       '#name': 'name',
  //       '#sort_key': 'sort_key',
  //     },
  //   });
  //   if (!Items || Items.length === 0) throw new Error('No resource found');
  //   const storedData = Items[0];

  //   return deserialize(storedData?.serialized, {});
  // }

  async delete() {
    if (!this.has('deployment') || !this.get('deployment'))
      throw new Error('cannot delete resource without deployment');
    const { stateTable, name } = this.get('deployment');

    const resource_key = this.parent
      ? `${this.parent}#${this.name}`
      : this.name;

    await docClient.delete({
      TableName: stateTable,
      Key: {
        deployment: name,
        resource_key,
      },
    });
  }

  async cache() {}
}

module.exports = BaseResource;
