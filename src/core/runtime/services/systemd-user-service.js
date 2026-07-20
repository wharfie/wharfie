/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import path from 'node:path';

import { assertArtifactId } from '../artifact-record.js';
import {
  assertApplicationRevisionId,
  validateSha256Digest,
} from '../application-revision.js';
import { validateBuildTarget } from '../build-target.js';
import { cloneJsonObject } from '../json-value.js';
import {
  LOCAL_APP_EXECUTION_LEDGER_TABLE,
  createLocalAppStorageLayout,
} from '../local-app-storage.js';
import { assertLogicalId } from '../logical-id.js';

export const SYSTEMD_USER_SERVICE_SCHEMA_VERSION = 1;
export const SYSTEMD_USER_SERVICE_RELEASE_KIND =
  'wharfie.systemd-user-service.release';
export const SYSTEMD_USER_SERVICE_INSTALLATION_KIND =
  'wharfie.systemd-user-service.installation';
export const SYSTEMD_USER_SERVICE_EXECUTION_LEDGER_TABLE =
  LOCAL_APP_EXECUTION_LEDGER_TABLE;

const RELEASE_KEYS = new Set([
  'schemaVersion',
  'kind',
  'appId',
  'artifactId',
  'revisionId',
  'byteDigest',
  'size',
  'target',
  'installedAt',
  'artifactPath',
]);
const INSTALLATION_KEYS = new Set([
  'schemaVersion',
  'kind',
  'state',
  'appId',
  'unitName',
  'principal',
  'layout',
  'current',
  'previous',
  'installedAt',
  'updatedAt',
]);
const PRINCIPAL_KEYS = new Set(['uid', 'linger']);
const LAYOUT_KEYS = new Set([
  'appId',
  'dataRoot',
  'configRoot',
  'serviceRoot',
  'releasesRoot',
  'currentLink',
  'currentArtifact',
  'stateRoot',
  'controlPath',
  'payloadPath',
  'applicationStatePath',
  'sessionPath',
  'installationPath',
  'uninstallPath',
  'unitName',
  'unitPath',
  'executionLedgerTable',
]);
const SYSTEMD_STATUS_PROPERTIES = Object.freeze({
  LoadState: 'loadState',
  UnitFileState: 'unitFileState',
  ActiveState: 'activeState',
  SubState: 'subState',
  Result: 'result',
  MainPID: 'mainPid',
  ExecMainStatus: 'execMainStatus',
  FragmentPath: 'fragmentPath',
  DropInPaths: 'dropInPaths',
});

/**
 * @param {Record<string, any>} value - Object to inspect.
 * @param {Set<string>} keys - Exact supported keys.
 * @param {string} label - Boundary label.
 * @returns {void} - Returns after exact field validation.
 */
function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value);
  if (actual.length !== keys.size) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
  for (const key of actual) {
    if (!keys.has(key))
      throw new TypeError(`${label}.${key} is not supported.`);
  }
}

/**
 * @param {unknown} value - Candidate timestamp or size.
 * @param {string} label - Boundary label.
 * @returns {number} - Valid nonnegative safe integer.
 */
