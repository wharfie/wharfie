import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ActorSystem from '../../../../lambdas/lib/actor/resources/builds/actor-system.js';
import Function from '../../../../lambdas/lib/actor/resources/builds/function.js';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const functionsDir = path.resolve(appDir, '../../functions');
const runtimePath = path.join(
  os.tmpdir(),
  'wharfie-examples',
  'hello-world',
  String(process.pid),
);
const currentTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
};

const echoEvent = new Function({
  name: 'echo-event',
  entrypoint: {
    path: path.join(functionsDir, 'echo-event.js'),
    export: 'echoEvent',
  },
});

const helloResources = new Function({
  name: 'hello-resources',
  entrypoint: {
    path: path.join(functionsDir, 'hello-resources.js'),
    export: 'helloResources',
  },
});

const app = new ActorSystem({
  name: 'hello-world-demo',
  functions: [echoEvent, helloResources],
  properties: {
    targets: [currentTarget],
    resources: {
      db: { adapter: 'vanilla', options: { path: runtimePath } },
      queue: { adapter: 'vanilla', options: { path: runtimePath } },
      objectStorage: { adapter: 'vanilla', options: { path: runtimePath } },
    },
  },
});

export default app;
