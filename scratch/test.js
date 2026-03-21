// @ts-nocheck
import { EventEmitter } from 'node:events';
import path from 'node:path';

import Reconcilable from '../lambdas/lib/actor/resources/reconcilable.js';
import {
  deleteResource,
  getResource,
  getResourceStatus,
  getResources,
  putResource,
  putResourceStatus,
} from '../lambdas/lib/db/state/store.js';
import { createKitchenSinkApp } from './examples/actor-systems/kitchen-sink/wharfie.app.js';

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
 * Ad-hoc local runner for the supported kitchen-sink example.
 */
async function main() {
  emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  emitter.on(Reconcilable.Events.WHARFIE_ERROR, (event) => {
    // console.error(event)
  });

  const app = createKitchenSinkApp({
    stateDB,
    emitter,
    runtimeBasePath: path.resolve(import.meta.dirname, '.kitchen-sink'),
  });

  await app.reconcile();
}

main();
