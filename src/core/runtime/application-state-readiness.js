import {
  ApplicationStateStoreIdentityError,
  createApplicationStateTable,
} from '../lib/db/tables/application-state.js';
import {
  ApplicationStateReadinessConflictError,
  applicationStateReadinessAuthority,
  applicationStateReadinessDestination,
  createApplicationStateReadinessStore,
} from '../lib/db/tables/application-state-readiness.js';
import {
  createApplicationStateCoordinatorAuthorityRecord,
  validateApplicationStateCoordinatorAuthorityRecord,
} from '../lib/db/tables/application-state-authority.js';
import {
  assertCoordinatorAuthorityCurrent,
  assertCoordinatorAuthorityToken,
} from '../lib/db/tables/coordinator-authority.js';
import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { assertDomainSeparatedSha256Id } from './content-id.js';
import { assertLogicalId } from './logical-id.js';
import { resolveApplicationStateCoordinatorAuthority } from './application-state-authority.js';
import {
  assertApplicationStateStoreIsolation,
  openApplicationStateDB,
  validateApplicationStateStoreConfiguration,
} from './application-state-store.js';
import { normalizeApplicationStateDestination } from './effects/application-state.js';

/**
 * @param {unknown} value - Retained destination.
 * @param {{appId: string, adapterName: string, tableName: string}} scope - Captured routing scope.
 * @returns {ReturnType<typeof normalizeApplicationStateDestination>} - Exact supported destination.
 */
function scopedDestination(value, scope) {
  const destination = normalizeApplicationStateDestination(value);
  if (
    destination.configuration.namespace !== scope.appId ||
    destination.configuration.provider !== scope.adapterName ||
    destination.configuration.tableName !== scope.tableName
  ) {
    throw new ApplicationStateStoreIdentityError(
      'Application-state readiness destination does not match the application, provider, or table.',
    );
  }
  return destination;
}

/**
 * Inventory verified history, not the ready-work index. Terminal runs and
 * authorization-only successor targets can still name required destinations.
 * The caller holds fresh control authority and has not started any scheduling
 * or dispatch. Legacy/unbound writers must already be stopped at cutover.
 * @param {{ledger: Pick<import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, 'listRuns'|'rebuildRun'>, appId: string, configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, retainedDestination?: unknown, signal?: AbortSignal}} options - Captured startup scope.
 * @returns {Promise<ReturnType<typeof normalizeApplicationStateDestination> | null>} - The sole supported retained destination, or genuine first use.
 */
