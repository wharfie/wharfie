import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  writeSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';

const USAGE = 'Usage: systemd-service-proof <marker-file>';
const SYSTEMD_PROOF_RELEASE = '__WHARFIE_SYSTEMD_PROOF_RELEASE__';

/**
 * Parse the one application-owned marker argument shared by immediate and
 * durable execution.
 * @param {ReadonlyArray<string>} args - Application arguments without Node argv.
 * @returns {{markerPath: string, stepIndex: number, release: string}} - First workflow input.
 */
function parseMarkerInput(args) {
  if (!Object.isFrozen(args)) {
    throw new TypeError('systemd proof CLI arguments must be frozen.');
  }
  if (args.length !== 1 || !args[0]) throw new TypeError(USAGE);
  return {
    markerPath: resolve(args[0]),
    stepIndex: 0,
    release: SYSTEMD_PROOF_RELEASE,
  };
}

/**
 * Project ordinary application arguments into the default durable workflow.
 * @param {ReadonlyArray<string>} args - Application arguments after `--`.
 * @returns {{markerPath: string, stepIndex: number, release: string}} - Workflow input.
 */
export function toDurableInput(args) {
  return parseMarkerInput(args);
}

/**
 * Run the same first marker operation as an ordinary application CLI.
 * @param {string[]} [argv] - Node-style process arguments.
 * @returns {Promise<void>} - Resolves after synchronized marker output.
 */
export async function main(argv = process.argv) {
  const result = await recordStep(
    parseMarkerInput(Object.freeze(argv.slice(2))),
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

/**
 * Read the Linux boot identity that lets the proof bind physical activity
 * entries to opposite sides of a real VM reboot.
 * @returns {string} - Current kernel boot ID.
 */
function readBootId() {
  return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
}

/**
 * Append and synchronize one physical activity entry.
 * @param {string} markerPath - Durable marker file.
 * @param {Record<string, unknown>} marker - Exact marker object.
 * @returns {void} - Returns after file and first-directory-entry durability.
 */
function appendMarker(markerPath, marker) {
  const handle = openSync(markerPath, 'a', 0o600);
  try {
    writeSync(handle, `${JSON.stringify(marker)}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  const parent = openSync(dirname(markerPath), 'r');
  try {
    fsyncSync(parent);
  } finally {
    closeSync(parent);
  }
}

/**
 * Record one observable physical workflow step. The first step runs before
 * reboot; a signal payload supplies the second step's input after reboot.
 * @param {{markerPath: string, stepIndex?: number}} input - Step input.
 * @returns {Promise<{markerPath: string, stepIndex: number, bootId: string, release: string}>} - Next input and physical boot evidence.
 */
export async function recordStep(input) {
  if (!input || typeof input.markerPath !== 'string' || !input.markerPath) {
    throw new TypeError('systemd proof activity requires markerPath.');
  }
  const stepIndex = input.stepIndex === undefined ? 0 : input.stepIndex;
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    throw new TypeError('systemd proof activity stepIndex is invalid.');
  }
  const bootId = readBootId();
  appendMarker(input.markerPath, {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.activity-entry',
    stepIndex,
    bootId,
    processId: process.pid,
    release: SYSTEMD_PROOF_RELEASE,
  });
  return {
    markerPath: input.markerPath,
    stepIndex: stepIndex + 1,
    bootId,
    release: SYSTEMD_PROOF_RELEASE,
  };
}
