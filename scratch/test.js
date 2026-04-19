// @ts-nocheck
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Function from '../src/core/resources/builds/function.js';
import ActorSystem from '../src/core/resources/builds/actor-system.js';
import SeaBuild from '../src/core/resources/builds/sea-build.js';
import Reconcilable from '../src/core/resources/reconcilable.js';

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
} from '../src/core/lib/db/state/store.js';

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

function getBuildTargetSelector(build) {
  const nodeVersion = build.get('nodeVersion');
  const platform = build.get('platform');
  const architecture = build.get('architecture');
  const libc = build.has('libc') ? build.get('libc') : '';

  return `node${nodeVersion}-${platform}-${architecture}${
    libc ? `-${libc}` : ''
  }`;
}

function getArtifactLocations(system) {
  return system
    .getResources()
    .filter((resource) => resource instanceof SeaBuild)
    .map((build) => ({
      name: build.name,
      target: getBuildTargetSelector(build),
      path: build.get('binaryPath'),
    }))
    .filter((artifact) => artifact.path);
}

function printArtifactLocations(system) {
  const artifacts = getArtifactLocations(system);

  if (!artifacts.length) {
    console.log('No packaged artifacts were produced.');
    return;
  }

  console.log('Packaged artifacts:');
  for (const artifact of artifacts) {
    console.log(`- ${artifact.target}: ${artifact.path}`);
  }

  const firstArtifact = artifacts[0];
  console.log('Example commands:');
  console.log(`  "${firstArtifact.path}"`);
  console.log(`  "${firstArtifact.path}" ctl manifest`);
  console.log(`  "${firstArtifact.path}" func run start '{"who":"scratch"}'`);
}

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
  printArtifactLocations(system);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
