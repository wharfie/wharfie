'use strict';

const BaseResource = require('../../lambdas/lib/actor/resources/base-resource');
const {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
} = require('../../lambdas/lib/db/state/local');
BaseResource.stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};

const SSHKey = require('../../lambdas/lib/actor/resources/local/ssh-key');
const HetznerNode = require('../../lambdas/lib/actor/resources/hetzner/node');

const HZ_TOKEN = process.env.HETZNER_TOKEN;
const BINARY_FILE =
  '/Users/joe/Library/Application Support/wharfie-nodejs/actor_binaries/main-build-24-linux-x64';

/**
 * Ensure required env present.
 */
function requireEnv() {
  const missing = [];
  if (!HZ_TOKEN) missing.push('HETZNER_TOKEN');
  if (!BINARY_FILE) missing.push('BINARY_FILE');
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    process.exit(2);
  }
}

(async () => {
  requireEnv();
  // 1) Ensure local SSH keypair exists (idempotent)
  const sshKey = new SSHKey({
    name: `ssh-key-test`,
    properties: {},
  });
  await sshKey._reconcile();
  const keyPrefix = sshKey.get('path'); // absolute path without .pub
  const publicKeyPath = `${keyPrefix}.pub`;

  // 2) Ensure the public key is present in Hetzner under the same name (idempotent)
  const hzNode = new HetznerNode({
    name: 'node-hz1',
    properties: {
      hetznerToken: HZ_TOKEN,
      sshPublicKeyPath: publicKeyPath,
      sshPrivateKeyPath: keyPrefix,
      binaryLocalPath: BINARY_FILE,
      location: 'ash',
    },
  });
  let exitCode = 0;
  try {
    await hzNode._reconcile();
    exitCode = await hzNode.openSSH();
    console.log(`SSH session ended with code ${exitCode}`);
  } finally {
    console.log('Tearing down resources...');
    try {
      await hzNode._destroy();
    } catch (e) {
      console.error('Error destroying node:', e);
    }
    try {
      await sshKey._destroy();
    } catch (e) {
      console.error('Error destroying local SSH key:', e);
    }
  }

  process.exit(exitCode);
})().catch((err) => {
  console.log(err);
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? /** @type {{message: string}} */ (err).message
      : String(err);
  console.error('Fatal:', msg);
  process.exit(1);
});
