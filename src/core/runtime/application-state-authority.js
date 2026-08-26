import {
  assertCoordinatorAuthorityCurrent,
  assertCoordinatorAuthorityToken,
} from '../lib/db/tables/coordinator-authority.js';
import { assertLogicalId } from './logical-id.js';

/**
 * Snapshot the exact coordinator held by a writable host before it opens a
 * catalog binding. The control read only refuses already-observed loss of
 * authority; destination-local transaction fencing remains independent and
 * cannot be made atomic with this read across the two stores.
 * @param {{ledger: import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, appId: string, controlContext: {db: import('../lib/db/base.js').DBClient, tableName: string}}} options - Already-owned production capabilities.
 * @returns {Promise<import('../lib/db/tables/coordinator-authority.js').CoordinatorAuthorityToken>} - Captured token, never a replacement read from current state.
 */
export async function resolveApplicationStateCoordinatorAuthority(options) {
  const candidate =
    typeof options.ledger?.getCoordinatorAuthority === 'function'
      ? options.ledger.getCoordinatorAuthority()
      : undefined;
  if (candidate === undefined) {
    throw new TypeError(
      'Writable application-state access requires a coordinator-bound ledger.',
    );
  }
  const authority = assertCoordinatorAuthorityToken(
    candidate,
    'Application-state coordinator authority',
  );
  const appId = options.appId;
  assertLogicalId(appId, 'Application-state appId');
  if (authority.appId !== appId) {
    throw new TypeError(
      'Application-state coordinator authority must bind the catalog appId.',
    );
  }
  const db = options.controlContext.db;
  const tableName = options.controlContext.tableName;
  await assertCoordinatorAuthorityCurrent({ db, tableName, authority });
  return authority;
}
