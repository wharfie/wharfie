import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  canonicalizeSingleNodeDeploymentIntentPayload,
  createAwsSingleNodeDeploymentProvider,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
  getSingleNodeDeploymentIntentRevisionId,
  validateSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';

/** @returns {Record<string, any>} - Mutable valid intent input. */
function makeIntentInput() {
  return {
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { ...SINGLE_NODE_DEPLOYMENT_MODE },
    machine: { ...SINGLE_NODE_MACHINE },
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32', '198.51.100.4/32'],
    },
    provider: { kind: 'hetzner', location: 'fsn1' },
  };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

describe('single-node deployment intent', () => {
  it('creates the two exact provider selections through public helpers', () => {
    expect(createAwsSingleNodeDeploymentProvider('us-east-1')).toEqual({
      kind: 'aws',
      region: 'us-east-1',
    });
    expect(createHetznerSingleNodeDeploymentProvider('fsn1')).toEqual({
      kind: 'hetzner',
      location: 'fsn1',
    });
    expect(() => createAwsSingleNodeDeploymentProvider(' US-EAST-1 ')).toThrow(
      /canonical AWS region/i,
    );
    expect(() => createHetznerSingleNodeDeploymentProvider('FSN1')).toThrow(
      /canonical Hetzner location/i,
    );
  });

  it.each([
    [
      { kind: 'aws', region: 'us-east-1' },
      { kind: 'aws', region: 'us-east-1' },
    ],
    [
      { kind: 'hetzner', location: 'fsn1' },
      { kind: 'hetzner', location: 'fsn1' },
    ],
  ])(
    'creates one small provider-neutral intent for %#',
    (provider, expected) => {
      const input = makeIntentInput();
      input.provider = provider;
      const intent = createSingleNodeDeploymentIntent(input);

      expect(intent).toEqual({
        access: {
          allowedIpv4: ['198.51.100.4/32', '203.0.113.7/32'],
          kind: 'public-ssh',
        },
        appId: 'hello-app',
        deployment: { id: 'hello-production' },
        intentRevisionId: expect.stringMatching(/^wsni1_[A-Za-z0-9_-]{43}$/),
        kind: 'singleNodeDeploymentIntent',
        machine: { class: 'small' },
        mode: { kind: 'single-node-systemd-user', version: 1 },
        provider: expected,
        schemaVersion: 1,
        target: {
          architecture: 'x64',
          libc: 'glibc',
          nodeVersion: '24.13.1',
          platform: 'linux',
        },
      });
      expect(Object.isFrozen(intent)).toBe(true);
      expect(Object.isFrozen(intent.access.allowedIpv4)).toBe(true);

      input.deployment.id = 'changed';
      input.access.allowedIpv4[0] = '192.0.2.9/32';
      expect(intent.deployment.id).toBe('hello-production');
      expect(intent.access.allowedIpv4).toEqual([
        '198.51.100.4/32',
        '203.0.113.7/32',
      ]);
    },
  );

  it('canonicalizes SSH source order and duplicates before identity', () => {
    const first = makeIntentInput();
    const second = makeIntentInput();
    second.access.allowedIpv4 = [
      '198.51.100.4/32',
      '203.0.113.7/32',
      '198.51.100.4/32',
    ];

    expect(getSingleNodeDeploymentIntentRevisionId(second)).toBe(
      getSingleNodeDeploymentIntentRevisionId(first),
    );
  });

  it('uses a dedicated content-addressed identity namespace', () => {
    const input = makeIntentInput();
    const payload = canonicalizeSingleNodeDeploymentIntentPayload(input);
    const expected = createCanonicalJsonSha256Id({
      domain: 'wharfie:single-node-deployment-intent:v1',
      prefix: 'wsni1',
      value: payload,
    });

    expect(SINGLE_NODE_DEPLOYMENT_INTENT_ID_DOMAIN).toBe(
      'wharfie:single-node-deployment-intent:v1',
    );
    expect(SINGLE_NODE_DEPLOYMENT_INTENT_ID_PREFIX).toBe('wsni1');
    expect(getSingleNodeDeploymentIntentRevisionId(input)).toBe(expected);
    expect(createSingleNodeDeploymentIntent(input).intentRevisionId).toBe(
      expected,
    );
  });

  it('validates, clones, and freezes a serialized intent', () => {
    const serialized = clone(
      createSingleNodeDeploymentIntent(makeIntentInput()),
    );
    const validated = validateSingleNodeDeploymentIntent(serialized);

    expect(validated).toEqual(serialized);
    expect(validated).not.toBe(serialized);
    expect(validated.provider).not.toBe(serialized.provider);
    /** @type {any} */ (serialized.provider).location = 'hel1';
    expect(validated.provider).toEqual({ kind: 'hetzner', location: 'fsn1' });
  });

  it.each([
    [
      'unsupported provider',
      (/** @type {any} */ value) => (value.provider.kind = 'gcp'),
      /kind must be 'aws' or 'hetzner'/i,
    ],
    [
      'AWS configuration',
      (/** @type {any} */ value) =>
        (value.provider = {
          kind: 'aws',
          region: 'us-east-1',
          resources: {},
        }),
      /provider\.resources is not supported/i,
    ],
    [
      'noncanonical AWS region',
      (/** @type {any} */ value) =>
        (value.provider = { kind: 'aws', region: ' US-EAST-1 ' }),
      /canonical AWS region/i,
    ],
    [
      'implicit Hetzner location',
      (/** @type {any} */ value) => (value.provider = { kind: 'hetzner' }),
      /provider\.location is required/i,
    ],
    [
      'unknown Hetzner location shape',
      (/** @type {any} */ value) =>
        (value.provider = { kind: 'hetzner', location: 'FSN1' }),
      /canonical Hetzner location/i,
    ],
    [
      'arm64 target',
      (/** @type {any} */ value) => (value.target.architecture = 'arm64'),
      /target must be Linux glibc on x64/i,
    ],
    [
      'Darwin target',
      (/** @type {any} */ value) =>
        (value.target = {
          nodeVersion: '24.13.1',
          platform: 'darwin',
          architecture: 'x64',
        }),
      /target must be Linux glibc on x64/i,
    ],
    [
      'larger machine',
      (/** @type {any} */ value) => (value.machine.class = 'large'),
      /class must be 'small'/i,
    ],
    [
      'unrestricted SSH',
      (/** @type {any} */ value) => (value.access.allowedIpv4 = ['0.0.0.0/0']),
      /IPv4 address followed by \/32/i,
    ],
    [
      'IPv4 subnet',
      (/** @type {any} */ value) =>
        (value.access.allowedIpv4 = ['203.0.113.0/24']),
      /IPv4 address followed by \/32/i,
    ],
    [
      'noncanonical IPv4',
      (/** @type {any} */ value) =>
        (value.access.allowedIpv4 = ['203.000.113.7/32']),
      /canonical IPv4 address/i,
    ],
    [
      'empty SSH sources',
      (/** @type {any} */ value) => (value.access.allowedIpv4 = []),
      /at least one IPv4 \/32/i,
    ],
    [
      'wrong mode',
      (/** @type {any} */ value) => (value.mode.kind = 'mesh'),
      /single-node-systemd-user version 1/i,
    ],
  ])('rejects %s', (_name, mutate, errorPattern) => {
    const input = makeIntentInput();
    mutate(input);
    expect(() => createSingleNodeDeploymentIntent(input)).toThrow(errorPattern);
  });

  it.each([
    ['credentials', { accessKeyId: 'secret-sentinel-access-key' }],
    ['token', { token: 'secret-sentinel-token' }],
    ['private key', { privateKey: 'secret-sentinel-private-key' }],
    ['user data', { userData: 'secret-sentinel-user-data' }],
    ['arbitrary tags', { tags: { owner: 'secret-sentinel-owner' } }],
  ])('rejects and never echoes provider %s', (_name, extra) => {
    const input = makeIntentInput();
    Object.assign(input.provider, extra);
    const sentinel = Object.values(extra)[0];
    let thrown;
    try {
      createSingleNodeDeploymentIntent(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(String(sentinel));
  });

  it.each([
    [
      'wrong schema version',
      (/** @type {any} */ value) => (value.schemaVersion = 2),
      /schemaVersion must be the integer 1/i,
    ],
    [
      'wrong identity namespace',
      (/** @type {any} */ value) =>
        (value.intentRevisionId = value.intentRevisionId.replace(
          /^wsni1_/,
          'wsni2_',
        )),
      /canonical wsni1_/i,
    ],
    [
      'changed placement',
      (/** @type {any} */ value) => (value.provider.location = 'hel1'),
      /intentRevisionId does not match/i,
    ],
  ])('rejects serialized intent with %s', (_name, mutate, errorPattern) => {
    const intent = clone(createSingleNodeDeploymentIntent(makeIntentInput()));
    mutate(intent);
    expect(() => validateSingleNodeDeploymentIntent(intent)).toThrow(
      errorPattern,
    );
  });
});
