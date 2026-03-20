// @ts-nocheck
import { EventEmitter } from 'node:events';
import path from 'node:path';

import Function from '../lambdas/lib/actor/resources/builds/function.js';
import ActorSystem from '../lambdas/lib/actor/resources/builds/actor-system.js';
import Reconcilable from '../lambdas/lib/actor/resources/reconcilable.js';
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

/**
 *
 */
async function main() {
  emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  emitter.on(Reconcilable.Events.WHARFIE_ERROR, (event) => {
    // console.error(event)
  });
  const __dirname = import.meta.dirname;
  const start = new Function({
    name: 'start',
    entrypoint: {
      path: path.resolve(__dirname, 'functions', 'start.js'),
      export: 'start',
    },
    properties: {
      external: [
        // Wharfie now resolves installed versions automatically for bare package names.
        'lmdb',
        'sharp@0.34.4',
        'sodium-native@5.0.9',
        '@duckdb/node-api',
        'usb@2.13.0',
      ],
      resources: {
        db: {
          adapter: 'vanilla',
          options: { path: path.resolve(import.meta.dirname, '.hello-world') },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: path.resolve(import.meta.dirname, '.hello-world') },
        },
        objectStorage: {
          adapter: 'vanilla',
          options: { path: path.resolve(import.meta.dirname, '.hello-world') },
        },
      },
    },
  });

  const main = new ActorSystem({
    name: 'main',
    functions: [start],
    stateDB,
    emitter,
    properties: {
      targets: [
        {
          nodeVersion: '24',
          platform: 'darwin',
          architecture: 'arm64',
        },
        // {
        //   nodeVersion: '23',
        //   platform: 'darwin',
        //   architecture: 'arm64',
        // },
        {
          nodeVersion: '24',
          platform: 'linux',
          architecture: 'x64',
          // libc: 'glibc',
        },
        // {
        //   nodeVersion: '22',
        //   platform: 'darwin',
        //   architecture: 'x64',
        // },
        // {
        //   nodeVersion: '24',
        //   platform: 'win32',
        //   architecture: 'x64',
        // },
        // {
        //   nodeVersion: '22',
        //   platform: 'win32',
        //   architecture: 'x86',
        // },
      ],
      resources: {
        db: {
          adapter: 'vanilla',
          options: { path: path.resolve(import.meta.dirname, '.hello-world') },
        },
        queue: {
          adapter: 'vanilla',
          options: { path: path.resolve(import.meta.dirname, '.hello-world') },
        },
        objectStorage: {
          adapter: 'vanilla',
          options: { path: path.resolve(import.meta.dirname, '.hello-world') },
        },
      },
    },
  });

  await main.reconcile();
  // let t = 0;
  // while (t < 10) {
  //   await start.fn()
  //   t += 1
  // }
}

main();
