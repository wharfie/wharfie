/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import {
  EffectStatus,
  EXECUTION_LEDGER_SCHEMA_VERSION,
  MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA,
  MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA,
  MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA,
  createManagedEffectDestinationId,
} from '../../src/core/lib/ledger/execution-ledger-contract.js';
import { createManagedEffectSuccessorAuthorization } from '../../src/core/lib/ledger/managed-effect-successor-contract.js';
import {
  APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
  APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
  APPLICATION_STATE_HISTORY_DIGEST_DOMAIN,
  APPLICATION_STATE_HISTORY_DIGEST_PREFIX,
  assertSettledApplicationStateHistory,
  inventoryApplicationStateHistory,
  validateApplicationStateHistoryCheckpoint,
} from '../../src/core/runtime/application-state-history-checkpoint.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  createExecutionPayloadReference,
  encodeCanonicalJsonPayload,
} from '../../src/core/runtime/execution-payload.js';
import {
  APPLICATION_STATE_ADAPTER_DESCRIPTOR,
  APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR,
  APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
  APPLICATION_STATE_VERIFIER_DESCRIPTOR,
} from '../../src/core/runtime/effects/application-state.js';

const APP_ID = 'application-state-history';
const REVISION_ID = fixtureId('wrv1', 'revision');
const PAYLOAD_STORE_ID = 'application-state-history-payloads';
const PRIMARY_DESTINATION = destination(fixtureId('was', 'primary'));
const SECONDARY_DESTINATION = destination(fixtureId('was', 'secondary'));