function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a nonnegative safe integer.`);
  }
  return Number(value);
}

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
 * Create the only supported app-scoped systemd user-service layout. Runtime
 * state stays outside immutable release directories.
 * @param {{appId: string, dataRoot: string, configRoot: string}} input - Stable roots and application identity.
 * @returns {Readonly<Record<string, string>>} - Canonical layout.
 */
export function createSystemdUserServiceLayout(input) {
  const storage = createLocalAppStorageLayout({
    appId: input?.appId,
    dataRoot: input?.dataRoot,
  });
  const configRoot = canonicalAbsolutePath(
    input?.configRoot,
    'systemd user service configRoot',
  );
  const appId = storage.appId;
  const unitName = `wharfie-${appId}.service`;
  const serviceRoot = storage.appRoot;
  return Object.freeze({
    appId,
    dataRoot: storage.dataRoot,
    configRoot,
    serviceRoot,
    releasesRoot: path.join(serviceRoot, 'releases'),
    currentLink: path.join(serviceRoot, 'current'),
    currentArtifact: path.join(serviceRoot, 'current', 'app'),
    stateRoot: storage.stateRoot,
    controlPath: storage.controlPath,
    payloadPath: storage.payloadPath,
    applicationStatePath: storage.applicationStatePath,
    sessionPath: storage.sessionPath,
    installationPath: path.join(serviceRoot, 'installation.json'),
    uninstallPath: path.join(serviceRoot, '.uninstalling.json'),
    unitName,
    unitPath: path.join(configRoot, 'systemd', 'user', unitName),
    executionLedgerTable: storage.executionLedgerTable,
  });
}

/**
 * Validate a persisted layout by deriving it again from its only independent
 * roots. This rejects path-by-path installation-record redirection.
 * @param {unknown} value - Candidate layout.
 * @param {string} [label] - Boundary label.
 * @returns {Readonly<Record<string, string>>} - Canonical layout.
 */
export function validateSystemdUserServiceLayout(
  value,
  label = 'systemd user service layout',
) {
  const candidate = cloneJsonObject(value, label);
  assertExactKeys(candidate, LAYOUT_KEYS, label);
  const expected = createSystemdUserServiceLayout({
    appId: candidate.appId,
    dataRoot: candidate.dataRoot,
    configRoot: candidate.configRoot,
  });
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (candidate[key] !== expectedValue) {
      throw new TypeError(`${label}.${key} does not match its derived path.`);
    }
  }
  return expected;
}

/**
 * @param {string} value - Unit argument.
 * @returns {string} - Quoted unit-setting word with literal specifiers.
 */
function quoteSystemdSettingWord(value) {
  return `"${String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')}"`;
}

/**
 * Exec directives additionally expand `$NAME` and `${NAME}`. Doubling every
 * dollar sign is the systemd command-line escape for an exact literal dollar.
 * @param {string} value - Executable argument.
 * @returns {string} - Quoted systemd command word.
 */
function quoteSystemdExecWord(value) {
  return quoteSystemdSettingWord(value).replace(/\$/g, () => '$$');
}

/**
 * @param {string} name - Environment name.
 * @param {string} value - Environment value.
 * @returns {string} - Fixed Environment directive.
 */
function environmentDirective(name, value) {
  return `Environment=${quoteSystemdSettingWord(`${name}=${value}`)}`;
}

/**
 * Render the fixed user unit for the existing hidden resident runtime. No
 * caller-controlled environment or command arguments enter the unit.
 * @param {{layout: unknown}} input - Validated service layout.
 * @returns {string} - Complete deterministic unit text.
 */
export function createSystemdUserServiceUnit(input) {
  const layout = validateSystemdUserServiceLayout(input?.layout);
  return [
    '[Unit]',
    `Description=Wharfie application ${layout.appId}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=exec',
    `ExecStart=${quoteSystemdExecWord(layout.currentArtifact)}`,
    `WorkingDirectory=${quoteSystemdSettingWord(layout.stateRoot)}`,
    environmentDirective('WHARFIE_RUNTIME_COMMAND', 'ledger-service'),
    environmentDirective('WHARFIE_RUNTIME_ARGS', '[]'),
    environmentDirective('WHARFIE_CONTROL_ADAPTER', 'lmdb'),
    environmentDirective('WHARFIE_CONTROL_PATH', layout.controlPath),
    environmentDirective('WHARFIE_EXECUTION_PAYLOAD_PATH', layout.payloadPath),
    environmentDirective('WHARFIE_EXECUTION_PAYLOAD_STORE_ID', ''),
    environmentDirective(
      'WHARFIE_EXECUTION_LEDGER_TABLE',
      layout.executionLedgerTable,
    ),
    environmentDirective(
      'WHARFIE_LEDGER_SERVICE_SESSION_PATH',
      layout.sessionPath,
    ),
    environmentDirective('WHARFIE_APPLICATION_STATE_ADAPTER', 'lmdb'),
    environmentDirective(
      'WHARFIE_APPLICATION_STATE_PATH',
      layout.applicationStatePath,
    ),
    'Restart=on-failure',
    'RestartSec=5s',
    'KillSignal=SIGTERM',
    'KillMode=mixed',
    'TimeoutStopSec=45s',
    'UMask=0077',
    'NoNewPrivileges=true',
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

/**
 * @param {unknown} value - Candidate release record.
 * @param {string} [label] - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Validated release.
 */
