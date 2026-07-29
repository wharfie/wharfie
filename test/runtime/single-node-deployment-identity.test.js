import { describe, expect, it } from '@jest/globals';

import {
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
  createSingleNodeDeploymentIncarnationId,
  getSingleNodeDeploymentInstanceId,
} from '../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';

/** @param {Record<string, any>} [overrides] */
function makeIntent(overrides = {}) {
  return createSingleNodeDeploymentIntent({
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
    ...overrides,
  });
}

describe('single-node deployment identities', () => {
  it('preserves instance identity across target, machine, and access revisions', () => {
    const original = makeIntent();
    const updated = makeIntent({
      target: {
        nodeVersion: '24.14.0',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      access: {
        kind: 'public-ssh',
        allowedIpv4: ['198.51.100.4/32'],
      },
    });

    expect(updated.intentRevisionId).not.toBe(original.intentRevisionId);
    expect(getSingleNodeDeploymentInstanceId(updated)).toBe(
      getSingleNodeDeploymentInstanceId(original),
    );
  });

  it.each([
    ['application', { appId: 'another-app' }],
    ['deployment', { deployment: { id: 'hello-staging' } }],
    ['provider', { provider: { kind: 'hetzner', location: 'hel1' } }],
  ])('changes instance identity with %s', (_name, overrides) => {
    expect(getSingleNodeDeploymentInstanceId(makeIntent(overrides))).not.toBe(
      getSingleNodeDeploymentInstanceId(makeIntent()),
    );
  });

  it('uses disjoint typed instance and incarnation namespaces', () => {
    const instanceId = getSingleNodeDeploymentInstanceId(makeIntent());
    const incarnationId = createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 7),
    );

    expect(instanceId).toMatch(/^wsnd1_[A-Za-z0-9_-]{43}$/);
    expect(incarnationId).toMatch(/^wsnc1_[A-Za-z0-9_-]{43}$/);
    expect(() =>
      assertSingleNodeDeploymentInstanceId(instanceId),
    ).not.toThrow();
    expect(() =>
      assertSingleNodeDeploymentIncarnationId(incarnationId),
    ).not.toThrow();
    expect(() => assertSingleNodeDeploymentInstanceId(incarnationId)).toThrow(
      /canonical wsnd1_/i,
    );
    expect(() => assertSingleNodeDeploymentIncarnationId(instanceId)).toThrow(
      /canonical wsnc1_/i,
    );
  });

  it.each([
    Buffer.alloc(0),
    Buffer.alloc(16),
    Buffer.alloc(31),
    Buffer.alloc(33),
    'not-bytes',
  ])('rejects non-256-bit incarnation entropy: %#', (entropy) => {
    expect(() =>
      createSingleNodeDeploymentIncarnationId(/** @type {any} */ (entropy)),
    ).toThrow(/exactly 32 bytes/i);
  });
});