/** @param {string} prefix @param {unknown} value @returns {string} */
function fixtureId(prefix, value) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:application-state-history:${prefix}:v1`,
    prefix,
    value,
  });
}

/** @param {string} storeId @returns {Record<string, any>} */
function destination(storeId) {
  return {
    kind: 'application-state',
    version: 2,
    bindingId: 'primary',
    configuration: {
      provider: 'lmdb',
      storeId,
      tableName: APPLICATION_STATE_TABLE_NAME,
      namespace: APP_ID,
    },
  };
}

/** @param {string} payloadSchema @param {unknown} value */
function payloadReference(payloadSchema, value) {
  return createExecutionPayloadReference({
    bytes: encodeCanonicalJsonPayload(value),
    payloadSchema,
    storeId: PAYLOAD_STORE_ID,
  });
}

/** @param {string} attemptId @param {boolean} [includesProtocolSequence] @returns {Record<string, any>} */
function attemptBinding(attemptId, includesProtocolSequence = false) {
  return {
    attemptId,
    generation: 1,
    coordinatorEpoch: 3,
    fencingToken: `fence-${attemptId}`,
    ...(includesProtocolSequence ? { protocolSequence: 1 } : {}),
  };
}

/**
 * @typedef {{runId?: string, invocationId?: string, effectId?: string, status?: string, effectDestination?: Record<string, any>, requestValue?: string, outcomeValue?: string, reconciliationReason?: unknown}} EffectOptions
 */

/** @param {EffectOptions} [options] @returns {Record<string, any>} */
function applicationStateEffect(options = {}) {
  const runId = options.runId ?? 'run-a';
  const invocationId = options.invocationId ?? `invocation-${runId}`;
  const effectId = options.effectId ?? 'effect-a';
  const status = options.status ?? EffectStatus.COMPLETED;
  const effectDestination = options.effectDestination ?? PRIMARY_DESTINATION;
  const requestValue = options.requestValue ?? 'request-a';
  const outcomeValue = options.outcomeValue ?? 'outcome-a';
  const reconciliationReason = options.reconciliationReason;
  const attemptId = `attempt-${effectId}`;
  const requestedBy = attemptBinding(attemptId, true);
  const startedBy = attemptBinding(attemptId);
  const outcomeRef = payloadReference(MANAGED_EFFECT_OUTCOME_PAYLOAD_SCHEMA, {
    outcomeValue,
  });
  /** @type {Record<string, any>} */
  const effect = {
    schemaVersion: EXECUTION_LEDGER_SCHEMA_VERSION,
    runId,
    invocationId,
    effectId,
    appId: APP_ID,
    revisionId: REVISION_ID,
    activityId: 'write-state',
    destinationEffectId: createManagedEffectDestinationId({
      appId: APP_ID,
      runId,
      invocationId,
      effectId,
    }),
    adapter: { ...APPLICATION_STATE_ADAPTER_DESCRIPTOR },
    destination: structuredClone(effectDestination),
    verifier: { ...APPLICATION_STATE_VERIFIER_DESCRIPTOR },
    requestRef: payloadReference(MANAGED_EFFECT_REQUEST_PAYLOAD_SCHEMA, {
      requestValue,
    }),
    requestedReplayProperties: [
      ...APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ],
    substantiatedReplayProperties: [
      ...APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
    ],
    requestedBy,
    status,
    version: 4,
    lastSequence: 8,
    createdAt: 100,
    updatedAt: 200,
  };

  if (status === EffectStatus.STARTED) {
    effect.startedBy = startedBy;
  } else if (
    status === EffectStatus.COMPLETED ||
    status === EffectStatus.FAILED
  ) {
    effect.startedBy = startedBy;
    effect.terminal = { ok: status === EffectStatus.COMPLETED };
    effect.outcomeRef = outcomeRef;
  } else if (status === EffectStatus.CANCELLED) {
    effect.cancellation = { reason: 'cancelled-before-start' };
  } else if (status === EffectStatus.UNCERTAIN) {
    effect.startedBy = startedBy;
    effect.uncertainty = { reason: 'destination-result-unknown' };
  } else if (status === EffectStatus.NOT_APPLIED) {
    effect.startedBy = startedBy;
  }

  if (
    status === EffectStatus.NOT_APPLIED ||
    reconciliationReason !== undefined
  ) {
    const evidenceRef =
      status === EffectStatus.NOT_APPLIED
        ? payloadReference(
            MANAGED_EFFECT_RECONCILIATION_EVIDENCE_PAYLOAD_SCHEMA,
            { disposition: 'not-applied' },
          )
        : outcomeRef;
    effect.reconciliation = {
      reconciliationId: `reconciliation-${effectId}`,
      invocationId,
      attemptId,
      effectId,
      generation: 1,
      coordinatorEpoch: 3,
      fencingToken: `fence-${attemptId}`,
      uncertaintyEventId: `uncertainty-${effectId}`,
      uncertaintySequence: 7,
      verifier:
        status === EffectStatus.NOT_APPLIED
          ? { ...APPLICATION_STATE_RECONCILIATION_VERIFIER_DESCRIPTOR }
          : { ...APPLICATION_STATE_VERIFIER_DESCRIPTOR },
      evidenceRef,
      resolutionStatus: status,
      reason: reconciliationReason ?? { code: 'permanent-not-applied' },
    };
  }
  return effect;
}

/** @param {string} runId @param {Record<string, any>[]} [effects] @param {Record<string, any>} [trigger] */
function runView(runId, effects = [], trigger = { kind: 'manual' }) {
  return {
    run: {
      runId,
      appId: APP_ID,
      revisionId: REVISION_ID,
      status: 'COMPLETED',
      trigger,
    },
    effects,
  };
}

/** @param {any[]} pages @param {Record<string, Record<string, any>>} [views] */
function history(pages, views = {}) {
  let page = 0;
  return {
    listRuns: jest.fn(async () => pages[page++]),
    rebuildRun: jest.fn(async (/** @type {string} */ runId) => views[runId]),
  };
}

/** @param {Record<string, Record<string, any>>} views */
function onePageHistory(views) {
  return history(
    [
      {
        items: Object.keys(views).map((runId) => ({
          appId: APP_ID,
          runId,
        })),
      },
    ],
    views,
  );
}

/** @param {Record<string, Record<string, any>>} views */
async function inventoryViews(views) {
  return await inventoryApplicationStateHistory({
    ledger: onePageHistory(views),
    appId: APP_ID,
  });
}

/** @param {Record<string, any>} [effectDestination] @returns {Record<string, any>} */
function successorAuthorization(effectDestination = PRIMARY_DESTINATION) {
  return createManagedEffectSuccessorAuthorization({
    appId: APP_ID,
    revisionId: REVISION_ID,
    successorId: 'successor-a',
    reason: { code: 'operator-approved-retry' },
    source: {
      runId: 'source-run',
      invocationId: 'source-invocation',
      attemptId: 'source-attempt',
      effectId: 'source-effect',
      uncertaintyEventId: 'source-uncertainty-event',
      uncertaintySequence: 5,
      reconciliationEventId: 'source-reconciliation-event',
      reconciliationSequence: 7,
      reconciliationId: 'source-reconciliation',
      disposition: 'NOT_APPLIED',
    },
    contract: {
      adapter: { ...APPLICATION_STATE_ADAPTER_DESCRIPTOR },
      destination: structuredClone(effectDestination),
      verifier: { ...APPLICATION_STATE_VERIFIER_DESCRIPTOR },
      substantiatedReplayProperties: [
        ...APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
      ],
    },
    request: {
      capability: 'application-state',
      operation: 'put-if-absent',
      input: { key: 'successor-key', value: 'successor-value' },
      requestedReplayProperties: [
        ...APPLICATION_STATE_SUBSTANTIATED_REPLAY_PROPERTIES,
      ],
    },
  });
}

describe('application-state history checkpoint inventory', () => {
  test('is independent of page, run, and effect ordering', async () => {
    const effectA = applicationStateEffect({
      runId: 'run-a',
      effectId: 'effect-a',
    });
    const effectB = applicationStateEffect({
      runId: 'run-a',
      effectId: 'effect-b',
    });
    const effectC = applicationStateEffect({
      runId: 'run-b',
      effectId: 'effect-c',
    });
    const forward = history(
      [
        {
          items: [{ appId: APP_ID, runId: 'run-a' }],
          nextCursor: 'page-two',
        },
        { items: [{ appId: APP_ID, runId: 'run-b' }] },
      ],
      {
        'run-a': runView('run-a', [effectA, effectB]),
        'run-b': runView('run-b', [effectC]),
      },
    );
    const reverse = onePageHistory({
      'run-b': runView('run-b', [effectC]),
      'run-a': runView('run-a', [effectB, effectA]),
    });

    const first = await inventoryApplicationStateHistory({
      ledger: forward,
      appId: APP_ID,
    });
    const second = await inventoryApplicationStateHistory({
      ledger: reverse,
      appId: APP_ID,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: APPLICATION_STATE_HISTORY_CHECKPOINT_SCHEMA_VERSION,
      kind: APPLICATION_STATE_HISTORY_CHECKPOINT_KIND,
      appId: APP_ID,
      visitedRuns: 2,
      applicationStateEffects: 3,
      unsettledEffects: 0,
    });
    expect(first.historyDigest).toMatch(
      new RegExp(`^${APPLICATION_STATE_HISTORY_DIGEST_PREFIX}_[\\w-]{43}$`),
    );
    expect(APPLICATION_STATE_HISTORY_DIGEST_DOMAIN).toBe(
      'wharfie:application-state:history-checkpoint:v1',
    );
    expect(Object.isFrozen(first)).toBe(true);
  });

  test.each([
    ['status', { status: EffectStatus.FAILED }],
    ['destination', { effectDestination: SECONDARY_DESTINATION }],
    ['request reference', { requestValue: 'changed-request' }],
    ['outcome reference', { outcomeValue: 'changed-outcome' }],
    [
      'reconciliation',
      { reconciliationReason: { code: 'changed-reconciliation' } },
    ],
  ])('changes the digest when %s changes', async (_label, mutation) => {
    const base = await inventoryViews({
      'run-a': runView('run-a', [
        applicationStateEffect({
          reconciliationReason: { code: 'original-reconciliation' },
        }),
      ]),
    });
    const changed = await inventoryViews({
      'run-a': runView('run-a', [
        applicationStateEffect({
          reconciliationReason: { code: 'original-reconciliation' },
          ...mutation,
        }),
      ]),
    });

    expect(changed.historyDigest).not.toBe(base.historyDigest);
  });

  test('counts PENDING, STARTED, and UNCERTAIN conservatively and rejects unsettled history', async () => {
    const summary = await inventoryViews({
      'run-a': runView('run-a', [
        applicationStateEffect({
          effectId: 'pending-effect',
          status: EffectStatus.PENDING,
        }),
        applicationStateEffect({
          effectId: 'started-effect',
          status: EffectStatus.STARTED,
        }),
        applicationStateEffect({
          effectId: 'uncertain-effect',
          status: EffectStatus.UNCERTAIN,
        }),
      ]),
    });

    expect(summary).toMatchObject({
      applicationStateEffects: 3,
      unsettledEffects: 3,
    });
    expect(() => assertSettledApplicationStateHistory(summary)).toThrow(
      /3 unsettled effect/i,
    );
  });

  test('accepts terminal and permanently not-applied effects as settled', async () => {
    const summary = await inventoryViews({
      'run-a': runView('run-a', [
        applicationStateEffect({ effectId: 'completed-effect' }),
        applicationStateEffect({
          effectId: 'not-applied-effect',
          status: EffectStatus.NOT_APPLIED,
        }),
        applicationStateEffect({
          effectId: 'cancelled-effect',
          status: EffectStatus.CANCELLED,
        }),
      ]),
    });

    expect(assertSettledApplicationStateHistory(summary)).toEqual(summary);
    expect(summary.unsettledEffects).toBe(0);
  });

  test('binds an authorization-only application-state successor destination', async () => {
    const primary = successorAuthorization(PRIMARY_DESTINATION);
    const secondary = successorAuthorization(SECONDARY_DESTINATION);
    const primarySummary = await inventoryViews({
      [primary.target.runId]: runView(primary.target.runId, [], primary),
    });
    const secondarySummary = await inventoryViews({
      [secondary.target.runId]: runView(secondary.target.runId, [], secondary),
    });
    const omittedSummary = await inventoryViews({
      [primary.target.runId]: runView(primary.target.runId),
    });

    expect(primarySummary).toMatchObject({
      visitedRuns: 1,
      applicationStateEffects: 0,
      unsettledEffects: 0,
    });
    expect(primarySummary.historyDigest).not.toBe(
      secondarySummary.historyDigest,
    );
    expect(primarySummary.historyDigest).not.toBe(omittedSummary.historyDigest);
  });

  test('ignores an unrelated effect-successor without interpreting its destination', async () => {
    const unrelated = {
      kind: 'effect-successor',
      contract: {
        adapter: { id: 'unrelated-adapter', version: 1 },
        destination: {
          kind: 'unrelated-destination',
          version: 1,
          bindingId: 'primary',
          configuration: {},
        },
        verifier: { kind: 'unrelated-verifier', version: 1 },
      },
    };
    const ignored = await inventoryViews({
      'run-a': runView('run-a', [], unrelated),
    });
    const manual = await inventoryViews({
      'run-a': runView('run-a'),
    });

    expect(ignored).toEqual(manual);
  });

  test('strictly validates summary fields, digest spelling, and counts', async () => {
    const summary = await inventoryViews({});
    expect(validateApplicationStateHistoryCheckpoint(summary)).toEqual(summary);

    expect(() =>
      validateApplicationStateHistoryCheckpoint({ ...summary, extra: true }),
    ).toThrow(/exactly/i);
    expect(() =>
      validateApplicationStateHistoryCheckpoint({
        ...summary,
        historyDigest: `${APPLICATION_STATE_HISTORY_DIGEST_PREFIX}_bad`,
      }),
    ).toThrow(/canonical wash1/i);
    expect(() =>
      validateApplicationStateHistoryCheckpoint({
        ...summary,
        applicationStateEffects: 0,
        unsettledEffects: 1,
      }),
    ).toThrow(/cannot exceed/i);
  });

  test.each([
    ['malformed page', history([{ items: 'not-an-array' }])],
    [
      'malformed effects view',
      onePageHistory({
        'run-a': { ...runView('run-a'), effects: {} },
      }),
    ],
    [
      'malformed effect reference',
      onePageHistory({
        'run-a': runView('run-a', [
          { ...applicationStateEffect(), requestRef: { mutable: true } },
        ]),
      }),
    ],
    [
      'partial application-state successor',
      onePageHistory({
        'run-a': runView('run-a', [], {
          kind: 'effect-successor',
          contract: { destination: { kind: 'application-state' } },
        }),
      }),
    ],
  ])('rejects %s', async (_label, ledger) => {
    await expect(
      inventoryApplicationStateHistory({ ledger, appId: APP_ID }),
    ).rejects.toThrow();
  });

  test('propagates abort before reading history', async () => {
    const controller = new AbortController();
    const reason = new Error('stop application-state inventory');
    controller.abort(reason);
    const ledger = history([{ items: [] }]);

    await expect(
      inventoryApplicationStateHistory({
        ledger,
        appId: APP_ID,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(ledger.listRuns).not.toHaveBeenCalled();
    expect(ledger.rebuildRun).not.toHaveBeenCalled();
  });
});