export function validateSystemdUserServiceRelease(
  value,
  label = 'systemd user service release',
) {
  const release = cloneJsonObject(value, label);
  assertExactKeys(release, RELEASE_KEYS, label);
  if (release.schemaVersion !== SYSTEMD_USER_SERVICE_SCHEMA_VERSION) {
    throw new TypeError(`${label}.schemaVersion must be 1.`);
  }
  if (release.kind !== SYSTEMD_USER_SERVICE_RELEASE_KIND) {
    throw new TypeError(`${label}.kind is unsupported.`);
  }
  assertLogicalId(release.appId, `${label}.appId`);
  assertArtifactId(release.artifactId, `${label}.artifactId`);
  assertApplicationRevisionId(release.revisionId, `${label}.revisionId`);
  const byteDigest = validateSha256Digest(
    release.byteDigest,
    `${label}.byteDigest`,
  );
  if (release.artifactId !== `waf1_${byteDigest.value}`) {
    throw new TypeError(`${label}.artifactId does not match byteDigest.`);
  }
  const size = nonnegativeInteger(release.size, `${label}.size`);
  const installedAt = nonnegativeInteger(
    release.installedAt,
    `${label}.installedAt`,
  );
  const target = validateBuildTarget(release.target, `${label}.target`);
  const artifactPath = canonicalAbsolutePath(
    release.artifactPath,
    `${label}.artifactPath`,
  );
  return Object.freeze({
    schemaVersion: SYSTEMD_USER_SERVICE_SCHEMA_VERSION,
    kind: SYSTEMD_USER_SERVICE_RELEASE_KIND,
    appId: release.appId,
    artifactId: release.artifactId,
    revisionId: release.revisionId,
    byteDigest: Object.freeze(byteDigest),
    size,
    target: Object.freeze(target),
    installedAt,
    artifactPath,
  });
}

/**
 * @param {{appId: string, artifactId: string, revisionId: string, byteDigest: unknown, size: number, target: unknown, installedAt: number, artifactPath: string}} input - Release fields.
 * @returns {Readonly<Record<string, any>>} - Strict release record.
 */
export function createSystemdUserServiceRelease(input) {
  return validateSystemdUserServiceRelease({
    schemaVersion: SYSTEMD_USER_SERVICE_SCHEMA_VERSION,
    kind: SYSTEMD_USER_SERVICE_RELEASE_KIND,
    ...input,
  });
}

/**
 * @param {unknown} value - Candidate installation record.
 * @param {string} [label] - Boundary label.
 * @returns {Readonly<Record<string, any>>} - Validated installation.
 */
export function validateSystemdUserServiceInstallation(
  value,
  label = 'systemd user service installation',
) {
  const installation = cloneJsonObject(value, label);
  assertExactKeys(installation, INSTALLATION_KEYS, label);
  if (installation.schemaVersion !== SYSTEMD_USER_SERVICE_SCHEMA_VERSION) {
    throw new TypeError(`${label}.schemaVersion must be 1.`);
  }
  if (installation.kind !== SYSTEMD_USER_SERVICE_INSTALLATION_KIND) {
    throw new TypeError(`${label}.kind is unsupported.`);
  }
  if (
    installation.state !== 'installed' &&
    installation.state !== 'uninstalled'
  ) {
    throw new TypeError(`${label}.state must be 'installed' or 'uninstalled'.`);
  }
  assertLogicalId(installation.appId, `${label}.appId`);
  const layout = validateSystemdUserServiceLayout(
    installation.layout,
    `${label}.layout`,
  );
  if (
    layout.appId !== installation.appId ||
    installation.unitName !== layout.unitName
  ) {
    throw new TypeError(`${label} does not match its derived layout.`);
  }
  const principal = cloneJsonObject(
    installation.principal,
    `${label}.principal`,
  );
  assertExactKeys(principal, PRINCIPAL_KEYS, `${label}.principal`);
  const uid = nonnegativeInteger(principal.uid, `${label}.principal.uid`);
  if (principal.linger !== true) {
    throw new TypeError(`${label}.principal.linger must be true.`);
  }
  const current = validateSystemdUserServiceRelease(
    installation.current,
    `${label}.current`,
  );
  const previous =
    installation.previous === null
      ? null
      : validateSystemdUserServiceRelease(
          installation.previous,
          `${label}.previous`,
        );
  const selectedReleases =
    /** @type {Array<[string, Readonly<Record<string, any>> | null]>} */ ([
      ['current', current],
      ['previous', previous],
    ]);
  for (const [name, release] of selectedReleases) {
    if (!release) continue;
    if (
      release.appId !== installation.appId ||
      release.artifactPath !==
        path.join(layout.releasesRoot, release.artifactId, 'app')
    ) {
      throw new TypeError(`${label}.${name} does not match its layout.`);
    }
  }
  if (previous?.artifactId === current.artifactId) {
    throw new TypeError(`${label}.previous must differ from current.`);
  }
  const installedAt = nonnegativeInteger(
    installation.installedAt,
    `${label}.installedAt`,
  );
  const updatedAt = nonnegativeInteger(
    installation.updatedAt,
    `${label}.updatedAt`,
  );
  if (
    updatedAt < installedAt ||
    current.installedAt > updatedAt ||
    (previous !== null && previous.installedAt > updatedAt)
  ) {
    throw new TypeError(`${label} timestamps are inconsistent.`);
  }
  return Object.freeze({
    schemaVersion: SYSTEMD_USER_SERVICE_SCHEMA_VERSION,
    kind: SYSTEMD_USER_SERVICE_INSTALLATION_KIND,
    state: installation.state,
    appId: installation.appId,
    unitName: layout.unitName,
    principal: Object.freeze({ uid, linger: true }),
    layout,
    current,
    previous,
    installedAt,
    updatedAt,
  });
}

