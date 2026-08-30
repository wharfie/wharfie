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

import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
  COORDINATOR_AUTHORITY_RECORD_KIND,
  COORDINATOR_AUTHORITY_SCHEMA_VERSION,
  COORDINATOR_AUTHORITY_SORT_KEY,
  CoordinatorAuthorityStaleError,
  getCoordinatorAuthorityPartitionKey,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

const LEDGER_SERVICE_IMPORT =
  '../../src/core/runtime/services/ledger-service.js';
const DB_CONFIG_IMPORT = '../../src/core/lib/config/db.js';
const EXECUTION_LEDGER_STORE_IMPORT =
  '../../src/core/runtime/operator/execution-ledger-store.js';
const EXECUTION_LEDGER_IMPORT =
  '../../src/core/lib/db/tables/execution-ledger.js';
const TABLE_RESOURCE_ID = `wdtr1_${'A'.repeat(43)}`;
const OTHER_TABLE_RESOURCE_ID = `wdtr1_${'E'.repeat(43)}`;
const CURRENT_REVISION_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:test:resident-reconstruction-revision:v1',
  prefix: 'wrv1',
  value: { revision: 'current' },
});

/** @type {ReturnType<typeof jest.fn>} */
let acquireLocalLedgerServiceSession;
/** @type {ReturnType<typeof jest.fn>} */
let createControlDBClient;
/** @type {Function} */
let withExecutionLedger;
/** @type {Function} */
let withExecutionLedgerResidentCoordinatorAuthority;
/** @type {Function} */
let withReconstructedExecutionLedgerResidentAuthority;
/** @type {Function} */
let withLocalLedgerServiceMutationOwnership;
/** @type {Function} */
let assertExecutionLedgerStoreScope;
/** @type {Function} */
let createExecutionLedger;
/** @type {Function} */
let prepareExecutionLedgerCoordinatorAuthorityBinding;

