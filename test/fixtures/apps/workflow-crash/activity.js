import { closeSync, existsSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/** @returns {void} - Minimal fixture CLI entrypoint. */
export function main() {}

/**
 * Record physical entry durably so the parent can detect redispatch across a
 * process crash. The first output becomes the second step's exact input.
 * @param {{markerPath: string, stepIndex?: number}} input - Workflow step input.
 * @returns {{markerPath: string, stepIndex: number}} - Next step input.
 */
export function crashStep(input) {
  if (!input || typeof input.markerPath !== 'string' || !input.markerPath) {
    throw new TypeError('workflow crash activity requires markerPath.');
  }
  const stepIndex = input.stepIndex === undefined ? 0 : input.stepIndex;
  if (!Number.isSafeInteger(stepIndex) || stepIndex < 0) {
    throw new TypeError('workflow crash activity stepIndex is invalid.');
  }
  const existed = existsSync(input.markerPath);
  const handle = openSync(input.markerPath, 'a', 0o600);
  try {
    writeSync(handle, `enter:${stepIndex}\n`);
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  if (!existed) {
    const parent = openSync(dirname(input.markerPath), 'r');
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  }
  return { markerPath: input.markerPath, stepIndex: stepIndex + 1 };
}
