/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- Internal acceptance transport uses compact typed helpers and narrow data ports. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readOperatorJsonObjectStdin } from '../src/core/runtime/operator/json-document-stdin.js';
import { validateSingleNodeDeploymentJournal } from '../src/core/runtime/single-node-deployment-journal.js';
import { runLiveDeploymentProcess } from './live-deployment-package.js';
import { auditLiveDeploymentCleanup } from './live-deployment-provider-audit.js';

const CHILD = fileURLToPath(import.meta.url);
const REPO = fileURLToPath(new URL('../', import.meta.url));
const FLAG = '--internal-provider-audit';
const MAX_BYTES = 256 * 1024;
const MAX_DURATION_MS = 120_000;
const REASONS = new Set([
  null,
  'provider-read-failed',
  'provider-read-timeout',
  'provider-pagination-limit',
  'provider-scope-mismatch',
  'authority-close-failed',
  'credential-binding-failed',
]);

/** @param {unknown} value @param {string[]} keys @returns {Record<string, any>} */
function exactObject(value, keys) {
  assert.ok(
    value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} input @returns {{journal: ReturnType<typeof validateSingleNodeDeploymentJournal>, dataRoot: string}} */
function checkedInput(input) {
  const document = exactObject(input, ['journal', 'dataRoot']);
  assert.ok(
    typeof document.dataRoot === 'string' &&
      path.isAbsolute(document.dataRoot) &&
      path.normalize(document.dataRoot) === document.dataRoot,
  );
  return {
    journal: validateSingleNodeDeploymentJournal(document.journal),
    dataRoot: document.dataRoot,
  };
}

/** @param {unknown} value @returns {string} */
function boundedJson(value) {
  const encoded = JSON.stringify(value);
  assert.ok(
    typeof encoded === 'string' && Buffer.byteLength(encoded) <= MAX_BYTES,
  );
  return encoded;
}

/** @param {unknown} input @param {ReturnType<typeof validateSingleNodeDeploymentJournal>} journal @returns {Record<string, any>} */
function checkedReport(input, journal) {
  const report = exactObject(input, [
    'schemaVersion',
    'kind',
    'provider',
    'deploymentInstanceId',
    'status',
    'resources',
    'inventory',
    'reason',
  ]);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.kind, 'wharfie.live-deployment.cleanup');
  assert.equal(report.provider, journal.providerIntent.provider);
  assert.equal(report.deploymentInstanceId, journal.deploymentInstanceId);
  assert.ok(REASONS.has(report.reason));
  const roles =
    report.provider === 'aws'
      ? ['instance', 'rootVolume', 'securityGroup']
      : ['server', 'primaryIp', 'firewall'];
  assert.ok(
    Array.isArray(report.resources) && report.resources.length === roles.length,
  );
  assert.ok(
    Array.isArray(report.inventory) && report.inventory.length === roles.length,
  );
  for (const [index, role] of roles.entries()) {
    const resource = exactObject(report.resources[index], [
      'role',
      'id',
      'status',
    ]);
    const inventory = exactObject(report.inventory[index], [
      'role',
      'count',
      'status',
    ]);
    assert.equal(resource.role, role);
    assert.equal(inventory.role, role);
    const id =
      journal.resources.find(
        (/** @type {Record<string, any>} */ entry) => entry.role === role,
      )?.providerResourceId ?? null;
    assert.equal(resource.id, id);
    assert.ok(
      ['unknown', 'present', 'absent', 'unrecorded'].includes(resource.status),
    );
    if (resource.status === 'unrecorded') assert.equal(id, null);
    assert.ok(['unknown', 'present', 'absent'].includes(inventory.status));
    if (inventory.status === 'unknown') assert.equal(inventory.count, null);
    else {
      assert.ok(
        Number.isSafeInteger(inventory.count) &&
          inventory.count >= 0 &&
          inventory.count <= 4096,
      );
      assert.equal(inventory.status === 'absent', inventory.count === 0);
    }
  }
  const statuses = [...report.resources, ...report.inventory].map(
    (entry) => entry.status,
  );
  const status =
    report.reason !== null || statuses.includes('unknown')
      ? 'unknown'
      : statuses.includes('present')
        ? 'present'
        : 'absent';
  assert.equal(report.status, status);
  return report;
}

/** @param {unknown} error @param {number} started @returns {Error} */
function auditFailure(error, started) {
  const diagnostic =
    error !== null && typeof error === 'object' && 'diagnostic' in error
      ? /** @type {Record<string, any>} */ (error.diagnostic)
      : null;
  return Object.assign(new Error('Live deployment cleanup audit failed.'), {
    diagnostic: {
      phase: 'cleanup-audit',
      command: 'node',
      durationMs: Math.round(performance.now() - started),
      status: Number.isSafeInteger(diagnostic?.status)
        ? diagnostic?.status
        : null,
      signal:
        typeof diagnostic?.signal === 'string' &&
        /^SIG[A-Z0-9]{1,16}$/.test(diagnostic.signal)
          ? diagnostic.signal
          : null,
      timedOut: diagnostic?.timedOut === true,
      aborted: diagnostic?.aborted === true,
      outputLimitExceeded: diagnostic?.outputLimitExceeded === true,
      spawnError: diagnostic?.spawnError === true,
      stdinError: diagnostic?.stdinError === true,
    },
  });
}

/**
 * Isolate credential providers and SDK initialization in an owned process group.
 * Even an unresolved credential subprocess or STS socket cannot outlive its deadline.
 * @param {{run?: typeof runLiveDeploymentProcess, timeoutMs?: number}} [dependencies]
 * @returns {(input: {journal: unknown, dataRoot: string, env: NodeJS.ProcessEnv}) => Promise<Record<string, any>>}
 */
export function createLiveDeploymentCleanupChildAuditor(dependencies = {}) {
  const run = dependencies.run ?? runLiveDeploymentProcess;
  const timeoutMs = dependencies.timeoutMs ?? MAX_DURATION_MS;
  assert.equal(typeof run, 'function');
  assert.ok(
    Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0 &&
      timeoutMs <= MAX_DURATION_MS,
  );
  return async ({ journal, dataRoot, env }) => {
    const started = performance.now();
    try {
      const input = checkedInput({ journal, dataRoot });
      const stdin = boundedJson(input);
      const result = await run({
        file: process.execPath,
        args: [CHILD, FLAG],
        cwd: REPO,
        env,
        stdin,
        timeoutMs,
        phase: 'cleanup-audit',
      });
      assert.ok(Buffer.byteLength(result.stdout) <= MAX_BYTES);
      return checkedReport(JSON.parse(result.stdout), input.journal);
    } catch (error) {
      throw auditFailure(error, started);
    }
  };
}

export const auditLiveDeploymentCleanupInChild =
  createLiveDeploymentCleanupChildAuditor();

if (process.argv[1] && path.resolve(process.argv[1]) === CHILD) {
  try {
    assert.deepEqual(process.argv.slice(2), [FLAG]);
    const input = checkedInput(
      await readOperatorJsonObjectStdin(MAX_BYTES, 'Provider cleanup audit'),
    );
    const report = checkedReport(
      await auditLiveDeploymentCleanup(input),
      input.journal,
    );
    process.stdout.write(`${boundedJson(report)}\n`);
  } catch {
    process.stderr.write('Live deployment cleanup audit failed.\n');
    process.exitCode = 1;
  }
}
