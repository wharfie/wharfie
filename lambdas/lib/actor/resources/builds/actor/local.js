const BaseResourceGroup = require('../../base-resource-group');

/**
 * @typedef {('local'|'aws')} InfrastructurePlatform
 */

/**
 * @typedef WharfieActorSystemProperties
 * @property {InfrastructurePlatform | function(): InfrastructurePlatform} infrastructure -
 */

/**
 * @typedef WharfieActorSystemOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../../reconcilable').Status} [status] -
 * @property {WharfieActorSystemProperties & import('../../../typedefs').SharedProperties} properties -
 * @property {import('../../reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('../../base-resource') | import('../../base-resource-group')>} [resources] -
 */

class LocalActorInfra extends BaseResourceGroup {
  /**
   * @param {import('../function')} actor -
   * @param {WharfieActorSystemOptions} options -
   */
  constructor(
    actor,
    { name, parent, status, properties, resources, dependsOn }
  ) {
    super({
      name,
      parent,
      status,
      properties,
      resources,
      dependsOn,
    });
    this.actor = actor;
  }

  /**
   * @param {string} parent -
   * @returns {(import('../../base-resource') | import('../../base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    let ActorInfraConstructor;
    switch (this.get('infrastructure')) {
      case 'local':
        ActorInfraConstructor = require('./infra/local');
        break;
      case 'aws':
        ActorInfraConstructor = require('./infra/aws');
        break;
      default:
        return [];
    }
    return this.actors.map(
      (actor) => new ActorInfraConstructor(actor, { parent })
    );
  }
}

module.exports = ActorSystem;