export async function collectApplicationStateReadinessDestination(options) {
  const appId = options.appId;
  assertLogicalId(appId, 'application-state readiness appId');
  const configuration = validateApplicationStateStoreConfiguration(
    options.configuration,
  );
  const signal = options.signal;
  if (
    typeof options.ledger?.listRuns !== 'function' ||
    typeof options.ledger?.rebuildRun !== 'function'
  ) {
    throw new TypeError(
      'Application-state readiness requires complete verified run history.',
    );
  }
  const listRuns = options.ledger.listRuns.bind(options.ledger);
  const rebuildRun = options.ledger.rebuildRun.bind(options.ledger);
  const scope = { appId, ...configuration };
  let destination =
    options.retainedDestination === undefined
      ? null
      : scopedDestination(options.retainedDestination, scope);
  /** @param {unknown} candidate - One retained managed-effect destination. */
  const include = (candidate) => {
    const normalized = scopedDestination(candidate, scope);
    if (
      destination &&
      destination.configuration.storeId !== normalized.configuration.storeId
    ) {
      throw new ApplicationStateStoreIdentityError(
        'Application-state readiness cannot select between multiple retained primary stores.',
      );
    }
    destination = normalized;
  };
  const seenRuns = new Set();
  const seenCursors = new Set();
  /** @type {string | undefined} */
  let cursor;
  do {
    signal?.throwIfAborted();
    const page = await listRuns({
      appId,
      limit: 100,
      ...(cursor === undefined ? {} : { cursor }),
    });
    if (!page || !Array.isArray(page.items)) {
      throw new TypeError('Application-state readiness history is invalid.');
    }
    for (const row of page.items) {
      signal?.throwIfAborted();
      const runId = assertLedgerOpaqueId(
        row?.runId,
        'application-state readiness runId',
      );
      if (row.appId !== appId || seenRuns.has(runId)) {
        throw new TypeError(
          'Application-state readiness history crossed application scope or repeated a run.',
        );
      }
      seenRuns.add(runId);
      const view = await rebuildRun(runId);
      if (
        !view ||
        view.run?.runId !== runId ||
        view.run.appId !== appId ||
        !Array.isArray(view.effects)
      ) {
        throw new TypeError(
          'Application-state readiness history could not be rebuilt exactly.',
        );
      }
      for (const effect of view.effects) include(effect.destination);
      if (view.run.trigger?.kind === 'effect-successor') {
        include(view.run.trigger.contract?.destination);
      }
    }
    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (typeof cursor !== 'string' || !cursor || seenCursors.has(cursor)) {
        throw new TypeError(
          'Application-state readiness history cursor did not advance.',
        );
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);
  signal?.throwIfAborted();
  return destination;
}

/**
 * Honor a resident's durable primary-store pin at every later writable catalog
 * opening, including foreground and operator execution. This lookup does not
 * confer authority or adopt a destination; the caller retains both guards.
 * @param {{appId: string, controlContext: {db: import('../lib/db/base.js').DBClient, tableName: string}, applicationStateContext: {adapterName: string, tableName: string}, expectedStoreId?: string}} options - Captured write routing.
 * @param {boolean} rejectPreparing - Whether an incomplete resident handoff is unsafe for this caller.
 * @returns {Promise<Readonly<{expectedStoreId: string, destinationAuthorityFloor?: Readonly<Record<string, any>>}> | undefined>} - Exact retained write binding, when known.
 */
async function resolveApplicationStateRetainedBinding(
  options,
  rejectPreparing,
) {
  const appId = options.appId;
  assertLogicalId(appId, 'application-state readiness appId');
  const { db, tableName } = options.controlContext;
  const scope = {
    appId,
    adapterName: options.applicationStateContext.adapterName,
    tableName: options.applicationStateContext.tableName,
  };
  const expectedStoreId = options.expectedStoreId;
  if (expectedStoreId !== undefined) {
    assertDomainSeparatedSha256Id(
      expectedStoreId,
      'was',
      'application-state expected storeId',
    );
  }
  const retained = await createApplicationStateReadinessStore({
    db,
    tableName,
  }).get({ appId });
  if (!retained) {
    return expectedStoreId === undefined
      ? undefined
      : Object.freeze({ expectedStoreId });
  }
  const destination = scopedDestination(
    applicationStateReadinessDestination(retained),
    scope,
  );
  if (
    expectedStoreId !== undefined &&
    destination.configuration.storeId !== expectedStoreId
  ) {
    throw new ApplicationStateStoreIdentityError(
      'Application-state effect destination disagrees with the retained primary-store binding.',
    );
  }
  const retainedStoreId = destination.configuration.storeId;
  if (retained.status !== 'ADOPTED') {
    if (rejectPreparing) {
      throw new ApplicationStateReadinessConflictError(
        appId,
        'destination handoff is still PREPARING',
      );
    }
    return Object.freeze({ expectedStoreId: retainedStoreId });
  }
  const destinationAuthorityFloor =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId: retainedStoreId,
      namespace: appId,
      authority: applicationStateReadinessAuthority(retained),
    });
  if (
    destinationAuthorityFloor.record_digest !==
    retained.destination_authority_digest
  ) {
    throw new TypeError(
      'Application-state readiness does not retain its exact destination authority.',
    );
  }
  return Object.freeze({
    expectedStoreId: retainedStoreId,
    destinationAuthorityFloor,
  });
}

/**
 * Resolve the complete retained binding required for non-resident writable
 * access. PREPARING belongs exclusively to resident handoff recovery because
 * it does not prove that any destination barrier was committed.
 * @param {{appId: string, controlContext: {db: import('../lib/db/base.js').DBClient, tableName: string}, applicationStateContext: {adapterName: string, tableName: string}, expectedStoreId?: string}} options - Captured write routing.
 * @returns {Promise<Readonly<{expectedStoreId: string, destinationAuthorityFloor?: Readonly<Record<string, any>>}> | undefined>} - Exact retained write binding, when known.
 */
export async function resolveApplicationStateWriteBinding(options) {
  return await resolveApplicationStateRetainedBinding(options, true);
}

/**
 * Compatibility projection for read-only callers that need only the retained
 * physical identity. Writable callers must retain the full write binding.
 * @param {{appId: string, controlContext: {db: import('../lib/db/base.js').DBClient, tableName: string}, applicationStateContext: {adapterName: string, tableName: string}, expectedStoreId?: string}} options - Captured write routing.
 * @returns {Promise<string | undefined>} - Exact retained store identity, when known.
 */
export async function resolveApplicationStateExpectedStoreId(options) {
  return (await resolveApplicationStateRetainedBinding(options, false))
    ?.expectedStoreId;
}

