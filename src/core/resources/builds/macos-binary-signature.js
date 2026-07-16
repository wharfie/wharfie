import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promises } from 'node:fs';

import { execFileOutput, runCmd } from '../../lib/cmd.js';
import BaseResource from '../base-resource.js';
import {
  getMacOSSigningCredentials,
  setMacOSSigningCredentials,
} from './lib/macos-signing-credentials.js';

const CODE_SIGNING_IDENTITY_PATTERN =
  /^\s*\d+\)\s+([0-9a-f]{40,64})\s+"([^"]+)"\s*$/gim;

/**
 * Parse valid identities rendered by `security find-identity -v`.
 * @param {string} output - `security` command output.
 * @returns {{ hash: string, name: string }[]} - Valid identities.
 */
export function parseCodeSigningIdentities(output) {
  return Array.from(String(output).matchAll(CODE_SIGNING_IDENTITY_PATTERN)).map(
    (match) => ({ hash: match[1].toUpperCase(), name: match[2] }),
  );
}

/**
 * @typedef {('darwin'|'win'|'linux')} SeaBinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} SeaBinaryArch
 */
/**
 * @typedef MacOSBinarySignatureProperties
 * @property {string | function(): string} binaryPath - binaryPath.
 * @property {string | function(): string} [entitlements] - entitlements.
 */

/**
 * @typedef MacOSBinarySignatureOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 * @property {{ certificateBase64?: string, certificatePassword?: string, keychainPassword?: string } | (() => { certificateBase64?: string, certificatePassword?: string, keychainPassword?: string })} [credentials] - Ephemeral signing credentials or provider.
 * @property {MacOSBinarySignatureProperties & import('../../actors/typedefs.js').SharedProperties} properties - properties.
 */

class MacOSBinarySignature extends BaseResource {
  /**
   * @param {MacOSBinarySignatureOptions} options - SeaBuild Class Options
   */
  constructor({ name, parent, status, dependsOn, credentials, properties }) {
    const propertiesWithDefaults = /** @type {Record<string, any>} */ ({
      entitlements: MacOSBinarySignature.DEFAULT_ENTITLEMENTS,
      ...properties,
    });
    delete propertiesWithDefaults.macosCertBase64;
    delete propertiesWithDefaults.macosCertPassword;
    delete propertiesWithDefaults.macosKeychainPassword;
    delete propertiesWithDefaults.macosSigningCredentials;
    super({
      name,
      parent,
      status,
      dependsOn,
      properties: propertiesWithDefaults,
    });
    setMacOSSigningCredentials(this, credentials);
  }

  /**
   * @returns {Readonly<{ certificateBase64: string, certificatePassword: string, keychainPassword: string }>} - credentials.
   */
  getMacOSSigningCredentials() {
    return getMacOSSigningCredentials(this);
  }

  /**
   * Setup an isolated macOS keychain for signing.
   * @param {string} keychainPath - keychainPath.
   * @param {string} certificatePath - certificatePath.
   * @returns {Promise<void>}
   */
  async setupMacKeychain(keychainPath, certificatePath) {
    const { certificatePassword, keychainPassword } =
      this.getMacOSSigningCredentials();

    // Apple's headless `security` CLI requires these password flags. They are
    // transiently visible in the child argv, so command-error rendering must
    // redact the corresponding argument positions.
    await runCmd(
      'security',
      ['create-keychain', '-p', keychainPassword, keychainPath],
      { sensitiveArgIndexes: [2] },
    );
    await runCmd(
      'security',
      ['unlock-keychain', '-p', keychainPassword, keychainPath],
      { sensitiveArgIndexes: [2] },
    );
    await runCmd('security', [
      'set-keychain-settings',
      '-t',
      '3600',
      '-u',
      keychainPath,
    ]);
    await runCmd(
      'security',
      [
        'import',
        certificatePath,
        '-k',
        keychainPath,
        '-P',
        certificatePassword,
        '-T',
        '/usr/bin/codesign',
      ],
      { sensitiveArgIndexes: [5] },
    );
    await runCmd(
      'security',
      [
        'set-key-partition-list',
        '-S',
        'apple-tool:,apple:',
        '-s',
        '-k',
        keychainPassword,
        keychainPath,
      ],
      { sensitiveArgIndexes: [5] },
    );
  }

