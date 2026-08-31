/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import {
  APPLICATION_STATE_TABLE_NAME,
  DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
} from '../../src/core/lib/config/db.js';
import { EXECUTION_PAYLOAD_STORAGE_KIND } from '../../src/core/runtime/execution-payload.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
  RESIDENT_REPLACEMENT_INPUT_KIND,
  RESIDENT_REPLACEMENT_INPUT_MAX_BYTES,
  RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX,
  createResidentReplacementInputReceipt,
  decodeResidentReplacementInputReceipt,
  encodeResidentReplacementInputReceipt,
  validateResidentReplacementInputReceipt,
} from '../../src/core/runtime/resident-replacement-input.js';
import {
  createTestApplicationStateHistory,
  createTestApplicationStateTransport,
} from '../helpers/application-state-snapshot.js';

const APP_ID = 'replacement-input-app';
const PAYLOAD_STORE_ID = 'replacement-payloads';

/** @param {string} prefix @param {string} label @returns {string} */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:resident-replacement-input:${prefix}`,
    prefix,
    value: { label },
  });
}

/**
 * @param {Record<string, any>} [overrides]
 * @returns {Record<string, any>}
 */
function input(overrides = {}) {
  const applicationStateDestination = overrides.applicationStateDestination ?? {
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId: id('was', 'application-state'),
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: APP_ID,
    },
  };
  const value = {
    appId: APP_ID,
    currentRevisionId: id('wrv1', 'current-revision'),
    control: {
      profile: DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
      adapterName: 'dynamodb',
      region: 'us-east-2',
      tableName: 'wharfie-execution-ledger-v10',
      tableResourceId: id('wdtr1', 'table-incarnation'),
    },
    payloadStorage: {
      kind: EXECUTION_PAYLOAD_STORAGE_KIND,
      storeId: PAYLOAD_STORE_ID,
      distribution: {
        kind: EXECUTION_PAYLOAD_DISTRIBUTION_KIND,
        distributionId: id('wepd1', 'payload-distribution'),
        storeId: PAYLOAD_STORE_ID,
      },
    },
    applicationStateDestination,
    applicationStateTransport:
      overrides.applicationStateTransport ??
      createTestApplicationStateTransport({
        destination: applicationStateDestination,
        label: applicationStateDestination.configuration.storeId,
      }),
  };
  return {
    ...value,
    ...overrides,
  };
}

/** @param {any} value @returns {any} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

/** @param {any} value @returns {void} */
function expectDeeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('resident replacement input receipt', () => {
  it('binds one exact portable startup scope into a stable content receipt', () => {
    const first = createResidentReplacementInputReceipt(input());
    const reordered = createResidentReplacementInputReceipt({
      applicationStateDestination: input().applicationStateDestination,
      applicationStateTransport: input().applicationStateTransport,
      payloadStorage: input().payloadStorage,
      control: input().control,
      currentRevisionId: input().currentRevisionId,
      appId: APP_ID,
    });

    expect(first).toEqual(reordered);
    expect(first).toMatchObject({
      schemaVersion: 2,
      kind: RESIDENT_REPLACEMENT_INPUT_KIND,
      receiptId: expect.stringMatching(
        new RegExp(`^${RESIDENT_REPLACEMENT_INPUT_RECEIPT_ID_PREFIX}_`),
      ),
      appId: APP_ID,
      currentRevisionId: input().currentRevisionId,
      control: {
        profile: 'dynamodb-rvn-v1',
        adapterName: 'dynamodb',
        region: 'us-east-2',
        tableName: 'wharfie-execution-ledger-v10',
        tableResourceId: input().control.tableResourceId,
      },
      payloadStorage: {
        kind: 'wharfie.local-content-addressed.v1',
        storeId: PAYLOAD_STORE_ID,
        distribution: {
          kind: 'wharfie.execution-payload-distribution.v1',
          distributionId: input().payloadStorage.distribution.distributionId,
          storeId: PAYLOAD_STORE_ID,
        },
      },
      applicationStateDestination: input().applicationStateDestination,
      applicationStateTransport: input().applicationStateTransport,
    });
    expect(validateResidentReplacementInputReceipt(first)).toEqual(first);
    expectDeeplyFrozen(first);

    const serialized = JSON.stringify(first);
    expect(serialized).not.toMatch(
      /path|credential|secret|timestamp|observedAt|nodeId|renewalInterval|observationWindow|arn|accountId/iu,
    );
  });

  it.each([
    [
      'application revision',
      () => ({ currentRevisionId: id('wrv1', 'other-revision') }),
    ],
    [
      'table incarnation',
      () => ({
        control: {
          ...input().control,
          tableResourceId: id('wdtr1', 'other-table'),
        },
      }),
    ],
    [
      'payload distribution',
      () => ({
        payloadStorage: {
          ...input().payloadStorage,
          distribution: {
            ...input().payloadStorage.distribution,
            distributionId: id('wepd1', 'other-distribution'),
          },
        },
      }),
    ],
    [
      'application-state destination',
      () => ({
        applicationStateDestination: {
          ...input().applicationStateDestination,
          configuration: {
            ...input().applicationStateDestination.configuration,
            storeId: id('was', 'other-application-state'),
          },
        },
      }),
    ],
    [
      'application-state snapshot distribution',
      () => ({
        applicationStateTransport: {
          ...input().applicationStateTransport,
          distribution: {
            ...input().applicationStateTransport.distribution,
            distributionId: id('wasd1', 'other-snapshot-distribution'),
          },
        },
      }),
    ],
    [
      'application-state history checkpoint',
      () => ({
        applicationStateTransport: createTestApplicationStateTransport({
          destination: input().applicationStateDestination,
          label: input().applicationStateDestination.configuration.storeId,
          history: createTestApplicationStateHistory({
            appId: APP_ID,
            label: 'other-history',
          }),
        }),
      }),
    ],
    [
      'application-state snapshot bytes',
      () => ({
        applicationStateTransport: createTestApplicationStateTransport({
          destination: input().applicationStateDestination,
          label: input().applicationStateDestination.configuration.storeId,
          bytes: Buffer.from('different-application-state-snapshot', 'utf8'),
        }),
      }),
    ],
  ])('changes the receipt identity when the %s changes', (_label, change) => {
    const first = createResidentReplacementInputReceipt(input());
    const second = createResidentReplacementInputReceipt(input(change()));
    expect(second.receiptId).not.toBe(first.receiptId);
  });

  it('snapshots plain JSON data and rejects accessor or extra-field inputs', () => {
    const value = input();
    const receipt = createResidentReplacementInputReceipt(value);
    value.control.tableResourceId = id('wdtr1', 'mutated-after-create');
    value.payloadStorage.distribution.storeId = 'changed-payloads';
    expect(receipt).toEqual(validateResidentReplacementInputReceipt(receipt));

    const accessor = input();
    Object.defineProperty(accessor, 'appId', {
      enumerable: true,
      get() {
        throw new Error('must not invoke receipt accessors');
      },
    });
    expect(() => createResidentReplacementInputReceipt(accessor)).toThrow(
      /plain JSON property/i,
    );

    expect(() =>
      createResidentReplacementInputReceipt({
        ...input(),
        observedAt: 1,
      }),
    ).toThrow(/unsupported or missing fields/i);
    const missing = input();
    delete missing.payloadStorage;
    expect(() => createResidentReplacementInputReceipt(missing)).toThrow(
      /unsupported or missing fields/i,
    );
  });

  it.each([
    [
      'control profile',
      (/** @type {Record<string, any>} */ value) => {
        value.control.profile = 'timestamp-lease-v0';
      },
      /profile/u,
    ],
    [
      'control adapter',
      (/** @type {Record<string, any>} */ value) => {
        value.control.adapterName = 'lmdb';
      },
      /adapterName/u,
    ],
    [
      'control region',
      (/** @type {Record<string, any>} */ value) => {
        value.control.region = 'US EAST 2';
      },
      /AWS Region/u,
    ],
    [
      'control table',
      (/** @type {Record<string, any>} */ value) => {
        value.control.tableName = 'x';
      },
      /DynamoDB table name/u,
    ],
    [
      'table resource',
      (/** @type {Record<string, any>} */ value) => {
        value.control.tableResourceId = id('wdtr2', 'wrong-kind');
      },
      /wdtr1/u,
    ],
    [
      'payload storage kind',
      (/** @type {Record<string, any>} */ value) => {
        value.payloadStorage.kind = 'mutable-files.v0';
      },
      /local-content-addressed/u,
    ],
    [
      'distribution kind',
      (/** @type {Record<string, any>} */ value) => {
        value.payloadStorage.distribution.kind = 'copy.v0';
      },
      /execution-payload-distribution/u,
    ],
    [
      'distribution identity',
      (/** @type {Record<string, any>} */ value) => {
        value.payloadStorage.distribution.distributionId = id(
          'wepd2',
          'wrong-kind',
        );
      },
      /wepd1/u,
    ],
    [
      'distribution store',
      (/** @type {Record<string, any>} */ value) => {
        value.payloadStorage.distribution.storeId = 'other-payloads';
      },
      /must match/u,
    ],
    [
      'application namespace',
      (/** @type {Record<string, any>} */ value) => {
        value.applicationStateDestination.configuration.namespace = 'other-app';
      },
      /namespace must match appId/u,
    ],
  ])('rejects a mismatched %s', (_label, mutate, message) => {
    const value = input();
    mutate(value);
    expect(() => createResidentReplacementInputReceipt(value)).toThrow(message);
  });

  it('recomputes the receipt identity instead of trusting serialized fields', () => {
    const receipt = createResidentReplacementInputReceipt(input());
    const changed = clone(receipt);
    changed.control.tableResourceId = id('wdtr1', 'tampered-table');
    expect(() => validateResidentReplacementInputReceipt(changed)).toThrow(
      /does not match its exact replacement inputs/u,
    );

    const extra = { ...clone(receipt), path: '/private/startup.json' };
    expect(() => validateResidentReplacementInputReceipt(extra)).toThrow(
      /unsupported or missing fields/u,
    );
  });

  it('uses one bounded canonical byte spelling for durable handoff', () => {
    const receipt = createResidentReplacementInputReceipt(input());
    const bytes = encodeResidentReplacementInputReceipt(receipt);
    expect(bytes.byteLength).toBeLessThan(RESIDENT_REPLACEMENT_INPUT_MAX_BYTES);
    expect(decodeResidentReplacementInputReceipt(bytes)).toEqual(receipt);

    const pretty = Buffer.from(JSON.stringify(receipt, null, 2), 'utf8');
    expect(() => decodeResidentReplacementInputReceipt(pretty)).toThrow(
      /canonical compact JSON/u,
    );
    expect(() =>
      decodeResidentReplacementInputReceipt(
        Buffer.alloc(RESIDENT_REPLACEMENT_INPUT_MAX_BYTES + 1),
      ),
    ).toThrow(/must not exceed/u);
    expect(() =>
      decodeResidentReplacementInputReceipt(Buffer.from([0xc3, 0x28])),
    ).toThrow(/well-formed UTF-8/u);
  });
});
