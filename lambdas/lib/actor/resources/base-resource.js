'use strict';

const Reconcilable = require('./reconcilable');
const {
  putResource,
  getResource,
  getResources,
  getResourceStatus,
  deleteResource,
  putResourceStatus,
} = require('../../db/state/aws');
const Secret = require('../lib/secret');

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
    } else if (Secret.isSecret(value)) {
      return value.getSecretValue();
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
   * @param {any} properties -
   */
  setProperties(properties) {
    if (this.checkPropertyEquality(properties)) return;
    this.properties = properties;
    Object.entries(properties).forEach(([key, value]) => {
      this.set(key, value);
    });
  }

  /**
   * @param {string} key -
   * @param {any} value -
   */
  set(key, value) {
    if (this.get(key) === this._resolveProperty(value)) {
      return;
    }
    this.properties[key] = value;
    if (this.status !== Reconcilable.Status.DRIFTED) {
      this.setStatus(Reconcilable.Status.DRIFTED);
    }
  }

  /**
   * sets a property without marking the resource as drifted, should only be used internally by the reconcile method
   * @param {string} key -
   * @param {any} value -
   */
  _setUNSAFE(key, value) {
    if (this.get(key) === this._resolveProperty(value)) {
      return;
    }
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
  checkPropertyEquality(other = {}) {
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
    await this.saveStatus();
  }

  async _post_reconcile() {
    await this.save();
  }

  async _pre_destroy() {
    await this.saveStatus();
  }

  async _post_destroy() {
    if (this.get('_INTERNAL_STATE_RESOURCE')) {
      return;
    }
    await this.delete();
  }

  async save() {
    await BaseResource.stateDB.putResource(this);
  }

  /**
   * @returns {Promise<Reconcilable.StatusEnum?>} -
   */
  async getStatus() {
    return await BaseResource.stateDB.getResourceStatus(this);
  }

  async saveStatus() {
    await BaseResource.stateDB.putResourceStatus(this);
  }

  /**
   * @returns {Promise<import('../typedefs').SerializedBaseResource?>} -
   */
  async fetchStoredData() {
    return await BaseResource.stateDB.getResource(this);
  }

  /**
   * @param {import('../typedefs').SerializedBaseResource} [storedResource] -
   * @returns {Promise<boolean>} -
   */
  async needsUpdate(storedResource) {
    const _storedResource = storedResource || (await this.fetchStoredData());
    return !this.checkPropertyEquality(_storedResource?.properties);
  }

  async delete() {
    await BaseResource.stateDB.deleteResource(this);
  }
}
/**
 * @typedef StateStore
 * @property {function(BaseResource): Promise<void>} putResource -
 * @property {function(BaseResource): Promise<void>} putResourceStatus -
 * @property {function(BaseResource): Promise<import("../typedefs").SerializedBaseResource?>} getResource -
 * @property {function(BaseResource): Promise<Reconcilable.StatusEnum?>} getResourceStatus -
 * @property {function(string, string): Promise<import("../typedefs").SerializedBaseResource[]>} getResources -
 * @property {function(BaseResource): Promise<void>} deleteResource -
 */

/**
 * @type {StateStore}
 */
BaseResource.stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResources,
  getResourceStatus,
  deleteResource,
};

module.exports = BaseResource;
