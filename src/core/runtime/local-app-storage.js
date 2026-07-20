/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import path from 'node:path';

import { assertLogicalId } from './logical-id.js';

export const LOCAL_APP_EXECUTION_LEDGER_TABLE = 'wharfie-execution-ledger-v10';

/**
 * @param {unknown} value - Candidate absolute path.
 * @param {string} label - Boundary label.
 * @returns {string} - Canonical absolute path.
 */
function canonicalAbsolutePath(value, label) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.includes('\0') ||
    value.includes('\n') ||
    value.includes('\r') ||
    !path.isAbsolute(value) ||
    path.normalize(value) !== value
  ) {
    throw new TypeError(`${label} must be a canonical absolute path.`);
  }
  return value;
}

/**
 * Derive the one local durable-storage layout for a packaged application.
 * The layout exists independently of whether the application is installed as
 * an operating-system service, so foreground operators and a resident always
 * address the same ledger and application-state roots.
 * @param {{appId: string, dataRoot: string}} input - Stable data root and embedded application identity.
 * @returns {Readonly<Record<string, string>>} - Canonical app-scoped storage layout.
 */
export function createLocalAppStorageLayout(input) {
  assertLogicalId(input?.appId, 'local app storage appId');
  const dataRoot = canonicalAbsolutePath(
    input?.dataRoot,
    'local app storage dataRoot',
  );
  const appRoot = path.join(dataRoot, 'applications', input.appId);
  const stateRoot = path.join(appRoot, 'state');
  const controlPath = path.join(stateRoot, 'control');
  return Object.freeze({
    appId: input.appId,
    dataRoot,
    appRoot,
    stateRoot,
    controlPath,
    payloadPath: path.join(controlPath, 'execution-payloads'),
    applicationStatePath: path.join(stateRoot, 'application-state'),
    sessionPath: path.join(controlPath, 'ledger-service-sessions'),
    executionLedgerTable: LOCAL_APP_EXECUTION_LEDGER_TABLE,
  });
}

export default createLocalAppStorageLayout;
