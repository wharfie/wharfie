import { describe, expect, it } from '@jest/globals';

import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_BYTES,
  AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_DURATION_MS,
  AwsSingleNodeRetainedStorageProviderExperimentInactiveError,
  createAwsSingleNodeRetainedStorageProviderExperiment,
  getAwsSingleNodeRetainedStorageProviderExperimentTags,
  validateAwsSingleNodeRetainedStorageProviderExperiment,
  validateAwsSingleNodeRetainedStorageProviderExperimentWindow,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-provider-experiment.js';

const SOURCE_COMMIT = 'a'.repeat(40);
const NOT_BEFORE = '2026-07-25T12:00:00.000Z';
const EXPIRES_AT = '2026-07-25T18:00:00.000Z';
const PROVIDER_SCOPE_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:retained-storage-experiment-scope:v1',
  prefix: 'wps1',
  value: { scope: 1 },
});
const PROVIDER_SPEC_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:retained-storage-experiment-spec:v1',
  prefix: 'wap6',
  value: { spec: 1 },
});

/** @param {any} value @returns {any} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Partial<Record<string, any>>} [overrides] @returns {Readonly<Record<string, any>>} */
function createExperiment(overrides = {}) {
  return createAwsSingleNodeRetainedStorageProviderExperiment({
    sourceCommit: SOURCE_COMMIT,
    providerScopeId: PROVIDER_SCOPE_ID,
    providerSpecId: PROVIDER_SPEC_ID,
    volumeRole: 'application-state',
    notBefore: NOT_BEFORE,
    expiresAt: EXPIRES_AT,
    ...overrides,
  });
}

