import { constants as fsConstants } from 'node:fs';
import { open, readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  capture as captureFile,
  verify as verifyFile,
} from '../examples/steady-file/activities.js';

/**
 * Persist a physical activity observation separately from the runtime ledger.
 * These proof-owned files let acceptance detect repeated committed activity
 * execution even when the final logical output happens to be unchanged.
 * @param {string} inputPath - Absolute regular-file input.
 * @param {'capture'|'verify'} activity - Successful activity invocation.
 * @returns {Promise<void>} - File and parent directory have been synchronized.
 */
async function appendActivity(inputPath, activity) {
  const marker = {
    schemaVersion: 1,
    kind: 'wharfie.live-deployment.activity-entry',
    activity,
    bootId:
      process.platform === 'linux'
        ? (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim()
        : null,
    processId: process.pid,
  };
  const handle = await open(
    `${inputPath}.activities.jsonl`,
    fsConstants.O_APPEND |
      fsConstants.O_CREAT |
      fsConstants.O_WRONLY |
      fsConstants.O_NOFOLLOW |
      fsConstants.O_NONBLOCK,
    0o600,
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) {
      throw new Error('Live acceptance activity evidence is not bounded.');
    }
    await handle.writeFile(`${JSON.stringify(marker)}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  const directory = await open(path.dirname(inputPath), 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

/**
 * Capture the shipped starter's baseline and persist an independent marker.
 * @param {{path?: unknown}} [input] - Workflow input.
 * @returns {ReturnType<typeof captureFile>} - Original capture output.
 */
export async function capture(input = {}) {
  const result = await captureFile(input);
  await appendActivity(result.path, 'capture');
  return result;
}

/**
 * Verify the shipped starter's retained baseline and persist its marker.
 * @param {Record<string, any>} baseline - Original committed baseline.
 * @returns {ReturnType<typeof verifyFile>} - Original verification output.
 */
export async function verify(baseline) {
  const result = await verifyFile(baseline);
  await appendActivity(result.path, 'verify');
  return result;
}
