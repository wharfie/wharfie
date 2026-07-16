import fs from 'node:fs/promises';
import path from 'node:path';

import { stringifyAppManifest } from '../../../../runtime/app-manifest.js';
import { getManifestAppId, getManifestPrimaryTarget } from './app-manifest.js';
import {
  BOOTSTRAP_MODE_STATE_START,
  createBootstrapEnvironment,
} from './bootstrap-mode.js';

/**
 * @param {string} value - value.
 * @returns {string} - Result.
 */
export function sanitizeNameSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/--+/g, '-');
}

/**
 * @param {any} manifest - manifest.
 * @returns {string} - Result.
 */
export function getManifestTargetSelector(manifest) {
  const target = getManifestPrimaryTarget(manifest);
  if (!target) {
    return `node${process.versions.node}-${process.platform}-${process.arch}`;
  }

  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

/**
 * @param {string} value - value.
 * @returns {string} - Result.
 */
function escapeSystemdValue(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

/**
 * @param {string} value - value.
 * @returns {string} - Result.
 */
function shellQuote(value) {
  const stringValue = String(value);
  if (!/[\s"'\\$`]/.test(stringValue)) {
    return stringValue;
  }
  return `"${stringValue.replace(/(["\\$`])/g, '\\$1')}"`;
}

/**
 * @param {Record<string, string>} environment - environment.
 * @returns {string[]} - Result.
 */
function formatEnvironmentLines(environment) {
  return Object.keys(environment)
    .sort((left, right) => left.localeCompare(right))
    .map((key) => `Environment=${key}=${escapeSystemdValue(environment[key])}`);
}

/**
 * @typedef SystemdUnitOptions
 * @property {string} description - description.
 * @property {string} execStart - execStart.
 * @property {string} workingDirectory - workingDirectory.
 * @property {string} [user] - user.
 * @property {string} [restartPolicy] - restartPolicy.
 * @property {number} [restartSeconds] - restartSeconds.
 * @property {Record<string, string>} [environment] - environment.
 */

/**
 * @param {SystemdUnitOptions} options - options.
 * @returns {string} - Result.
 */
