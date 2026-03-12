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
  'context-override',
  String(process.pid),
);
const currentTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
};

const inspectContextFunction = new Function({
  name: 'inspect-context',
  entrypoint: {
    path: path.join(functionsDir, 'inspect-context.js'),
    export: 'inspectContext',
  },
});

const app = new ActorSystem({
  name: 'context-override-demo',
  functions: [inspectContextFunction],
  properties: {
    targets: [currentTarget],
    resources: {
      db: { adapter: 'vanilla', options: { path: runtimePath } },
    },
  },
});

export default app;
