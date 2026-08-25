import { describe, expect, it } from '@jest/globals';

import {
  HETZNER_OWNERSHIP_CONFLICT_REASONS,
  HETZNER_OWNERSHIP_LABEL_PREFIX,
  HETZNER_OWNERSHIP_MAX_LABELS,
  HETZNER_OWNERSHIP_MAX_MATCHES,
  HETZNER_RESOURCE_ROLES,
  classifyHetznerOwnershipMatches,
  createHetznerOwnership,
  getHetznerDeploymentLabelSelector,
  validateHetznerOwnership,
} from '../../../../src/core/runtime/providers/hetzner/ownership.js';
import {
  createDomainSeparatedSha256Id,
  sha256Base64Url,
} from '../../../../src/core/runtime/content-id.js';
import {
  createSingleNodeDeploymentIncarnationId,
  getSingleNodeDeploymentInstanceId,
} from '../../../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../../src/core/runtime/single-node-deployment-intent.js';

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

/** @param {Record<string, any>} [overrides] */
function makeOwnership(overrides = {}) {
  return createHetznerOwnership({
    deploymentInstanceId: getSingleNodeDeploymentInstanceId(makeIntent()),
    incarnationId: createSingleNodeDeploymentIncarnationId(Buffer.alloc(32, 1)),
    role: 'server',
    createdByActionId: createDomainSeparatedSha256Id({
      domain: 'wharfie:single-node-deployment-action:v1',
      prefix: 'wsna1',
      payload: 'create-server',
    }),
    ownershipNonce: sha256Base64Url('ownership-nonce'),
    desiredStateDigest: sha256Base64Url('server-specification'),
    ...overrides,
  });
}

/** @param {ReturnType<typeof makeOwnership>} ownership @param {Record<string, any>} [overrides] */
function makeMatch(ownership, overrides = {}) {
  return {
    id: 412_345,
    name: ownership.name,
    labels: { ...ownership.labels },
    ...overrides,
  };
}

/** @param {ReturnType<typeof makeOwnership>} ownership @param {Record<string, any>} [overrides] */
function classify(ownership, overrides = {}) {
  return classifyHetznerOwnershipMatches({
    ownership,
    storedResourceId: null,
    matches: [],
    ...overrides,
  });
}

