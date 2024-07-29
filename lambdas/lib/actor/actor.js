const BaseResourceGroup = require('./resources/base-resource-group');

/**
 * @typedef ActorOptions
 * @property {string} name -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {import("./actor-deployment")} deployment -
 * @property {Actor} [parentActor] -
 * @property {any} [properties] -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

class Actor extends BaseResourceGroup {
  /**
   * @param {ActorOptions} options -
   */
  constructor({
    name,
    status,
    parentActor,
    deployment,
    properties,
    dependsOn = [],
    resources,
  }) {
    super({ name, status, dependsOn, properties, resources });
    this.deployment = deployment;
    this.parentActor = parentActor;
  }

  /**
   * @typedef {new (options: ActorOptions) => Actor} ActorConstructor
   */
  /**
   * @param {string} name -
   * @param {ActorConstructor} ActorClass -
   * @returns {import("./actor")} -
   */
  createSubActor(name, ActorClass) {
    const fullName = `${this.name}#${name}`;
    return this.deployment.createActor(fullName, ActorClass, {
      parentActor: this,
    });
  }

  /**
   * @param {any} message -
   */
  async send(message) {}

  /**
   * @param {any} message -
   */
  async receive(message) {
    console.log(`${this.name} received a message:`, message);
  }
}

module.exports = Actor;