/**
 * @param {{layout: unknown, uid: number, current: unknown, previous?: unknown, state?: 'installed'|'uninstalled', installedAt: number, updatedAt: number}} input - Installation fields.
 * @returns {Readonly<Record<string, any>>} - Strict installation record.
 */
export function createSystemdUserServiceInstallation(input) {
  const layout = validateSystemdUserServiceLayout(input?.layout);
  return validateSystemdUserServiceInstallation({
    schemaVersion: SYSTEMD_USER_SERVICE_SCHEMA_VERSION,
    kind: SYSTEMD_USER_SERVICE_INSTALLATION_KIND,
    state: input.state || 'installed',
    appId: layout.appId,
    unitName: layout.unitName,
    principal: { uid: input.uid, linger: true },
    layout,
    current: input.current,
    previous: input.previous ?? null,
    installedAt: input.installedAt,
    updatedAt: input.updatedAt,
  });
}

/**
 * Parse the exact property subset requested from `systemctl --user show`.
 * Unknown, duplicate, missing, or multiline fields fail closed.
 * @param {string} text - Raw systemctl output.
 * @returns {Readonly<{loadState: string, unitFileState: string, activeState: string, subState: string, result: string, mainPid: number, execMainStatus: number, fragmentPath: string, dropInPaths: string}>} - Parsed manager status.
 */
export function parseSystemdUserServiceStatus(text) {
  if (typeof text !== 'string') {
    throw new TypeError('systemd user service status must be text.');
  }
  /** @type {Record<string, string | number>} */
  const parsed = {};
  const lines = text.endsWith('\n')
    ? text.slice(0, -1).split('\n')
    : text.split('\n');
  for (const line of lines) {
    const separator = line.indexOf('=');
    if (separator <= 0) {
      throw new TypeError('systemd user service status is malformed.');
    }
    const property = line.slice(0, separator);
    const outputName =
      SYSTEMD_STATUS_PROPERTIES[
        /** @type {keyof typeof SYSTEMD_STATUS_PROPERTIES} */ (property)
      ];
    if (
      !outputName ||
      Object.prototype.hasOwnProperty.call(parsed, outputName)
    ) {
      throw new TypeError(
        'systemd user service status has unsupported fields.',
      );
    }
    const value = line.slice(separator + 1);
    if (property === 'MainPID' || property === 'ExecMainStatus') {
      if (!/^(0|[1-9]\d*)$/.test(value)) {
        throw new TypeError(
          `systemd user service status ${property} is invalid.`,
        );
      }
      parsed[outputName] = nonnegativeInteger(Number(value), property);
    } else if (property === 'DropInPaths') {
      if (value.trim() !== value) {
        throw new TypeError(
          'systemd user service status DropInPaths is invalid.',
        );
      }
      parsed[outputName] = value;
    } else {
      if (!value || value.trim() !== value) {
        throw new TypeError(
          `systemd user service status ${property} is invalid.`,
        );
      }
      parsed[outputName] = value;
    }
  }
  if (
    Object.keys(parsed).length !== Object.keys(SYSTEMD_STATUS_PROPERTIES).length
  ) {
    throw new TypeError('systemd user service status is missing fields.');
  }
  return /** @type {any} */ (Object.freeze(parsed));
}

export default {
  SYSTEMD_USER_SERVICE_EXECUTION_LEDGER_TABLE,
  SYSTEMD_USER_SERVICE_INSTALLATION_KIND,
  SYSTEMD_USER_SERVICE_RELEASE_KIND,
  SYSTEMD_USER_SERVICE_SCHEMA_VERSION,
  createSystemdUserServiceInstallation,
  createSystemdUserServiceLayout,
  createSystemdUserServiceRelease,
  createSystemdUserServiceUnit,
  parseSystemdUserServiceStatus,
  validateSystemdUserServiceInstallation,
  validateSystemdUserServiceLayout,
  validateSystemdUserServiceRelease,
};
