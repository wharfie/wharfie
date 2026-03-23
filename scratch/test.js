// @ts-nocheck
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../lambdas/lib/actor/resources/builds/function.js';
import ActorSystem from '../lambdas/lib/actor/resources/builds/actor-system.js';
import Reconcilable from '../lambdas/lib/actor/resources/reconcilable.js';

import {
  kitchenSinkDefaultTargets,
  kitchenSinkExternalDependencies,
} from './examples/actor-systems/kitchen-sink/config.js';
import {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
} from '../lambdas/lib/db/state/store.js';

const stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};

const emitter = new EventEmitter();
const runtime = {
  stateStore: stateDB,
  telemetry: emitter,
};
const scratchDir = path.dirname(fileURLToPath(import.meta.url));
const runtimePath = path.resolve(scratchDir, '.hello-world');

/**
 * Scratch spike for the kitchen-sink ActorSystem path.
 */
async function main() {
  emitter.on(Reconcilable.Events.WHARFIE_STATUS, () => {});
  emitter.on(Reconcilable.Events.WHARFIE_ERROR, () => {});

  const start = new Function({
    name: 'start',
    entrypoint: {
      path: path.resolve(scratchDir, 'functions', 'start.js'),
      export: 'start',
    },
    properties: {
      external: [...kitchenSinkExternalDependencies],
      resources: {
        db: {
          adapter: 'vanilla',
          options: { path: runtimePath },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: runtimePath },
        },
        objectStorage: {
          adapter: 'vanilla',
          options: { path: runtimePath },
        },
      },
    },
  });

  const system = new ActorSystem({
    name: 'main',
    functions: [start],
    runtime,
    properties: {
      targets: kitchenSinkDefaultTargets.map((target) => ({ ...target })),
      resources: {
        db: {
          adapter: 'vanilla',
          options: { path: runtimePath },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: runtimePath },
        },
        objectStorage: {
          adapter: 'vanilla',
          options: { path: runtimePath },
        },
      },
    },
  });

  await system.reconcile();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