export function buildLinuxSystemdUnit(options) {
  const {
    description,
    execStart,
    workingDirectory,
    user = 'root',
    restartPolicy = 'always',
    restartSeconds = 5,
    environment = {},
  } = options;

  return [
    '[Unit]',
    `Description=${description}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `User=${user}`,
    `WorkingDirectory=${workingDirectory}`,
    `ExecStart=${execStart}`,
    `Restart=${restartPolicy}`,
    `RestartSec=${restartSeconds}`,
    ...formatEnvironmentLines(environment),
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');
}

/**
 * @typedef ReleasePaths
 * @property {string} appRoot - appRoot.
 * @property {string} releasesDir - releasesDir.
 * @property {string} releaseDir - releaseDir.
 * @property {string} currentLinkPath - currentLinkPath.
 * @property {string} releaseArtifactPath - releaseArtifactPath.
 * @property {string} currentArtifactPath - currentArtifactPath.
 * @property {string} releaseManifestPath - releaseManifestPath.
 * @property {string} releaseRecordPath - releaseRecordPath.
 * @property {string} unitPath - unitPath.
 */

/**
 * @param {{ appName: string, releaseRoot: string, systemdDir: string, releaseId: string, artifactFileName: string, unitName: string }} options - options.
 * @returns {ReleasePaths} - Result.
 */
export function createReleasePaths(options) {
  const appKey = sanitizeNameSegment(options.appName || 'wharfie');
  const releaseRoot = path.resolve(options.releaseRoot);
  const systemdDir = path.resolve(options.systemdDir);
  const appRoot = path.join(releaseRoot, appKey);
  const releasesDir = path.join(appRoot, 'releases');
  const releaseDir = path.join(releasesDir, options.releaseId);
  const currentLinkPath = path.join(appRoot, 'current');
  const releaseArtifactPath = path.join(releaseDir, options.artifactFileName);

  return {
    appRoot,
    releasesDir,
    releaseDir,
    currentLinkPath,
    releaseArtifactPath,
    currentArtifactPath: path.join(currentLinkPath, options.artifactFileName),
    releaseManifestPath: path.join(releaseDir, 'manifest.json'),
    releaseRecordPath: path.join(releaseDir, 'release.json'),
    unitPath: path.join(systemdDir, options.unitName),
  };
}

/**
 * @typedef ReleaseRecord
 * @property {number} version - version.
 * @property {string} appName - appName.
 * @property {string} serviceName - serviceName.
 * @property {string} unitName - unitName.
 * @property {string} releaseId - releaseId.
 * @property {string} deployedAt - deployedAt.
 * @property {string} targetSelector - targetSelector.
 * @property {string} artifactFileName - artifactFileName.
 * @property {string} artifactPath - artifactPath.
 * @property {string} manifestPath - manifestPath.
 * @property {string} workingDirectory - workingDirectory.
 */

/**
 * @typedef DeployPlan
 * @property {any} manifest - manifest.
 * @property {string} appName - appName.
 * @property {string} serviceName - serviceName.
 * @property {string} unitName - unitName.
 * @property {string} artifactPath - artifactPath.
 * @property {string} releaseId - releaseId.
 * @property {string} deployedAt - deployedAt.
 * @property {string} targetSelector - targetSelector.
 * @property {ReleasePaths} paths - paths.
 * @property {ReleaseRecord} record - record.
 * @property {string} unitContent - unitContent.
 * @property {string[]} execArgs - execArgs.
 * @property {string[]} bootstrapArgs - bootstrapArgs.
 * @property {Record<string, string>} environment - environment.
 * @property {Array<{ command: string, args: string[] }>} shellCommands - shellCommands.
 */

/**
 * @param {{ manifest: any, artifactPath?: string, releaseRoot?: string, systemdDir?: string, serviceName?: string, releaseId?: string, deployedAt?: string, role?: 'all'|'leader'|'worker', workingDirectory?: string, serviceUser?: string, environment?: Record<string, string>, extraArgs?: string[] }} options - options.
 * @returns {DeployPlan} - Result.
 */
export function createDeployPlan(options) {
  const appName = getManifestAppId(options.manifest);
  if (!appName) {
    throw new Error('Deploy requires manifest.app.id.');
  }

  const serviceName = sanitizeNameSegment(options.serviceName || appName);
  if (!serviceName) {
    throw new Error('Deploy requires a non-empty service name.');
  }

  const artifactPath = path.resolve(options.artifactPath || process.execPath);
  const artifactFileName = path.basename(artifactPath) || 'wharfie';
  const deployedAt = options.deployedAt || new Date().toISOString();
  const targetSelector = getManifestTargetSelector(options.manifest);
  const releaseId =
    options.releaseId ||
    `${serviceName}-${targetSelector}-${deployedAt
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z')}`;
  const unitName = `${serviceName}.service`;
  const bootstrapArgs = [
    '--role',
    options.role || 'all',
    ...(Array.isArray(options.extraArgs) ? options.extraArgs : []),
  ];
  /** @type {string[]} */
  const execArgs = [];
  const paths = createReleasePaths({
    appName,
    releaseRoot: options.releaseRoot || '/var/lib/wharfie',
    systemdDir: options.systemdDir || '/etc/systemd/system',
    releaseId,
    artifactFileName,
    unitName,
  });
  const workingDirectory = path.resolve(
    options.workingDirectory || paths.currentLinkPath,
  );
  const configuredEnvironment = Object.keys(options.environment || {}).reduce(
    (acc, key) => {
      const value = options.environment?.[key];
      if (typeof value === 'string') {
        acc[key] = value;
      }
      return acc;
    },
    /** @type {Record<string, string>} */ ({}),
  );
  const environment = {
    ...configuredEnvironment,
    ...createBootstrapEnvironment({
      mode: BOOTSTRAP_MODE_STATE_START,
      args: bootstrapArgs,
    }),
  };
  const execStart = shellQuote(paths.currentArtifactPath);
  const unitContent = buildLinuxSystemdUnit({
    description: `${appName} artifact service`,
    execStart,
    workingDirectory,
    user: options.serviceUser || 'root',
    environment,
  });
  const record = {
    version: 1,
    appName,
    serviceName,
    unitName,
    releaseId,
    deployedAt,
    targetSelector,
    artifactFileName,
    artifactPath: paths.releaseArtifactPath,
    manifestPath: paths.releaseManifestPath,
    workingDirectory,
  };

  return {
    manifest: options.manifest,
    appName,
    serviceName,
    unitName,
    artifactPath,
    releaseId,
    deployedAt,
    targetSelector,
    paths,
    record,
    unitContent,
    execArgs,
    bootstrapArgs,
    environment,
    shellCommands: [
      { command: 'systemctl', args: ['daemon-reload'] },
      { command: 'systemctl', args: ['enable', unitName] },
      { command: 'systemctl', args: ['restart', unitName] },
    ],
  };
}

/**
 * @param {DeployPlan} plan - plan.
 * @param {{ fsOps?: typeof fs }} [options] - options.
 * @returns {Promise<void>} - Result.
 */
export async function materializeDeployPlan(plan, options = {}) {
  const fsOps = options.fsOps || fs;

  await fsOps.mkdir(plan.paths.releaseDir, { recursive: true });
  await fsOps.mkdir(path.dirname(plan.paths.unitPath), { recursive: true });
  await fsOps.copyFile(plan.artifactPath, plan.paths.releaseArtifactPath);
  await fsOps.chmod(plan.paths.releaseArtifactPath, 0o755);
  await fsOps.writeFile(
    plan.paths.releaseManifestPath,
    `${stringifyAppManifest(plan.manifest)}\n`,
    'utf8',
  );
  await fsOps.writeFile(
    plan.paths.releaseRecordPath,
    `${JSON.stringify(plan.record, null, 2)}\n`,
    'utf8',
  );
  await fsOps.writeFile(plan.paths.unitPath, `${plan.unitContent}\n`, 'utf8');
  await repointCurrentRelease(
    plan.paths.currentLinkPath,
    plan.paths.releaseDir,
    {
      fsOps,
    },
  );
}

/**
 * @param {string} currentLinkPath - currentLinkPath.
 * @param {string} releaseDir - releaseDir.
 * @param {{ fsOps?: typeof fs }} [options] - options.
 * @returns {Promise<void>} - Result.
 */
export async function repointCurrentRelease(
  currentLinkPath,
  releaseDir,
  options = {},
) {
  const fsOps = options.fsOps || fs;
  const parentDir = path.dirname(currentLinkPath);
  await fsOps.mkdir(parentDir, { recursive: true });
  await fsOps.rm(currentLinkPath, { recursive: true, force: true });
  const relativeTarget = path.relative(parentDir, releaseDir) || '.';
  await fsOps.symlink(relativeTarget, currentLinkPath, 'dir');
}

/**
 * @param {string} releaseRoot - releaseRoot.
 * @param {string} appName - appName.
 * @returns {string} - Result.
 */
export function getAppRoot(releaseRoot, appName) {
  return path.join(path.resolve(releaseRoot), sanitizeNameSegment(appName));
}

/**
 * @param {ReleaseRecord[]} records - records.
 * @returns {ReleaseRecord[]} - Result.
 */
export function sortReleaseRecords(records) {
  return [...records].sort((left, right) => {
    const leftTime = Date.parse(left.deployedAt || '');
    const rightTime = Date.parse(right.deployedAt || '');
    if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
      return rightTime - leftTime;
    }
    return right.releaseId.localeCompare(left.releaseId);
  });
}

/**
 * @param {unknown} value - value.
 * @returns {value is ReleaseRecord} - Result.
 */
function isReleaseRecord(value) {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = /** @type {Record<string, unknown>} */ (value);
  return (
    typeof record.releaseId === 'string' &&
    typeof record.appName === 'string' &&
    typeof record.unitName === 'string'
  );
}

/**
 * @param {{ releaseRoot: string, appName: string, fsOps?: typeof fs }} options - options.
 * @returns {Promise<ReleaseRecord[]>} - Result.
 */
export async function listReleaseRecords(options) {
  const fsOps = options.fsOps || fs;
  const appRoot = getAppRoot(options.releaseRoot, options.appName);
  const releasesDir = path.join(appRoot, 'releases');

  let entries = [];
  try {
    entries = await fsOps.readdir(releasesDir, { withFileTypes: true });
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const records = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const recordPath = path.join(releasesDir, entry.name, 'release.json');
        try {
          const raw = await fsOps.readFile(recordPath, 'utf8');
          const parsed = JSON.parse(raw);
          return isReleaseRecord(parsed) ? parsed : undefined;
        } catch {
          return undefined;
        }
      }),
  );

  return sortReleaseRecords(
    records.reduce((acc, record) => {
      if (record) {
        acc.push(record);
      }
      return acc;
    }, /** @type {ReleaseRecord[]} */ ([])),
  );
}

