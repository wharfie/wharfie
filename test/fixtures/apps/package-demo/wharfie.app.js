import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import ActorSystem from '../../../../lambdas/lib/actor/resources/builds/actor-system.js';
import SeaBuild from '../../../../lambdas/lib/actor/resources/builds/sea-build.js';

const currentTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch,
};
const alternateTarget = {
  nodeVersion: process.versions.node,
  platform: process.platform,
  architecture: process.arch === 'x64' ? 'arm64' : 'x64',
};
const buildDir = path.join(os.tmpdir(), 'wharfie-package-demo-builds');

/**
 * @param {{ nodeVersion: string, platform: string, architecture: string, libc?: string }} target - target.
 * @returns {string} - Result.
 */
function getTargetSelector(target) {
  return `node${target.nodeVersion}-${target.platform}-${target.architecture}${
    target.libc ? `-${target.libc}` : ''
  }`;
}

const buildsByTarget = new Map(
  [currentTarget, alternateTarget].map((target) => {
    const selector = getTargetSelector(target);
    const build = new SeaBuild({
      name: `package-demo-build-${selector}`,
      properties: {
        entryCode: `console.log(${JSON.stringify(selector)})`,
        resolveDir: process.cwd(),
        nodeBinaryPath: process.execPath,
        nodeVersion: target.nodeVersion,
        platform: target.platform,
        architecture: target.architecture,
        ...(target.libc ? { libc: target.libc } : {}),
      },
    });
    return [selector, build];
  }),
);

const app = new ActorSystem({
  name: 'package-demo',
  properties: {
    targets: [currentTarget, alternateTarget],
    resources: {},
  },
});

app.reconcile = async () => {
  await fsp.mkdir(buildDir, { recursive: true });

  /** @type {string[]} */
  const builtTargets = [];
  for (const target of app.get('targets')) {
    const selector = getTargetSelector(target);
    const build = buildsByTarget.get(selector);
    if (!build) {
      continue;
    }

    const fakeBinaryPath = path.join(buildDir, `package-demo-${selector}`);
    await fsp.writeFile(
      fakeBinaryPath,
      `#!/bin/sh
echo ${selector}
`,
    );
    build._setUNSAFE('binaryPath', fakeBinaryPath);
    builtTargets.push(selector);
  }

  const traceFile = process.env.WHARFIE_PACKAGE_DEMO_TRACE_FILE;
  if (traceFile) {
    await fsp.mkdir(path.dirname(traceFile), { recursive: true });
    await fsp.writeFile(traceFile, JSON.stringify({ builtTargets }, null, 2));
  }
};

app.getResources = () => {
  return app.get('targets').reduce((acc, target) => {
    const build = buildsByTarget.get(getTargetSelector(target));
    if (build) {
      acc.push(build);
    }
    return acc;
  }, /** @type {SeaBuild[]} */ ([]));
};

export default app;