/**
 * Verify a known destination without materializing a missing store. Dispatch
 * preparation uses this before durable STARTED; startup uses it before any
 * writable destination access. The later writable catalog must still compare
 * the same identity and adopt its own captured coordinator token.
 * @param {{configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, controlContext: {adapterName: import('../lib/config/db.js').DBAdapterName, controlPath: string, tableName: string}, expectedStoreId: string, appId?: string, coordinatorAuthority?: unknown, destinationAuthorityFloor?: unknown}} options - Captured physical route and retained identity.
 * @returns {Promise<void>} - Exact existing identity, with the read handle closed.
 */
export async function preflightApplicationStateStoreIdentity(options) {
  const configuration = validateApplicationStateStoreConfiguration(
    options.configuration,
  );
  const controlContext = {
    adapterName: options.controlContext.adapterName,
    controlPath: options.controlContext.controlPath,
    tableName: options.controlContext.tableName,
  };
  const expectedStoreId = options.expectedStoreId;
  assertDomainSeparatedSha256Id(
    expectedStoreId,
    'was',
    'application-state expected storeId',
  );
  const destinationAuthorityFloor =
    options.destinationAuthorityFloor === undefined
      ? undefined
      : validateApplicationStateCoordinatorAuthorityRecord(
          options.destinationAuthorityFloor,
        );
  const appId = options.appId;
  const coordinatorAuthority =
    options.coordinatorAuthority === undefined
      ? undefined
      : assertCoordinatorAuthorityToken(
          options.coordinatorAuthority,
          'application-state destination-authority preflight coordinatorAuthority',
        );
  /** @type {{storeId: string, namespace: string} | undefined} */
  let adoptionScope;
  if (destinationAuthorityFloor !== undefined) {
    assertLogicalId(appId, 'application-state readiness appId');
    if (coordinatorAuthority === undefined) {
      throw new TypeError(
        'Application-state destination-authority preflight requires coordinatorAuthority.',
      );
    }
    if (
      destinationAuthorityFloor.store_id !== expectedStoreId ||
      destinationAuthorityFloor.namespace !== appId
    ) {
      throw new TypeError(
        'Application-state destination-authority floor must match the preflight scope.',
      );
    }
    adoptionScope = { storeId: expectedStoreId, namespace: appId };
  }
  assertApplicationStateStoreIsolation(configuration, controlContext);
  const preflight = await openApplicationStateDB({
    configuration,
    readOnly: true,
  });
  try {
    assertApplicationStateStoreIsolation(preflight.context, controlContext);
    const table = createApplicationStateTable({
      db: preflight.db,
      tableName: preflight.context.tableName,
      ...(coordinatorAuthority === undefined ? {} : { coordinatorAuthority }),
    });
    await table.assertStoreIdentity(expectedStoreId);
    if (
      destinationAuthorityFloor !== undefined &&
      adoptionScope !== undefined
    ) {
      await table.assertCoordinatorAuthorityAdoptionPrecondition(
        adoptionScope,
        { destinationAuthorityFloor },
      );
    }
  } finally {
    await preflight.close();
  }
}

/**
 * Complete the single supported destination handoff before starting a resident
 * worker. PREPARING and ADOPTED live in control; the high-water barrier lives
 * in application data. These are separate commits, not an atomic takeover.
 * Interrupted startup retains its pin and barrier for a fresh, explicitly
 * acquired coordinator to resume. A pinned missing store is never recreated.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, controlContext: {db: import('../lib/db/base.js').DBClient, tableName: string, adapterName: import('../lib/config/db.js').DBAdapterName, controlPath: string}, configuration: ReturnType<typeof validateApplicationStateStoreConfiguration>, signal?: AbortSignal}} options - Already-owned startup capabilities.
 * @returns {Promise<import('../lib/db/tables/application-state-readiness.js').ApplicationStateReadinessRecord>} - Exact ADOPTED control record, not a perpetual readiness capability.
 */
