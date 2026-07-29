import { createHash } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import {
  SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
  SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
  SINGLE_NODE_CLOUD_INIT_MAX_BYTES,
  SINGLE_NODE_DEPLOYMENT_ROOT,
  createSingleNodeCloudInit,
  validateSshEd25519PublicKey,
} from '../../src/core/runtime/single-node-cloud-init.js';
import {
  createSingleNodeDeploymentIncarnationId,
  getSingleNodeDeploymentInstanceId,
} from '../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';
import { SINGLE_NODE_RUNTIME_ACCOUNT } from '../../src/core/runtime/single-node-runtime-account.js';

/** @param {string|Buffer} value */
function sshWireString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function makePublicKey() {
  const blob = Buffer.concat([
    sshWireString('ssh-ed25519'),
    sshWireString(Buffer.alloc(32, 7)),
  ]);
  return {
    publicKey: `ssh-ed25519 ${blob.toString('base64')}`,
    publicKeyFingerprint: `SHA256:${createHash('sha256')
      .update(blob)
      .digest('base64')
      .replace(/=+$/, '')}`,
  };
}

function makeIdentity() {
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: 'fsn1' },
  });
  return {
    deploymentInstanceId: getSingleNodeDeploymentInstanceId(intent),
    incarnationId: createSingleNodeDeploymentIncarnationId(Buffer.alloc(32, 5)),
  };
}

/** @param {Buffer} bytes */
function parseCloudConfig(bytes) {
  const text = bytes.toString('utf8');
  expect(text.startsWith('#cloud-config\n')).toBe(true);
  return JSON.parse(text.slice('#cloud-config\n'.length));
}

describe('single-node cloud-init', () => {
  it('creates deterministic bounded bootstrap for only the non-root account', () => {
    const identity = makeIdentity();
    const key = makePublicKey();
    const first = createSingleNodeCloudInit({ ...identity, ...key });
    const second = createSingleNodeCloudInit({ ...identity, ...key });
    const config = parseCloudConfig(first.bytes);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.bytes.byteLength).toBeLessThanOrEqual(
      SINGLE_NODE_CLOUD_INIT_MAX_BYTES,
    );
    expect(first.digest).toEqual(second.digest);
    expect(first.runtimeAccount).toBe(SINGLE_NODE_RUNTIME_ACCOUNT);
    expect(config).toMatchObject({
      disable_root: true,
      package_update: false,
      package_upgrade: false,
      ssh_pwauth: false,
      users: [
        {
          homedir: '/home/wharfie',
          lock_passwd: true,
          name: 'wharfie',
          shell: '/bin/bash',
          ssh_authorized_keys: [key.publicKey],
          uid: 60706,
        },
      ],
      write_files: [
        {
          owner: 'root:root',
          path: SINGLE_NODE_BOOTSTRAP_IDENTITY_PATH,
          permissions: '0644',
        },
      ],
    });
    expect(config.users).toHaveLength(1);
    expect(config.runcmd.at(-1)).toEqual([
      '/usr/bin/install',
      '-m',
      '0644',
      '-o',
      'root',
      '-g',
      'root',
      '/dev/null',
      SINGLE_NODE_BOOTSTRAP_COMPLETE_PATH,
    ]);
    expect(config.runcmd[0]).toContain(SINGLE_NODE_DEPLOYMENT_ROOT);
    expect(first.bytes.toString('utf8')).not.toMatch(
      /\b(?:sudo|apt|package_install)\b/i,
    );
  });

  it('writes exact secret-free bootstrap identity evidence', () => {
    const identity = makeIdentity();
    const key = makePublicKey();
    const result = createSingleNodeCloudInit({ ...identity, ...key });
    const config = parseCloudConfig(result.bytes);
    const persisted = JSON.parse(config.write_files[0].content);

    expect(persisted).toEqual(result.bootstrapIdentity);
    expect(persisted).toEqual({
      contract: { kind: 'single-node-systemd-user', version: 1 },
      deploymentInstanceId: identity.deploymentInstanceId,
      incarnationId: identity.incarnationId,
      kind: 'singleNodeBootstrapIdentity',
      runtimeAccount: {
        home: '/home/wharfie',
        shell: '/bin/bash',
        uid: 60706,
        user: 'wharfie',
      },
      schemaVersion: 1,
      sshPublicKeyFingerprint: key.publicKeyFingerprint,
    });
    expect(persisted).not.toHaveProperty('publicKey');
  });

  it('validates exact Ed25519 wire bytes and matching fingerprint', () => {
    const key = makePublicKey();
    expect(validateSshEd25519PublicKey(key.publicKey)).toEqual({
      publicKey: key.publicKey,
      fingerprint: key.publicKeyFingerprint,
    });
    expect(() =>
      createSingleNodeCloudInit({
        ...makeIdentity(),
        ...key,
        publicKeyFingerprint:
          'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }),
    ).toThrow(/fingerprint must match/i);
  });

  it('rejects credential-like and other unknown input without echoing it', () => {
    const sentinel = 'secret-sentinel-token';
    let thrown;
    try {
      const input = /** @type {any} */ ({
        ...makeIdentity(),
        ...makePublicKey(),
        providerToken: sentinel,
      });
      createSingleNodeCloudInit(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });

  it.each([
    'ssh-rsa AAAA test',
    'ssh-ed25519 !!! test',
    'ssh-ed25519 AAAA test',
    'ssh-ed25519 AAAA\nsecond-line',
  ])('rejects malformed public key %p without echoing it', (publicKey) => {
    let thrown;
    try {
      createSingleNodeCloudInit({
        ...makeIdentity(),
        publicKey,
        publicKeyFingerprint:
          'SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(publicKey);
  });
});
