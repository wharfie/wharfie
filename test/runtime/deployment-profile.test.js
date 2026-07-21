import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_CONFIGURATION,
  DEPLOYMENT_CAPABILITY_KINDS,
  DEPLOYMENT_PROFILE_ID_DOMAIN,
  DEPLOYMENT_PROFILE_ID_PREFIX,
  canonicalizeDeploymentProfilePayload,
  createAwsSingleNodeProvider,
  createDeploymentProfile,
  getDeploymentProfileRevisionId,
  validateDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';

const target = {
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'arm64',
  libc: 'glibc',
};

/** @returns {Record<string, any>} - Mutable valid profile input. */
function makeProfileInput() {
  return {
    profile: { id: 'production' },
    appId: 'hello-app',
    target: { ...target },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  };
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

describe('deployment profiles', () => {
  it('creates one explicit finite AWS single-node capability mapping', () => {
    const input = makeProfileInput();
    const profile = createDeploymentProfile(input);

    expect(profile).toEqual({
      appId: 'hello-app',
      kind: 'deploymentProfile',
      mode: { kind: 'single-node-systemd-user', version: 1 },
      profile: { id: 'production' },
      profileRevisionId: expect.stringMatching(/^wpr2_[A-Za-z0-9_-]{43}$/),
      provider: {
        configuration: AWS_SINGLE_NODE_CONFIGURATION,
        contractVersion: 3,
        kind: 'aws',
        scope: { region: 'us-east-1' },
      },
      schemaVersion: 2,
      target,
    });
    expect(DEPLOYMENT_CAPABILITY_KINDS).toEqual([
      'resident-node',
      'application-state',
      'control-state',
      'artifact-storage',
      'runtime-identity',
      'networking',
      'ingress',
    ]);
    expect(profile.provider.configuration).toEqual({
      node: { management: 'managed', capacity: 'small' },
      applicationState: {
        management: 'managed',
        storage: 'attached-encrypted-volume',
        onDestroy: 'retain',
      },
      controlState: {
        management: 'managed',
        storage: 'attached-encrypted-volume',
        onDestroy: 'retain',
      },
      artifactStorage: {
        management: 'managed',
        storage: 'private-provider-object',
        onDestroy: 'purge',
      },
      runtimeIdentity: {
        management: 'managed',
        kind: 'host-ssm-artifact-read-health-read-write-current-object',
      },
      networking: {
        management: 'managed',
        kind: 'public-egress-no-ingress',
      },
      ingress: { management: 'none' },
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.provider.configuration.node)).toBe(true);

    input.profile.id = 'mutated';
    input.provider.scope.region = 'us-west-2';
    expect(profile.profile.id).toBe('production');
    expect(profile.provider.scope.region).toBe('us-east-1');
  });

  it('uses a new immutable identity namespace rather than reinterpreting V1', () => {
    const input = makeProfileInput();
    const payload = canonicalizeDeploymentProfilePayload(input);
    const expected = createCanonicalJsonSha256Id({
      domain: 'wharfie:deployment-profile:v2',
      prefix: 'wpr2',
      value: payload,
    });

    expect(DEPLOYMENT_PROFILE_ID_DOMAIN).toBe('wharfie:deployment-profile:v2');
    expect(DEPLOYMENT_PROFILE_ID_PREFIX).toBe('wpr2');
    expect(getDeploymentProfileRevisionId(input)).toBe(expected);
    expect(createDeploymentProfile(input).profileRevisionId).toBe(expected);
  });

  it('canonicalizes JSON key order without weakening exact schemas', () => {
    const first = makeProfileInput();
    const second = {
      provider: {
        configuration: {
          ingress: { management: 'none' },
          networking: {
            kind: 'public-egress-no-ingress',
            management: 'managed',
          },
          runtimeIdentity: {
            kind: 'host-ssm-artifact-read-health-read-write-current-object',
            management: 'managed',
          },
          artifactStorage: {
            onDestroy: 'purge',
            storage: 'private-provider-object',
            management: 'managed',
          },
          controlState: {
            onDestroy: 'retain',
            storage: 'attached-encrypted-volume',
            management: 'managed',
          },
          applicationState: {
            storage: 'attached-encrypted-volume',
            management: 'managed',
            onDestroy: 'retain',
          },
          node: { capacity: 'small', management: 'managed' },
        },
        scope: { region: 'us-east-1' },
        contractVersion: 3,
        kind: 'aws',
      },
      mode: { version: 1, kind: 'single-node-systemd-user' },
      target: {
        libc: 'glibc',
        architecture: 'arm64',
        platform: 'linux',
        nodeVersion: '24.13.1',
      },
      appId: 'hello-app',
      profile: { id: 'production' },
    };

    expect(getDeploymentProfileRevisionId(second)).toBe(
      getDeploymentProfileRevisionId(first),
    );
  });

  it.each([
    [
      'profile identity',
      (/** @type {any} */ value) => {
        value.profile.id = 'staging';
      },
    ],
    [
      'application identity',
      (/** @type {any} */ value) => {
        value.appId = 'other-app';
      },
    ],
    [
      'target',
      (/** @type {any} */ value) => {
        value.target.architecture = 'x64';
      },
    ],
    [
      'provider scope',
      (/** @type {any} */ value) => {
        value.provider.scope.region = 'us-west-2';
      },
    ],
  ])('changes identity with %s', (_name, mutate) => {
    const original = makeProfileInput();
    const changed = makeProfileInput();
    mutate(changed);
    expect(getDeploymentProfileRevisionId(changed)).not.toBe(
      getDeploymentProfileRevisionId(original),
    );
  });

  it('validates, canonicalizes, and independently freezes serialized profiles', () => {
    const serialized = clone(createDeploymentProfile(makeProfileInput()));
    const validated = validateDeploymentProfile(serialized);

    expect(validated).toEqual(serialized);
    expect(validated).not.toBe(serialized);
    expect(validated.provider).not.toBe(serialized.provider);
    serialized.provider.scope.region = 'us-west-2';
    expect(validated.provider.scope.region).toBe('us-east-1');
  });

  it.each([
    ['provider-native template', 'template'],
    ['provider-native tags', 'tags'],
    ['bootstrap commands', 'userData'],
    ['runtime environment', 'environment'],
    ['generic resources', 'resources'],
  ])('rejects %s', (_name, field) => {
    const input = makeProfileInput();
    input.provider[field] = { arbitrary: true };
    expect(() => createDeploymentProfile(input)).toThrow(
      new RegExp(`provider\\.${field} is not supported`, 'i'),
    );
  });

  it.each([
    [
      'wrong provider',
      (/** @type {any} */ value) => (value.provider.kind = 'gcp'),
      /kind must be 'aws'/i,
    ],
    [
      'wrong contract version',
      (/** @type {any} */ value) => (value.provider.contractVersion = 1),
      /contractVersion must be the integer 3/i,
    ],
    [
      'implicit region',
      (/** @type {any} */ value) => delete value.provider.scope.region,
      /scope\.region is required/i,
    ],
    [
      'noncanonical region',
      (/** @type {any} */ value) =>
        (value.provider.scope.region = ' US-EAST-1 '),
      /canonical AWS region/i,
    ],
    [
      'unsupported capacity',
      (/** @type {any} */ value) =>
        (value.provider.configuration.node.capacity = 'large'),
      /capacity must be 'small'/i,
    ],
    [
      'managed ingress',
      (/** @type {any} */ value) =>
        (value.provider.configuration.ingress.management = 'managed'),
      /management must be 'none'/i,
    ],
    [
      'state purge by default',
      (/** @type {any} */ value) =>
        (value.provider.configuration.applicationState.onDestroy = 'purge'),
      /onDestroy must be 'retain'/i,
    ],
    [
      'missing capability',
      (/** @type {any} */ value) =>
        delete value.provider.configuration.controlState,
      /configuration\.controlState is required/i,
    ],
    [
      'unknown capability',
      (/** @type {any} */ value) => (value.provider.configuration.queue = {}),
      /configuration\.queue is not supported/i,
    ],
    [
      'wrong mode',
      (/** @type {any} */ value) => (value.mode.kind = 'mesh'),
      /single-node-systemd-user version 1/i,
    ],
    [
      'Darwin target',
      (/** @type {any} */ value) => {
        value.target = {
          nodeVersion: '24.13.1',
          platform: 'darwin',
          architecture: 'arm64',
        };
      },
      /target must be Linux glibc/i,
    ],
    [
      'Windows target',
      (/** @type {any} */ value) => {
        value.target = {
          nodeVersion: '24.13.1',
          platform: 'win32',
          architecture: 'x64',
        };
      },
      /target must be Linux glibc/i,
    ],
  ])('rejects %s', (_name, mutate, errorPattern) => {
    const input = makeProfileInput();
    mutate(input);
    expect(() => createDeploymentProfile(input)).toThrow(errorPattern);
  });

  it('accepts a canonical region name without maintaining a stale AWS catalog', () => {
    const input = makeProfileInput();
    input.provider.scope.region = 'eusc-de-east-1';
    expect(createDeploymentProfile(input).provider.scope.region).toBe(
      'eusc-de-east-1',
    );
  });

  it.each(['credentials', 'accessToken', 'secretAccessKey', 'password'])(
    'never accepts or echoes inline provider field %s',
    (field) => {
      const secret = `secret-sentinel-${field}`;
      const input = makeProfileInput();
      input.provider.scope[field] = secret;
      let thrown;
      try {
        createDeploymentProfile(input);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(String(thrown)).not.toContain(secret);
    },
  );

  it.each([
    [
      'wrong schema version',
      (/** @type {any} */ value) => {
        value.schemaVersion = 1;
      },
      /schemaVersion must be the integer 2/i,
    ],
    [
      'old V1 identity',
      (/** @type {any} */ value) => {
        value.profileRevisionId = value.profileRevisionId.replace(
          /^wpr2_/,
          'wpr1_',
        );
      },
      /canonical wpr2_/i,
    ],
    [
      'changed provider scope',
      (/** @type {any} */ value) => {
        value.provider.scope.region = 'us-west-2';
      },
      /profileRevisionId does not match/i,
    ],
  ])('rejects serialized profiles with %s', (_name, mutate, errorPattern) => {
    const profile = clone(createDeploymentProfile(makeProfileInput()));
    mutate(profile);
    expect(() => validateDeploymentProfile(profile)).toThrow(errorPattern);
  });
});
