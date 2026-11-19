import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createHetznerPreviewApiClient } from '../src/core/runtime/providers/hetzner/api-client.js';
import {
  selectImage,
  selectLocation,
  selectServerType,
} from '../src/core/runtime/providers/hetzner/single-node-plan.js';

// Read-only check that the catalog reads behind Hetzner `deployment preview`
// and a first `deployment apply` still decode against the live API and still
// select a location, server type, and image. Uses the GET-only preview client
// with the planner's exact list filters and the planner's own selectors.

/**
 * @param {string} name - Read label.
 * @param {() => Promise<unknown>} request - Provider read.
 * @returns {Promise<{name: string, decoded: boolean, value?: any, error?: string}>} - Outcome.
 */
async function read(name, request) {
  try {
    return { name, decoded: true, value: await request() };
  } catch (error) {
    return {
      name,
      decoded: false,
      // Client and decoder errors carry fixed, body-free messages.
      error: error instanceof Error ? error.message : 'unknown failure',
    };
  }
}

/**
 * @param {{api: Readonly<Record<string, Function>>, location: string}} input - Read client and target location.
 * @returns {Promise<Readonly<Record<string, any>>>} - Secret-free contract report.
 */
export async function checkHetznerApiContract({ api, location }) {
  const reads = await Promise.all([
    read('locations', () => api.listLocations({ name: location })),
    read('serverTypes', () => api.listServerTypes()),
    read('images', () =>
      api.listImages({
        name: 'ubuntu-24.04',
        type: 'system',
        architecture: 'x86',
        includeDeprecated: false,
      }),
    ),
  ]);
  const [locations, serverTypes, images] = reads;
  let selection = null;
  let selectionError = null;
  if (reads.every((outcome) => outcome.decoded)) {
    try {
      const target = selectLocation(locations.value, location);
      const serverType = selectServerType(serverTypes.value, target);
      const image = selectImage(images.value);
      selection = {
        location: target.name,
        serverType: serverType.name,
        image: { id: image.id, name: image.name },
      };
    } catch (error) {
      // Planner selection errors are fixed messages without provider data.
      selectionError =
        error instanceof Error ? error.message : 'unknown failure';
    }
  }
  return Object.freeze({
    format: 'wharfie-hetzner-api-contract',
    version: 1,
    location,
    reads: Object.fromEntries(
      reads.map((outcome) => [
        outcome.name,
        outcome.decoded
          ? { decoded: true, count: outcome.value.length }
          : { decoded: false, error: outcome.error },
      ]),
    ),
    selection,
    ...(selectionError === null ? {} : { selectionError }),
    result: selection === null ? 'failed' : 'passed',
  });
}

/** @returns {Promise<void>} */
export async function main() {
  const { values } = parseArgs({
    options: { location: { type: 'string', default: 'fsn1' } },
  });
  const token = process.env.HCLOUD_TOKEN;
  if (typeof token !== 'string' || token.length === 0) {
    process.stderr.write('verify:hetzner:contract requires HCLOUD_TOKEN.\n');
    process.exitCode = 2;
    return;
  }
  let api;
  try {
    api = createHetznerPreviewApiClient({ token });
  } catch (error) {
    // The client rejects malformed tokens with a fixed message.
    process.stderr.write(
      `verify:hetzner:contract could not create a read client: ${
        error instanceof Error ? error.message : 'unknown failure'
      }\n`,
    );
    process.exitCode = 2;
    return;
  }
  const report = await checkHetznerApiContract({
    api,
    location: /** @type {string} */ (values.location),
  });
  process.stdout.write(
    `${JSON.stringify({ checkedAt: new Date().toISOString(), ...report }, null, 2)}\n`,
  );
  if (report.result !== 'passed') process.exitCode = 1;
}

const isDirect =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  await main();
}