describe('Hetzner resource ownership', () => {
  it('has exactly the three aggregate roles and no provider SSH-key role', () => {
    expect(HETZNER_RESOURCE_ROLES).toEqual([
      'firewall',
      'primary-ip',
      'server',
    ]);
    expect(HETZNER_RESOURCE_ROLES).not.toContain('ssh-key');
    expect(Object.isFrozen(HETZNER_RESOURCE_ROLES)).toBe(true);
  });

  it('creates deterministic, deeply frozen, provider-safe names and labels', () => {
    const ownership = makeOwnership();
    const repeated = makeOwnership();

    expect(repeated).toEqual(ownership);
    expect(ownership.name).toMatch(/^wharfie-server-[a-f0-9]{24}$/u);
    expect(ownership.name.length).toBeLessThanOrEqual(63);
    expect(Object.keys(ownership.labels)).toHaveLength(8);
    expect(
      Object.keys(ownership.labels).every((key) =>
        key.startsWith(HETZNER_OWNERSHIP_LABEL_PREFIX),
      ),
    ).toBe(true);
    expect(
      Object.values(ownership.labels).every(
        (value) =>
          value.length <= 63 &&
          /^[A-Za-z0-9](?:[A-Za-z0-9_.-]*[A-Za-z0-9])?$/u.test(value),
      ),
    ).toBe(true);
    expect(ownership.labels['wharfie.dev/deployment']).toMatch(
      /^wsnd1-[a-z2-7]{52}$/u,
    );
    expect(ownership.labels['wharfie.dev/incarnation']).toMatch(
      /^wsnc1-[a-z2-7]{52}$/u,
    );
    expect(ownership.labels['wharfie.dev/action']).toMatch(
      /^wsna1-[a-z2-7]{52}$/u,
    );
    expect(ownership.labels['wharfie.dev/nonce']).toMatch(
      /^sha256-[a-z2-7]{52}$/u,
    );
    expect(ownership.labels['wharfie.dev/spec']).toMatch(
      /^sha256-[a-z2-7]{52}$/u,
    );
    expect(Object.isFrozen(ownership)).toBe(true);
    expect(Object.isFrozen(ownership.labels)).toBe(true);
  });

  it('keeps a role name stable across action and desired-state retries', () => {
    const ownership = makeOwnership();
    const revised = makeOwnership({
      createdByActionId: createDomainSeparatedSha256Id({
        domain: 'wharfie:single-node-deployment-action:v1',
        prefix: 'wsna1',
        payload: 'another-create-action',
      }),
      ownershipNonce: sha256Base64Url('another-nonce'),
      desiredStateDigest: sha256Base64Url('another-specification'),
    });

    expect(revised.name).toBe(ownership.name);
    expect(revised.labels).not.toEqual(ownership.labels);
  });

  it('derives one full-width deployment inventory selector', () => {
    const ownership = makeOwnership();

    expect(
      getHetznerDeploymentLabelSelector(ownership.deploymentInstanceId),
    ).toBe(
      `wharfie.dev/deployment=${ownership.labels['wharfie.dev/deployment']}`,
    );
    expect(
      getHetznerDeploymentLabelSelector(ownership.deploymentInstanceId),
    ).toMatch(/^wharfie\.dev\/deployment=wsnd1-[a-z2-7]{52}$/u);
  });

  it.each([
    [
      'deployment placement',
      () => ({
        deploymentInstanceId: getSingleNodeDeploymentInstanceId(
          makeIntent({ provider: { kind: 'hetzner', location: 'hel1' } }),
        ),
      }),
    ],
    [
      'incarnation',
      () => ({
        incarnationId: createSingleNodeDeploymentIncarnationId(
          Buffer.alloc(32, 2),
        ),
      }),
    ],
    ['role', () => ({ role: 'firewall' })],
  ])('changes the stable name with %s', (_name, overrides) => {
    expect(makeOwnership(overrides()).name).not.toBe(makeOwnership().name);
  });

  it('validates serialized ownership by recomputing derived fields', () => {
    const ownership = makeOwnership();
    const serialized = JSON.parse(JSON.stringify(ownership));

    expect(validateHetznerOwnership(serialized)).toEqual(ownership);
    expect(Object.isFrozen(validateHetznerOwnership(serialized))).toBe(true);

    expect(() =>
      validateHetznerOwnership({ ...serialized, name: 'wrong-name' }),
    ).toThrow(/name does not match/u);
    expect(() =>
      validateHetznerOwnership({
        ...serialized,
        labels: {
          ...serialized.labels,
          'wharfie.dev/spec': serialized.labels['wharfie.dev/nonce'],
        },
      }),
    ).toThrow(/labels do not match/u);
  });

  it.each([
    ['ssh-key role', { role: 'ssh-key' }, /role/u],
    [
      'legacy incarnation',
      { incarnationId: `wic1_${'A'.repeat(43)}` },
      /wsnc1/u,
    ],
    [
      'legacy action',
      { createdByActionId: `wda3_${'A'.repeat(43)}` },
      /wsna1/u,
    ],
    ['short nonce', { ownershipNonce: 'short' }, /SHA-256 digest/u],
    ['short spec', { desiredStateDigest: 'short' }, /SHA-256 digest/u],
  ])('rejects %s', (_name, overrides, expected) => {
    expect(() => makeOwnership(overrides)).toThrow(expected);
  });

  it.each(['token', 'credentials', 'privateKey', 'cloudInit', 'userData'])(
    'does not accept a %s field or disclose its value',
    (field) => {
      const secret = 'must-not-appear-in-the-error';
      let thrown;
      try {
        makeOwnership({ [field]: secret });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(TypeError);
      expect(String(thrown)).not.toContain(secret);
    },
  );
});

describe('Hetzner ownership match classification', () => {
  it('reports authoritative zero-match absence with or without a stored ID', () => {
    const ownership = makeOwnership();

    expect(classify(ownership)).toEqual({
      status: 'absent',
      reason: null,
      matchCount: 0,
      providerResourceId: null,
    });
    expect(classify(ownership, { storedResourceId: 412_345 })).toEqual({
      status: 'absent',
      reason: null,
      matchCount: 0,
      providerResourceId: null,
    });
  });

  it('accepts one exact match for adoption or stored-ID readback', () => {
    const ownership = makeOwnership();
    const match = makeMatch(ownership);

    expect(classify(ownership, { matches: [match] })).toEqual({
      status: 'exact',
      reason: null,
      matchCount: 1,
      providerResourceId: match.id,
    });
    expect(
      classify(ownership, {
        storedResourceId: match.id,
        matches: [match],
      }),
    ).toEqual({
      status: 'exact',
      reason: null,
      matchCount: 1,
      providerResourceId: match.id,
    });
  });

  it('allows unrelated operator labels without returning any labels or names', () => {
    const ownership = makeOwnership();
    const sentinel = 'operator-data-that-must-not-be-returned';
    const match = makeMatch(ownership, {
      labels: {
        ...ownership.labels,
        'operator.example/environment': 'development',
        'operator.example/note': sentinel,
      },
    });

    const result = classify(ownership, { matches: [match] });

    expect(result.status).toBe('exact');
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result).not.toHaveProperty('labels');
    expect(result).not.toHaveProperty('name');
  });

  it('fails closed on multiple matches even when both appear exact', () => {
    const ownership = makeOwnership();

    expect(
      classify(ownership, {
        matches: [makeMatch(ownership), makeMatch(ownership, { id: 412_346 })],
      }),
    ).toEqual({
      status: 'conflict',
      reason: 'multiple-matches',
      matchCount: 2,
      providerResourceId: null,
    });
  });

  it.each([
    [
      'stored ID',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        storedResourceId: 9,
        matches: [makeMatch(ownership)],
      }),
      'stored-id-mismatch',
    ],
    [
      'name',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [makeMatch(ownership, { name: 'another-valid-name' })],
      }),
      'name-mismatch',
    ],
    [
      'unknown reserved label',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [
          makeMatch(ownership, {
            labels: {
              ...ownership.labels,
              'wharfie.dev/future-field': 'unexpected',
            },
          }),
        ],
      }),
      'unknown-ownership-label',
    ],
    [
      'desired-state spec',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [
          makeMatch(ownership, {
            labels: {
              ...ownership.labels,
              'wharfie.dev/spec': `sha256-${'a'.repeat(52)}`,
            },
          }),
        ],
      }),
      'spec-mismatch',
    ],
    [
      'missing desired-state spec',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => {
        const labels = { ...ownership.labels };
        delete labels['wharfie.dev/spec'];
        return { matches: [makeMatch(ownership, { labels })] };
      },
      'spec-mismatch',
    ],
    [
      'ownership label',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [
          makeMatch(ownership, {
            labels: {
              ...ownership.labels,
              'wharfie.dev/role': 'firewall',
            },
          }),
        ],
      }),
      'labels-mismatch',
    ],
    [
      'missing ownership label',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => {
        const labels = { ...ownership.labels };
        delete labels['wharfie.dev/action'];
        return { matches: [makeMatch(ownership, { labels })] };
      },
      'labels-mismatch',
    ],
  ])('classifies a %s conflict', (_name, input, reason) => {
    const ownership = makeOwnership();

    expect(classify(ownership, input(ownership))).toEqual({
      status: 'conflict',
      reason,
      matchCount: 1,
      providerResourceId: null,
    });
  });

  it('bounds matches and labels at the provider boundary', () => {
    const ownership = makeOwnership();
    const match = makeMatch(ownership);

    expect(() =>
      classify(ownership, {
        matches: Array.from(
          { length: HETZNER_OWNERSHIP_MAX_MATCHES + 1 },
          () => match,
        ),
      }),
    ).toThrow(/at most 64 entries/u);
    expect(() =>
      classify(ownership, {
        matches: [
          makeMatch(ownership, {
            labels: Object.fromEntries(
              Array.from(
                { length: HETZNER_OWNERSHIP_MAX_LABELS + 1 },
                (_, index) => [`operator.example/label-${index}`, 'value'],
              ),
            ),
          }),
        ],
      }),
    ).toThrow(/at most 64 labels/u);
  });

  it.each([
    [
      'string resource ID',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [makeMatch(ownership, { id: '412345' })],
      }),
    ],
    [
      'extra provider field',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [
          {
            ...makeMatch(ownership),
            privateKey: 'provider-secret-material',
          },
        ],
      }),
    ],
    [
      'invalid label value',
      /** @param {ReturnType<typeof makeOwnership>} ownership */
      (ownership) => ({
        matches: [
          makeMatch(ownership, {
            labels: {
              ...ownership.labels,
              'operator.example/note': 'ends-with-a-dash-',
            },
          }),
        ],
      }),
    ],
  ])('rejects a malformed %s projection', (_name, input) => {
    expect(() => classify(makeOwnership(), input(makeOwnership()))).toThrow();
  });

  it('does not disclose rejected projection data and freezes results', () => {
    const ownership = makeOwnership();
    const secret = 'projection-secret-that-must-not-appear';
    let thrown;
    try {
      classify(ownership, {
        matches: [{ ...makeMatch(ownership), cloudInit: secret }],
      });
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).not.toContain(secret);
    expect(Object.isFrozen(classify(ownership))).toBe(true);
    expect(HETZNER_OWNERSHIP_CONFLICT_REASONS).toEqual([
      'multiple-matches',
      'stored-id-mismatch',
      'name-mismatch',
      'unknown-ownership-label',
      'spec-mismatch',
      'labels-mismatch',
    ]);
    expect(Object.isFrozen(HETZNER_OWNERSHIP_CONFLICT_REASONS)).toBe(true);
  });
});
