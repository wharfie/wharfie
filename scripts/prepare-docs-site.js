import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const EDGE_CODE_MARKER = '__WHARFIE_DOCS_EDGE_CODE__';
const CONTENT_MARKER = '__WHARFIE_DOCS_SHA256__';

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
 * Prepare local files only; cloud credentials and deployment stay with the operator.
 * Git provenance describes the checkout before this new output directory is created.
 * @param {{outputDir: string, repoRoot?: string}} options - Bundle destination and source.
 * @returns {{format: string, version: number, git: {commit: string, dirty: boolean}, account: string, region: string, stack: string, bucket: string, contentSha256: string, objectKey: string, files: Array<{name: string, sha256: string, size: number}>}} Manifest binding source and deployable files.
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
  const index = readFileSync(path.join(source, 'index.html'));
  const edge = readFileSync(path.join(source, 'edge-router.js'), 'utf8');
  const template = JSON.parse(
    readFileSync(path.join(source, 'hosting.template.json'), 'utf8'),
  );
  assert.equal(
    template.Resources?.DocsRoutes?.Properties?.FunctionCode,
    EDGE_CODE_MARKER,
    'The hosting template must contain the exact edge-code marker.',
  );
  const segments = edge.split(CONTENT_MARKER);
  assert.equal(
    segments.length,
    2,
    'The edge source must contain one content marker.',
  );
  const contentSha256 = sha256(index);
  assert.ok(
    Buffer.byteLength(segments.join(contentSha256)) <= 10 * 1024,
    'The rendered edge function exceeds the CloudFront 10 KB limit.',
  );
  template.Resources.DocsRoutes.Properties.FunctionCode = {
    'Fn::Join': ['', [segments[0], { Ref: 'ContentSha256' }, segments[1]]],
  };
  const files = new Map([
    ['index.html', index],
    ['hosting.template.json', jsonBytes(template)],
    [
      'parameters.json',
      jsonBytes([
        { ParameterKey: 'ContentSha256', ParameterValue: contentSha256 },
        { ParameterKey: 'CustomDomain', ParameterValue: '' },
        { ParameterKey: 'CertificateArn', ParameterValue: '' },
      ]),
    ],
  ]);
  const certificate = path.join(source, 'certificate.template.json');
  if (existsSync(certificate)) {
    const bytes = readFileSync(certificate);
    JSON.parse(bytes.toString('utf8'));
    files.set('certificate.template.json', bytes);
  }
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
    version: 1,
    git: { commit, dirty: status !== '' },
    account: '411430101559',
    region: 'us-east-1',
    stack: 'wharfie-docs',
    bucket: 'wharfie-docs-411430101559-us-east-1',
    contentSha256,
    objectKey: `releases/${contentSha256}/index.html`,
    files: [...files].map(([name, bytes]) => ({
      name,
      sha256: sha256(bytes),
      size: bytes.length,
    })),
  };
  mkdirSync(destination, { mode: 0o700 });
  for (const [name, bytes] of files) {
    writeFileSync(path.join(destination, name), bytes, {
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
          'Prepare a reviewable docs bundle locally. The destination must not exist; its parent must exist.\n',
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
