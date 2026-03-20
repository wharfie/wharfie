import BaseResource from './base-resource.js';
import Reconcilable from './reconcilable.js';
import { withResourceScope } from './resource-scope.js';

/**
 * @typedef BaseResourceGroupOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {Reconcilable.Status} [status] - status.
 * @property {Reconcilable[]} [dependsOn] - dependsOn.
 * @property {Object<string, any> & import('../typedefs.js').SharedProperties} properties - properties.
 * @property {Object<string, BaseResource | BaseResourceGroup>} [resources] - resources.
 * @property {any} [stateDB] - Scoped state store.
 * @property {import('node:events').EventEmitter} [emitter] - Scoped telemetry emitter.
 */
class BaseResourceGroup extends BaseResource {
  /**
   * @param {BaseResourceGroupOptions} options - BaseResourceGroup Class Options
   */
  constructor({
    name,
    parent,
    status,
    dependsOn = [],
    properties,
    resources,
    stateDB,
    emitter,
  }) {
    super({
      name,
      parent,
      status,
      dependsOn,
      properties,
      stateDB,
      emitter,
    });
    this.resources = resources;

    if (!this.resources) {
      this.resources = {};
      this.addResources(
        withResourceScope(
          {
            stateDB: this.getStateDB(),
            emitter: this.getEmitter(),
          },
          () => this._defineGroupResources(this.getName()),
        ),
      );
    } else {
      Object.values(this.resources).forEach((resource) => {
        this._inheritResourceScope(resource);
      });
    }
  }

  /**
   * @param {string} parent - parent.
   * @returns {(BaseResource | BaseResourceGroup)[]} - Result.
   */
  _defineGroupResources(parent) {
    return [];
  }

  /**
   * @param {BaseResource | BaseResourceGroup} resource - resource.
   * @returns {void} - Result.
   */
  _inheritResourceScope(resource) {
    if (typeof resource.setStateDB === 'function') {
      resource.setStateDB(this.getStateDB());
    }

    const previousEmitter =
      typeof resource.getEmitter === 'function' ? resource.getEmitter() : null;
    if (typeof resource.setEmitter === 'function') {
      resource.setEmitter(this.getEmitter());
    }

    if (
      previousEmitter &&
      previousEmitter !== this.getEmitter() &&
      typeof resource.dispatchStatusEvent === 'function'
    ) {
      resource.dispatchStatusEvent();
    }
  }

  /**
   * @param {any} stateDB - stateDB.
   * @returns {this} - Result.
   */
  setStateDB(stateDB) {
    super.setStateDB(stateDB);
    this.getResources().forEach((resource) => {
      if (typeof resource.setStateDB === 'function') {
        resource.setStateDB(this.getStateDB());
      }
    });
    return this;
  }

  /**
   * @param {import('node:events').EventEmitter | undefined} emitter - emitter.
   * @returns {this} - Result.
   */
  setEmitter(emitter) {
    const previousEmitter = this.getEmitter();
    super.setEmitter(emitter);
    this.getResources().forEach((resource) => {
      const childPreviousEmitter =
        typeof resource.getEmitter === 'function'
          ? resource.getEmitter()
          : null;
      if (typeof resource.setEmitter === 'function') {
        resource.setEmitter(this.getEmitter());
      }
      if (
        childPreviousEmitter &&
        childPreviousEmitter !== this.getEmitter() &&
        typeof resource.dispatchStatusEvent === 'function'
      ) {
        resource.dispatchStatusEvent();
      }
    });
    if (previousEmitter !== this.getEmitter()) {
      this.dispatchStatusEvent();
    }
    return this;
  }

  /**
   * @param {BaseResource | BaseResourceGroup} resource - resource.
   */
  addResource(resource) {
    if (this.resources[resource.name]) {
      throw new Error(`Resource with name ${resource.name} already exists`);
    }
    this._inheritResourceScope(resource);
    this.resources[resource.name] = resource;
  }

  /**
   * @param {(BaseResource | BaseResourceGroup)[]} resources - resources.
   */
  addResources(resources) {
    resources.forEach((resource) => {
      this.addResource(resource);
    });
  }

  /**
   * @param {string} name - name.
   * @returns {BaseResource | BaseResourceGroup} - Result.
   */
  getResource(name) {
    if (!this.resources[name]) {
      throw new Error(`Resource with name ${name} doesn't exist`);
    }
    return this.resources[name];
  }

  /**
   * @returns {(BaseResource | BaseResourceGroup)[]} - Result.
   */
  getResources() {
    return Object.values(this.resources || {});
  }

  /**
   * @param {string} name - name.
   * @returns {boolean} - Result.
   */
  hasResource(name) {
    return !!this.resources[name];
  }

  /**
   * @typedef BaseResourceGroupEvent
   * @property {string} name - name.
   * @property {string} constructor - constructor.
   * @property {Reconcilable.Status} status - status.
   * @property {string[]} resources - resources.
   * @returns {BaseResourceGroupEvent} - Result.
   */
  asEvent() {
    return {
      name: this.name,
      constructor: this.constructor.name,
      status: this.status,
      resources: Object.keys(this.resources || {}),
    };
  }

  /**
   * @returns {import('../typedefs.js').SerializedBaseResourceGroup} - Result.
   */
  serialize() {
    return {
      name: this.name,
      parent: this.parent,
      status: this.status,
      dependsOn: this.dependsOn.map((dep) => dep.name),
      properties: this.resolveProperties(),
      resourceType: this.resourceType,
      resources: Object.entries(this.resources).reduce(
        (/** @type {string[]} */ acc, [name, resource]) => {
          if (resource.status === Reconcilable.Status.DESTROYED) return acc;
          acc.push(name);
          return acc;
        },
        [],
      ),
    };
  }

  async _destroy() {
    await Promise.all(
      this.getResources().map((resource) => resource.destroy()),
    );
  }

  async _reconcile() {
    await Promise.all(
      this.getResources().map((resource) => resource.reconcile()),
    );
  }
}

export default BaseResourceGroup;
