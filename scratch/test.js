const BaseResource = require('../lambdas/lib/actor/resources/base-resource');
const Function = require('../lambdas/lib/actor/resources/builds/function');
const ActorSystem = require('../lambdas/lib/actor/resources/builds/actor-system');
const Reconcilable = require('../lambdas/lib/actor/resources/reconcilable');
const dep = require('./lib/dep');

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

const lock = require('../package-lock.json');

function getInstalledVersion(pkgName) {
  const entry = lock.packages?.[`node_modules/${pkgName}`];
  return entry?.version || null;
}

/**
 *
 */
async function main() {
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  const start = new Function(
    async () => {
      console.log('started');
      dep();
      console.log('done');

      const lmdb = require('lmdb');
      const ROOT_DB = lmdb.open({
        path: 'test-db',
      });
      await ROOT_DB.put('greeting', { someText: 'Hello, World!' });
      console.log(ROOT_DB.get('greeting').someText);
    },
    {
      name: 'start',
      properties: {
        nodeVersion: '24',
        external: [
          {
            name: 'lmdb',
            version: getInstalledVersion('lmdb'),
          },
        ],
      },
    }
  );

  const main = new ActorSystem({
    name: 'main',
    properties: {
      infrastructure: 'aws',
      nodeVersion: '24',
      platform: 'darwin',
      architecture: 'arm64',
    },
    functions: [start],
  });

  await start.reconcile();
  await main.reconcile();
}
main();

// const start = new Actor(path.join(__dirname, './handlers/start.handler'))
// const end = new Actor(path.join(__dirname, './handlers/start.handler'))

// start.run();

// const finish = new Actor()
