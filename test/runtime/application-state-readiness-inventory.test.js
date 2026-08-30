/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { APPLICATION_STATE_TABLE_NAME } from '../../src/core/lib/config/db.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import {
  ApplicationStateReadinessRecordError,
  createApplicationStateReadinessStore,
} from '../../src/core/lib/db/tables/application-state-readiness.js';
import { ApplicationStateStoreIdentityError } from '../../src/core/lib/db/tables/application-state.js';
import {
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import {
  collectApplicationStateReadinessDestination,
  resolveApplicationStateExpectedStoreId,
  resolveApplicationStateWriteBinding,
} from '../../src/core/runtime/application-state-readiness.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createVanillaDB } from '../helpers/db-adapters.js';

/** @typedef {import('../../src/core/lib/db/base.js').DBClient} DBClient */
/** @typedef {import('../../src/core/lib/db/tables/application-state-readiness.js').ApplicationStateReadinessRecord} Readiness */

const APP_ID = 'readiness-inventory';
const CONTROL_TABLE_NAME = 'readiness-inventory-control';
const CONFIGURATION = Object.freeze({
  adapterName: /** @type {const} */ ('lmdb'),
  storePath: '/private/tmp/wharfie-inventory-unused-application-store',
  tableName: APPLICATION_STATE_TABLE_NAME,
});
const STORE_ID = fixtureId('primary');
const OTHER_STORE_ID = fixtureId('other');
const DESTINATION = Object.freeze({
  kind: 'application-state',
  version: 2,
  bindingId: 'primary',
  configuration: Object.freeze({
    provider: 'lmdb',
    storeId: STORE_ID,
    tableName: APPLICATION_STATE_TABLE_NAME,
    namespace: APP_ID,
  }),
});

/** @param {string} value */
function fixtureId(value) {
  return createCanonicalJsonSha256Id({
    domain: 'wharfie:test:application-state-readiness-inventory:v1',
    prefix: 'was',
    value,
  });
}

/** @param {any[]} pages @param {Record<string, any>} [views] */
function history(pages, views = {}) {
  let page = 0;
  return {
    listRuns: jest.fn(
      async (/** @type {Record<string, any>} */ _options) => pages[page++],
    ),
    rebuildRun: jest.fn(async (/** @type {string} */ runId) => views[runId]),
  };
}

/** @param {string} runId @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function view(runId, overrides = {}) {
  return {
    run: {
      runId,
      appId: APP_ID,
      status: 'SUCCEEDED',
      revisionId: 'old-revision',
    },
    effects: [],
    ...overrides,
  };
}

/** @param {ReturnType<typeof history>} ledger @param {Partial<Parameters<typeof collectApplicationStateReadinessDestination>[0]>} [overrides] */
async function collect(ledger, overrides = {}) {
  return await collectApplicationStateReadinessDestination({
    appId: APP_ID,
    ledger,
    configuration: CONFIGURATION,
    ...overrides,
  });
}

function gate() {
  let release = () => {};
  const waiting = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { waiting, release };
}

describe('complete application-state readiness inventory', () => {
  test('recognizes genuine first use without a retained destination or effects', async () => {
    const ledger = history(
      [{ items: [{ appId: APP_ID, runId: 'empty-run' }] }],
      {
        'empty-run': view('empty-run'),
      },
    );

    await expect(collect(ledger)).resolves.toBeNull();
    expect(ledger.listRuns).toHaveBeenCalledWith({ appId: APP_ID, limit: 100 });
    expect(ledger.rebuildRun).toHaveBeenCalledWith('empty-run');
  });

  test('visits every page and terminal revision, including an authorization-only successor destination', async () => {
    const ledger = history(
      [
        {
          items: [{ appId: APP_ID, runId: 'terminal' }],
          nextCursor: 'next-page',
        },
        { items: [{ appId: APP_ID, runId: 'authorized-successor' }] },
      ],
      {
        terminal: view('terminal', {
          effects: [{ status: 'APPLIED', destination: DESTINATION }],
        }),
        'authorized-successor': view('authorized-successor', {
          run: {
            appId: APP_ID,
            runId: 'authorized-successor',
            status: 'RUNNING',
            revisionId: 'another-revision',
            trigger: {
              kind: 'effect-successor',
              contract: { destination: DESTINATION },
            },
          },
        }),
      },
    );

    const destination = await collect(ledger);

    expect(destination).toEqual(DESTINATION);
    expect(Object.isFrozen(destination)).toBe(true);
    expect(ledger.listRuns.mock.calls).toEqual([
      [{ appId: APP_ID, limit: 100 }],
      [{ appId: APP_ID, limit: 100, cursor: 'next-page' }],
    ]);
    expect(ledger.rebuildRun.mock.calls).toEqual([
      ['terminal'],
      ['authorized-successor'],
    ]);
  });

  test('uses an authorization-only successor as the sole retained destination', async () => {
    const ledger = history(
      [{ items: [{ appId: APP_ID, runId: 'successor' }] }],
      {
        successor: view('successor', {
          run: {
            appId: APP_ID,
            runId: 'successor',
            trigger: {
              kind: 'effect-successor',
              contract: { destination: DESTINATION },
            },
          },
        }),
      },
    );

    await expect(collect(ledger)).resolves.toEqual(DESTINATION);
  });

  test('keeps the registry pin with no runs and still checks later history against it', async () => {
    await expect(
      collect(history([{ items: [] }]), { retainedDestination: DESTINATION }),
    ).resolves.toEqual(DESTINATION);
    const ledger = history(
      [{ items: [{ appId: APP_ID, runId: 'same-store' }] }],
      {
        'same-store': view('same-store', {
          effects: [{ status: 'NOT_APPLIED', destination: DESTINATION }],
        }),
      },
    );
    await expect(
      collect(ledger, { retainedDestination: DESTINATION }),
    ).resolves.toEqual(DESTINATION);
    expect(ledger.rebuildRun).toHaveBeenCalledWith('same-store');
  });

  test.each(['effects', 'successor', 'registry'])(
    'refuses two retained primary stores from %s instead of choosing the latest',
    async (origin) => {
      const other = {
        ...DESTINATION,
        configuration: {
          ...DESTINATION.configuration,
          storeId: OTHER_STORE_ID,
        },
      };
      const terminal = view('terminal', {
        effects: [{ destination: DESTINATION }],
      });
      if (origin === 'effects') terminal.effects.push({ destination: other });
      if (origin === 'successor') {
        terminal.run.trigger = {
          kind: 'effect-successor',
          contract: { destination: other },
        };
      }
      const ledger = history(
        [{ items: [{ appId: APP_ID, runId: 'terminal' }] }],
        {
          terminal,
        },
      );

      await expect(
        collect(
          ledger,
          origin === 'registry' ? { retainedDestination: other } : {},
        ),
      ).rejects.toThrow(ApplicationStateStoreIdentityError);
    },
  );

  test.each([
    [
      'namespace',
      {
        ...DESTINATION,
        configuration: {
          ...DESTINATION.configuration,
          namespace: 'another-app',
        },
      },
    ],
    [
      'provider',
      {
        ...DESTINATION,
        configuration: { ...DESTINATION.configuration, provider: 'vanilla' },
      },
    ],
    [
      'table',
      {
        ...DESTINATION,
        configuration: {
          ...DESTINATION.configuration,
          tableName: 'another-table',
        },
      },
    ],
    ['binding', { ...DESTINATION, bindingId: 'secondary' }],
    ['version', { ...DESTINATION, version: 1 }],
    ['kind', { ...DESTINATION, kind: 'unsupported-effect' }],
    ['missing destination', undefined],
  ])('rejects a wrong or unsupported %s', async (_label, destination) => {
    const ledger = history(
      [{ items: [{ appId: APP_ID, runId: 'retained' }] }],
      {
        retained: view('retained', { effects: [{ destination }] }),
      },
    );

    await expect(collect(ledger)).rejects.toThrow();
  });

  test.each([
    ['missing run', undefined],
    ['wrong run', view('another-run')],
    [
      'wrong application',
      view('retained', { run: { appId: 'another-app', runId: 'retained' } }),
    ],
    ['missing effects', { run: { appId: APP_ID, runId: 'retained' } }],
    [
      'malformed successor',
      view('retained', {
        run: {
          appId: APP_ID,
          runId: 'retained',
          trigger: { kind: 'effect-successor' },
        },
      }),
    ],
  ])('fails closed on %s in verified history', async (_label, retained) => {
    const ledger = history(
      [{ items: [{ appId: APP_ID, runId: 'retained' }] }],
      {
        retained,
      },
    );

    await expect(collect(ledger)).rejects.toThrow();
  });

  test.each([
    [
      'wrong application',
      [{ items: [{ appId: 'another-app', runId: 'retained' }] }],
    ],
    ['empty run identity', [{ items: [{ appId: APP_ID, runId: '' }] }]],
    ['invalid page', [null]],
    ['missing page items', [{}]],
    [
      'repeated run',
      [
        { items: [{ appId: APP_ID, runId: 'retained' }], nextCursor: 'next' },
        { items: [{ appId: APP_ID, runId: 'retained' }] },
      ],
    ],
    ['empty cursor', [{ items: [], nextCursor: '' }]],
    ['non-string cursor', [{ items: [], nextCursor: 7 }]],
    ['null cursor', [{ items: [], nextCursor: null }]],
  ])(
    'rejects a %s rather than declaring a partial inventory complete',
    async (_label, pages) => {
      const ledger = history(/** @type {any[]} */ (pages), {
        retained: view('retained'),
      });

      await expect(collect(ledger)).rejects.toThrow();
    },
  );

  test('rejects a repeated cursor after visiting nonempty distinct pages', async () => {
    const ledger = history(
      [
        {
          items: [{ appId: APP_ID, runId: 'first-run' }],
          nextCursor: 'again',
        },
        {
          items: [{ appId: APP_ID, runId: 'second-run' }],
          nextCursor: 'again',
        },
      ],
      {
        'first-run': view('first-run'),
        'second-run': view('second-run'),
      },
    );

    await expect(collect(ledger)).rejects.toThrow(/cursor did not advance/u);
    expect(ledger.rebuildRun).toHaveBeenCalledTimes(2);
  });

  test('propagates rebuild corruption instead of skipping an unready run', async () => {
    const ledger = history([{ items: [{ appId: APP_ID, runId: 'broken' }] }]);
    const corruption = new Error('retained event digest does not match');
    ledger.rebuildRun.mockRejectedValueOnce(corruption);

    await expect(collect(ledger)).rejects.toBe(corruption);
  });

  test('snapshots scope, retained destination, and ledger methods before the first await', async () => {
    const waiting = gate();
    const ledger = history([], { retained: view('retained') });
    const originalList = ledger.listRuns;
    const originalRebuild = ledger.rebuildRun;
    originalList.mockImplementationOnce(async () => {
      await waiting.waiting;
      return { items: [{ appId: APP_ID, runId: 'retained' }] };
    });
    const configuration = {
      ...CONFIGURATION,
      storePath: String(CONFIGURATION.storePath),
    };
    const retainedDestination = {
      ...DESTINATION,
      configuration: {
        ...DESTINATION.configuration,
        namespace: String(DESTINATION.configuration.namespace),
      },
    };
    const options = {
      appId: APP_ID,
      ledger,
      configuration,
      retainedDestination,
    };

    const pending = collectApplicationStateReadinessDestination(options);
    options.appId = 'caller-mutated-app';
    configuration.storePath = '/private/tmp/caller-mutated-path';
    retainedDestination.configuration.namespace = 'caller-mutated-app';
    retainedDestination.configuration.storeId = OTHER_STORE_ID;
    ledger.listRuns = jest.fn(async () => {
      throw new Error('replaced list');
    });
    ledger.rebuildRun = jest.fn(async () => {
      throw new Error('replaced rebuild');
    });
    waiting.release();

    await expect(pending).resolves.toEqual(DESTINATION);
    expect(originalList).toHaveBeenCalledWith({ appId: APP_ID, limit: 100 });
    expect(originalRebuild).toHaveBeenCalledWith('retained');
    expect(ledger.listRuns).not.toHaveBeenCalled();
    expect(ledger.rebuildRun).not.toHaveBeenCalled();
  });

  test('stops an already-cancelled inventory before reading history', async () => {
    const cancellation = new AbortController();
    const reason = new Error('startup cancelled');
    cancellation.abort(reason);
    const ledger = history([{ items: [] }]);

    await expect(collect(ledger, { signal: cancellation.signal })).rejects.toBe(
      reason,
    );
    expect(ledger.listRuns).not.toHaveBeenCalled();
    expect(ledger.rebuildRun).not.toHaveBeenCalled();
  });

  test('checks cancellation after the final rebuilt run', async () => {
    const cancellation = new AbortController();
    const reason = new Error('cancelled while rebuilding');
    const ledger = history([{ items: [{ appId: APP_ID, runId: 'retained' }] }]);
    ledger.rebuildRun.mockImplementationOnce(async () => {
      cancellation.abort(reason);
      return view('retained', { effects: [{ destination: DESTINATION }] });
    });

    await expect(collect(ledger, { signal: cancellation.signal })).rejects.toBe(
      reason,
    );
  });

  test('requires both complete-history capabilities before any reads', async () => {
    const listRuns = jest.fn();
    await expect(
      collectApplicationStateReadinessDestination({
        appId: APP_ID,
        configuration: CONFIGURATION,
        ledger: /** @type {any} */ ({ listRuns }),
      }),
    ).rejects.toThrow('complete verified run history');
    expect(listRuns).not.toHaveBeenCalled();
  });
});

describe('writable-catalog application-state identity pin lookup', () => {
  /** @type {string} */
  let root;
  /** @type {DBClient} */
  let fixtureDb;
  /** @type {Readiness} */
  let preparing;
  /** @type {Readiness} */
  let adopted;
  /** @type {Readonly<Record<string, any>>} */
  let adoptedBarrier;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'wharfie-readiness-inventory-'));
    fixtureDb = await createVanillaDB(root);
    const authorityStore = createCoordinatorAuthority({
      db: fixtureDb,
      tableName: CONTROL_TABLE_NAME,
    });
    const acquired = await authorityStore.acquire({
      appId: APP_ID,
      coordinatorId: 'fixture-coordinator',
      requestId: 'fixture-acquire',
    });
    const coordinatorAuthority = createCoordinatorAuthorityToken(
      acquired.authority,
    );
    const readiness = createApplicationStateReadinessStore({
      db: fixtureDb,
      tableName: CONTROL_TABLE_NAME,
      coordinatorAuthority,
    });
    preparing = await readiness.prepare({ destination: DESTINATION });
    adoptedBarrier = createApplicationStateCoordinatorAuthorityRecord({
      storeId: STORE_ID,
      namespace: APP_ID,
      authority: coordinatorAuthority,
    });
    adopted = await readiness.markAdopted({
      preparation: preparing,
      destinationAuthority: adoptedBarrier,
    });
  });

  afterAll(async () => {
    try {
      await fixtureDb?.close();
    } finally {
      if (root) rmSync(root, { recursive: true, force: true });
    }
  });

  /** @param {unknown} retained */
  function lookup(retained) {
    const get = jest.fn(
      async (/** @type {Record<string, any>} */ _input) => retained,
    );
    const transactionWrite = jest.fn(async () => {
      throw new Error('identity pin lookup must be read-only');
    });
    return {
      get,
      transactionWrite,
      options: {
        appId: APP_ID,
        controlContext: {
          db: /** @type {DBClient} */ (
            /** @type {unknown} */ ({ get, transactionWrite })
          ),
          tableName: CONTROL_TABLE_NAME,
        },
        applicationStateContext: { ...CONFIGURATION },
      },
    };
  }

  test.each([undefined, STORE_ID])(
    'preserves the pre-registry expected identity %s',
    async (expectedStoreId) => {
      const fixture = lookup(null);
      await expect(
        resolveApplicationStateExpectedStoreId({
          ...fixture.options,
          ...(expectedStoreId === undefined ? {} : { expectedStoreId }),
        }),
      ).resolves.toBe(expectedStoreId);
      expect(fixture.get).toHaveBeenCalledTimes(1);
      expect(fixture.get).toHaveBeenCalledWith(
        expect.objectContaining({ consistentRead: true }),
      );
      expect(fixture.transactionWrite).not.toHaveBeenCalled();
    },
  );

  test.each(['PREPARING', 'ADOPTED'])(
    'honors the immutable %s pin without requiring or adopting current authority',
    async (status) => {
      const fixture = lookup(status === 'PREPARING' ? preparing : adopted);

      await expect(
        resolveApplicationStateExpectedStoreId(fixture.options),
      ).resolves.toBe(STORE_ID);
      await expect(
        resolveApplicationStateExpectedStoreId({
          ...fixture.options,
          expectedStoreId: STORE_ID,
        }),
      ).resolves.toBe(STORE_ID);
      expect(fixture.get).toHaveBeenCalledTimes(2);
      expect(fixture.transactionWrite).not.toHaveBeenCalled();
    },
  );

  test('preserves the canonical ADOPTED destination-authority floor in the shared write binding', async () => {
    const adoptedFixture = lookup(adopted);
    const preparingFixture = lookup(preparing);

    const adoptedBinding = await resolveApplicationStateWriteBinding(
      adoptedFixture.options,
    );
    expect(adoptedBinding).toEqual({
      expectedStoreId: STORE_ID,
      destinationAuthorityFloor: adoptedBarrier,
    });
    expect(Object.isFrozen(adoptedBinding)).toBe(true);
    expect(Object.isFrozen(adoptedBinding?.destinationAuthorityFloor)).toBe(
      true,
    );
    await expect(
      resolveApplicationStateWriteBinding(preparingFixture.options),
    ).rejects.toMatchObject({
      code: 'WHARFIE_APPLICATION_STATE_READINESS_CONFLICT',
      reason: 'destination handoff is still PREPARING',
    });
    expect(adoptedFixture.transactionWrite).not.toHaveBeenCalled();
    expect(preparingFixture.transactionWrite).not.toHaveBeenCalled();
  });

  test('refuses a historical effect destination that disagrees with the resident pin', async () => {
    const fixture = lookup(adopted);

    await expect(
      resolveApplicationStateExpectedStoreId({
        ...fixture.options,
        expectedStoreId: OTHER_STORE_ID,
      }),
    ).rejects.toThrow(ApplicationStateStoreIdentityError);
    expect(fixture.transactionWrite).not.toHaveBeenCalled();
  });

  test.each(['provider', 'table'])(
    'refuses a configured %s that disagrees with the retained destination',
    async (field) => {
      const fixture = lookup(adopted);
      const applicationStateContext = {
        adapterName: field === 'provider' ? 'vanilla' : 'lmdb',
        tableName:
          field === 'table' ? 'another-table' : APPLICATION_STATE_TABLE_NAME,
      };

      await expect(
        resolveApplicationStateExpectedStoreId({
          ...fixture.options,
          applicationStateContext,
        }),
      ).rejects.toThrow(ApplicationStateStoreIdentityError);
      expect(fixture.transactionWrite).not.toHaveBeenCalled();
    },
  );

  test('does not use malformed retained readiness as a missing pin', async () => {
    const fixture = lookup({ ...adopted, status: 'PREPARING' });

    await expect(
      resolveApplicationStateExpectedStoreId(fixture.options),
    ).rejects.toThrow(ApplicationStateReadinessRecordError);
    expect(fixture.transactionWrite).not.toHaveBeenCalled();
  });

  test('rejects a malformed effect-retained store identity before any database read', async () => {
    const fixture = lookup(adopted);

    await expect(
      resolveApplicationStateExpectedStoreId({
        ...fixture.options,
        expectedStoreId: 'not-a-store-id',
      }),
    ).rejects.toThrow();
    expect(fixture.get).not.toHaveBeenCalled();
    expect(fixture.transactionWrite).not.toHaveBeenCalled();
  });

  test('snapshots app, destination routing, and expected store before its read', async () => {
    const fixture = lookup(adopted);
    const waiting = gate();
    fixture.get.mockImplementationOnce(async () => {
      await waiting.waiting;
      return adopted;
    });
    const options = { ...fixture.options, expectedStoreId: STORE_ID };

    const pending = resolveApplicationStateExpectedStoreId(options);
    options.appId = 'caller-mutated-app';
    options.applicationStateContext.tableName = /** @type {any} */ (
      'caller-mutated-table'
    );
    options.applicationStateContext.adapterName = /** @type {any} */ (
      'vanilla'
    );
    options.expectedStoreId = OTHER_STORE_ID;
    waiting.release();

    await expect(pending).resolves.toBe(STORE_ID);
    expect(fixture.get).toHaveBeenCalledTimes(1);
    expect(fixture.transactionWrite).not.toHaveBeenCalled();
  });
});
