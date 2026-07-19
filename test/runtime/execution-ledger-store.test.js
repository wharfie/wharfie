/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const LEDGER_SERVICE_IMPORT =
  '../../src/core/runtime/services/ledger-service.js';
const DB_CONFIG_IMPORT = '../../src/core/lib/config/db.js';
const EXECUTION_LEDGER_STORE_IMPORT =
  '../../src/core/runtime/operator/execution-ledger-store.js';

/** @type {ReturnType<typeof jest.fn>} */
let acquireLocalLedgerServiceSession;
/** @type {ReturnType<typeof jest.fn>} */
let createControlDBClient;
/** @type {Function} */
let withExecutionLedger;
/** @type {Function} */
let withLocalLedgerServiceMutationOwnership;

beforeEach(async () => {
  jest.resetModules();
  acquireLocalLedgerServiceSession = jest.fn();
  createControlDBClient = jest.fn();
  jest.unstable_mockModule(LEDGER_SERVICE_IMPORT, () => ({
    acquireLocalLedgerServiceSession,
  }));
  jest.unstable_mockModule(DB_CONFIG_IMPORT, () => ({
    APPLICATION_STATE_TABLE_NAME: 'wharfie-application-state-v2',
    createControlDBClient,
    resolveControlAdapterName: () => 'lmdb',
    resolveControlStorePath: () => '/control',
    resolveExecutionLedgerTableName: () => 'execution-ledger-test',
    resolveExecutionPayloadPath: () => '/payloads',
    resolveExecutionPayloadStoreId: () => 'payload-store-test',
    resolveLedgerServiceSessionPath: () => '/sessions',
  }));
  ({ withExecutionLedger, withLocalLedgerServiceMutationOwnership } =
    await import(EXECUTION_LEDGER_STORE_IMPORT));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

/** @param {() => Promise<unknown>} handler */
function ownershipOptions(handler) {
  return {
    appId: 'operator-cleanup-test',
    context: {
      db: {
        get: jest.fn(),
        transactionWrite: jest.fn(),
      },
      adapterName: 'lmdb',
      controlPath: '/control',
      tableName: 'operator-cleanup-test',
      sessionPath: '/sessions',
      readOnly: false,
    },
    handler,
  };
}

function executionLedgerConfiguration() {
  return Object.freeze({
    adapterName: /** @type {const} */ ('lmdb'),
    controlPath: '/control',
    tableName: 'execution-ledger-test',
    payloadPath: '/payloads',
    payloadStoreId: 'payload-store-test',
    sessionPath: '/sessions',
  });
}

describe('execution-ledger control-store cleanup', () => {
  it('closes the DB and preserves a handler-only non-Error failure', async () => {
    /** @type {string[]} */
    const order = [];
    const handlerFailure = Object.freeze({ kind: 'handler-failure' });
    const close = jest.fn(async () => {
      order.push('close');
    });
    createControlDBClient.mockResolvedValue({
      transactionWrite: jest.fn(),
      close,
    });

    const result = withExecutionLedger(
      async (
        /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */ ledger,
        /** @type {Record<string, any>} */ context,
      ) => {
        order.push('handler');
        expect(typeof ledger.rebuildRun).toBe('function');
        expect(context).toMatchObject({
          adapterName: 'lmdb',
          controlPath: '/control',
          readOnly: false,
        });
        throw handlerFailure;
      },
      { configuration: executionLedgerConfiguration() },
    );

    await expect(result).rejects.toBe(handlerFailure);
    expect(order).toEqual(['handler', 'close']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('reports a close-only failure after returning from the handler', async () => {
    /** @type {string[]} */
    const order = [];
    const closeFailure = new Error('control-store close failed');
    const close = jest.fn(async () => {
      order.push('close');
      throw closeFailure;
    });
    createControlDBClient.mockResolvedValue({
      transactionWrite: jest.fn(),
      close,
    });

    const result = withExecutionLedger(
      async () => {
        order.push('handler');
        return 'completed';
      },
      { configuration: executionLedgerConfiguration() },
    );

    await expect(result).rejects.toBe(closeFailure);
    expect(order).toEqual(['handler', 'close']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('aggregates handler and close failures in causal order', async () => {
    /** @type {string[]} */
    const order = [];
    const handlerFailure = Object.freeze({ kind: 'handler-failure' });
    const closeFailure = new Error('control-store close failed');
    const close = jest.fn(async () => {
      order.push('close');
      throw closeFailure;
    });
    createControlDBClient.mockResolvedValue({
      transactionWrite: jest.fn(),
      close,
    });

    let reported;
    try {
      await withExecutionLedger(
        async () => {
          order.push('handler');
          throw handlerFailure;
        },
        { configuration: executionLedgerConfiguration() },
      );
    } catch (error) {
      reported = error;
    }

    expect(reported).toBeInstanceOf(AggregateError);
    expect(reported).toMatchObject({
      message:
        'Execution-ledger operation and control-store close both failed.',
    });
    expect(/** @type {AggregateError} */ (reported).errors).toEqual([
      handlerFailure,
      closeFailure,
    ]);
    expect(order).toEqual(['handler', 'close']);
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('local execution-ledger mutation ownership cleanup', () => {
  it('releases ownership and preserves a handler-only non-Error failure', async () => {
    /** @type {string[]} */
    const order = [];
    const handlerFailure = Object.freeze({ kind: 'handler-failure' });
    const release = jest.fn(async () => {
      order.push('release');
    });
    acquireLocalLedgerServiceSession.mockResolvedValue({ release });

    const result = withLocalLedgerServiceMutationOwnership(
      ownershipOptions(async () => {
        order.push('handler');
        throw handlerFailure;
      }),
    );

    await expect(result).rejects.toBe(handlerFailure);
    expect(order).toEqual(['handler', 'release']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('reports a release-only failure after a successful handler', async () => {
    /** @type {string[]} */
    const order = [];
    const releaseFailure = new Error('ownership release failed');
    const release = jest.fn(async () => {
      order.push('release');
      throw releaseFailure;
    });
    acquireLocalLedgerServiceSession.mockResolvedValue({ release });

    const result = withLocalLedgerServiceMutationOwnership(
      ownershipOptions(async () => {
        order.push('handler');
        return 'completed';
      }),
    );

    await expect(result).rejects.toBe(releaseFailure);
    expect(order).toEqual(['handler', 'release']);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('aggregates handler and release failures in causal order', async () => {
    /** @type {string[]} */
    const order = [];
    const handlerFailure = Object.freeze({ kind: 'handler-failure' });
    const releaseFailure = new Error('ownership release failed');
    const release = jest.fn(async () => {
      order.push('release');
      throw releaseFailure;
    });
    acquireLocalLedgerServiceSession.mockResolvedValue({ release });

    let reported;
    try {
      await withLocalLedgerServiceMutationOwnership(
        ownershipOptions(async () => {
          order.push('handler');
          throw handlerFailure;
        }),
      );
    } catch (error) {
      reported = error;
    }

    expect(reported).toBeInstanceOf(AggregateError);
    expect(reported).toMatchObject({
      message:
        'Local ledger-service mutation and ownership release both failed.',
    });
    expect(/** @type {AggregateError} */ (reported).errors).toEqual([
      handlerFailure,
      releaseFailure,
    ]);
    expect(order).toEqual(['handler', 'release']);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
