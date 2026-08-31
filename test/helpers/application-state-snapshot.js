import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createApplicationStateCoordinatorAuthorityRecord } from '../../src/core/lib/db/tables/application-state-authority.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import {
  APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND,
  APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
  createApplicationStateSnapshotReference,
  normalizeApplicationStateSnapshotTransport,
} from '../../src/core/runtime/application-state-snapshot.js';

/** @param {string} prefix @param {string} label */
function id(prefix, label) {
  return createCanonicalJsonSha256Id({
    domain: `wharfie:test:application-state-snapshot:${prefix}`,
    prefix,
    value: { label },
  });
}

/** @param {{appId: string, label?: string, epoch?: number, coordinatorId?: string}} options */
export function createTestCoordinatorAuthority(options) {
  const label = options.label ?? 'source';
  const epoch = options.epoch ?? 1;
  const coordinatorId = options.coordinatorId ?? `coordinator-${label}`;
  return Object.freeze({
    schemaVersion: 1,
    appId: options.appId,
    coordinatorId,
    authorityId: createCanonicalJsonSha256Id({
      domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
      prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
      value: {
        schemaVersion: 1,
        appId: options.appId,
        coordinatorId,
        epoch,
        requestId: `request-${label}`,
      },
    }),
    epoch,
  });
}

/** @param {{appId: string, label?: string, visitedRuns?: number, applicationStateEffects?: number, unsettledEffects?: number}} options */
export function createTestApplicationStateHistory(options) {
  const label = options.label ?? 'history';
  return Object.freeze({
    schemaVersion: 1,
    kind: 'applicationStateHistoryCheckpoint',
    appId: options.appId,
    historyDigest: id('wash1', `${options.appId}-${label}`),
    visitedRuns: options.visitedRuns ?? 0,
    applicationStateEffects: options.applicationStateEffects ?? 0,
    unsettledEffects: options.unsettledEffects ?? 0,
  });
}

/** @param {{appId: string, authority: unknown, label?: string, version?: number}} options */
export function createTestClosedBarrier(options) {
  const label = options.label ?? 'checkpoint';
  return Object.freeze({
    schemaVersion: 1,
    appId: options.appId,
    state: 'CLOSED',
    version: options.version ?? 1,
    authority: options.authority,
    lastAction: 'close',
    lastRequestId: `close-${label}`,
    updatedAt: 1,
  });
}

/**
 * @param {{destination: Record<string, any>, label?: string, authority?: Record<string, any>, history?: Record<string, any>, barrier?: Record<string, any>, bytes?: Buffer}} options
 */
export function createTestApplicationStateTransport(options) {
  const label = options.label ?? 'snapshot';
  const { namespace: appId, storeId } = options.destination.configuration;
  const authority =
    options.authority ?? createTestCoordinatorAuthority({ appId, label });
  const history =
    options.history ?? createTestApplicationStateHistory({ appId, label });
  const closedBarrier =
    options.barrier ??
    createTestClosedBarrier({ appId, authority, label, version: 1 });
  const sourceDestinationAuthorityDigest =
    createApplicationStateCoordinatorAuthorityRecord({
      storeId,
      namespace: appId,
      authority: closedBarrier.authority,
    }).record_digest;
  const snapshot = createApplicationStateSnapshotReference({
    bytes: options.bytes ?? Buffer.from(`application-state-${label}`, 'utf8'),
    destination: options.destination,
    transferId: id('wast1', `${storeId}-${label}`),
    history,
    closedBarrier,
    sourceDestinationAuthorityDigest,
  });
  return normalizeApplicationStateSnapshotTransport({
    kind: APPLICATION_STATE_SNAPSHOT_TRANSPORT_KIND,
    distribution: {
      kind: APPLICATION_STATE_SNAPSHOT_DISTRIBUTION_KIND,
      distributionId: id('wasd1', `${storeId}-${label}`),
      storeId,
    },
    snapshot,
  });
}

export default createTestApplicationStateTransport;
