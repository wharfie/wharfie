import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ActorSystem from '../../../../src/core/resources/builds/actor-system.js';
import Function from '../../../../src/core/resources/builds/function.js';

import {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
} from './config.js';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const scratchDir = path.resolve(appDir, '../../..');
const startEntrypointPath = path.join(scratchDir, 'functions', 'start.js');

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
 * @property {import('../../../../src/core/resources/runtime-config.js').WharfieRuntimeConfig} [runtime] - Optional structured runtime config.
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
      external: [...kitchenSinkExternalDependencies],
      resources: createVanillaResources(functionRuntimePath),
    },
  });

  return new ActorSystem({
    name: 'kitchen-sink-demo',
    functions: [startFunction],
    runtime: options.runtime,
    stateDB: options.stateDB,
    emitter: options.emitter,
    properties: {
      targets:
        Array.isArray(options.targets) && options.targets.length > 0
          ? options.targets.map((target) => ({ ...target }))
          : kitchenSinkDefaultTargets.map((target) => ({ ...target })),
      resources: createVanillaResources(systemRuntimePath),
    },
  });
}

const app = createKitchenSinkApp();

export default app;
