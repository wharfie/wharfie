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

/**
 *
 * @param pkgName
 */
function getInstalledVersion(pkgName) {
  const entry = lock.packages?.[`node_modules/${pkgName}`];
  return entry?.version || null;
}

async function unawaitedAsync() {
  await new Promise((resolve) => setTimeout(resolve, 100));
  console.log('test draining');
}
/**
 *
 */
async function main() {
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_STATUS, (event) => {
    // console.log(event)
  });
  const start = new Function(
    async (event, context) => {
      console.log('params', [event, context]);
      console.log('started');
      dep();
      console.log('done');

      const lmdb = require('lmdb');
      const ROOT_DB = lmdb.open({
        path: 'test-db',
      });
      await ROOT_DB.put('greeting', { someText: 'Hello, World!' });
      console.log(ROOT_DB.get('greeting').someText);
      unawaitedAsync();
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
      targest: [
        {
          nodeVersion: '24',
          platform: 'darwin',
          architecture: 'arm64',
        },
      ],
    },
    functions: [start],
  });

  await start.reconcile();
  await main.reconcile();
}

main();
