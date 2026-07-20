import { closeSync, existsSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/** @returns {void} - Minimal fixture CLI entrypoint. */
export function main() {}

/**
 * Append and fsync one observable physical marker.
 * @param {string} markerPath - Durable marker file.
 * @param {string} marker - Exact marker line.
 */
function appendMarker(markerPath, marker) {
  const existed = existsSync(markerPath);
  const handle = openSync(markerPath, 'a', 0o600);
  try {
    writeSync(handle, `${marker}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  if (!existed) {
    const parent = openSync(dirname(markerPath), 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  }
}

/**
 * Record physical entry durably so the parent can detect redispatch across a
 * process crash. The first output becomes the second step's exact input.
 * @param {{markerPath: string, stepIndex?: number, waitForCancellation?: boolean}} input - Workflow step input.
 * @param {{signal?: AbortSignal}} [runtime] - Activity runtime controls.
 * @returns {Promise<{markerPath: string, stepIndex: number}>} - Next step input.
 */
export async function crashStep(input, runtime = {}) {
  if (!input || typeof input.markerPath !== 'string' || !input.markerPath) {
    throw new TypeError('workflow crash activity requires markerPath.');
  }
  const stepIndex = input.stepIndex === undefined ? 0 : input.stepIndex;
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    throw new TypeError('workflow crash activity stepIndex is invalid.');
  }
  appendMarker(input.markerPath, `enter:${stepIndex}`);
  if (input.waitForCancellation === true && stepIndex === 0) {
    if (!runtime.signal) {
      throw new TypeError(
        'workflow cancellation fixture requires an activity AbortSignal.',
      );
    }
    if (!runtime.signal.aborted) {
      await new Promise((resolve) =>
        runtime.signal?.addEventListener('abort', resolve, { once: true }),
      );
    }
    appendMarker(input.markerPath, `cancel:${stepIndex}`);
    throw runtime.signal.reason || new Error('workflow activity cancelled');
  }
  return { markerPath: input.markerPath, stepIndex: stepIndex + 1 };
}
