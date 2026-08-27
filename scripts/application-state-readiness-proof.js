import assert from 'node:assert/strict';
import { lstatSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Require a fully existing native volume before opening a read-only facade.
 * Even the lock file must already belong to the SEA, not this observer.
 * @param {string} storePath - Independently derived sealed store route.
 * @returns {{root: string, data: import('node:fs').BigIntStats, lock: import('node:fs').BigIntStats}} - Physical read-only separation evidence.
 */
function existingVolume(storePath) {
  assert.ok(
    path.isAbsolute(storePath),
    'readiness proof requires absolute store paths',
  );
  const root = path.join(storePath, 'lmdb');
  const rootStat = lstatSync(root);
  assert.ok(
    rootStat.isDirectory() && !rootStat.isSymbolicLink(),
    'readiness proof requires an existing non-symlink LMDB directory',
  );
  const data = lstatSync(path.join(root, 'data.mdb'), { bigint: true });
  const lock = lstatSync(path.join(root, 'lock.mdb'), { bigint: true });
  assert.ok(
    data.isFile() && !data.isSymbolicLink(),
    'readiness proof requires an existing LMDB data file',
  );
  assert.ok(
    lock.isFile() && !lock.isSymbolicLink(),
    'readiness proof requires an existing LMDB lock file',
  );
  return { root: realpathSync(root), data, lock };
}

/**
 * Observe the installed runtime's exact readiness, source authority, and
 * destination barrier at every live READY checkpoint. All handles are opened
 * read-only after both SEA-owned volumes exist; this helper cannot prepare,
 * adopt, initialize, or repair any evidence that it is supposed to prove.
 * These are independent readbacks, not a multi-store atomic snapshot. A final
 * control/lifecycle recheck refuses a handoff that occurred during observation.
 * @param {{installedPackageRoot: string, controlPath: string, applicationStatePath: string, tableName: string, appId: string}} options - Independently derived packaged routes.
 * @param {{openReadOnlyDB?: (options: {path: string, readOnly: true}) => import('../src/core/lib/db/base.js').DBClient}} [ports] - Optional read-only adapter port for focused assertion tests.
 * @returns {Promise<{assertReady: (snapshot: Record<string, any> | null) => Promise<Readonly<Record<string, any>>>}>} - Exact live-READY proof.
 */
export async function createPackageSeaApplicationStateReadinessProof(
  options,
  ports = {},
) {
  const scope = Object.freeze({
    installedPackageRoot: options.installedPackageRoot,
    controlPath: options.controlPath,
    applicationStatePath: options.applicationStatePath,
    tableName: options.tableName,
    appId: options.appId,
  });
  const installedModule = async (/** @type {string} */ relativePath) =>
    await import(
      pathToFileURL(path.join(scope.installedPackageRoot, relativePath)).href
    );
  const [
    adapter,
    lifecycleModule,
    readinessModule,
    authorityModule,
    applicationModule,
    barrierModule,
    dbConfig,
  ] = await Promise.all([
    installedModule('src/core/lib/db/adapters/lmdb.js'),
    installedModule('src/core/lib/db/tables/ledger-service-lifecycle.js'),
    installedModule('src/core/lib/db/tables/application-state-readiness.js'),
    installedModule('src/core/lib/db/tables/coordinator-authority.js'),
    installedModule('src/core/lib/db/tables/application-state.js'),
    installedModule('src/core/lib/db/tables/application-state-authority.js'),
    installedModule('src/core/lib/config/db.js'),
  ]);
  const openReadOnly = ports.openReadOnlyDB ?? adapter.default;
  const serviceId = lifecycleModule.createLedgerServiceId({
    appId: scope.appId,
  });
  /** @type {{destination: Record<string, any>, authority: Record<string, any>} | undefined} */
  let previous;

  /**
   * @param {Record<string, any> | null} snapshot - Lifecycle observed from the live SEA.
   * @returns {Promise<Readonly<Record<string, any>>>} - Verified read-only evidence.
   */
  async function assertReady(snapshot) {
    assert.ok(snapshot, 'live READY proof requires a lifecycle snapshot');
    const expected = Object.freeze({
      status: snapshot.status,
      serviceId: snapshot.serviceId,
      appId: snapshot.appId,
      revisionId: snapshot.revisionId,
      sessionId: snapshot.sessionId,
      generation: snapshot.generation,
    });
    assert.equal(
      expected.status,
      'READY',
      'readiness proof requires a live READY lifecycle',
    );
    assert.equal(expected.serviceId, serviceId);
    assert.equal(expected.appId, scope.appId);
    assert.equal(typeof expected.sessionId, 'string');
    assert.ok(expected.sessionId.length > 0);
    assert.ok(
      Number.isSafeInteger(expected.generation) && expected.generation > 0,
    );

    const controlVolume = existingVolume(scope.controlPath);
    const destinationVolume = existingVolume(scope.applicationStatePath);
    assert.notEqual(
      controlVolume.root,
      destinationVolume.root,
      'READY must use a separate application-state LMDB volume',
    );
    for (const file of /** @type {const} */ (['data', 'lock'])) {
      assert.ok(
        controlVolume[file].dev !== destinationVolume[file].dev ||
          controlVolume[file].ino !== destinationVolume[file].ino,
        `READY control and application-state ${file} files must not alias`,
      );
    }

    const controlDB = openReadOnly({ path: scope.controlPath, readOnly: true });
    try {
      const readinessStore =
        readinessModule.createApplicationStateReadinessStore({
          db: controlDB,
          tableName: scope.tableName,
        });
      const readiness = await readinessStore.get({ appId: scope.appId });
      assert.ok(
        readiness,
        'READY has no retained application-state readiness pin',
      );
      assert.equal(
        readiness.status,
        'ADOPTED',
        'READY application-state pin must be ADOPTED',
      );
      const token =
        readinessModule.applicationStateReadinessAuthority(readiness);
      const destination =
        readinessModule.applicationStateReadinessDestination(readiness);
      assert.equal(token.appId, scope.appId);
      assert.equal(
        token.coordinatorId,
        expected.sessionId,
        'READY session does not own the readiness token',
      );
      assert.deepEqual(destination, {
        kind: 'application-state',
        version: 2,
        bindingId: 'primary',
        configuration: {
          provider: 'lmdb',
          storeId: readiness.store_id,
          tableName: dbConfig.APPLICATION_STATE_TABLE_NAME,
          namespace: scope.appId,
        },
      });
      await authorityModule.assertCoordinatorAuthorityCurrent({
        db: controlDB,
        tableName: scope.tableName,
        authority: token,
      });
      if (previous) {
        assert.deepEqual(
          destination,
          previous.destination,
          'resident restart changed its retained primary destination',
        );
        if (token.coordinatorId === previous.authority.coordinatorId) {
          assert.deepEqual(
            token,
            previous.authority,
            'one READY session changed its captured coordinator token',
          );
        } else {
          assert.ok(
            token.epoch > previous.authority.epoch,
            'replacement READY session did not advance coordinator authority',
          );
        }
      }

      const applicationDB = openReadOnly({
        path: scope.applicationStatePath,
        readOnly: true,
      });
      let storeIdentity;
      let destinationAuthority;
      try {
        const applicationTable = applicationModule.createApplicationStateTable({
          db: applicationDB,
          tableName: destination.configuration.tableName,
        });
        storeIdentity = await applicationTable.assertStoreIdentity(
          destination.configuration.storeId,
        );
        destinationAuthority = await applicationTable.readCoordinatorAuthority({
          storeId: destination.configuration.storeId,
          namespace: scope.appId,
        });
        assert.deepEqual(
          destinationAuthority,
          barrierModule.createApplicationStateCoordinatorAuthorityRecord({
            storeId: destination.configuration.storeId,
            namespace: scope.appId,
            authority: token,
          }),
          'READY destination does not retain the exact same store/app/coordinator barrier',
        );
        assert.equal(
          destinationAuthority.record_digest,
          readiness.destination_authority_digest,
        );
      } finally {
        await applicationDB.close();
      }

      assert.deepEqual(
        await readinessStore.get({ appId: scope.appId }),
        readiness,
        'READY control pin changed during separate destination observation',
      );
      const currentLifecycle = await lifecycleModule
        .createLedgerServiceLifecycle({
          db: controlDB,
          tableName: scope.tableName,
        })
        .get({ serviceId });
      assert.ok(
        currentLifecycle,
        'READY lifecycle disappeared during readiness observation',
      );
      for (const [field, value] of Object.entries(expected)) {
        assert.equal(
          currentLifecycle[field],
          value,
          `READY lifecycle ${field} changed during readiness observation`,
        );
      }
      const ownership = await lifecycleModule
        .createLedgerServiceOwnership({
          db: controlDB,
          tableName: scope.tableName,
        })
        .getOwnership({ serviceId });
      assert.ok(ownership, 'READY resident has no retained local ownership');
      assert.equal(ownership.ownerKind, 'resident');
      assert.equal(ownership.appId, scope.appId);
      assert.equal(
        ownership.sessionId,
        expected.sessionId,
        'READY local ownership names a different session',
      );
      const authority = await authorityModule.assertCoordinatorAuthorityCurrent(
        { db: controlDB, tableName: scope.tableName, authority: token },
      );
      previous = { destination, authority: token };
      return Object.freeze({
        readiness,
        authority,
        storeIdentity,
        destinationAuthority,
      });
    } finally {
      await controlDB.close();
    }
  }

  return Object.freeze({ assertReady });
}
