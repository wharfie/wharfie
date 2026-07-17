import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  DEPLOYMENT_PROFILE_ID_DOMAIN,
  DEPLOYMENT_PROFILE_ID_PREFIX,
  canonicalizeDeploymentProfilePayload,
  createDeploymentProfile,
  getDeploymentProfileRevisionId,
  validateDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';

/** @returns {any} - Mutable valid profile input. */
function makeProfileInput() {
  return {
    profile: { id: 'production' },
    appId: 'hello-app',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'arm64',
      libc: 'glibc',
    },
    bindings: {
      objectStorage: { kind: 'external', ref: 'production-artifacts' },
      db: { kind: 'external', ref: 'production-state' },
    },
  };
}

describe('deployment profiles', () => {
  it('creates a canonical, deeply immutable target-specific snapshot', () => {
    const input = makeProfileInput();
    const profile = createDeploymentProfile(input);

    expect(profile).toEqual({
      appId: 'hello-app',
      bindings: {
        db: { kind: 'external', ref: 'production-state' },
        objectStorage: {
          kind: 'external',
          ref: 'production-artifacts',
        },
      },
      kind: 'deploymentProfile',
      profile: { id: 'production' },
      profileRevisionId: expect.stringMatching(/^wpr1_[A-Za-z0-9_-]{43}$/),
      schemaVersion: 1,
      target: {
        architecture: 'arm64',
        libc: 'glibc',
        nodeVersion: '24.13.1',
        platform: 'linux',
      },
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.profile)).toBe(true);
    expect(Object.isFrozen(profile.target)).toBe(true);
    expect(Object.isFrozen(profile.bindings)).toBe(true);
    expect(Object.isFrozen(profile.bindings?.db)).toBe(true);

    input.profile.id = 'mutated';
    input.target.nodeVersion = '24.14.0';
    input.bindings.db.ref = 'mutated-state';
    expect(profile.profile.id).toBe('production');
    expect(profile.target.nodeVersion).toBe('24.13.1');
    expect(profile.bindings?.db?.ref).toBe('production-state');
    expect(() => {
      profile.target.platform = 'darwin';
    }).toThrow(TypeError);
  });

  it('uses the exact ADR domain and ignores input object-key order', () => {
    const input = makeProfileInput();
    const reordered = {
      bindings: {
        db: { ref: 'production-state', kind: 'external' },
        objectStorage: {
          ref: 'production-artifacts',
          kind: 'external',
        },
      },
      target: {
        libc: 'glibc',
        architecture: 'arm64',
        platform: 'linux',
        nodeVersion: '24.13.1',
      },
      appId: 'hello-app',
      profile: { id: 'production' },
    };
    const payload = canonicalizeDeploymentProfilePayload(input);
    const expectedId = createCanonicalJsonSha256Id({
      domain: 'wharfie:deployment-profile:v1',
      prefix: 'wpr1',
      value: payload,
    });

    expect(DEPLOYMENT_PROFILE_ID_DOMAIN).toBe('wharfie:deployment-profile:v1');
    expect(DEPLOYMENT_PROFILE_ID_PREFIX).toBe('wpr1');
    expect(getDeploymentProfileRevisionId(input)).toBe(expectedId);
    expect(getDeploymentProfileRevisionId(reordered)).toBe(expectedId);
    expect(createDeploymentProfile(reordered).profileRevisionId).toBe(
      expectedId,
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
      'exact target',
      (/** @type {any} */ value) => {
        value.target.architecture = 'x64';
      },
    ],
    [
      'external binding',
      (/** @type {any} */ value) => {
        value.bindings.db.ref = 'other-state';
      },
    ],
    [
      'binding presence',
      (/** @type {any} */ value) => {
        delete value.bindings.objectStorage;
      },
    ],
  ])('changes identity when %s changes', (_name, mutate) => {
    const original = makeProfileInput();
    const changed = makeProfileInput();
    mutate(changed);
    expect(getDeploymentProfileRevisionId(changed)).not.toBe(
      getDeploymentProfileRevisionId(original),
    );
  });

  it('validates, canonicalizes, and independently freezes serialized profiles', () => {
    const serialized = JSON.parse(
      JSON.stringify(createDeploymentProfile(makeProfileInput())),
    );
    const validated = validateDeploymentProfile(serialized);

    expect(validated).toEqual(serialized);
    expect(validated).not.toBe(serialized);
    expect(validated.target).not.toBe(serialized.target);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.bindings?.objectStorage)).toBe(true);

    serialized.profile.id = 'changed-after-validation';
    expect(validated.profile.id).toBe('production');
  });

  it('rejects a well-formed identity that does not match the payload', () => {
    const profile = JSON.parse(
      JSON.stringify(createDeploymentProfile(makeProfileInput())),
    );
    profile.profileRevisionId = `${profile.profileRevisionId.slice(0, -1)}${
      profile.profileRevisionId.endsWith('A') ? 'B' : 'A'
    }`;
    expect(() => validateDeploymentProfile(profile)).toThrow(
      /does not match the canonical profile payload/i,
    );
  });

  it.each([
    'revisionId',
    'artifactId',
    'deploymentId',
    'provider',
    'topology',
    'credentials',
    'env',
    'environment',
    'resources',
    'managed',
  ])('rejects unsupported top-level field %s', (field) => {
    const input = makeProfileInput();
    input[field] = { token: 'must-not-be-accepted' };
    expect(() => createDeploymentProfile(input)).toThrow(
      new RegExp(`deploymentProfile\\.${field} is not supported`, 'i'),
    );
  });

  it.each([
    [
      'profile topology',
      (/** @type {any} */ value) => {
        value.profile.topology = 'mesh';
      },
      /profile\.topology is not supported/i,
    ],
    [
      'target provider',
      (/** @type {any} */ value) => {
        value.target.provider = 'aws';
      },
      /target\.provider is not supported/i,
    ],
    [
      'target environment',
      (/** @type {any} */ value) => {
        value.target.env = { NODE_ENV: 'production' };
      },
      /target\.env is not supported/i,
    ],
    [
      'unknown resource kind',
      (/** @type {any} */ value) => {
        value.bindings.lambda = { kind: 'external', ref: 'worker' };
      },
      /bindings\.lambda is not supported/i,
    ],
    [
      'binding provider',
      (/** @type {any} */ value) => {
        value.bindings.db.provider = 'dynamodb';
      },
      /bindings\.db\.provider is not supported/i,
    ],
    [
      'binding credentials',
      (/** @type {any} */ value) => {
        value.bindings.db.credentials = { token: 'secret' };
      },
      /bindings\.db\.credentials is not supported/i,
    ],
    [
      'binding topology',
      (/** @type {any} */ value) => {
        value.bindings.db.topology = { replicas: 3 };
      },
      /bindings\.db\.topology is not supported/i,
    ],
  ])('rejects unsupported nested %s', (_name, mutate, errorPattern) => {
    const input = makeProfileInput();
    mutate(input);
    expect(() => createDeploymentProfile(input)).toThrow(errorPattern);
  });

  it('does not echo rejected credential values', () => {
    const secret = 'credential-sentinel-do-not-render';
    const input = makeProfileInput();
    input.bindings.db.credentials = { token: secret };

    let thrown;
    try {
      createDeploymentProfile(input);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).not.toContain(secret);
  });

  it.each([
    [
      'managed bindings',
      () => {
        const input = makeProfileInput();
        input.bindings.db.kind = 'managed';
        return input;
      },
      /kind must be 'external'/i,
    ],
    [
      'provider references',
      () => {
        const input = makeProfileInput();
        input.bindings.db.ref =
          'arn:aws:dynamodb:us-east-1:123456789012:table/state';
        return input;
      },
      /canonical logical ID/i,
    ],
    [
      'empty bindings',
      () => ({ ...makeProfileInput(), bindings: {} }),
      /must not be empty/i,
    ],
    [
      'missing target',
      () => {
        const input = makeProfileInput();
        delete input.target;
        return input;
      },
      /target must be a JSON object/i,
    ],
    [
      'inexact targets',
      () => {
        const input = makeProfileInput();
        input.target.nodeVersion = '^24.13.1';
        return input;
      },
      /exact canonical semantic version/i,
    ],
    [
      'noncanonical profile IDs',
      () => {
        const input = makeProfileInput();
        input.profile.id = ' Production ';
        return input;
      },
      /canonical logical ID/i,
    ],
    [
      'noncanonical application IDs',
      () => {
        const input = makeProfileInput();
        input.appId = 'HelloApp';
        return input;
      },
      /canonical logical ID/i,
    ],
  ])('rejects %s', (_name, makeValue, errorPattern) => {
    expect(() => createDeploymentProfile(makeValue())).toThrow(errorPattern);
  });

  it.each([
    [
      'unknown document fields',
      (/** @type {any} */ value) => {
        value.provider = 'aws';
      },
      /provider is not supported/i,
    ],
    [
      'wrong schema versions',
      (/** @type {any} */ value) => {
        value.schemaVersion = 2;
      },
      /schemaVersion must be the integer 1/i,
    ],
    [
      'wrong document kinds',
      (/** @type {any} */ value) => {
        value.kind = 'deployment';
      },
      /kind must be 'deploymentProfile'/i,
    ],
    [
      'missing profile revision identities',
      (/** @type {any} */ value) => {
        delete value.profileRevisionId;
      },
      /profileRevisionId must be a canonical wpr1_/i,
    ],
  ])('rejects serialized profiles with %s', (_name, mutate, errorPattern) => {
    const profile = JSON.parse(
      JSON.stringify(createDeploymentProfile(makeProfileInput())),
    );
    mutate(profile);
    expect(() => validateDeploymentProfile(profile)).toThrow(errorPattern);
  });
});
