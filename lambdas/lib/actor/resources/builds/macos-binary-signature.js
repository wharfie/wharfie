// const bluebirdPromise = require('bluebird');

// eslint-disable-next-line node/no-extraneous-require
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const paths = require('../../../paths');
const { runCmd, spawnSync } = require('../../../cmd');
const BaseResource = require('../base-resource');

/**
 * @typedef {('darwin'|'win'|'linux')} SeaBinaryPlatform
 */
/**
 * @typedef {('x64'|'arm64')} SeaBinaryArch
 */
/**
 * @typedef MacOSBinarySignatureProperties
 * @property {string | function(): string} binaryPath -
 * @property {string | function(): string} macosCertBase64 -
 * @property {string | function(): string} macosCertPassword -
 * @property {string | function(): string} macosKeychainPassword -
 * @property {string | function(): string} [entitlements] -
 */

/**
 * @typedef MacOSBinarySignatureOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {import('../reconcilable')[]} [dependsOn] -
 * @property {MacOSBinarySignatureProperties & import('../../typedefs').SharedProperties} properties -
 */

class MacOSBinarySignature extends BaseResource {
  /**
   * @param {MacOSBinarySignatureOptions} options - SeaBuild Class Options
   */
  constructor({ name, parent, status, dependsOn, properties }) {
    const propertiesWithDefaults = {
      entitlements: MacOSBinarySignature.DEFAULT_ENTITLEMENTS,
      ...properties,
    };
    super({
      name,
      parent,
      status,
      dependsOn,
      properties: propertiesWithDefaults,
    });
  }

  /**
   * Setup the macOS keychain for signing.
   * @param {string} keychainPath -
   */
  setupMacKeychain(keychainPath) {
    const macosCertBase64 = this.get('macosCertBase64');
    const macosCertPassword = this.get('macosCertPassword');
    const macosKeychainPassword = this.get('macosKeychainPassword');

    // Check if this keychain is already listed
    // We'll parse the output of `security list-keychains`
    const listResult = spawnSync('security', ['list-keychains'], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    if (listResult.status !== 0) {
      throw new Error('Failed to run "security list-keychains"');
    }

    const stdout = listResult.stdout.toString();
    if (stdout.includes(keychainPath)) {
      return; // Early return, so we don’t recreate or re-import.
    }

    // 1) Create a temporary keychain (in /tmp or in memory)
    runCmd('security', [
      'create-keychain',
      '-p',
      macosKeychainPassword,
      keychainPath,
    ]);

    // 2) Unlock it
    runCmd('security', [
      'unlock-keychain',
      '-p',
      macosKeychainPassword,
      keychainPath,
    ]);

    // 3) Make it the default keychain (so codesign uses it)
    // runCmd('security', ['default-keychain', '-s', '/tmp/build.keychain']);

    // 4) Set timeout so it doesn’t lock immediately
    runCmd('security', [
      'set-keychain-settings',
      '-t',
      '3600',
      '-u',
      keychainPath,
    ]);

    // 5) Decode & import the p12
    fs.writeFileSync(
      '/tmp/devcert.p12',
      Buffer.from(macosCertBase64, 'base64')
    );
    runCmd('security', [
      'import',
      '/tmp/devcert.p12',
      '-k',
      keychainPath,
      '-P',
      macosCertPassword,
      '-T',
      '/usr/bin/codesign',
    ]);

    // 6) Allow codesign to access the key
    runCmd('security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:',
      '-s',
      '-k',
      macosKeychainPassword,
      keychainPath,
    ]);
  }

  /**
   * write entitlements for macos
   * @param {string} entitlementsPath -
   */
  async writeEntitlements(entitlementsPath) {
    if (fs.existsSync(entitlementsPath)) return;
    await fs.promises.writeFile(
      entitlementsPath,
      this.get('entitlements'),
      'utf8'
    );
  }

  async signBinary() {
    const macosCertBase64 = this.get('macosCertBase64');
    const macosCertPassword = this.get('macosCertPassword');
    const macosKeychainPassword = this.get('macosKeychainPassword');
    const data = `${macosCertBase64}|${macosCertPassword}|${macosKeychainPassword}`;
    // Create a stable MD5 hash in base64 format (shorter than hex)

    const keychainHash = crypto.createHash('md5').update(data).digest('base64');

    const keychainPath = path.join(
      MacOSBinarySignature.KEYCHAINS_DIR,
      `${keychainHash}.keychain`
    );
    this._setUNSAFE('keychainPath', keychainPath);
    const entitlementsHash = crypto
      .createHash('md5')
      .update(this.get('entitlements'))
      .digest('base64');
    const entitlementsPath = path.join(
      MacOSBinarySignature.ENTITLEMENTS_DIR,
      `entitlements-${entitlementsHash}.plist`
    );
    this._setUNSAFE('entitlementsPath', entitlementsPath);
    await this.writeEntitlements(entitlementsPath);

    if (!macosCertBase64 || !macosCertPassword || !macosKeychainPassword) {
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
      await this.setupMacKeychain(keychainPath);
      await runCmd('codesign', [
        '--force',
        '--deep',
        '--verify',
        '--options',
        'runtime',
        '--sign',
        // Make sure quotes are correct. Sometimes passing the certificate name with quotes
        // inside the array can be tricky; you might need to remove the extra quotes:
        'Developer ID Application: Joseph Van Drunen (F84MQ242HH)',
        '--entitlements',
        entitlementsPath,
        '--keychain',
        keychainPath,
        this.get('binaryPath'),
      ]);
    }
  }

  async _reconcile() {
    if (!fs.existsSync(MacOSBinarySignature.ENTITLEMENTS_DIR)) {
      await fs.promises.mkdir(MacOSBinarySignature.ENTITLEMENTS_DIR, {
        recursive: true,
      });
    }
    if (!fs.existsSync(MacOSBinarySignature.KEYCHAINS_DIR)) {
      await fs.promises.mkdir(MacOSBinarySignature.KEYCHAINS_DIR, {
        recursive: true,
      });
    }
    await this.signBinary();
  }

  async _destroy() {}
}

MacOSBinarySignature.ENTITLEMENTS_DIR = path.join(paths.temp, 'entitlements');
MacOSBinarySignature.KEYCHAINS_DIR = path.join(paths.config, 'keychains');

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

module.exports = MacOSBinarySignature;
