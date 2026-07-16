import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageMetadata = JSON.parse(
  readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
);

const blockers = [];

if (packageMetadata.private === true) {
  blockers.push('package.json is intentionally marked private');
}

for (const relativePath of [
  'src/core/lib/aws/athena',
  'src/core/lib/duckdb',
  'src/core/resources/aws/athena-workgroup.js',
  'test/legacy',
]) {
  if (existsSync(path.join(repoRoot, relativePath))) {
    blockers.push(`abandoned v1 path still exists: ${relativePath}`);
  }
}

for (const dependency of [
  '@aws-sdk/client-athena',
  '@duckdb/node-api',
  'apache-arrow',
  'hyparquet',
  'hyparquet-compressors',
  'node-sql-parser',
]) {
  if (Object.hasOwn(packageMetadata.dependencies || {}, dependency)) {
    blockers.push(`abandoned v1 dependency still exists: ${dependency}`);
  }
}

if (blockers.length > 0) {
  throw new Error(
    [
      'Wharfie releases are blocked until the v1 deletion milestone is complete:',
      ...blockers.map((blocker) => `- ${blocker}`),
      'Remove every blocker deliberately, then rerun this check before publishing a GitHub release.',
    ].join('\n'),
  );
}

process.stdout.write('Verified Wharfie is ready for a v2-only release\n');
