'use strict';

const { HetznerCloud, HetznerError } = require('../../../hetzner/');
const BaseResource = require('../base-resource');

/**
 * Minimal systemd service spec for first-boot install via cloud-init.
 * Mirrors the exec fields your Hetzner client already understands.
 * @typedef {Object} VPSServiceSpec
 * @property {string} [url] - HTTPS URL to download the executable (preferred for large artifacts).
 * @property {string} [inline_b64] - Base64-encoded executable/script (keep << 32 KiB).
 * @property {string} [remote_path='/usr/local/bin/app'] - Absolute path for the binary on the VM.
 * @property {string[]} [args=[]] - CLI args.
 * @property {Record<string,string>} [env={}] - Environment variables.
 * @property {string} [user='root'] - System user to own/execute.
 * @property {string} [group] - Optional group; defaults to user.
 * @property {string} [service_name='app'] - systemd unit name (=> app.service).
 * @property {'simple'|'exec'|'notify'} [type='simple'] - systemd Service Type.
 * @property {'always'|'on-failure'|'no'} [restart='always'] - systemd Restart policy.
 * @property {number} [restart_sec=3] - Seconds before restart.
 * @property {boolean} [wantsNetworkOnline=true] - Depend on network-online.target.
 * @property {string} [stdout_log='/var/log/app.stdout.log'] - stdout log file.
 * @property {string} [stderr_log='/var/log/app.stderr.log'] - stderr log file.
 */

/**
 * @typedef VPSProperties
 * @property {string} hetznerToken - Hetzner API token.
 * @property {string} serverType - Server type slug (e.g., "cpx11").
 * @property {string} image - Image slug (e.g., "ubuntu-22.04").
 * @property {string} location - Location slug (e.g., "nbg1").
 * @property {string} [sshKeyName] - Optional Hetzner SSH key **name** to inject at creation.
 * @property {string} [cloudInit] - Optional raw cloud-init YAML string to pass as user_data.
 * @property {VPSServiceSpec} [service] - Optional structured spec for a systemd-managed executable.
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
   * Build user_data from either properties.cloudInit (raw YAML)
   * or properties.service (structured systemd spec). If both are provided,
   * they are merged (raw first, then service section appended).
   * @returns {string|undefined} -
   * @private
   */
  _composeUserData() {
    /** @type {string|undefined} */
    const raw = this.get('cloudInit');
    /** @type {VPSServiceSpec|undefined} */
    const svc = this.get('service');

    if (!raw && !svc) return undefined;

    // If only raw YAML → pass-through
    if (raw && !svc) return String(raw);

    // If only service spec → generate cloud-config for systemd
    if (!raw && svc) {
      // leverage the client’s generator; returns "#cloud-config" YAML
      // (yes, it's a "private" helper; we control both sides)
      // @ts-ignore
      return this.hz._buildCloudInitForSystemd(svc);
    }

    // Both provided → merge (raw first, then systemd section)
    // @ts-ignore
    const svcYaml = this.hz._buildCloudInitForSystemd(svc);
    // @ts-ignore
    return this.hz._mergeUserData(String(raw), svcYaml);
  }

  /**
   * Ensure the server exists and is running; inject SSH key on first creation if provided.
   * If cloud-init/systemd is supplied, it is applied **only on first creation** (cannot be updated later).
   * Idempotent lifecycle.
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

    // 2) If not found, create it (optionally with SSH key + cloud-init)
    if (!server) {
      /** @type {string|undefined} */
      const sshKeyName = this.get('sshKeyName');
      const user_data = this._composeUserData();

      /** @type {import('../../../hetzner/typedefs').CreateServerPayload} */
      const payload = {
        name: this.name,
        server_type: this.get('serverType'),
        image: this.get('image'),
        location: this.get('location'),
        ...(sshKeyName ? { ssh_keys: [sshKeyName] } : {}),
        ...(user_data ? { user_data } : {}),
        // make public-net intent explicit (safer for future templates)
        public_net: { enable_ipv4: true, enable_ipv6: true },
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
    } else {
      // If server already exists but caller provided new cloud-init/service,
      // we **do not** re-provision (user_data is immutable post-create).
      // You could log/emit a warning here if you have a logger.
    }

    // 3) Wait for running & refresh IP (idempotent)
    const running = await this.hz.waitForServerRunning(serverId, {
      // defaults: intervalMs=2000, timeoutMs=15m, requireIPv4=true
    });
    const ip = running?.public_net?.ipv4?.ip;
    if (ip) this.set('ip', ip);
  }

  /**
   * Terminate the server if it exists.
   * Idempotent: ignores "already gone". Clears cached state.
   * @returns {Promise<void>}
   */
  async _destroy() {
    let serverId = this.get('hetzner_id');

    if (serverId == null) {
      const byName = await this._findServerByName();
      if (!byName) {
        this.set('ip', undefined);
        this.set('hetzner_id', undefined);
        return;
      }
      serverId = byName.id;
      this.set('hetzner_id', serverId);
    }

    try {
      await this.hz.terminateServerFast(serverId, { wait: true });
    } catch (err) {
      if (!(err instanceof HetznerError && err.status === 404)) throw err;
    } finally {
      this.set('ip', undefined);
      this.set('hetzner_id', undefined);
    }
  }
}

module.exports = HetznerVPS;
