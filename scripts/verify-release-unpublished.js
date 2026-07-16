import assert from 'node:assert/strict';
import path from 'node:path';

import { readJson, REPO_ROOT } from './package-verification.js';

const packageMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
assert.equal(typeof packageMetadata.name, 'string');
assert.equal(typeof packageMetadata.version, 'string');

const registryBase =
  process.env.npm_config_registry || 'https://registry.npmjs.org/';
const registryUrl = new URL(
  `${encodeURIComponent(packageMetadata.name)}/${encodeURIComponent(packageMetadata.version)}`,
  registryBase.endsWith('/') ? registryBase : `${registryBase}/`,
);

const response = await fetch(registryUrl, {
  headers: { accept: 'application/json' },
});

if (response.status === 200) {
  throw new Error(
    `${packageMetadata.name}@${packageMetadata.version} is already published; bump package.json before creating the release.`,
  );
}
if (response.status !== 404) {
  throw new Error(
    `Unable to verify npm version availability: registry returned HTTP ${response.status}.`,
  );
}

process.stdout.write(
  `Verified ${packageMetadata.name}@${packageMetadata.version} is not published\n`,
);
