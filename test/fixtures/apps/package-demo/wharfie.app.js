import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import ActorSystem from '../../../../lambdas/lib/actor/resources/builds/actor-system.js';
import SeaBuild from '../../../../lambdas/lib/actor/resources/builds/sea-build.js';

const fakeBinaryPath = path.join(
  os.tmpdir(),
  'wharfie-package-demo',
  `package-demo-${process.pid}`,
);

const fakeBuild = new SeaBuild({
  name: 'package-demo-build',
  properties: {
    entryCode: 'console.log("package-demo")',
    resolveDir: process.cwd(),
    nodeBinaryPath: process.execPath,
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  },
});

const app = new ActorSystem({
  name: 'package-demo',
  properties: {
    targets: [
      {
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
      },
    ],
    resources: {},
  },
});

app.reconcile = async () => {
  await fsp.mkdir(path.dirname(fakeBinaryPath), { recursive: true });
  await fsp.writeFile(fakeBinaryPath, '#!/bin/sh\necho package-demo\n');
  fakeBuild._setUNSAFE('binaryPath', fakeBinaryPath);
};

app.getResources = () => [fakeBuild];

export default app;
