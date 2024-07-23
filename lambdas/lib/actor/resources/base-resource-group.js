'use strict';

const BaseResource = require('./base-resource');

/**
 * @typedef BaseResourceGroupOptions
 * @property {string} name -
 * @property {import('./reconcilable').Status} [status] -
 * @property {import('./reconcilable')[]} [dependsOn] -
 * @property {Object<string, any> & import('../typedefs').SharedProperties} properties -
 * @property {Object<string, BaseResource | BaseResourceGroup>} [resources] -
 */
class BaseResourceGroup extends BaseResource {
  /**
   * @param {BaseResourceGroupOptions} options - BaseResourceGroup Class Options
   */
  constructor({ name, status, dependsOn = [], properties, resources }) {
    super({ name, status, dependsOn, properties });
    this.resources = resources;

    if (!this.resources) {
      this.resources = {};
      this.addResources(this._defineGroupResources());
    }
  }

  /**
   * @returns {(BaseResource | BaseResourceGroup)[]} -
   */
  _defineGroupResources() {
    return [];
  }

  /**
   * @param {BaseResource | BaseResourceGroup} resource -
   */
  addResource(resource) {
    if (this.resources[resource.name]) {
      throw new Error(`Resource with name ${resource.name} already exists`);
    }
    this.resources[resource.name] = resource;
  }

  /**
   * @param {(BaseResource | BaseResourceGroup)[]} resources -
   */
  addResources(resources) {
    resources.forEach((resource) => {
      this.addResource(resource);
    });
  }

  /**
   * @param {string} name -
   * @returns {BaseResource | BaseResourceGroup} -
   */
  getResource(name) {
    if (!this.resources[name]) {
      throw new Error(`Resource with name ${name} doesn't exist`);
    }
    return this.resources[name];
  }

  /**
   * @returns {(BaseResource | BaseResourceGroup)[]} -
   */
  getResources() {
    return Object.values(this.resources);
  }

  /**
   * @param {string} name -
   * @returns {boolean} -
   */
  hasResource(name) {
    return !!this.resources[name];
  }

  asEvent() {
    return {
      name: this.name,
      constructor: this.constructor.name,
      status: this.status,
      resources: Object.keys(this.resources || {}),
    };
  }

  /**
   * @returns {any} -
   */
  serialize() {
    /** @type {Object<string, any>} */
    const serializedResources = {};

    Object.values(this.resources).forEach((resource) => {
      serializedResources[resource.name] = resource.serialize();
    });

    return {
      name: this.name,
      status: this.status,
      dependsOn: this.dependsOn.map((dep) => dep.name),
      properties: this.resolveProperties(),
      resourceType: this.resourceType,
      resources: serializedResources,
    };
  }

  async delete() {
    await Promise.all(this.getResources().map((resource) => resource.delete()));
    await super.delete();
  }

  async _destroy() {
    await Promise.all(
      this.getResources().map((resource) => resource.destroy())
    );
  }

  async _reconcile() {
    await Promise.all(
      this.getResources().map((resource) => resource.reconcile())
    );
  }
}

module.exports = BaseResourceGroup;
