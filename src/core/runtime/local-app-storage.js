/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import path from 'node:path';
import { userInfo } from 'node:os';
import process from 'node:process';

import { assertLogicalId } from './logical-id.js';

export const LOCAL_APP_EXECUTION_LEDGER_TABLE = 'wharfie-execution-ledger-v10';
export const LOCAL_APP_DATA_ROOT_ENVIRONMENT_VARIABLE = 'WHARFIE_DATA_ROOT';

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
 * Resolve the account-stable packaged data root without consulting ambient
 * XDG or shell-home variables. A packaged executable must find the same
 * durable app state when invoked interactively and by an OS service manager.
 * @param {{platform?: string, homeDirectory?: string}} [options] - Testable account identity.
 * @returns {string} - Canonical account-local Wharfie data root.
 */
export function resolveStableLocalAppDataRoot(options = {}) {
  const platform = options.platform ?? process.platform;
  if (typeof platform !== 'string' || !platform) {
    throw new TypeError(
      'local app storage platform must be a nonempty string.',
    );
  }
  const homeDirectory = canonicalAbsolutePath(
    options.homeDirectory ?? userInfo().homedir,
    'local app storage homeDirectory',
  );
  if (platform === 'darwin') {
    return path.join(
      homeDirectory,
      'Library',
      'Application Support',
      'wharfie-nodejs',
    );
  }
  if (platform === 'win32') {
    return path.join(
      homeDirectory,
      'AppData',
      'Local',
      'wharfie-nodejs',
      'Data',
    );
  }
  return path.join(homeDirectory, '.local', 'share', 'wharfie-nodejs');
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