beforeEach(async () => {
  jest.resetModules();
  acquireLocalLedgerServiceSession = jest.fn();
  createControlDBClient = jest.fn();
  jest.unstable_mockModule(LEDGER_SERVICE_IMPORT, () => ({
    acquireLocalLedgerServiceSession,
  }));
  jest.unstable_mockModule(DB_CONFIG_IMPORT, () => ({
    APPLICATION_STATE_TABLE_NAME: 'wharfie-application-state-v2',
    DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE: 'dynamodb-rvn-v1',
    createControlDBClient,
    resolveControlAdapterName: () => 'lmdb',
    resolveControlStoreRegion: () => undefined,
    resolveControlStorePath: () => '/control',
    resolveExecutionLedgerTableName: () => 'execution-ledger-test',
    resolveExecutionPayloadPath: () => '/payloads',
    resolveExecutionPayloadStoreId: () => 'payload-store-test',
    resolveLedgerServiceSessionPath: () => '/sessions',
    resolveResidentCoordinatorAuthorityConfiguration: () => undefined,
  }));
  ({
    withExecutionLedger,
    withExecutionLedgerResidentCoordinatorAuthority,
    withReconstructedExecutionLedgerResidentAuthority,
    withLocalLedgerServiceMutationOwnership,
  } = await import(EXECUTION_LEDGER_STORE_IMPORT));
  ({
    assertExecutionLedgerStoreScope,
    createExecutionLedger,
    prepareExecutionLedgerCoordinatorAuthorityBinding,
  } = await import(EXECUTION_LEDGER_IMPORT));
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

function residentAuthorityConfiguration() {
  return Object.freeze({
    ...executionLedgerConfiguration(),
    adapterName: /** @type {const} */ ('dynamodb'),
    region: 'us-east-2',
    residentCoordinatorAuthority: Object.freeze({
      profile: /** @type {const} */ ('dynamodb-rvn-v1'),
      adapterName: /** @type {const} */ ('dynamodb'),
      region: 'us-east-2',
      tableName: 'execution-ledger-test',
      tableResourceId: TABLE_RESOURCE_ID,
      renewalIntervalMs: 5_000,
      observationWindowMs: 15_000,
    }),
  });
}

/** @param {{epoch?: number, requestId?: string}} [settings] */
function coordinatorAuthorityToken(settings = {}) {
  const { epoch = 2, requestId = 'resident-acquisition-request' } = settings;
  return Object.freeze({
    schemaVersion: 1,
    appId: 'resident-test-app',
    coordinatorId: 'resident-session',
    authorityId: createCanonicalJsonSha256Id({
      domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
      prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
      value: {
        schemaVersion: 1,
        appId: 'resident-test-app',
        coordinatorId: 'resident-session',
        epoch,
        requestId,
      },
    }),
    epoch,
  });
}

function executionLedgerDB(kind = 'dynamodb-client') {
  return {
    kind,
    get: jest.fn(),
    transactionWrite: jest.fn(),
  };
}

/** @param {Record<string, any>} snapshot */
function authorityRecord(snapshot) {
  return Object.freeze({
    run_id: getCoordinatorAuthorityPartitionKey(snapshot.appId),
    sort_key: COORDINATOR_AUTHORITY_SORT_KEY,
    schema_version: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    record_kind: COORDINATOR_AUTHORITY_RECORD_KIND,
    app_id: snapshot.appId,
    coordinator_id: snapshot.coordinatorId,
    authority_id: snapshot.authorityId,
    epoch: snapshot.epoch,
    status: snapshot.status,
    record_version: snapshot.recordVersion,
    acquisition_request_id: snapshot.acquisitionRequestId,
    acquired_at: snapshot.acquiredAt,
    heartbeat_at: snapshot.heartbeatAt,
    released_at: snapshot.releasedAt,
    updated_at: snapshot.updatedAt,
    last_request_id: snapshot.lastRequestId,
  });
}

/**
 * @param {Record<string, any>} db
 * @param {string} [tableName]
 * @returns {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore}
 */
function scopedExecutionLedger(db, tableName = 'execution-ledger-test') {
  return createExecutionLedger({
    db,
    tableName,
    payloadStore: {
      putJson: jest.fn(),
      readBytes: jest.fn(),
    },
  });
}

describe('execution-ledger control-store cleanup', () => {
  it('passes the command-local DynamoDB region instead of rereading ambient routing', async () => {
    const close = jest.fn();
    createControlDBClient.mockResolvedValue({
      get: jest.fn(),
      transactionWrite: jest.fn(),
      close,
    });
    const configuration = Object.freeze({
      ...executionLedgerConfiguration(),
      adapterName: /** @type {const} */ ('dynamodb'),
      region: 'us-east-2',
    });

    await withExecutionLedger(async () => 'done', { configuration });

    expect(createControlDBClient).toHaveBeenCalledWith('dynamodb', {
      path: '/control',
      readOnly: false,
      region: 'us-east-2',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('closes the DB and preserves a handler-only non-Error failure', async () => {
    /** @type {string[]} */
    const order = [];
    const handlerFailure = Object.freeze({ kind: 'handler-failure' });
    const close = jest.fn(async () => {
      order.push('close');
    });
    createControlDBClient.mockResolvedValue({
      get: jest.fn(),
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
      get: jest.fn(),
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
      get: jest.fn(),
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

describe('execution-ledger construction scope', () => {
  it('recognizes exact unbound and authority-bound ledger objects', () => {
    const db = executionLedgerDB();
    const ledger = scopedExecutionLedger(db);
    const boundLedger = ledger.bindCoordinatorAuthority(
      coordinatorAuthorityToken(),
    );

    expect(() =>
      assertExecutionLedgerStoreScope(ledger, db, 'execution-ledger-test'),
    ).not.toThrow();
    expect(() =>
      assertExecutionLedgerStoreScope(boundLedger, db, 'execution-ledger-test'),
    ).not.toThrow();
  });

  it('binds through the retained construction closure exactly once', () => {
    const db = executionLedgerDB();
    const ledger = scopedExecutionLedger(db);
    const publicBinder = jest
      .spyOn(ledger, 'bindCoordinatorAuthority')
      .mockImplementation(() => {
        throw new Error('mutable public binder invoked');
      });
    const bindCoordinatorAuthority =
      prepareExecutionLedgerCoordinatorAuthorityBinding(
        ledger,
        db,
        'execution-ledger-test',
      );

    const boundLedger = bindCoordinatorAuthority(coordinatorAuthorityToken());

    expect(publicBinder).not.toHaveBeenCalled();
    expect(boundLedger.getCoordinatorAuthority()).toEqual(
      coordinatorAuthorityToken(),
    );
    expect(() => bindCoordinatorAuthority(coordinatorAuthorityToken())).toThrow(
      /already used/u,
    );
  });

  it.each([
    ['copied ledger', 'copied'],
    ['unrelated object', 'unrelated'],
    ['different DB object', 'different-db'],
    ['different table', 'different-table'],
  ])('rejects a %s', (_label, scenario) => {
    const db = executionLedgerDB();
    const ledger = scopedExecutionLedger(db);
    const differentDB = executionLedgerDB('different-dynamodb-client');
    const candidate =
      scenario === 'copied'
        ? { ...ledger }
        : scenario === 'unrelated'
          ? { bindCoordinatorAuthority: ledger.bindCoordinatorAuthority }
          : ledger;

    expect(() =>
      assertExecutionLedgerStoreScope(
        candidate,
        scenario === 'different-db' ? differentDB : db,
        scenario === 'different-table'
          ? 'other-execution-ledger'
          : 'execution-ledger-test',
      ),
    ).toThrow(/exact store/u);
  });
});

describe('resident DynamoDB coordinator authority integration', () => {
  /** @param {{topologyFailure?: unknown, expectedRequestedResourceId?: string, admissionPredecessor?: Record<string, any> | null}} [settings] */
  function harness(settings = {}) {
    const {
      topologyFailure,
      expectedRequestedResourceId = TABLE_RESOURCE_ID,
      admissionPredecessor = null,
    } = settings;
    /** @type {string[]} */
    const calls = [];
    const protocol = Object.freeze({ kind: 'protocol' });
    const topology = Object.freeze({
      kind: 'dynamodb-coordinator-authority-topology',
      tableName: 'execution-ledger-test',
      region: 'us-east-2',
      tableResourceId: TABLE_RESOURCE_ID,
    });
    const coordinatorAuthority = coordinatorAuthorityToken();
    const authority = Object.freeze({
      ...coordinatorAuthority,
      status: 'ACTIVE',
      recordVersion: 7,
      acquisitionRequestId: 'resident-acquisition-request',
      acquiredAt: 1,
      heartbeatAt: 7,
      releasedAt: null,
      updatedAt: 7,
      lastRequestId: 'resident-renewal-6',
    });
    const authorityController = new AbortController();
    const authoritySignal = authorityController.signal;
    const db = executionLedgerDB();
    const predecessorVersion = admissionPredecessor?.version ?? 0;
    const predecessorAuthority = admissionPredecessor?.authority;
    const retainsCurrentClosedBarrier =
      admissionPredecessor?.state === 'CLOSED' &&
      predecessorAuthority?.schemaVersion ===
        coordinatorAuthority.schemaVersion &&
      predecessorAuthority?.appId === coordinatorAuthority.appId &&
      predecessorAuthority?.coordinatorId ===
        coordinatorAuthority.coordinatorId &&
      predecessorAuthority?.authorityId === coordinatorAuthority.authorityId &&
      predecessorAuthority?.epoch === coordinatorAuthority.epoch;
    const closedBarrier = retainsCurrentClosedBarrier
      ? admissionPredecessor
      : Object.freeze({
          schemaVersion: 1,
          appId: 'resident-test-app',
          state: 'CLOSED',
          version: predecessorVersion + 1,
          authority: coordinatorAuthority,
          lastAction: admissionPredecessor ? 'adopt' : 'close',
          lastRequestId: admissionPredecessor
            ? `resident-quiescence:adopt:${coordinatorAuthority.authorityId}:predecessor:${predecessorVersion}`
            : `resident-quiescence:close:${coordinatorAuthority.authorityId}:predecessor:${predecessorVersion}`,
          updatedAt: 10,
        });
    const reopenedBarrier = Object.freeze({
      ...closedBarrier,
      state: 'OPEN',
      version: closedBarrier.version + 1,
      lastAction: 'reopen',
      lastRequestId: `resident-quiescence:reopen:${coordinatorAuthority.authorityId}:predecessor:${closedBarrier.version}`,
      updatedAt: 11,
    });
    const admissionBarrier = {
      get: jest.fn(async (input) => {
        calls.push('admission-barrier-get');
        expect(input).toEqual({ appId: 'resident-test-app' });
        return admissionPredecessor;
      }),
      close: jest.fn(async (input) => {
        calls.push('admission-barrier-close');
        expect(input).toEqual({
          authority: coordinatorAuthority,
          requestId: `resident-quiescence:close:${coordinatorAuthority.authorityId}:predecessor:${predecessorVersion}`,
          predecessor: admissionPredecessor,
        });
        return Object.freeze({ barrier: closedBarrier });
      }),
      adopt: jest.fn(async (input) => {
        calls.push('admission-barrier-adopt');
        expect(input).toEqual({
          authority: coordinatorAuthority,
          requestId: `resident-quiescence:adopt:${coordinatorAuthority.authorityId}:predecessor:${predecessorVersion}`,
          predecessor: admissionPredecessor,
        });
        return Object.freeze({ barrier: closedBarrier });
      }),
      reopen: jest.fn(async (input) => {
        calls.push('admission-barrier-reopen');
        expect(input).toEqual({
          authority: coordinatorAuthority,
          requestId: `resident-quiescence:reopen:${coordinatorAuthority.authorityId}:predecessor:${closedBarrier.version}`,
          predecessor: closedBarrier,
        });
        return Object.freeze({ barrier: reopenedBarrier });
      }),
    };
    const createAdmissionBarrier = jest.fn((input) => {
      calls.push('admission-barrier-create');
      expect(input).toEqual({
        db,
        tableName: 'execution-ledger-test',
      });
      return admissionBarrier;
    });
    db.get.mockImplementation(async () => {
      calls.push('assert-current-authority');
      return authorityRecord(authority);
    });
    const ledger = scopedExecutionLedger(db);
    jest.spyOn(ledger, 'bindCoordinatorAuthority').mockImplementation(() => {
      throw new Error('The mutable public binder must not be called.');
    });
    const validateTopology = jest.fn(async (input) => {
      calls.push('topology');
      if (topologyFailure) throw topologyFailure;
      expect(input).toEqual({
        db,
        tableName: 'execution-ledger-test',
        region: 'us-east-2',
        expectedTableResourceId: expectedRequestedResourceId,
      });
      return topology;
    });
    const createProtocol = jest.fn((input) => {
      calls.push('protocol');
      expect(input).toMatchObject({
        tableName: 'execution-ledger-test',
        observationWindowMs: 15_000,
      });
      return protocol;
    });
    const run = jest.fn(async (/** @type {any} */ input) => {
      calls.push('run');
      return await input.handler({
        authority,
        coordinatorAuthority,
        signal: authoritySignal,
      });
    });
    const createSupervisor = jest.fn((input) => {
      calls.push('supervisor');
      expect(input).toMatchObject({
        protocol,
        appId: 'resident-test-app',
        coordinatorId: 'resident-session',
        renewalIntervalMs: 5_000,
      });
      return { run };
    });
    return {
      calls,
      protocol,
      topology,
      authority,
      coordinatorAuthority,
      authoritySignal,
      authorityController,
      admissionBarrier,
      admissionPredecessor,
      closedBarrier,
      reopenedBarrier,
      createAdmissionBarrier,
      db,
      ledger,
      validateTopology,
      createProtocol,
      createSupervisor,
      run,
    };
  }

  /**
   * @param {ReturnType<typeof harness>} fixture
   * @param {Function} handler
   * @param {any} [configuration]
   */
  function options(
    fixture,
    handler,
    configuration = residentAuthorityConfiguration(),
  ) {
    return {
      appId: 'resident-test-app',
      coordinatorId: 'resident-session',
      ledger: fixture.ledger,
      context: {
        db: fixture.db,
        adapterName: 'dynamodb',
        tableName: 'execution-ledger-test',
        readOnly: false,
      },
      configuration,
      handler,
    };
  }

  test('proves topology before starting and binds only the stable authority token', async () => {
    const fixture = harness();
    const handler = jest.fn(
      async (
        /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */ ledger,
        /** @type {Record<string, any>} */ session,
      ) => {
        fixture.calls.push('handler');
        expect(ledger.getCoordinatorAuthority()).toEqual(
          fixture.coordinatorAuthority,
        );
        expect(session).toEqual({
          authority: fixture.authority,
          coordinatorAuthority: fixture.coordinatorAuthority,
          signal: fixture.authoritySignal,
          topology: fixture.topology,
        });
        expect(Object.isFrozen(session)).toBe(true);
        return 'completed';
      },
    );

    await expect(
      withExecutionLedgerResidentCoordinatorAuthority(
        options(fixture, handler),
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
        },
      ),
    ).resolves.toBe('completed');

    expect(fixture.calls).toEqual([
      'topology',
      'protocol',
      'supervisor',
      'run',
      'handler',
    ]);
    expect(fixture.ledger.bindCoordinatorAuthority).not.toHaveBeenCalled();
  });

  test('reconstructs, prepares application state, and only then starts the resident body', async () => {
    const fixture = harness();
    const reconstruction = Object.freeze({
      schemaVersion: 1,
      inspectedRuns: 3,
    });
    const applicationState = Object.freeze({ storeId: 'prepared-store' });
    const redirectedAssertion = jest.fn(async () => {
      throw new Error('mutable public authority assertion invoked');
    });
    const redirectedReopen = jest.fn(async () => {
      throw new Error('mutable public barrier reopen invoked');
    });
    const reconstructHistory = jest.fn(async (/** @type {any} */ input) => {
      fixture.calls.push('reconstruct');
      expect(input).toEqual({
        ledger: expect.any(Object),
        appId: 'resident-test-app',
        currentRevisionId: CURRENT_REVISION_ID,
        coordinatorAuthority: fixture.coordinatorAuthority,
        signal: fixture.authoritySignal,
      });
      expect(input.ledger.getCoordinatorAuthority()).toEqual(
        fixture.coordinatorAuthority,
      );
      return reconstruction;
    });
    const prepareApplicationState = jest.fn(
      async (
        /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */ ledger,
        /** @type {Record<string, any>} */ session,
      ) => {
        fixture.calls.push('prepare-application-state');
        expect(ledger.getCoordinatorAuthority()).toEqual(
          fixture.coordinatorAuthority,
        );
        expect(session).toMatchObject({
          reconstruction,
          topology: fixture.topology,
        });
        expect(Object.isFrozen(session)).toBe(true);
        ledger.assertCurrentCoordinatorAuthority = redirectedAssertion;
        fixture.admissionBarrier.reopen = redirectedReopen;
        return applicationState;
      },
    );
    const handler = jest.fn(
      async (
        /** @type {import('../../src/core/lib/db/tables/execution-ledger.js').ExecutionLedgerStore} */ ledger,
        /** @type {Record<string, any>} */ session,
      ) => {
        fixture.calls.push('resident-body');
        expect(ledger.getCoordinatorAuthority()).toEqual(
          fixture.coordinatorAuthority,
        );
        expect(session).toMatchObject({
          reconstruction,
          applicationState,
          topology: fixture.topology,
        });
        expect(Object.isFrozen(session)).toBe(true);
        return 'resident-completed';
      },
    );

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).resolves.toBe('resident-completed');

    expect(fixture.calls).toEqual([
      'topology',
      'protocol',
      'supervisor',
      'run',
      'admission-barrier-create',
      'admission-barrier-get',
      'admission-barrier-close',
      'reconstruct',
      'prepare-application-state',
      'assert-current-authority',
      'admission-barrier-reopen',
      'assert-current-authority',
      'resident-body',
    ]);
    expect(redirectedAssertion).not.toHaveBeenCalled();
    expect(redirectedReopen).not.toHaveBeenCalled();
  });

  test('adopts an inherited CLOSED barrier before reconstruction and reopens that exact successor', async () => {
    const inheritedBarrier = Object.freeze({
      schemaVersion: 1,
      appId: 'resident-test-app',
      state: 'CLOSED',
      version: 7,
      authority: coordinatorAuthorityToken({
        epoch: 1,
        requestId: 'predecessor-acquisition-request',
      }),
      lastAction: 'close',
      lastRequestId: 'predecessor-close-request',
      updatedAt: 7,
    });
    const fixture = harness({ admissionPredecessor: inheritedBarrier });
    const reconstructHistory = jest.fn(async () =>
      Object.freeze({ schemaVersion: 1 }),
    );
    const prepareApplicationState = jest.fn(async () =>
      Object.freeze({ storeId: 'prepared-store' }),
    );
    const handler = jest.fn(async () => 'adopted');

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).resolves.toBe('adopted');

    expect(fixture.admissionBarrier.close).not.toHaveBeenCalled();
    expect(fixture.admissionBarrier.adopt).toHaveBeenCalledTimes(1);
    expect(fixture.admissionBarrier.reopen).toHaveBeenCalledWith({
      authority: fixture.coordinatorAuthority,
      requestId: `resident-quiescence:reopen:${fixture.coordinatorAuthority.authorityId}:predecessor:${fixture.closedBarrier.version}`,
      predecessor: fixture.closedBarrier,
    });
  });

  test('retains a CLOSED barrier already owned by the full exact session authority without adopting it', async () => {
    const currentAuthority = coordinatorAuthorityToken();
    const retainedBarrier = Object.freeze({
      schemaVersion: 1,
      appId: 'resident-test-app',
      state: 'CLOSED',
      version: 12,
      authority: currentAuthority,
      lastAction: 'close',
      lastRequestId: 'retained-close-request',
      updatedAt: 12,
    });
    const fixture = harness({ admissionPredecessor: retainedBarrier });
    const reconstructHistory = jest.fn(async () =>
      Object.freeze({ schemaVersion: 1 }),
    );
    const prepareApplicationState = jest.fn(async () =>
      Object.freeze({ storeId: 'prepared-store' }),
    );
    const handler = jest.fn(async () => 'retained');

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).resolves.toBe('retained');

    expect(fixture.admissionBarrier.close).not.toHaveBeenCalled();
    expect(fixture.admissionBarrier.adopt).not.toHaveBeenCalled();
    expect(fixture.admissionBarrier.reopen).toHaveBeenCalledWith({
      authority: fixture.coordinatorAuthority,
      requestId: `resident-quiescence:reopen:${fixture.coordinatorAuthority.authorityId}:predecessor:${retainedBarrier.version}`,
      predecessor: retainedBarrier,
    });
  });

  test('never starts the resident body when authority becomes stale during application-state preparation', async () => {
    const fixture = harness();
    const staleAuthority = new Error('replacement token is stale');
    const reconstructHistory = jest.fn(async () => {
      fixture.calls.push('reconstruct');
      return Object.freeze({ schemaVersion: 1 });
    });
    const prepareApplicationState = jest.fn(async () => {
      fixture.calls.push('prepare-application-state');
      fixture.db.get.mockImplementation(async () => {
        fixture.calls.push('assert-current-authority');
        throw staleAuthority;
      });
      return Object.freeze({ storeId: 'prepared-store' });
    });
    const handler = jest.fn();

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).rejects.toBe(staleAuthority);
    expect(fixture.calls).toEqual([
      'topology',
      'protocol',
      'supervisor',
      'run',
      'admission-barrier-create',
      'admission-barrier-get',
      'admission-barrier-close',
      'reconstruct',
      'prepare-application-state',
      'assert-current-authority',
    ]);
    expect(handler).not.toHaveBeenCalled();
    expect(fixture.admissionBarrier.reopen).not.toHaveBeenCalled();
  });

  test('never prepares or starts the resident body after reconstruction loses authority', async () => {
    const fixture = harness();
    const authorityLoss = new Error('replacement authority lost');
    const reconstructHistory = jest.fn(async () => {
      fixture.calls.push('reconstruct');
      fixture.authorityController.abort(authorityLoss);
      return Object.freeze({ schemaVersion: 1 });
    });
    const prepareApplicationState = jest.fn();
    const handler = jest.fn();

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).rejects.toBe(authorityLoss);
    expect(prepareApplicationState).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(fixture.admissionBarrier.reopen).not.toHaveBeenCalled();
  });

  test('leaves admission closed when application-state preparation fails', async () => {
    const fixture = harness();
    const applicationStateFailure = new Error(
      'application-state preparation failed',
    );
    const reconstructHistory = jest.fn(async () =>
      Object.freeze({ schemaVersion: 1 }),
    );
    const prepareApplicationState = jest.fn(async () => {
      throw applicationStateFailure;
    });
    const handler = jest.fn();

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).rejects.toBe(applicationStateFailure);
    expect(fixture.admissionBarrier.reopen).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  test('never starts the resident when the exact barrier reopen fails', async () => {
    const fixture = harness();
    const reopenFailure = new Error('admission barrier reopen failed');
    fixture.admissionBarrier.reopen.mockImplementationOnce(async () => {
      fixture.calls.push('admission-barrier-reopen');
      throw reopenFailure;
    });
    const reconstructHistory = jest.fn(async () =>
      Object.freeze({ schemaVersion: 1 }),
    );
    const prepareApplicationState = jest.fn(async () =>
      Object.freeze({ storeId: 'prepared-store' }),
    );
    const handler = jest.fn();

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).rejects.toBe(reopenFailure);
    expect(fixture.admissionBarrier.reopen).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  test('never starts the resident when authority changes immediately after reopen', async () => {
    const fixture = harness();
    const authorityLoss = new CoordinatorAuthorityStaleError(
      'resident-test-app',
    );
    let authorityAssertions = 0;
    fixture.db.get.mockImplementation(async () => {
      fixture.calls.push('assert-current-authority');
      authorityAssertions += 1;
      if (authorityAssertions === 2) throw authorityLoss;
      return authorityRecord(fixture.authority);
    });
    const reconstructHistory = jest.fn(async () =>
      Object.freeze({ schemaVersion: 1 }),
    );
    const prepareApplicationState = jest.fn(async () =>
      Object.freeze({ storeId: 'prepared-store' }),
    );
    const handler = jest.fn();

    await expect(
      withReconstructedExecutionLedgerResidentAuthority(
        {
          ...options(fixture, handler),
          currentRevisionId: CURRENT_REVISION_ID,
          prepareApplicationState,
        },
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
          reconstructHistory,
          createAdmissionBarrier: fixture.createAdmissionBarrier,
        },
      ),
    ).rejects.toBe(authorityLoss);
    expect(fixture.admissionBarrier.reopen).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  test('snapshots accessor-backed client and routing fields exactly once', async () => {
    const fixture = harness();
    const differentDB = executionLedgerDB('drifting-dynamodb-client');
    const reads = {
      contextDB: 0,
      contextTable: 0,
      configurationRegion: 0,
      configurationTable: 0,
      authorityRegion: 0,
      authorityTable: 0,
      authorityTableResource: 0,
    };
    const authorityConfiguration = {
      ...residentAuthorityConfiguration().residentCoordinatorAuthority,
      get region() {
        reads.authorityRegion += 1;
        return reads.authorityRegion === 1 ? 'us-east-2' : 'us-west-2';
      },
      get tableName() {
        reads.authorityTable += 1;
        return reads.authorityTable === 1
          ? 'execution-ledger-test'
          : 'different-execution-ledger';
      },
      get tableResourceId() {
        reads.authorityTableResource += 1;
        return reads.authorityTableResource === 1
          ? TABLE_RESOURCE_ID
          : OTHER_TABLE_RESOURCE_ID;
      },
    };
    const configuration = {
      ...residentAuthorityConfiguration(),
      get region() {
        reads.configurationRegion += 1;
        return reads.configurationRegion === 1 ? 'us-east-2' : 'us-west-2';
      },
      get tableName() {
        reads.configurationTable += 1;
        return reads.configurationTable === 1
          ? 'execution-ledger-test'
          : 'different-execution-ledger';
      },
      residentCoordinatorAuthority: authorityConfiguration,
    };
    const context = {
      get db() {
        reads.contextDB += 1;
        return reads.contextDB === 1 ? fixture.db : differentDB;
      },
      adapterName: 'dynamodb',
      get tableName() {
        reads.contextTable += 1;
        return reads.contextTable === 1
          ? 'execution-ledger-test'
          : 'different-execution-ledger';
      },
      readOnly: false,
    };
    const handler = jest.fn(async () => 'accessors-snapshotted');
    const input = options(fixture, handler, configuration);
    input.context = context;

    await expect(
      withExecutionLedgerResidentCoordinatorAuthority(input, {
        validateTopology: fixture.validateTopology,
        createProtocol: fixture.createProtocol,
        createSupervisor: fixture.createSupervisor,
      }),
    ).resolves.toBe('accessors-snapshotted');

    expect(reads).toEqual({
      contextDB: 1,
      contextTable: 1,
      configurationRegion: 1,
      configurationTable: 1,
      authorityRegion: 1,
      authorityTable: 1,
      authorityTableResource: 1,
    });
    expect(fixture.createProtocol.mock.calls[0][0]).toMatchObject({
      db: fixture.db,
      tableName: 'execution-ledger-test',
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('retains one run snapshot when protocol construction mutates caller inputs and dependencies', async () => {
    const fixture = harness();
    const originalHandler = jest.fn(async () => 'snapshot-retained');
    const replacementHandler = jest.fn(async () => 'drifted-handler');
    const driftedTopology = jest.fn(async () => {
      throw new Error('drifted topology dependency invoked');
    });
    const authorityConfiguration = /** @type {any} */ ({
      ...residentAuthorityConfiguration().residentCoordinatorAuthority,
    });
    const configuration = /** @type {any} */ ({
      ...residentAuthorityConfiguration(),
      residentCoordinatorAuthority: authorityConfiguration,
    });
    const input = /** @type {any} */ (
      options(fixture, originalHandler, configuration)
    );
    const dependencies = /** @type {any} */ ({
      validateTopology: fixture.validateTopology,
      createProtocol: jest.fn((protocolInput) => {
        fixture.calls.push('protocol');
        expect(protocolInput).toEqual({
          db: fixture.db,
          tableName: 'execution-ledger-test',
          observationWindowMs: 15_000,
        });
        input.appId = 'drifted-app';
        input.coordinatorId = 'drifted-coordinator';
        input.ledger = { bindCoordinatorAuthority: jest.fn() };
        input.context.db = executionLedgerDB('drifted-dynamodb-client');
        input.context.adapterName = 'lmdb';
        input.context.tableName = 'different-execution-ledger';
        input.context.readOnly = true;
        input.configuration.adapterName = 'lmdb';
        input.configuration.region = 'us-west-2';
        input.configuration.tableName = 'different-execution-ledger';
        authorityConfiguration.adapterName = 'lmdb';
        authorityConfiguration.region = 'us-west-2';
        authorityConfiguration.tableName = 'different-execution-ledger';
        authorityConfiguration.tableResourceId = OTHER_TABLE_RESOURCE_ID;
        authorityConfiguration.renewalIntervalMs = 1;
        authorityConfiguration.observationWindowMs = 2;
        input.signal = new AbortController().signal;
        input.handler = replacementHandler;
        dependencies.validateTopology = driftedTopology;
        dependencies.createSupervisor = jest.fn(() => {
          throw new Error('drifted supervisor dependency invoked');
        });
        return fixture.protocol;
      }),
      createSupervisor: fixture.createSupervisor,
    });

    await expect(
      withExecutionLedgerResidentCoordinatorAuthority(input, dependencies),
    ).resolves.toBe('snapshot-retained');

    expect(fixture.validateTopology).toHaveBeenCalledWith({
      db: fixture.db,
      tableName: 'execution-ledger-test',
      region: 'us-east-2',
      expectedTableResourceId: TABLE_RESOURCE_ID,
    });
    expect(fixture.createSupervisor).toHaveBeenCalledWith({
      protocol: fixture.protocol,
      appId: 'resident-test-app',
      coordinatorId: 'resident-session',
      renewalIntervalMs: 5_000,
    });
    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(replacementHandler).not.toHaveBeenCalled();
    expect(driftedTopology).not.toHaveBeenCalled();
  });

  test('never starts authority when topology cannot be established', async () => {
    const failure = new Error('topology unknown');
    const fixture = harness({ topologyFailure: failure });
    const handler = jest.fn();

    await expect(
      withExecutionLedgerResidentCoordinatorAuthority(
        options(fixture, handler),
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
        },
      ),
    ).rejects.toBe(failure);

    expect(fixture.calls).toEqual(['topology']);
    expect(fixture.createSupervisor).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  test('rejects a different configured table resource before authority construction or mutation', async () => {
    const fixture = harness({
      expectedRequestedResourceId: OTHER_TABLE_RESOURCE_ID,
    });
    const handler = jest.fn();
    const configuration = residentAuthorityConfiguration();
    const mismatched = Object.freeze({
      ...configuration,
      residentCoordinatorAuthority: Object.freeze({
        ...configuration.residentCoordinatorAuthority,
        tableResourceId: OTHER_TABLE_RESOURCE_ID,
      }),
    });

    await expect(
      withExecutionLedgerResidentCoordinatorAuthority(
        options(fixture, handler, mismatched),
        {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
        },
      ),
    ).rejects.toThrow(/does not match the configured table resource/u);

    expect(fixture.calls).toEqual(['topology']);
    expect(fixture.createProtocol).not.toHaveBeenCalled();
    expect(fixture.createSupervisor).not.toHaveBeenCalled();
    expect(fixture.run).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(fixture.db.transactionWrite).not.toHaveBeenCalled();
  });

  test.each([
    ['copied ledger', 'copied'],
    ['unrelated object', 'unrelated'],
    ['ledger from a different DB object', 'different-db'],
    ['ledger from a different table', 'different-table'],
    ['ledger that is already authority-bound', 'already-bound'],
  ])(
    'rejects a %s before protocol or topology construction',
    async (_label, scenario) => {
      const fixture = harness();
      const input = /** @type {any} */ (options(fixture, jest.fn()));
      if (scenario === 'copied') {
        input.ledger = { ...fixture.ledger };
      } else if (scenario === 'unrelated') {
        input.ledger = { bindCoordinatorAuthority: jest.fn() };
      } else if (scenario === 'different-db') {
        input.ledger = scopedExecutionLedger(
          executionLedgerDB('different-dynamodb-client'),
        );
      } else if (scenario === 'already-bound') {
        input.ledger = scopedExecutionLedger(
          fixture.db,
        ).bindCoordinatorAuthority(coordinatorAuthorityToken());
      } else {
        input.ledger = scopedExecutionLedger(
          fixture.db,
          'different-execution-ledger',
        );
      }

      await expect(
        withExecutionLedgerResidentCoordinatorAuthority(input, {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
        }),
      ).rejects.toThrow(
        scenario === 'already-bound' ? /unbound/u : /exact store/u,
      );
      expect(fixture.createProtocol).not.toHaveBeenCalled();
      expect(fixture.validateTopology).not.toHaveBeenCalled();
    },
  );

  test.each([
    ['non-DynamoDB context', { contextAdapterName: 'lmdb' }],
    ['missing profile', { omitProfile: true }],
    ['different Region', { region: 'us-west-2' }],
    ['different table', { tableName: 'other-ledger' }],
  ])(
    'rejects %s before protocol or topology construction',
    async (_label, drift) => {
      const change = /** @type {Record<string, any>} */ (drift);
      const fixture = harness();
      const configuration = residentAuthorityConfiguration();
      const changedConfiguration = change.omitProfile
        ? Object.freeze({
            ...configuration,
            residentCoordinatorAuthority: undefined,
          })
        : Object.freeze({
            ...configuration,
            ...(change.region === undefined ? {} : { region: change.region }),
          });
      const input = options(fixture, jest.fn(), changedConfiguration);
      if (change.contextAdapterName !== undefined) {
        input.context.adapterName = change.contextAdapterName;
      }
      if (change.tableName !== undefined) {
        input.context.tableName = change.tableName;
      }

      await expect(
        withExecutionLedgerResidentCoordinatorAuthority(input, {
          validateTopology: fixture.validateTopology,
          createProtocol: fixture.createProtocol,
          createSupervisor: fixture.createSupervisor,
        }),
      ).rejects.toThrow();
      expect(fixture.createProtocol).not.toHaveBeenCalled();
      expect(fixture.validateTopology).not.toHaveBeenCalled();
    },
  );
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
