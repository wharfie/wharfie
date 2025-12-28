import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import SSHKeygen from '../../../ssh-keygen.js';
import BaseResource from '../base-resource.js';

/**
 * @typedef SSHKeyProperties
 * @property {string} [keyPrefix] - Absolute/relative path prefix for the keypair. Defaults to "~/.ssh/<name>".
 * @property {string} [comment] - Public key comment; defaults to "<name>@local".
 * @property {boolean} [overwrite=false] - Overwrite existing key files if true; otherwise idempotent no-op.
 * @property {string} [passphrase=''] - Private key passphrase; empty string = unencrypted key.
 * @property {number} [rounds=64] - KDF rounds for private key encryption (ssh-keygen -a).
 */

/**
 * @typedef SSHKeyOptions
 * @property {string} name - Logical name for this SSH key resource (used for default path/comment).
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {SSHKeyProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 */

class SSHKey extends BaseResource {
  /**
   * @param {SSHKeyOptions} options - Constructor options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    const propertiesWithDefaults = Object.assign(
      {
        overwrite: false,
        passphrase: '',
        rounds: 64,
      },
      properties,
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    const outPrefix = this._outPrefix();
    this.set('path', outPrefix);
  }

  /**
   * Compute the filesystem prefix for the SSH keypair.
   * @returns {string} Absolute path prefix (without ".pub").
   * @private
   */
  _outPrefix() {
    /** @type {string|undefined} */
    const keyPrefix = this.get('keyPrefix');
    if (
      keyPrefix &&
      typeof keyPrefix === 'string' &&
      keyPrefix.trim().length > 0
    ) {
      return resolve(keyPrefix);
    }
    const home = homedir();
    return join(home, '.ssh', this.name);
  }

  /**
   * Idempotent reconcile:
   * - If keys already exist and overwrite=false → no-op.
   * - If missing or overwrite=true → (re)generate with provided options.
   * - Stores publicKey + path on the resource for downstream consumers.
   * @returns {Promise<void>}
   */
  async _reconcile() {
    const outPrefix = this.get('path');
    const overwrite = Boolean(this.get('overwrite'));
    const passphrase =
      typeof this.get('passphrase') === 'string' ? this.get('passphrase') : '';
    const roundsCandidate = Number(this.get('rounds'));
    const rounds =
      Number.isInteger(roundsCandidate) && roundsCandidate > 0
        ? roundsCandidate
        : 64;
    const comment =
      (this.get('comment') && String(this.get('comment'))) ||
      `${this.name}@local`;

    if (!(await SSHKeygen.isAvailable())) {
      throw new Error('ssh-keygen not found on PATH. Install OpenSSH client.');
    }

    const privExists = await SSHKeygen.exists(outPrefix);
    const pubExists = await SSHKeygen.exists(`${outPrefix}.pub`);

    if (!overwrite && privExists && pubExists) {
      // No-op: idempotent reconcile
      return;
    } else {
      await SSHKeygen.generate(outPrefix, comment, {
        overwrite,
        passphrase,
        rounds,
      });
    }

    // Cache useful info for other resources
    const publicKey = await SSHKeygen.readPublicKey(outPrefix);
    this.set('publicKey', publicKey);
  }

  /**
   * Idempotent destroy:
   * - Best-effort removal (missing files are ignored).
   * - Safe to call repeatedly.
   * @returns {Promise<void>}
   */
  async _destroy() {
    const outPrefix = this._outPrefix();
    await SSHKeygen.remove(outPrefix);
    this.set('publicKey', undefined);
    this.set('path', undefined);
  }
}

export default SSHKey;
