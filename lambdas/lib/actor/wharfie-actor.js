const WharfieActorResources = require('./resources/wharfie-actor-resources');
const BaseResourceGroup = require('./resources/base-resource-group');

/**
 * @typedef ExtendedWharfieActorProperties
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef ExtendedWharfieActorOptions
 * @property {string} parent -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {ExtendedWharfieActorProperties & import('./typedefs').SharedProperties} properties -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

/**
 * @typedef WharfieActorProperties
 * @property {string} handler -
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef WharfieActorOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {WharfieActorProperties & import('./typedefs').SharedProperties} properties -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

class WharfieActor extends BaseResourceGroup {
  /**
   * @param {WharfieActorOptions} options -
   */
  constructor({ name, parent, status, properties, resources, dependsOn }) {
    if (!properties.handler) throw new Error('No handler defined');
    super({
      name,
      parent,
      status,
      properties,
      resources,
      dependsOn,
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('./resources/base-resource') | import('./resources/base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    const actorResources = new WharfieActorResources({
      name: `${this.name}-actor-resources`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        handler: this.get('handler'),
        actorName: this.name,
        actorPolicyArns: () => this.get('actorPolicyArns'),
        artifactBucket: () => this.get('artifactBucket'),
        environmentVariables: () => this.get('environmentVariables'),
      },
    });
    return [actorResources];
  }

  /**
   * @returns {WharfieActorResources} -
   */
  getActorResources() {
    // @ts-ignore
    return this.getResource(`${this.name}-actor-resources`);
  }

  getQueue() {
    return this.getActorResources().getResource(
      `${this.get('deployment').name}-${this.name}-queue`
    );
  }

  getRole() {
    return this.getActorResources().getResource(
      `${this.get('deployment').name}-${this.name}-role`
    );
  }
}

module.exports = WharfieActor;