describe('AWS retained-storage provider experiment', () => {
  it('creates one strict, content-addressed, non-authorizing descriptor', () => {
    const experiment = createExperiment();

    expect(experiment).toEqual({
      authority: 'none',
      expiresAt: EXPIRES_AT,
      experimentId: expect.stringMatching(/^wre1_[A-Za-z0-9_-]{43}$/),
      kind: 'awsSingleNodeRetainedStorageProviderExperiment',
      notBefore: NOT_BEFORE,
      providerScopeId: PROVIDER_SCOPE_ID,
      providerSpecId: PROVIDER_SPEC_ID,
      purpose: 'retained-storage-provider-qualification',
      schemaVersion: 1,
      sourceCommit: SOURCE_COMMIT,
      volumeRole: 'application-state',
    });
    expectDeepFrozen(experiment);
  });

  it('validates a deserialized receipt into a new deeply frozen value', () => {
    const experiment = createExperiment();
    const deserialized = clone(experiment);
    const validated =
      validateAwsSingleNodeRetainedStorageProviderExperiment(deserialized);

    expect(validated).toEqual(experiment);
    expect(validated).not.toBe(deserialized);
    expectDeepFrozen(validated);
  });

  it('rejects payload tampering, extra keys, accessors, and oversized input', () => {
    const experiment = createExperiment();
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderExperiment({
        ...experiment,
        volumeRole: 'control-state',
      }),
    ).toThrow(/ID does not match/i);
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderExperiment({
        ...experiment,
        extra: true,
      }),
    ).toThrow(/exact required keys/i);

    const accessor = clone(experiment);
    Object.defineProperty(accessor, 'sourceCommit', {
      enumerable: true,
      get() {
        return SOURCE_COMMIT;
      },
    });
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderExperiment(accessor),
    ).toThrow(/plain JSON property/i);

    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderExperiment({
        ...experiment,
        sourceCommit: 'a'.repeat(
          AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_BYTES,
        ),
      }),
    ).toThrow(/must not exceed/i);
    expect(() =>
      createExperiment({
        extra: 'a'.repeat(
          AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_BYTES,
        ),
      }),
    ).toThrow(/must not exceed/i);
  });

  it.each([
    ['uppercase commit', { sourceCommit: 'A'.repeat(40) }],
    ['short commit', { sourceCommit: 'a'.repeat(39) }],
    ['wrong scope prefix', { providerScopeId: PROVIDER_SPEC_ID }],
    ['wrong spec prefix', { providerSpecId: PROVIDER_SCOPE_ID }],
    ['unsupported role', { volumeRole: 'scratch' }],
    ['noncanonical start', { notBefore: '2026-07-25T12:00:00Z' }],
    ['noncanonical end', { expiresAt: '2026-07-25T18:00:00Z' }],
  ])('rejects %s', (_label, overrides) => {
    expect(() => createExperiment(overrides)).toThrow();
  });

  it('requires a positive window no longer than six hours', () => {
    expect(Date.parse(EXPIRES_AT) - Date.parse(NOT_BEFORE)).toBe(
      AWS_SINGLE_NODE_RETAINED_STORAGE_PROVIDER_EXPERIMENT_MAX_DURATION_MS,
    );
    expect(() => createExperiment()).not.toThrow();
    expect(() => createExperiment({ expiresAt: NOT_BEFORE })).toThrow(
      /positive/i,
    );
    expect(() =>
      createExperiment({ expiresAt: '2026-07-25T18:00:00.001Z' }),
    ).toThrow(/six hours/i);
  });

  it('accepts only the half-open active window', () => {
    const experiment = createExperiment();
    const start = Date.parse(NOT_BEFORE);
    const end = Date.parse(EXPIRES_AT);

    expect(
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        start,
      ),
    ).toEqual(experiment);
    expect(
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        end - 1,
      ),
    ).toEqual(experiment);
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        start - 1,
      ),
    ).toThrow(AwsSingleNodeRetainedStorageProviderExperimentInactiveError);
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
        experiment,
        end,
      ),
    ).toThrow(AwsSingleNodeRetainedStorageProviderExperimentInactiveError);
  });

  it('rejects malformed clocks without provider-dependent diagnostics', () => {
    const experiment = createExperiment();
    for (const now of [-1, 1.5, Number.NaN, 'now', null]) {
      expect(() =>
        validateAwsSingleNodeRetainedStorageProviderExperimentWindow(
          experiment,
          now,
        ),
      ).toThrow(/clock/i);
    }
  });

  it('derives exact frozen purge tags without production-state ownership', () => {
    const experiment = createExperiment();
    const tags =
      getAwsSingleNodeRetainedStorageProviderExperimentTags(experiment);

    expect(tags.instance).toMatchObject({
      'wharfie:managed-by': 'wharfie',
      'wharfie:resource-kind': 'retained-storage-evidence-host',
      'wharfie:retention': 'purge',
      'wharfie:schema-version': '1',
      'wharfie:evidence-experiment-id': experiment.experimentId,
      'wharfie:evidence-purpose': 'retained-storage-provider-qualification',
      'wharfie:evidence-source-commit': SOURCE_COMMIT,
      'wharfie:evidence-expires-at': EXPIRES_AT,
    });
    expect(tags.rootVolume['wharfie:resource-kind']).toBe(
      'retained-storage-evidence-root-volume',
    );
    expect(tags.evidenceVolume).toMatchObject({
      'wharfie:resource-kind': 'retained-storage-evidence-volume',
      'wharfie:evidence-volume-role': 'application-state',
      'wharfie:retention': 'purge',
    });
    expect(tags.instance).not.toHaveProperty('wharfie:ownership-nonce');
    expect(tags.evidenceVolume).not.toHaveProperty(
      'wharfie:created-by-action-id',
    );
    expectDeepFrozen(tags);
  });

  it('binds IDs and volume tags to the exact role and window', () => {
    const application = createExperiment();
    const control = createExperiment({ volumeRole: 'control-state' });
    const shorter = createExperiment({
      expiresAt: '2026-07-25T17:59:59.999Z',
    });

    expect(control.experimentId).not.toBe(application.experimentId);
    expect(shorter.experimentId).not.toBe(application.experimentId);
    expect(
      getAwsSingleNodeRetainedStorageProviderExperimentTags(control)
        .evidenceVolume['wharfie:evidence-volume-role'],
    ).toBe('control-state');
  });
});
