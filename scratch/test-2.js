import BaseResource from '../lambdas/lib/actor/resources/base-resource.js';
import Function from '../lambdas/lib/actor/resources/builds/function.js';
import ActorSystem from '../lambdas/lib/actor/resources/builds/actor-system.js';
import Reconcilable from '../lambdas/lib/actor/resources/reconcilable.js';

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';

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
 * @param pkgName
 */
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
  Reconcilable.Emitter.on(Reconcilable.Events.WHARFIE_ERROR, (event) => {
    // console.error(event)
  });
  const start = new Function(
    async (event, context) => {
      const node = await createLibp2p({
        addresses: {
          // listen on localhost, random port
          listen: ['/ip4/127.0.0.1/tcp/0'],
        },
        transports: [
          tcp(), // @libp2p/tcp
        ],
        connectionEncrypters: [
          noise(), // Noise handshake
        ],
        streamMuxers: [
          yamux(), // multiplexer for streams
        ],
      });

      await node.start();
      console.log(
        'listening on:',
        node.getMultiaddrs().map((ma) => ma.toString()),
      );
    },
    {
      name: 'start',
      properties: {
        external: [
          // --- existing ---
          { name: 'libp2p', version: getInstalledVersion('libp2p') },
          { name: '@libp2p/tcp', version: getInstalledVersion('@libp2p/tcp') },
          { name: 'libp2p', version: getInstalledVersion('libp2p') },
          { name: 'libp2p', version: getInstalledVersion('libp2p') },
        ],
      },
    },
  );

  const main = new ActorSystem({
    name: 'p2p',
    functions: [start],
    properties: {
      targets: [
        {
          nodeVersion: '24',
          platform: 'darwin',
          architecture: 'arm64',
        },
        {
          nodeVersion: '24',
          platform: 'linux',
          architecture: 'x64',
        },
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
