import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { HetznerCloud, HetznerError } from '../../../hetzner/index.js';
import BaseResource from '../base-resource.js';

/**
 * @typedef HetznerSSHKeyProperties
 * @property {string} hetznerToken - Hetzner API token.
 * @property {string} sshPublicKeyPath - Absolute or relative path to the OpenSSH public key file (.pub).
 */

/**
 * @typedef HetznerSSHKeyOptions
 * @property {string} name - Name of the SSH key in Hetzner (resource identity).
 * @property {string} [parent] - Optional parent id/name in your graph.
 * @property {import('../reconcilable.js').default.Status} [status] - Initial status.
 * @property {HetznerSSHKeyProperties & import('../../typedefs.js').SharedProperties} properties - Resource properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - Dependency list.
 */

class HetznerSSHKey extends BaseResource {
  /**
   * Construct the resource.
   * @param {HetznerSSHKeyOptions} options - Initialization options for this resource.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });

    this.hz = new HetznerCloud({
      token: this.get('hetznerToken'),
    });
  }

  /**
   * Read OpenSSH public key text from properties.publicKeyPath.
   * @returns {Promise<string>} Public key line like "ssh-ed25519 AAAA... comment".
   * @private
   */
  async _readPublicKeyFromPath() {
    const p = this.get('sshPublicKeyPath');
    if (typeof p !== 'string' || p.trim().length === 0) {
      throw new Error(
        'properties.publicKeyPath is required and must be a non-empty string.'
      );
    }
    const full = resolve(p);
    const text = (await readFile(full, 'utf8')).trim();
    if (!text) throw new Error(`Public key file is empty: ${full}`);
    // Minimal validation: "type base64 [comment]"
    const parts = text.split(/\s+/);
    if (parts.length < 2 || !/^ssh-(ed25519|rsa|ecdsa)/.test(parts[0])) {
      throw new Error(`Invalid OpenSSH public key format in: ${full}`);
    }
    return text;
  }

  /**
   * Find an existing Hetzner SSH key by name (single page fetch).
   * @param {string} name - Exact key name.
   * @returns {Promise<{id:number,name:string,public_key?:string}|null>} -
   * @private
   */
  async _findRemoteByName(name) {
    const page = await this.hz.listSSHKeys({ name, per_page: 50 });
    const found =
      page?.ssh_keys?.find(
        (/** @type {{ name: string; }} */ k) => k && k.name === name
      ) || null;
    return found;
  }

  /**
   * Reconcile: ensure Hetzner has an SSH key named `this.name`
   * with the public key at `publicKeyPath`.
   * - If identical: no-op (idempotent).
   * - If exists but mismatched: delete + recreate (Hetzner cannot update key material).
   * - If missing: create.
   * @returns {Promise<void>}
   */
  async _reconcile() {
    const publicKey = await this._readPublicKeyFromPath();

    const existing = await this._findRemoteByName(this.name);
    if (existing && typeof existing.id === 'number') {
      // If API returns public_key, compare to avoid churn
      if (
        typeof existing.public_key === 'string' &&
        existing.public_key.trim() === publicKey
      ) {
        this.set('sshKeyId', existing.id);
        return;
      }
      // Key with same name but different material: delete then recreate
      try {
        await this.hz.deleteSSHKey(existing.id);
      } catch (err) {
        if (!(err instanceof HetznerError && err?.status === 404)) {
          throw err;
        }
      }
    }

    const created = await this.hz.createSSHKey({
      name: this.name,
      public_key: publicKey,
    });

    // Normalize id regardless of shape
    this.set('sshKeyId', created?.ssh_key?.id ?? created?.id);
  }

  /**
   * Destroy: remove the Hetzner SSH key named `this.name`.
   * Idempotent: ignores "already deleted".
   * @returns {Promise<void>}
   */
  async _destroy() {
    if (typeof this.get('sshKeyId') === 'number') {
      try {
        await this.hz.deleteSSHKey(this.get('sshKeyId'));
        return;
      } catch (err) {
        if (err instanceof HetznerError && err.status === 404) return;
        throw err;
      }
    }

    const existing = await this._findRemoteByName(this.name);
    if (!existing) return;

    try {
      await this.hz.deleteSSHKey(existing.id);
    } catch (err) {
      if (err instanceof HetznerError && err.status === 404) return;
      throw err;
    }
  }
}

export default HetznerSSHKey;
