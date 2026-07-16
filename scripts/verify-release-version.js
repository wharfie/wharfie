import assert from 'node:assert/strict';
import path from 'node:path';

import { readJson, REPO_ROOT } from './package-verification.js';

const releaseTag = process.env.WHARFIE_RELEASE_TAG || process.argv[2];
assert.ok(releaseTag, 'Set WHARFIE_RELEASE_TAG or pass the release tag');

const packageMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
const expectedTag = `v${packageMetadata.version}`;

assert.equal(
  releaseTag,
  expectedTag,
  `Release tag ${releaseTag} does not match package version ${packageMetadata.version}`,
);

process.stdout.write(
  `Verified release tag ${releaseTag} matches package version\n`,
);
