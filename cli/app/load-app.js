import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import ActorSystem from '../../lambdas/lib/actor/resources/builds/actor-system.js';

/**
 * Wharfie v2 app loader + minimal manifest compiler.
 *
 * Wharfie v2 apps are code-defined (no YAML). The CLI needs a small, strict
 * contract so it can:
 *  - locate the app entrypoint (`wharfie.app.js`)
 *  - load it (ESM)
 *  - derive a normalized JSON manifest that can be embedded into a build artifact
 *
 * Supported export shapes (MVP):
 *
 * 1) Plain object export
 *
 *    ```js
 *    // wharfie.app.js
 *    export default {
 *      name: 'my-app',
 *      targets: [{ nodeVersion: '24', platform: 'linux', architecture: 'x64' }],
 *      // either "capabilities" (v2 term) or "resources" (existing ActorSystem term)
 *      capabilities: {
 *        db: { adapter: 'vanilla', options: { path: '.wharfie' } },
 *        queue: { adapter: 'vanilla', options: { path: '.wharfie' } },
 *      },
 *    };
 *    ```
 *
 * 2) ActorSystem instance export
 *
 *    ```js
 *    import ActorSystem from '.../actor-system.js';
 *    export default new ActorSystem({ name: 'my-app', properties: { resources: { ... } } });
 *    ```
 *
 * For ActorSystem exports we only *inspect* properties (no reconcile).
 */

/**
 * @typedef {Record<string, any>} PlainObject
 */

/**
 * @typedef CapabilitySpecs
 * @property {any} [db] - DB adapter spec / instance.
 * @property {any} [queue] - Queue adapter spec / instance.
 * @property {any} [objectStorage] - Object storage adapter spec / instance.
 */

/**
 * @typedef WharfieAppManifest
 * @property {{ name: string }} app - App metadata.
 * @property {any[]} [targets] - Build targets, if provided.
 * @property {CapabilitySpecs} [capabilities] - Runtime capability specs (db/queue/objectStorage), if discoverable.
 * @property {CapabilitySpecs} [resources] - Alias for `capabilities` (kept for compatibility with existing ActorSystem terminology).
 */

/**
 * @typedef LoadAppOptions
 * @property {string} [dir] - Directory to search for `wharfie.app.js` (default: cwd).
 */

/**
 * @param {any} v - v.
 * @returns {v is PlainObject} - Result.
 */
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {any} maybeSpecs - maybeSpecs.
 * @returns {CapabilitySpecs | undefined} - Result.
 */
function pickCapabilitySpecs(maybeSpecs) {
  if (!maybeSpecs || typeof maybeSpecs !== 'object') return undefined;

  /** @type {CapabilitySpecs} */
  const picked = {};
  if ('db' in maybeSpecs) picked.db = /** @type {any} */ (maybeSpecs).db;
  if ('queue' in maybeSpecs)
    picked.queue = /** @type {any} */ (maybeSpecs).queue;
  if ('objectStorage' in maybeSpecs)
    picked.objectStorage = /** @type {any} */ (maybeSpecs).objectStorage;

  if (!picked.db && !picked.queue && !picked.objectStorage) return undefined;
  return picked;
}

/**
 * Compile a minimal manifest from a supported `wharfie.app.js` export.
 * @param {any} appExport - appExport.
 * @returns {WharfieAppManifest} - Result.
 */
function compileManifest(appExport) {
  // --- Shape 1: ActorSystem instance (existing repo example) ---
  if (appExport instanceof ActorSystem) {
    const name = appExport.name;
    if (!name) {
      throw new Error('ActorSystem export is missing a name');
    }

    /** @type {WharfieAppManifest} */
    const manifest = { app: { name } };

    if (typeof appExport.has === 'function' && appExport.has('targets')) {
      const targets = appExport.get('targets');
      if (Array.isArray(targets)) {
        manifest.targets = targets;
      }
    }

    const resources = pickCapabilitySpecs(appExport.get('resources', {}));
    if (resources) {
      manifest.capabilities = resources;
      manifest.resources = resources;
    }

    return manifest;
  }

  // --- Shape 2: plain object export ---
  if (isPlainObject(appExport)) {
    const name =
      (isPlainObject(appExport.app) &&
        typeof appExport.app.name === 'string' &&
        appExport.app.name) ||
      (typeof appExport.name === 'string' && appExport.name);

    if (!name) {
      throw new Error(
        'Unsupported app export: expected { name } or { app: { name } }',
      );
    }

    /** @type {WharfieAppManifest} */
    const manifest = { app: { name } };

    const targets = Array.isArray(appExport.targets)
      ? appExport.targets
      : undefined;
    if (targets) manifest.targets = targets;

    // Prefer explicit v2 "capabilities", but accept existing "resources" terminology too.
    const candidates = [
      appExport.capabilities,
      appExport.capabilities?.resources,
      appExport.resources,
      appExport.app?.capabilities,
      appExport.app?.capabilities?.resources,
      appExport.app?.resources,
    ];

    let discovered;
    for (const candidate of candidates) {
      discovered = pickCapabilitySpecs(candidate);
      if (discovered) break;
    }

    if (discovered) {
      manifest.capabilities = discovered;
      manifest.resources = discovered;
    }

    return manifest;
  }

  throw new Error(
    `Unsupported app export type: ${typeof appExport}. Expected a plain object or ActorSystem instance.`,
  );
}

/**
 * Load `wharfie.app.js` from disk and compile a minimal manifest.
 * @param {LoadAppOptions} [options] - options.
 * @returns {Promise<{ appExport: any, manifest: WharfieAppManifest }>} - Result.
 */
export async function loadApp(options = {}) {
  const dir = options.dir ?? process.cwd();
  const appPath = path.resolve(dir, 'wharfie.app.js');

  try {
    await fsp.access(appPath);
  } catch (err) {
    throw new Error(`Could not find wharfie.app.js in: ${dir}`);
  }

  // NOTE: This uses an ESM dynamic import. Node will resolve the module format
  // based on the nearest package.json "type". Wharfie apps should be authored
  // as ESM ("type": "module") in v2.
  const mod = await import(pathToFileURL(appPath).href);

  // MVP: only `default` is required, but tolerate a named export for ergonomics.
  const appExport = mod?.default ?? mod?.app ?? mod?.actorSystem;
  if (!appExport) {
    throw new Error(
      'wharfie.app.js did not export an app. Expected a default export.',
    );
  }

  const manifest = compileManifest(appExport);
  return { appExport, manifest };
}

export default loadApp;
