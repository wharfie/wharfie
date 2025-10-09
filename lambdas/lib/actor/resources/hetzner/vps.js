'use strict';

const { HetznerCloud, HetznerError } = require('../../../hetzner');
const BaseResource = require('../base-resource');

/**
 * @typedef VPSProperties
 * @property {string} hetznerToken - Hetzner API token.
 * @property {string} serverType - Server type slug (e.g., "cpx11").
 * @property {string} image - Image slug (e.g., "ubuntu-22.04").
 * @property {string} location - Location slug (e.g., "nbg1").
 * @property {string} [sshKeyName] - Optional Hetzner SSH key name to inject at creation.
 */

/**
 * @typedef VPSOptions
 * @property {string} name - Unique server name within the project.
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {VPSProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class HetznerVPS extends BaseResource {
  /**
   * @param {VPSOptions} options - Constructor options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    const propertiesWithDefaults = Object.assign(
      {
        serverType: 'cpx11',
        image: 'ubuntu-22.04',
        location: 'nbg1',
      },
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    this.hz = new HetznerCloud({
      token: this.get('hetznerToken'),
    });
  }

  /**
   * Try to find a server by exact name.
   * @returns {Promise<any|null>} The server object or null if not found.
   * @private
   */
  async _findServerByName() {
    for await (const srv of this.hz.iterateServers({ per_page: 50 })) {
      if (srv && srv.name === this.name) return srv;
    }
    return null;
  }

  /**
   * Ensure the server exists and is running; inject SSH key on first creation if provided.
   * Idempotent:
   *  - If server already exists (by stored id or by name), do not recreate; just wait for running and refresh IP.
   *  - If missing, create (optionally with sshKeyName) and wait until running.
   * @returns {Promise<void>}
   */
  async _reconcile() {
    // 1) Resolve existing server (by cached id first, then by name)
    let serverId = this.get('hetzner_id');
    let server = null;

    if (serverId != null) {
      try {
        const res = await this.hz.getServer(serverId);
        server = res?.server ?? null;
      } catch (err) {
        if (!(err instanceof HetznerError && err.status === 404)) throw err;
        // stale id -> clear and fall through to name-based lookup
        serverId = null;
        this.set('hetzner_id', undefined);
      }
    }

    if (!server) {
      const byName = await this._findServerByName();
      if (byName) {
        server = byName;
        serverId = byName.id;
        this.set('hetzner_id', byName.id);
      }
    }

    // 2) If not found, create it (optionally with SSH key)
    if (!server) {
      /** @type {string|undefined} */
      const sshKeyName = this.get('sshKeyName');
      const payload = {
        name: this.name,
        server_type: this.get('serverType'),
        image: this.get('image'),
        location: this.get('location'),
        ...(sshKeyName ? { ssh_keys: [sshKeyName] } : {}),
      };

      const createRes = await this.hz.createServer(payload);
      const createActionId = createRes?.action?.id ?? null;
      const createdServerId = createRes?.server?.id ?? null;

      if (createActionId != null) {
        await this.hz.waitForAction(createActionId);
      }

      if (createdServerId == null) {
        throw new Error('Hetzner createServer did not return a server id');
      }

      this.set('hetzner_id', createdServerId);
      serverId = createdServerId;
    }

    // 3) Wait for running & refresh IP (idempotent)
    const running = await this.hz.waitForServerRunning(serverId, {
      // keep defaults from client: intervalMs=2000, timeoutMs=15m, requireIPv4=true
    });
    const ip = running?.public_net?.ipv4?.ip;
    if (ip) this.set('ip', ip);
  }

  /**
   * Terminate the server if it exists.
   * Idempotent: ignores "already gone".
   * @returns {Promise<void>}
   */
  async _destroy() {
    let serverId = this.get('hetzner_id');

    // If we don't have an id, attempt to find by name (idempotent safety)
    if (serverId == null) {
      const byName = await this._findServerByName();
      if (!byName) return;
      serverId = byName.id;
      this.set('hetzner_id', serverId);
    }

    try {
      await this.hz.terminateServerFast(serverId, { wait: true });
    } catch (err) {
      if (err instanceof HetznerError && err.status === 404) {
        this.set('ip', undefined);
        this.set('hetzner_id', undefined);
        // already deleted
      } else {
        throw err;
      }
    }
  }
}

module.exports = HetznerVPS;
