// test/helpers/make-fake-native.js
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/* eslint-disable jsdoc/require-jsdoc */

const fs = require('node:fs/promises');
const path = require('node:path');

async function makeFakeNativePkg(rootDir, name) {
  const pkgDir = path.join(rootDir, name);
  await fs.mkdir(pkgDir, { recursive: true });

  const pkgJson = {
    name,
    version: '0.0.0',
    // install script simulates a native build attempt
    scripts: {
      install: 'node scripts/install.js',
    },
  };

  const installJs = `
    import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
    console.log("INSTALLING")
    const { spawnSync } = require('node:child_process');

    // Signal to tests we tried to build
    console.error('BUILD_ATTEMPT: starting');

    // Respect common env toggles — if someone set prebuild_download=false, try to build
    // (We always try to "build" here to keep it deterministic.)
    const nodeGyp = process.env.npm_config_node_gyp || 'node-gyp';
    const res = spawnSync(nodeGyp, ['rebuild'], { stdio: 'inherit', shell: false });

    if (res.error) {
      console.error('BUILD_ATTEMPT: failed to spawn node-gyp:', String(res.error && res.error.message || res.error));
      process.exit(1);
    }
    process.exit(res.status || 1);
  `;

  await fs.writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify(pkgJson, null, 2),
  );
  await fs.mkdir(path.join(pkgDir, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(pkgDir, 'scripts', 'install.js'), installJs);
  return pkgDir;
}

module.exports = { makeFakeNativePkg };