export async function prepareApplicationStateReadiness(options) {
  const ledger = options.ledger;
  const appId = options.appId;
  const controlContext = {
    db: options.controlContext.db,
    tableName: options.controlContext.tableName,
    adapterName: options.controlContext.adapterName,
    controlPath: options.controlContext.controlPath,
  };
  const configuration = validateApplicationStateStoreConfiguration(
    options.configuration,
  );
  const signal = options.signal;
  if (configuration.adapterName !== 'lmdb') {
    throw new TypeError('Resident application-state readiness requires LMDB.');
  }
  assertApplicationStateStoreIsolation(configuration, controlContext);
  signal?.throwIfAborted();
  const coordinatorAuthority =
    await resolveApplicationStateCoordinatorAuthority({
      ledger,
      appId,
      controlContext,
    });
  const readiness = createApplicationStateReadinessStore({
    db: controlContext.db,
    tableName: controlContext.tableName,
    coordinatorAuthority,
  });
  const retained = await readiness.get({ appId });
  const retainedAdopted = retained?.status === 'ADOPTED' ? retained : undefined;
  const destinationAuthorityFloor =
    retainedAdopted !== undefined
      ? createApplicationStateCoordinatorAuthorityRecord({
          storeId: retainedAdopted.store_id,
          namespace: appId,
          authority: applicationStateReadinessAuthority(retainedAdopted),
        })
      : undefined;
  const required = await collectApplicationStateReadinessDestination({
    ledger,
    appId,
    configuration,
    ...(retained
      ? { retainedDestination: applicationStateReadinessDestination(retained) }
      : {}),
    ...(signal === undefined ? {} : { signal }),
  });
  await assertCoordinatorAuthorityCurrent({
    db: controlContext.db,
    tableName: controlContext.tableName,
    authority: coordinatorAuthority,
  });
  signal?.throwIfAborted();
  if (required) {
    await preflightApplicationStateStoreIdentity({
      configuration,
      controlContext,
      expectedStoreId: required.configuration.storeId,
      ...(destinationAuthorityFloor === undefined
        ? {}
        : {
            appId,
            coordinatorAuthority,
            destinationAuthorityFloor,
          }),
    });
  }
  signal?.throwIfAborted();
  const applicationState = await openApplicationStateDB({ configuration });
  try {
    assertApplicationStateStoreIsolation(
      applicationState.context,
      controlContext,
    );
    const table = createApplicationStateTable({
      db: applicationState.db,
      tableName: applicationState.context.tableName,
      coordinatorAuthority,
    });
    const identity = required
      ? await table.assertStoreIdentity(required.configuration.storeId)
      : await table.ensureStoreIdentity();
    // Only first use with no retained destination can initialize identity and
    // its first barrier. There is no dispatch yet. Do not mint an identity in
    // a control intent and recreate it after an ambiguous or lost volume.
    const destination = scopedDestination(
      {
        kind: 'application-state',
        version: 2,
        bindingId: 'primary',
        configuration: {
          provider: configuration.adapterName,
          storeId: identity.store_id,
          tableName: configuration.tableName,
          namespace: appId,
        },
      },
      { appId, ...configuration },
    );
    signal?.throwIfAborted();
    const scope = {
      storeId: destination.configuration.storeId,
      namespace: appId,
    };
    // Preserve an existing ADOPTED row until its destination-local floor has
    // been verified and advanced. A failed adoption must not replace the last
    // confirmed floor with a merely intended PREPARING token.
    if (
      destinationAuthorityFloor !== undefined &&
      retainedAdopted !== undefined
    ) {
      const destinationAuthority = await table.adoptCoordinatorAuthority(
        scope,
        {
          destinationAuthorityFloor,
        },
      );
      signal?.throwIfAborted();
      return await readiness.advanceAdopted({
        predecessor: retainedAdopted,
        destinationAuthority,
      });
    }
    signal?.throwIfAborted();
    const preparation = await readiness.prepare({ destination });
    signal?.throwIfAborted();
    // Another same-token startup may have completed adoption after our initial
    // readiness read. Honor the ADOPTED row returned by prepare instead of
    // letting that stale snapshot select the unguarded PREPARING path.
    if (preparation.status === 'ADOPTED') {
      const observedDestinationAuthorityFloor =
        createApplicationStateCoordinatorAuthorityRecord({
          storeId: preparation.store_id,
          namespace: appId,
          authority: applicationStateReadinessAuthority(preparation),
        });
      const observedDestinationAuthority =
        await table.adoptCoordinatorAuthority(scope, {
          destinationAuthorityFloor: observedDestinationAuthorityFloor,
        });
      signal?.throwIfAborted();
      const observedAdopted = await readiness.advanceAdopted({
        predecessor: preparation,
        destinationAuthority: observedDestinationAuthority,
      });
      return observedAdopted;
    }
    await table.adoptCoordinatorAuthority(scope);
    const destinationAuthority = await table.readCoordinatorAuthority(scope);
    signal?.throwIfAborted();
    return await readiness.markAdopted({ preparation, destinationAuthority });
  } finally {
    await applicationState.close();
  }
}
