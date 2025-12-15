import Node from '../node.js';
import HetznerSSHKey from './ssh-key.js';
import HetznerVPS from './vps.js';

/**
 * Properties for {@link HetznerNode}.
 * These are supplied via the `properties` field of {@link HetznerNodeOptions}.
 * @typedef {Object} HetznerNodeProperties
 * @property {string} hetznerToken - Hetzner Cloud API token used to authenticate with the Hetzner API.
 * @property {string} binaryLocalPath - Absolute path to the local binary that should be uploaded to the VPS.
 * @property {string} sshPublicKeyPath - Absolute path to the SSH pub key used to connect to the node.
 * @property {string} sshPrivateKeyPath - Absolute path to the SSH private key used to connect to the node.
 * @property {string} serverType -
 * @property {string} image -
 * @property {string} location -
 */

/**
 * Constructor options for {@link HetznerNode}.
 * @typedef {Object} HetznerNodeOptions
 * @property {string} name - Logical name of the Hetzner-backed node resource.
 * @property {string} [parent] - Optional parent resource identifier in the resource graph.
 * @property {import('../reconcilable.js').default.Status} [status] - Optional initial reconciliation status for the node.
 * @property {HetznerNodeProperties & import('../node.js').NodeProperties & import('../../typedefs.js').SharedProperties} properties - Properties controlling Hetzner provisioning and service deployment.
 * @property {Array<import('../reconcilable.js').default>} [dependsOn] - Optional list of resources that must be reconciled before this node.
 * @property {Record<string, import('../base-resource.js').default | import('../base-resource-group.js').default>} [resources] - Optional child resources (not required for {@link HetznerNode}).
 */

/**
 * Node implementation for Hetzner
 */
class HetznerNode extends Node {
  /**
   * @param {HetznerNodeOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn, resources }) {
    const propertiesWithDefaults = Object.assign(
      {},
      HetznerNode.DefaultProperties,
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
      resources,
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('../base-resource.js').default | import('../base-resource-group.js').default)[]} -
   */
  _defineGroupResources(parent) {
    const hetzner_key = new HetznerSSHKey({
      name: `${this.name}-ssh-key`,
      properties: {
        hetznerToken: this.get('hetznerToken'),
        sshPublicKeyPath: this.get('sshPublicKeyPath'),
      },
    });
    const vps = new HetznerVPS({
      name: `${this.name}-vps`,
      dependsOn: [hetzner_key],
      properties: {
        hetznerToken: this.get('hetznerToken'),
        serverType: this.get('serverType'),
        image: this.get('image'),
        location: this.get('location'),
        sshKeyName: hetzner_key.name,
      },
    });
    return [hetzner_key, vps];
  }
}
HetznerNode.DefaultProperties = {
  serverType: 'cpx11',
  image: 'ubuntu-22.04',
  location: 'nbg1',
  ...Node.DefaultProperties,
};

export default HetznerNode;
