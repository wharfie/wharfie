import { compareFileFingerprints, fingerprintFile } from './file-stability.js';

/**
 * Capture the first durable file observation.
 * @param {{path?: unknown}} [input] - Workflow input.
 * @returns {Promise<{path: string, bytes: number, sha256: string, readStable: boolean}>} - Baseline fingerprint.
 */
export async function capture(input = {}) {
  return await fingerprintFile(input.path);
}

/**
 * Compare the retained baseline with a fresh observation.
 * @param {Record<string, any>} baseline - Retained capture output.
 * @returns {Promise<ReturnType<typeof compareFileFingerprints>>} - Stable/changed decision.
 */
export async function verify(baseline) {
  const current = await fingerprintFile(baseline?.path);
  return compareFileFingerprints(baseline, current);
}