  /**
   * Resolve the single identity imported into the private keychain.
   * @param {string} keychainPath - keychainPath.
   * @returns {Promise<string>} - Identity hash accepted by codesign.
   */
  async resolveCodeSigningIdentity(keychainPath) {
    const { stdout } = await execFileOutput('security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
      keychainPath,
    ]);
    const identities = parseCodeSigningIdentities(stdout);
    if (identities.length === 0) {
      throw new Error(
        'No valid codesigning identity was imported into the temporary keychain.',
      );
    }
    if (identities.length > 1) {
      throw new Error(
        `Expected exactly one codesigning identity in the temporary keychain, found ${identities.length}.`,
      );
    }
    return identities[0].hash;
  }

  /**
   * Write entitlements into the private signing directory.
   * @param {string} entitlementsPath - entitlementsPath.
   * @returns {Promise<void>}
   */
  async writeEntitlements(entitlementsPath) {
    await promises.writeFile(entitlementsPath, this.get('entitlements'), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  async signBinary() {
    const credentials = this.getMacOSSigningCredentials();
    const suppliedCredentialCount = [
      credentials.certificateBase64,
      credentials.certificatePassword,
      credentials.keychainPassword,
    ].filter(Boolean).length;
    if (suppliedCredentialCount > 0 && suppliedCredentialCount < 3) {
      throw new Error(
        'macOS signing requires certificateBase64, certificatePassword, and keychainPassword together.',
      );
    }
    const hasSigningCredentials = suppliedCredentialCount === 3;
    const signingDir = await promises.mkdtemp(
      join(tmpdir(), 'wharfie-macos-signing-'),
    );

    const certificatePath = join(signingDir, 'certificate.p12');
    const entitlementsPath = join(signingDir, 'entitlements.plist');
    const keychainPath = join(signingDir, 'signing.keychain-db');

    /** @type {unknown} */
    let signingError;
    try {
      await promises.chmod(signingDir, 0o700);
      await this.writeEntitlements(entitlementsPath);

      if (!hasSigningCredentials) {
        await runCmd('codesign', [
          '--force',
          '--deep',
          '--verify',
          '--options',
          'runtime',
          '--sign',
          '-',
          '--entitlements',
          entitlementsPath,
          this.get('binaryPath'),
        ]);
      } else {
        await promises.writeFile(
          certificatePath,
          Buffer.from(credentials.certificateBase64, 'base64'),
          { mode: 0o600 },
        );
        await this.setupMacKeychain(keychainPath, certificatePath);
        const identityHash =
          await this.resolveCodeSigningIdentity(keychainPath);
        await runCmd('codesign', [
          '--force',
          '--deep',
          '--verify',
          '--options',
          'runtime',
          '--sign',
          identityHash,
          '--entitlements',
          entitlementsPath,
          '--keychain',
          keychainPath,
          this.get('binaryPath'),
        ]);
      }
    } catch (error) {
      signingError = error;
    }

    /** @type {Error[]} */
    const cleanupErrors = [];
    if (hasSigningCredentials) {
      try {
        await runCmd('security', ['delete-keychain', keychainPath]);
      } catch {
        cleanupErrors.push(
          new Error('Failed to delete the temporary macOS signing keychain.'),
        );
      }
    }

    try {
      await promises.rm(signingDir, { force: true, recursive: true });
    } catch {
      cleanupErrors.push(
        new Error('Failed to remove the private macOS signing directory.'),
      );
    }

    if (signingError && cleanupErrors.length > 0) {
      throw new AggregateError(
        [signingError, ...cleanupErrors],
        'macOS signing failed and temporary credential cleanup was incomplete.',
      );
    }
    if (signingError) throw signingError;
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        'macOS signing completed but temporary credential cleanup was incomplete.',
      );
    }
  }

  async _reconcile() {
    await this.signBinary();
  }

  async _destroy() {}
}

MacOSBinarySignature.DEFAULT_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
  <plist version="1.0">
  <dict>
    <key>com.apple.security.cs.allow-jit</key>
    <true/>
    <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
    <true/>
    <key>com.apple.security.cs.disable-executable-page-protection</key>
    <true/>
    <key>com.apple.security.cs.allow-dyld-environment-variables</key>
    <true/>
    <key>com.apple.security.cs.disable-library-validation</key>
    <true/>
  </dict>
  </plist>
`;

export default MacOSBinarySignature;