/**
 * @param {{ releaseRoot: string, appName: string, fsOps?: typeof fs }} options - options.
 * @returns {Promise<string | undefined>} - Result.
 */
export async function readCurrentReleaseId(options) {
  const fsOps = options.fsOps || fs;
  const appRoot = getAppRoot(options.releaseRoot, options.appName);
  const currentLinkPath = path.join(appRoot, 'current');

  try {
    const target = await fsOps.readlink(currentLinkPath);
    const resolved = path.resolve(path.dirname(currentLinkPath), target);
    return path.basename(resolved);
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : '';
    if (code === 'EINVAL' || code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

/**
 * @param {ReleaseRecord[]} records - records.
 * @param {{ currentReleaseId?: string, releaseId?: string, mode?: 'current'|'previous' }} [options] - options.
 * @returns {ReleaseRecord | undefined} - Result.
 */
export function selectReleaseRecord(records, options = {}) {
  const sorted = sortReleaseRecords(records);
  if (sorted.length === 0) return undefined;

  if (options.releaseId) {
    return sorted.find((record) => record.releaseId === options.releaseId);
  }

  const current = options.currentReleaseId
    ? sorted.find((record) => record.releaseId === options.currentReleaseId)
    : undefined;

  if (options.mode === 'previous') {
    if (!current) {
      return sorted[1] || undefined;
    }

    return sorted.find((record) => record.releaseId !== current.releaseId);
  }

  return current || sorted[0];
}

/**
 * @param {ReleaseRecord[]} records - records.
 * @param {string} releaseId - releaseId.
 * @returns {{ since?: string, until?: string }} - Result.
 */
export function getReleaseLogWindow(records, releaseId) {
  const sorted = sortReleaseRecords(records).reverse();
  const index = sorted.findIndex((record) => record.releaseId === releaseId);
  if (index === -1) {
    return {};
  }

  const selected = sorted[index];
  const next = sorted[index + 1];
  return {
    ...(selected?.deployedAt ? { since: selected.deployedAt } : {}),
    ...(next?.deployedAt ? { until: next.deployedAt } : {}),
  };
}

export default {
  buildLinuxSystemdUnit,
  createDeployPlan,
  createReleasePaths,
  getAppRoot,
  getManifestTargetSelector,
  getReleaseLogWindow,
  listReleaseRecords,
  materializeDeployPlan,
  readCurrentReleaseId,
  repointCurrentRelease,
  sanitizeNameSegment,
  selectReleaseRecord,
  sortReleaseRecords,
};
