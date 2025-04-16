const BaseResource = require('../lambdas/lib/actor/resources/base-resource');
const Actor = require('../lambdas/lib/actor/resources/builds/actor2');
const ActorSystem = require('../lambdas/lib/actor/resources/builds/actor-system');
const Reconcilable = require('../lambdas/lib/actor/resources/reconcilable');

const dep = require('./lib/dep');

// const start = new Actor((context) => {
// console.log('started')
// dep();
// console.log('done')
// })

// start.build();
// if (!(typeof __BUNDLED_WITH_ESBUILD !== 'undefined' && __BUNDLED_WITH_ESBUILD)) {
const {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
} = require('../lambdas/lib/db/state/local');
BaseResource.stateDB = {
  putResource,
  putResourceStatus,
  getResource,
  getResourceStatus,
  getResources,
  deleteResource,
};
// }

/**
 *
 */
async function main() {
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });

  const start = new Actor(
    async (event, context) => {
      console.log('started');
      dep();
      console.log('done');
    },
    {
      name: 'start',
    }
  );

  const system = new ActorSystem({
    name: 'system',
  });
  await system.registerActors([start]);
  await system.reconcile();
}
main();
// binary start <args>

// const start = new Actor(path.join(__dirname, './handlers/start.handler'))
// const end = new Actor(path.join(__dirname, './handlers/start.handler'))

// start.run();

// const finish = new Actor()
