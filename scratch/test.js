import BaseResource from '../lambdas/lib/actor/resources/base-resource.js';
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
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);

BaseResource.stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};
const lock = require('../package-lock.json');

/**
 * @param {string} pkgName -
 * @returns {string} -
 */
function getInstalledVersion(pkgName) {
  // @ts-ignore
  const entry = lock.packages?.[`node_modules/${pkgName}`];
  if (!entry || !entry.version)
    throw new Error(`Could not find ${pkgName} in package-lock.json`);
  return entry.version;
}
/**
 *
 */
async function main() {
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_ERROR, (event) => {
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
        // --- existing ---
        { name: 'lmdb', version: getInstalledVersion('lmdb') },
        { name: 'sharp', version: '0.34.4' },
        { name: 'sodium-native', version: '5.0.9' },
        {
          name: '@duckdb/node-api',
          version: getInstalledVersion('@duckdb/node-api'),
        },
        { name: 'usb', version: '2.13.0' },
      ],
    },
  });

  const main = new ActorSystem({
    name: 'main',
    functions: [start],
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
