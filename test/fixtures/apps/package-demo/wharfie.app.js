import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import ActorSystem from '../../../../src/core/resources/builds/actor-system.js';
import SeaBuild from '../../../../src/core/resources/builds/sea-build.js';
import { APP_MANIFEST_ASSET_NAME } from '../../../../src/core/resources/builds/lib/app-manifest-asset.js';

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
  /** @type {Record<string, { appName: string | null, targetSelectors: string[] }>} */
  const embeddedManifestByTarget = {};

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

    const assets = build.get('assets', {});
    const manifestAssetPath = assets[APP_MANIFEST_ASSET_NAME];
    if (typeof manifestAssetPath === 'string' && manifestAssetPath) {
      const embeddedManifest = JSON.parse(
        await fsp.readFile(manifestAssetPath, 'utf8'),
      );
      embeddedManifestByTarget[selector] = {
        appName:
          typeof embeddedManifest?.app?.name === 'string'
            ? embeddedManifest.app.name
            : null,
        targetSelectors: Array.isArray(embeddedManifest?.targets)
          ? embeddedManifest.targets.map((candidate) =>
              getTargetSelector(candidate),
            )
          : [],
      };
    }
  }

  const traceFile = process.env.WHARFIE_PACKAGE_DEMO_TRACE_FILE;
  if (traceFile) {
    await fsp.mkdir(path.dirname(traceFile), { recursive: true });
    await fsp.writeFile(
      traceFile,
      JSON.stringify({ builtTargets, embeddedManifestByTarget }, null, 2),
    );
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
