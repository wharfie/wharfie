import { closeSync, existsSync, fsyncSync, openSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

/** @returns {void} - Minimal fixture CLI entrypoint. */
export function main() {}

/**
 * Append one marker and synchronize both its bytes and first directory entry.
 * @param {string} markerPath - Durable physical-entry evidence.
 * @param {string} marker - Exact entry identity.
 */
function appendDurableMarker(markerPath, marker) {
  const existed = existsSync(markerPath);
  const handle = openSync(markerPath, 'a', 0o600);
  try {
    const bytes = Buffer.from(`${marker}\n`, 'utf8');
    let offset = 0;
    while (offset < bytes.length) {
      const written = writeSync(handle, bytes, offset, bytes.length - offset);
      if (written < 1) {
        throw new Error(
          'resident authored crash marker write made no progress.',
        );
      }
      offset += written;
    }
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
 * Cross a process-observable physical-entry boundary. Hanging work never
 * returns; completed work returns one exact sensitive result for terminal
 * replay proof.
 * @param {{markerPath: string, mode: 'hang'|'complete', token: string, proof?: Record<string, any>}} input - Crash-case controls.
 * @returns {Promise<Record<string, any>>} - Exact authored terminal result.
 */
export async function crashTask(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('resident authored crash input must be an object.');
  }
  if (
    typeof input.markerPath !== 'string' ||
    !input.markerPath ||
    (input.mode !== 'hang' && input.mode !== 'complete') ||
    typeof input.token !== 'string' ||
    !input.token
  ) {
    throw new TypeError(
      'resident authored crash input requires markerPath, mode, and token.',
    );
  }
  appendDurableMarker(input.markerPath, `entry:${input.token}`);
  if (input.mode === 'hang') {
    await new Promise(() => {});
  }
  return {
    token: input.token,
    proof: input.proof,
  };
}
