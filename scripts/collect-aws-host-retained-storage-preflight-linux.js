import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { createAwsRetainedStorageHostPreflightCollector } from './aws-host-retained-storage-host-preflight.js';
import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';

/**
 * Parse one closed, path-free host-fingerprint request.
 * @param {string[]} argv - Node-style argv.
 * @returns {Readonly<{sourceCommit: string, expectedArchitecture: string}>} - Exact collector request.
 */
export function parseAwsRetainedStorageHostPreflightArguments(argv) {
  if (
    !Array.isArray(argv) ||
    argv.length !== 4 ||
    typeof argv[2] !== 'string' ||
    !/^[0-9a-f]{40}$/u.test(argv[2]) ||
    typeof argv[3] !== 'string' ||
    !['x86_64', 'arm64'].includes(argv[3])
  ) {
    throw new TypeError(
      'Usage: collect-aws-host-retained-storage-preflight-linux.js <source-commit> <x86_64|arm64>',
    );
  }
  return Object.freeze({
    sourceCommit: argv[2],
    expectedArchitecture: argv[3],
  });
}

/**
 * Collect one evidence-only host/toolchain fingerprint.
 * @param {string[]} [argv] - Node-style argv.
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv) {
  const request = parseAwsRetainedStorageHostPreflightArguments(argv);
  const receipt =
    await createAwsRetainedStorageHostPreflightCollector().collect(request);
  process.stdout.write(`${JSON.stringify(sortCanonicalJsonValue(receipt))}\n`);
}

const invokedPath =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
  try {
    await main(process.argv);
  } catch {
    process.stderr.write('AWS retained-storage host preflight failed.\n');
    process.exitCode = 1;
  }
}
