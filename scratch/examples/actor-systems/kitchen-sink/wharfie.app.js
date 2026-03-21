import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ActorSystem from '../../../../lambdas/lib/actor/resources/builds/actor-system.js';
import Function from '../../../../lambdas/lib/actor/resources/builds/function.js';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const scratchDir = path.resolve(appDir, '../../..');
const startEntrypointPath = path.join(scratchDir, 'functions', 'start.js');
const defaultTargets = [
  {
    nodeVersion: '24',
    platform: 'darwin',
    architecture: 'arm64',
  },
  {
    nodeVersion: '24',
    platform: 'linux',
    architecture: 'x64',
  },
];

/**
 * @typedef KitchenSinkBuildTarget
 * @property {string} nodeVersion - Node major or exact version.
 * @property {string} platform - Target platform.
 * @property {string} architecture - Target architecture.
 * @property {string} [libc] - Optional libc.
 */

/**
 * @typedef CreateKitchenSinkAppOptions
 * @property {any} [stateDB] - Optional scoped state store override.
 * @property {import('node:events').EventEmitter} [emitter] - Optional scoped telemetry emitter.
 * @property {string} [runtimeBasePath] - Base path for vanilla runtime resources.
 * @property {KitchenSinkBuildTarget[]} [targets] - Optional build targets override.
 */

/**
 * @param {string} runtimePath - runtimePath.
 * @returns {{
 *   db: { adapter: 'vanilla', options: { path: string } },
 *   queue: { adapter: 'vanilla', options: { path: string } },
 *   objectStorage: { adapter: 'vanilla', options: { path: string } },
 * }} - Result.
 */
function createVanillaResources(runtimePath) {
  return {
    db: { adapter: 'vanilla', options: { path: runtimePath } },
    queue: { adapter: 'vanilla', options: { path: runtimePath } },
    objectStorage: { adapter: 'vanilla', options: { path: runtimePath } },
  };
}

/**
 * @param {CreateKitchenSinkAppOptions} [options] - options.
 * @returns {ActorSystem} - Result.
 */
export function createKitchenSinkApp(options = {}) {
  const runtimeBasePath =
    options.runtimeBasePath ??
    path.join(
      os.tmpdir(),
      'wharfie-examples',
      'kitchen-sink',
      String(process.pid),
    );
  const systemRuntimePath = path.join(runtimeBasePath, 'system');
  const functionRuntimePath = path.join(runtimeBasePath, 'function');
  const startFunction = new Function({
    name: 'start',
    entrypoint: {
      path: startEntrypointPath,
      export: 'start',
    },
    properties: {
      external: [
        'lmdb',
        'sharp@0.34.4',
        'sodium-native@5.0.9',
        '@duckdb/node-api',
        'usb@2.13.0',
      ],
      resources: createVanillaResources(functionRuntimePath),
    },
  });

  return new ActorSystem({
    name: 'kitchen-sink-demo',
    functions: [startFunction],
    stateDB: options.stateDB,
    emitter: options.emitter,
    properties: {
      targets:
        Array.isArray(options.targets) && options.targets.length > 0
          ? options.targets.map((target) => ({ ...target }))
          : defaultTargets.map((target) => ({ ...target })),
      resources: createVanillaResources(systemRuntimePath),
    },
  });
}

const app = createKitchenSinkApp();

export default app;
