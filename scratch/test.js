const BaseResource = require('../lambdas/lib/actor/resources/base-resource');
const Actor = require('../lambdas/lib/actor/resources/builds/actor');
const {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
} = require('../lambdas/lib/db/state/local');

const paths = require('../lambdas/lib/paths');
const Reconcilable = require('../lambdas/lib/actor/resources/reconcilable');
const path = require('node:path');
// const dep = require('./lib/dep')

// const start = new Actor((context) => {
//     console.log('started')
//     dep();
//     console.log('done')
// })

// start.build();
BaseResource.stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};

async function main() {
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  const start = new Actor({
    name: 'start',
    properties: {
      handler: path.join(__dirname, './handlers/start.handler'),
      nodeVersion: '23',
      platform: 'darwin',
      architecture: 'arm64',
    },
  });
  const timeA = Date.now();
  await start.reconcile();
  console.log('reconcile: ', Date.now() - timeA);
  const timeB = Date.now();
  await start.run();
  console.log('run1: ', Date.now() - timeB);
  const timeC = Date.now();
  await start.run();
  console.log('run2: ', Date.now() - timeC);
  const timeD = Date.now();
  await start.run();
  console.log('run3: ', Date.now() - timeD);
  const timeDestroy = Date.now();
  // await start.destroy();
  console.log('destroy: ', Date.now() - timeDestroy);
}
console.log(paths);
main();

// const start = new Actor(path.join(__dirname, './handlers/start.handler'))
// const end = new Actor(path.join(__dirname, './handlers/start.handler'))

// start.run();

// const finish = new Actor()
