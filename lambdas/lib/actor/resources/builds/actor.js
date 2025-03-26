// const Queue = require('./resources/aws/queue');
// const Role = require('./resources/aws/role');
// const LambdaFunction = require('./resources/aws/lambda-function');
// const EventSourceMapping = require('./resources/aws/event-source-mapping');
// const LambdaBuild = require('./resources/aws/lambda-build');
const NodeBinary = require('./node-binary');
const SeaBuild = require('./sea-build');
const MacOSBinarySignature = require('./macos-binary-signature');
const BaseResourceGroup = require('../base-resource-group');
const { execFile } = require('../../../../lib/cmd');
// const ActionDefinitionRecord = require('./resources/records/action-type-definition-record');

/**
 * @typedef ExtendedWharfieActorProperties
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef WharfieActorProperties
 * @property {string} handler -
 * @property {string} nodeVersion -
 * @property {string} platform -
 * @property {string} architecture -
 */

/**
 * @typedef WharfieActorOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {WharfieActorProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('../base-resource') | import('../base-resource-group')>} [resources] -
 */

class Actor extends BaseResourceGroup {
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
   * @returns {(import('../base-resource') | import('../base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    const node_binary = new NodeBinary({
      name: `${this.name}-node-binary`,
      parent,
      properties: {
        version: this.get('nodeVersion'),
        platform: this.get('platform'),
        architecture: this.get('architecture'),
      },
    });
    const build = new SeaBuild({
      name: `${this.name}-build`,
      parent,
      dependsOn: [node_binary],
      properties: {
        handler: this.get('handler'),
        nodeBinaryPath: () => node_binary.get('binaryPath'),
        nodeVersion: this.get('nodeVersion'),
        platform: this.get('platform'),
        architecture: this.get('architecture'),
      },
    });
    /** @type {(import('../base-resource') | import('../base-resource-group'))[]} */
    const resources = [node_binary, build];
    if (this.get('platform') === 'darwin') {
      const macosBinarySignature = new MacOSBinarySignature({
        name: `${this.name}-macos-binary-signature`,
        parent,
        dependsOn: [build],
        properties: {
          binaryPath: () => build.get('binaryPath'),
          macosCertBase64: this.get('macosCertBase64'),
          macosCertPassword: this.get('macosCertPassword'),
          macosKeychainPassword: this.get('macosKeychainPassword'),
        },
      });
      resources.push(macosBinarySignature);
    }
    return resources;
  }

  getBinaryPath() {
    return this.getResource(`${this.name}-build`).get('binaryPath');
  }

  async run() {
    if (!this.isStable()) throw new Error('Actor is not stable');
    console.log(this.getBinaryPath());
    await execFile(this.getBinaryPath(), [], {});
  }
}

module.exports = Actor;
