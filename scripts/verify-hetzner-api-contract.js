import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { createHetznerPreviewApiClient } from '../src/core/runtime/providers/hetzner/api-client.js';
import { HETZNER_SMALL_SERVER_TYPE_CANDIDATES } from '../src/core/runtime/providers/hetzner/single-node-plan.js';

// Read-only check that the catalog reads behind Hetzner `deployment preview`
// and a first `deployment apply` still decode against the live API. Uses the
// GET-only preview client with the planner's exact list filters.

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
  const [locations, serverTypes, images] = await Promise.all([
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
  const matchedLocations = locations.decoded
    ? locations.value.filter(
        (/** @type {any} */ candidate) => candidate.name === location,
      )
    : [];
  const target = matchedLocations.length === 1 ? matchedLocations[0] : null;
  const availableSmallServerTypes =
    serverTypes.decoded && target !== null
      ? HETZNER_SMALL_SERVER_TYPE_CANDIDATES.filter((name) =>
          serverTypes.value.some(
            (/** @type {any} */ type) =>
              type.name === name &&
              type.architecture === 'x86' &&
              type.locations.some(
                (/** @type {any} */ entry) =>
                  entry.id === target.id &&
                  entry.available === true &&
                  entry.deprecation === null,
              ),
          ),
        )
      : [];
  const currentImages = images.decoded
    ? images.value.filter(
        (/** @type {any} */ image) =>
          image.name === 'ubuntu-24.04' &&
          image.type === 'system' &&
          image.status === 'available' &&
          image.architecture === 'x86' &&
          image.osFlavor === 'ubuntu' &&
          image.osVersion === '24.04' &&
          image.deprecation === null,
      )
    : [];
  const passed =
    [locations, serverTypes, images].every((outcome) => outcome.decoded) &&
    target !== null &&
    availableSmallServerTypes.length > 0 &&
    currentImages.length === 1;
  return Object.freeze({
    format: 'wharfie-hetzner-api-contract',
    version: 1,
    location,
    reads: Object.fromEntries(
      [locations, serverTypes, images].map((outcome) => [
        outcome.name,
        outcome.decoded
          ? { decoded: true, count: outcome.value.length }
          : { decoded: false, error: outcome.error },
      ]),
    ),
    selection: {
      location: target?.name ?? null,
      availableSmallServerTypes,
      currentImages: currentImages.map((/** @type {any} */ image) => ({
        id: image.id,
        name: image.name,
      })),
    },
    result: passed ? 'passed' : 'failed',
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
  const report = await checkHetznerApiContract({
    api: createHetznerPreviewApiClient({ token }),
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
