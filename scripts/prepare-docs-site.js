import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_FILES = [
  'index.html',
  '404.html',
  '_headers',
  '_routes.json',
  '_worker.js',
];

/**
 * @param {Buffer | string} value - Exact file contents.
 * @returns {string} SHA-256 digest.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {unknown} value - JSON value.
 * @returns {Buffer} Pretty-printed JSON with a final newline.
 */
function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

/**
 * @param {string} repoRoot - Source checkout.
 * @param {string[]} args - Read-only Git arguments.
 * @returns {string} Bounded Git output.
 */
function readGit(repoRoot, args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Prepare only reviewed Pages inputs; upload the site subdirectory, never the bundle root.
 * Git provenance describes the checkout before this new output directory is created.
 * @param {{outputDir: string, repoRoot?: string}} options - Bundle destination and source.
 * @returns {{format: string, version: number, provider: string, deployDirectory: string, git: {commit: string, dirty: boolean}, contentSha256: string, files: Array<{name: string, sha256: string, size: number}>}} Manifest binding source and deployable files.
 */
export function prepareDocsSite({ outputDir, repoRoot = REPO_ROOT }) {
  assert.equal(typeof outputDir, 'string', '--output-dir is required.');
  assert.ok(outputDir.length > 0, '--output-dir is required.');
  const destination = path.resolve(outputDir);
  const commit = readGit(repoRoot, ['rev-parse', '--verify', 'HEAD']);
  assert.match(commit, /^[a-f0-9]{40}$/u, 'Expected a Git commit SHA.');
  const statusArgs = ['status', '--porcelain', '--untracked-files=normal'];
  const status = readGit(repoRoot, statusArgs);
  const source = path.join(repoRoot, 'docs', 'site');
  const files = new Map(
    SITE_FILES.map((name) => [name, readFileSync(path.join(source, name))]),
  );
  const index = files.get('index.html');
  assert.ok(index);
  const routes = files.get('_routes.json');
  assert.ok(routes);
  assert.deepEqual(
    JSON.parse(routes.toString('utf8')),
    {
      version: 1,
      include: ['/*'],
      exclude: ['/'],
    },
    'The landing page must remain outside Pages Functions invocation routes.',
  );
  const contentSha256 = sha256(index);
  assert.equal(
    readGit(repoRoot, ['rev-parse', '--verify', 'HEAD']),
    commit,
    'Git HEAD changed while preparing the bundle.',
  );
  assert.equal(
    readGit(repoRoot, statusArgs),
    status,
    'Git status changed while preparing the bundle.',
  );
  const manifest = {
    format: 'wharfie-docs-site',
    version: 2,
    provider: 'cloudflare-pages',
    deployDirectory: 'site',
    git: { commit, dirty: status !== '' },
    contentSha256,
    files: [...files].map(([name, bytes]) => ({
      name: `site/${name}`,
      sha256: sha256(bytes),
      size: bytes.length,
    })),
  };
  mkdirSync(destination, { mode: 0o700 });
  const site = path.join(destination, 'site');
  mkdirSync(site, { mode: 0o700 });
  for (const [name, bytes] of files) {
    writeFileSync(path.join(site, name), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  writeFileSync(path.join(destination, 'manifest.json'), jsonBytes(manifest), {
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}

/**
 * @param {string[]} argv - CLI arguments.
 * @returns {{outputDir?: string, help?: boolean}} Validated CLI options.
 */
export function parseDocsSiteArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return { help: true };
  if (
    argv.length !== 2 ||
    argv[0] !== '--output-dir' ||
    !argv[1] ||
    argv[1].startsWith('--')
  ) {
    throw new TypeError(
      'Usage: node scripts/prepare-docs-site.js --output-dir <new-directory>',
    );
  }
  return { outputDir: argv[1] };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const options = parseDocsSiteArgs(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(
        'Usage: node scripts/prepare-docs-site.js --output-dir <new-directory>\n' +
          'Prepare a Cloudflare Pages bundle locally. Upload only <new-directory>/site.\n' +
          'The destination must not exist; its parent must exist.\n',
      );
    } else {
      assert.ok(options.outputDir);
      process.stdout.write(
        `${JSON.stringify(prepareDocsSite({ outputDir: options.outputDir }), null, 2)}\n`,
      );
    }
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
