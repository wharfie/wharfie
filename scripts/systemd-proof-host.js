import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024 * 1024;
const MAX_SOURCE_FILES = 20000;
const MAX_SOURCE_ARCHIVE_BYTES =
  MAX_SOURCE_BYTES + MAX_SOURCE_FILES * 1024 + 64 * 1024;
const CONFIG_RELATIVE_PATH = 'test/systemd/lima.yaml';
const SAFE_ROOT_NPMRC = Buffer.from(
  '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nregistry=https://registry.npmjs.org/\n',
  'utf8',
);
const GENERATED_PARTS = new Set([
  '.git',
  '.codex',
  '.agents',
  '.wharfie',
  '.pytest_cache',
  '__pycache__',
  'node_modules',
  'coverage',
  'llm_artifacts',
  'build',
  'dist',
  'node_binaries',
  'esbuild_binaries',
  'test-db',
  'tmp',
]);

/**
 * @typedef {{path: string, mode: '100644' | '100755', bytes: number, sha256: string}} SourceFile
 */

/**
 * @param {string | Buffer} value - Exact bytes to identify.
 * @returns {string} - Lowercase SHA-256.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {string} filePath - A bounded or streamed local file.
 * @returns {string} - Lowercase SHA-256 without loading an image into memory.
 */
function hashFile(filePath) {
  const fd = fs.openSync(
    filePath,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    assert.ok(fs.fstatSync(fd).isFile(), 'Proof inputs must be regular files.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, count));
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Preserve ignored-file policy when inspecting the checkout, but never allow
 * inherited Git routing variables, fsmonitor hooks, or configured filters to
 * execute or redirect Git writes into the user's repository.
 * @param {boolean} isolated - Ignore global configuration for the private repo.
 * @returns {NodeJS.ProcessEnv} - Child-only environment; HOME is never changed.
 */
function gitEnvironment(isolated) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  Object.assign(environment, {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_NO_LAZY_FETCH: '1',
    GIT_ATTR_NOSYSTEM: '1',
    LC_ALL: 'C',
  });
  if (isolated) {
    Object.assign(environment, {
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: os.devNull,
      GIT_CONFIG_SYSTEM: os.devNull,
    });
  }
  return environment;
}

/**
 * @param {string} cwd - Exact source or private repository.
 * @param {string[]} args - Git arguments without a shell.
 * @param {{isolated?: boolean, config?: string[], input?: Buffer | string, maxBuffer?: number}} [options] - Read-only source / private write policy.
 * @returns {Buffer} - Exact Git output.
 */
function git(cwd, args, options = {}) {
  return execFileSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      `core.attributesFile=${os.devNull}`,
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'commit.gpgSign=false',
      ...(options.config ?? []),
      ...args,
    ],
    {
      cwd,
      env: gitEnvironment(options.isolated ?? false),
      input: options.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: options.maxBuffer ?? 16 * 1024 * 1024,
      timeout: 60000,
    },
  );
}

/**
 * git status can otherwise run a configured clean/process filter. Reading the
 * config itself does not execute those filters; override every configured key.
 * @param {string} repoRoot - Original checkout, read only.
 * @returns {string[]} - Per-call overrides that keep global ignore rules.
 */
function sourceGitConfig(repoRoot) {
  const names = git(repoRoot, ['config', '--null', '--name-only', '--list'])
    .toString('utf8')
    .split('\0');
  const config = [];
  for (const name of new Set(names)) {
    const match = /^filter\..*\.(clean|smudge|process|required)$/.exec(name);
    if (match)
      config.push('-c', `${name}=${match[1] === 'required' ? 'false' : ''}`);
  }
  return config;
}

/**
 * @param {string} candidate - Absolute path to a file or directory.
 * @param {boolean} [allowMissing] - Whether absent suffixes are allowed.
 * @returns {void} - Refuses symlinks, control characters and relative paths.
 */
function assertSafeAbsolutePath(candidate, allowMissing = false) {
  assert.ok(path.isAbsolute(candidate), 'Proof paths must be absolute.');
  assert.ok(
    [...candidate].every(
      (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
    ),
    'Proof paths contain control characters.',
  );
  assert.equal(
    path.normalize(candidate),
    candidate,
    'Proof paths must be normalized.',
  );
  let current = path.parse(candidate).root;
  for (const part of candidate
    .slice(current.length)
    .split(path.sep)
    .filter(Boolean)) {
    current = path.join(current, part);
    try {
      assert.ok(
        !fs.lstatSync(current).isSymbolicLink(),
        `Proof path is a symlink: ${current}`,
      );
    } catch (error) {
      if (
        allowMissing &&
        /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
      )
        return;
      throw error;
    }
  }
}

/**
 * @param {string} root - An existing canonical root.
 * @param {string} candidate - A normalized path.
 * @returns {boolean} - Whether candidate is root or nested below it.
 */
function within(root, candidate) {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

/**
 * @param {string} relativePath - Git-reported source path.
 * @returns {void} - Refuses paths unsafe to copy or represent in receipts.
 */
function assertSourcePath(relativePath) {
  assert.ok(
    relativePath && !path.isAbsolute(relativePath),
    'Invalid source path.',
  );
  assert.ok(
    !relativePath.includes('\\') &&
      [...relativePath].every(
        (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
      ),
    'Unsupported source path.',
  );
  assert.ok(
    relativePath
      .split('/')
      .every((part) => part && part !== '.' && part !== '..'),
    'Source path escapes the checkout.',
  );
}

/**
 * Do not import ignored/generated trees or conventional local credentials.
 * This is a conservative path policy, not a claim to classify secret contents.
 * @param {string} relativePath - Git-selected path.
 * @returns {string | null} - An explicit exclusion reason.
 */
function exclusionReason(relativePath) {
  const parts = relativePath.split('/');
  if (
    parts.some((part) =>
      ['.aws', '.ssh', '.gnupg', '.netrc', '.npmrc', '.pypirc'].includes(part),
    )
  )
    return 'local-credential-path';
  const name = parts.at(-1) ?? '';
  if (/^\.env(?:\.|$)/.test(name) && !/\.(example|sample|template)$/.test(name))
    return 'local-credential-path';
  if (
    /^(?:id_(?:rsa|dsa|ecdsa|ed25519)|credentials)(?:\.|$)/.test(name) ||
    /\.(?:pem|key|p12|pfx)$/.test(name)
  )
    return 'local-credential-path';
  if (parts.some((part) => GENERATED_PARTS.has(part)))
    return 'generated-or-local-tool-state';
  return null;
}

/**
 * @param {string} repoRoot - Original worktree, never modified.
 * @param {string[]} config - Read-only Git configuration overrides.
 * @returns {void} - Keep exact committed exports safe and independent of local attributes.
 */
function assertCleanExportPolicy(repoRoot, config) {
  const attributesPath = path.resolve(
    repoRoot,
    git(repoRoot, ['rev-parse', '--git-path', 'info/attributes'], { config })
      .toString('utf8')
      .trim(),
  );
  const stat = fs.lstatSync(attributesPath, { throwIfNoEntry: false });
  assert.ok(
    !stat || (stat.isFile() && stat.size === 0),
    'Local Git info/attributes can change committed exports. Use --snapshot for isolated exact-byte source capture.',
  );
}

/**
 * Write one already bounded source file into a fresh private repository.
 * @param {string} copyRoot - Newly owned private repository.
 * @param {string} relativePath - Validated Git path.
 * @param {Buffer} contents - Exact source bytes.
 * @param {'100644' | '100755'} mode - Exact Git mode.
 * @returns {void}
 */
function writeCapturedFile(copyRoot, relativePath, contents, mode) {
  const target = path.join(copyRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, contents, {
    flag: 'wx',
    mode: mode === '100755' ? 0o755 : 0o644,
  });
  fs.chmodSync(target, mode === '100755' ? 0o755 : 0o644);
}

/**
 * Read one bounded Git blob without worktree filters or checkout conversions.
 * @param {string} repoRoot - Original repository.
 * @param {string} objectId - Exact SHA-1 blob object.
 * @param {string[]} config - Disabled source filters.
 * @returns {Buffer} - Exact committed blob bytes.
 */
function readGitBlob(repoRoot, objectId, config) {
  const contents = git(repoRoot, ['cat-file', 'blob', objectId], {
    config,
    maxBuffer: MAX_FILE_BYTES + 1024 * 1024,
  });
  assert.ok(
    contents.length <= MAX_FILE_BYTES,
    'Proof source file is too large.',
  );
  return contents;
}

/**
 * Capture the allowlisted bytes and modes directly from one immutable HEAD.
 * @param {string} repoRoot - Original repository.
 * @param {string} head - Exact source commit.
 * @param {string | undefined} copyRoot - Optional private destination.
 * @param {string[]} config - Disabled source filters.
 * @returns {{files: SourceFile[], excluded: {path: string, reason: string}[], deleted: string[]}} - Exact committed allowlist.
 */
function captureHeadFiles(repoRoot, head, copyRoot, config) {
  const entries = gitRecords(
    git(repoRoot, ['ls-tree', '-r', '--full-tree', '-z', head], { config }),
  );
  assert.ok(
    entries.length <= MAX_SOURCE_FILES,
    'Proof source contains too many files.',
  );
  /** @type {SourceFile[]} */
  const files = [];
  const excluded = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const match = /^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
    assert.ok(
      match,
      'The committed tree contains a symlink, submodule, or unsupported mode.',
    );
    const mode = /** @type {'100644' | '100755'} */ (match[1]);
    const objectId = match[2];
    const relativePath = match[3];
    assertSourcePath(relativePath);
    let reason = exclusionReason(relativePath);
    if (reason && reason !== 'local-credential-path') {
      excluded.push({ path: relativePath, reason });
      continue;
    }
    const contents = readGitBlob(repoRoot, objectId, config);
    if (reason === 'local-credential-path') {
      assert.ok(
        relativePath === '.npmrc' &&
          mode === '100644' &&
          contents.equals(SAFE_ROOT_NPMRC),
        'The committed tree contains a conventional local credential/config path. Only the exact root .npmrc public-registry token placeholder is allowed in commit mode; use --snapshot to exclude other credential paths.',
      );
      reason = null;
    }
    assert.equal(reason, null);
    totalBytes += contents.length;
    assert.ok(
      totalBytes <= MAX_SOURCE_BYTES,
      'Proof source exceeds the snapshot byte limit.',
    );
    files.push({
      path: relativePath,
      mode,
      bytes: contents.length,
      sha256: sha256(contents),
    });
    if (copyRoot) writeCapturedFile(copyRoot, relativePath, contents, mode);
  }
  return { files, excluded, deleted: [] };
}

/**
 * @param {Buffer} output - A NUL-delimited Git result.
 * @returns {string[]} - Strict UTF-8 records, without a trailing empty record.
 */
function gitRecords(output) {
  const value = new TextDecoder('utf-8', { fatal: true }).decode(output);
  assert.ok(!value || value.endsWith('\0'), 'Incomplete Git path listing.');
  return value ? value.slice(0, -1).split('\0') : [];
}

/**
 * @param {string} repoRoot - Canonical original checkout.
 * @param {string[]} config - Disabled source filters.
 * @returns {{head: string, status: Buffer, index: Buffer, paths: string[]}} - Original source identity.
 */
function inspectSource(repoRoot, config) {
  const options = { config };
  const head = git(repoRoot, ['rev-parse', '--verify', 'HEAD'], options)
    .toString('utf8')
    .trim();
  assert.match(
    head,
    /^[a-f0-9]{40}$/,
    'The proof requires a SHA-1 source commit.',
  );
  const index = git(repoRoot, ['ls-files', '--stage', '-z'], options);
  for (const entry of gitRecords(index)) {
    assert.match(
      entry,
      /^100(?:644|755) [a-f0-9]{40} 0\t/,
      'Resolve unmerged, symlink, or submodule index entries before taking a proof snapshot.',
    );
  }
  const status = git(
    repoRoot,
    ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
    options,
  );
  const paths = [
    ...new Set(
      gitRecords(
        git(
          repoRoot,
          ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
          options,
        ),
      ),
    ),
  ].sort();
  assert.ok(
    paths.length <= MAX_SOURCE_FILES,
    'Proof source contains too many files.',
  );
  return { head, status, index, paths };
}

/**
 * @param {string} repoRoot - Canonical original checkout.
 * @param {string[]} paths - Selected tracked + nonignored untracked paths.
 * @param {string | undefined} copyRoot - Optional newly owned destination.
 * @param {boolean} [applyExclusions] - Whether source credential/tool policy applies.
 * @returns {{files: SourceFile[], excluded: {path: string, reason: string}[], deleted: string[]}} - Content-addressed worktree manifest.
 */
function captureFiles(repoRoot, paths, copyRoot, applyExclusions = true) {
  /** @type {SourceFile[]} */
  const files = [];
  const excluded = [];
  const deleted = [];
  let bytes = 0;
  for (const relativePath of paths) {
    assertSourcePath(relativePath);
    const reason = applyExclusions ? exclusionReason(relativePath) : null;
    if (reason) {
      excluded.push({ path: relativePath, reason });
      continue;
    }
    const sourcePath = path.join(repoRoot, relativePath);
    assertSafeAbsolutePath(sourcePath, true);
    let fd;
    try {
      fd = fs.openSync(
        sourcePath,
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT')
        throw error;
      deleted.push(relativePath);
      continue;
    }
    let contents;
    let before;
    try {
      before = fs.fstatSync(fd, { bigint: true });
      assert.ok(
        before.isFile(),
        `Proof source is not a regular file: ${relativePath}`,
      );
      assert.ok(
        before.size <= MAX_FILE_BYTES,
        `Proof source file is too large: ${relativePath}`,
      );
      contents = fs.readFileSync(fd);
      const after = fs.fstatSync(fd, { bigint: true });
      assert.ok(
        before.ino === after.ino &&
          before.size === after.size &&
          before.mtimeNs === after.mtimeNs &&
          before.ctimeNs === after.ctimeNs &&
          BigInt(contents.length) === before.size,
        `Source changed while being copied: ${relativePath}`,
      );
    } finally {
      fs.closeSync(fd);
    }
    bytes += contents.length;
    assert.ok(
      bytes <= MAX_SOURCE_BYTES,
      'Proof source exceeds the snapshot byte limit.',
    );
    const mode = (before.mode & 0o111n) === 0n ? '100644' : '100755';
    files.push({
      path: relativePath,
      mode,
      bytes: contents.length,
      sha256: sha256(contents),
    });
    if (copyRoot) writeCapturedFile(copyRoot, relativePath, contents, mode);
  }
  return { files, excluded, deleted };
}

/**
 * @param {string} target - A fresh owned JSON file.
 * @param {unknown} value - Serializable receipt.
 * @returns {void} - Never overwrites an existing receipt.
 */
function writeJson(target, value) {
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
}

/**
 * Create immutable source evidence without staging, committing, cleaning or
 * otherwise writing to the user's Git repository. Snapshot commits exist only
 * in a newly initialized, independent repository below the owned output root.
 * @param {{repoRoot: string, outputRoot: string, mode: 'commit' | 'snapshot'}} options - Explicit source mode and fresh private destination.
 * @param {{afterCapture?: () => void}} [ports] - Focused race-test observation seam.
 * @returns {Record<string, any>} - Durable source provenance, also written to disk.
 */
export function createProofSource(options, ports = {}) {
  assert.ok(
    ['commit', 'snapshot'].includes(options.mode),
    'Source mode must be commit or snapshot.',
  );
  const repoRoot = fs.realpathSync(options.repoRoot);
  const outputRoot = path.resolve(options.outputRoot);
  assertSafeAbsolutePath(repoRoot);
  assertSafeAbsolutePath(outputRoot, true);
  assert.ok(
    !within(repoRoot, outputRoot),
    'Snapshot storage must be outside the original checkout.',
  );
  const config = sourceGitConfig(repoRoot);
  assert.equal(
    fs.realpathSync(
      git(repoRoot, ['rev-parse', '--show-toplevel'], { config })
        .toString('utf8')
        .trim(),
    ),
    repoRoot,
    'Snapshot input must be the Git worktree root.',
  );
  const before = inspectSource(repoRoot, config);
  if (options.mode === 'commit') {
    assert.equal(
      before.status.length,
      0,
      'The worktree is dirty. Use --snapshot explicitly to prove uncommitted source without committing the checkout.',
    );
    assertCleanExportPolicy(repoRoot, config);
  }
  fs.mkdirSync(outputRoot, { mode: 0o700 });
  const privateRepo = path.join(outputRoot, 'repo');
  fs.mkdirSync(privateRepo, { mode: 0o700 });
  const capture =
    options.mode === 'commit'
      ? captureHeadFiles(repoRoot, before.head, privateRepo, config)
      : captureFiles(repoRoot, before.paths, privateRepo);
  assert.ok(
    capture.files.some((file) => file.path === CONFIG_RELATIVE_PATH),
    'Source must include the pinned systemd Lima config.',
  );
  const sourceTreeSha256 = sha256(JSON.stringify(capture));
  const sourceStatusSha256 = sha256(before.status);
  let commit = before.head;
  const archivePath = path.join(outputRoot, 'source.tar');
  const templateRoot = path.join(outputRoot, 'empty-git-template');
  fs.mkdirSync(templateRoot, { mode: 0o700 });
  const privateConfig = [
    '-c',
    'core.autocrlf=false',
    '-c',
    'core.fileMode=true',
    '-c',
    'core.ignoreCase=false',
    '-c',
    'core.precomposeUnicode=false',
    '-c',
    'user.name=Wharfie proof snapshot',
    '-c',
    'user.email=proof-snapshot@wharfie.invalid',
  ];
  const privateOptions = { isolated: true, config: privateConfig };
  git(
    privateRepo,
    [
      'init',
      '--quiet',
      '--object-format=sha1',
      '--initial-branch=proof-snapshot',
      `--template=${templateRoot}`,
    ],
    privateOptions,
  );
  fs.mkdirSync(path.join(privateRepo, '.git', 'info'), { mode: 0o700 });
  // Archive only the exact captured allowlist. The private attributes have
  // highest precedence, so committed export-ignore/substitution rules cannot
  // add, omit, transform, or execute anything behind the manifest.
  fs.writeFileSync(
    path.join(privateRepo, '.git', 'info', 'attributes'),
    '* -text -ident -filter -working-tree-encoding -export-ignore -export-subst\n',
    { flag: 'wx', mode: 0o600 },
  );
  git(privateRepo, ['add', '--force', '--all', '--', '.'], privateOptions);
  const tree = git(privateRepo, ['write-tree'], privateOptions)
    .toString('utf8')
    .trim();
  const archivedFiles = captureFiles(
    privateRepo,
    capture.files.map((file) => file.path),
    undefined,
    false,
  );
  assert.deepEqual(
    archivedFiles,
    { files: capture.files, excluded: [], deleted: [] },
    'Private archive source differs from the captured manifest.',
  );
  /**
   * @param {{path: string}} left - First manifest entry.
   * @param {{path: string}} right - Second manifest entry.
   * @returns {number} - Bytewise Git-path ordering.
   */
  const comparePaths = (left, right) =>
    Buffer.compare(Buffer.from(left.path), Buffer.from(right.path));
  const treeEntries = gitRecords(
    git(privateRepo, ['ls-tree', '-r', '-z', tree], privateOptions),
  ).map((entry) => {
    const match = /^(100644|100755) blob [a-f0-9]{40}\t(.+)$/.exec(entry);
    assert.ok(match, 'Private archive tree contains an unsupported entry.');
    return { mode: match[1], path: match[2] };
  });
  assert.deepEqual(
    treeEntries.sort(comparePaths),
    capture.files
      .map((file) => ({ mode: file.mode, path: file.path }))
      .sort(comparePaths),
    'Private archive tree paths or modes differ from the captured manifest.',
  );
  // commit-tree's explicit dates avoid touching the source index or relying
  // on host identity, signing agents, hooks, wall clock or global Git config.
  const commitEnvironment = gitEnvironment(true);
  Object.assign(commitEnvironment, {
    GIT_AUTHOR_NAME: 'Wharfie proof snapshot',
    GIT_AUTHOR_EMAIL: 'proof-snapshot@wharfie.invalid',
    GIT_COMMITTER_NAME: 'Wharfie proof snapshot',
    GIT_COMMITTER_EMAIL: 'proof-snapshot@wharfie.invalid',
    GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
  });
  const archiveCommit = execFileSync(
    'git',
    [
      '-c',
      'commit.gpgSign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit-tree',
      tree,
    ],
    {
      cwd: privateRepo,
      env: commitEnvironment,
      input: `Wharfie immutable worktree proof snapshot\n\nOriginal-HEAD: ${before.head}\nSource-Tree-SHA256: ${sourceTreeSha256}\nOriginal-Status-SHA256: ${sourceStatusSha256}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60000,
    },
  ).trim();
  assert.match(archiveCommit, /^[a-f0-9]{40}$/);
  if (options.mode === 'snapshot') commit = archiveCommit;
  git(
    privateRepo,
    ['update-ref', 'refs/heads/proof-snapshot', archiveCommit],
    privateOptions,
  );
  git(
    privateRepo,
    ['archive', '--format=tar', `--output=${archivePath}`, archiveCommit],
    privateOptions,
  );
  assert.ok(
    fs.statSync(archivePath).size <= MAX_SOURCE_ARCHIVE_BYTES,
    'Proof source archive exceeds its bounded maximum size.',
  );
  fs.copyFileSync(
    path.join(privateRepo, CONFIG_RELATIVE_PATH),
    path.join(outputRoot, 'lima-original.yaml'),
    fs.constants.COPYFILE_EXCL,
  );
  ports.afterCapture?.();
  const after = inspectSource(repoRoot, config);
  assert.equal(
    after.head,
    before.head,
    'Original HEAD changed during source capture.',
  );
  assert.ok(
    after.status.equals(before.status) && after.index.equals(before.index),
    'Original Git status/index changed during source capture.',
  );
  assert.deepEqual(
    after.paths,
    before.paths,
    'Source file selection changed during source capture.',
  );
  if (options.mode === 'commit') assertCleanExportPolicy(repoRoot, config);
  if (options.mode === 'snapshot') {
    assert.deepEqual(
      captureFiles(repoRoot, after.paths, undefined),
      capture,
      'Source contents changed during source capture.',
    );
  }
  if (options.mode === 'commit') {
    fs.rmSync(privateRepo, { recursive: true });
    fs.rmSync(templateRoot, { recursive: true });
  }
  const manifest = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.source-provenance',
    authority: 'none',
    authoritative: false,
    mode: options.mode,
    commit,
    snapshotCommit: options.mode === 'snapshot' ? commit : null,
    originalHead: before.head,
    originalStatusPorcelainV1ZBase64: before.status.toString('base64'),
    originalStatusSha256: sourceStatusSha256,
    originalIndexListingSha256: sha256(before.index),
    sourceTreeSha256,
    sourceTreeHashEncoding:
      'sha256(UTF-8 JSON of {files,excluded,deleted}, sorted by Git path)',
    ...capture,
    fileManifestScope:
      options.mode === 'snapshot'
        ? 'exact-snapshot-source'
        : 'exact-clean-commit-allowlist',
    exclusionScope:
      options.mode === 'snapshot' ? 'snapshot-archive' : 'clean-commit-archive',
    archive: {
      name: 'source.tar',
      sha256: hashFile(archivePath),
      bytes: fs.statSync(archivePath).size,
    },
    originalConfigSha256: hashFile(path.join(outputRoot, 'lima-original.yaml')),
    originalRepositoryWritten: false,
    capturedAt: new Date().toISOString(),
  };
  writeJson(path.join(outputRoot, 'source-provenance.json'), manifest);
  return manifest;
}

/**
 * @param {{limaHome: string, instance: string}} options - Private socket namespace.
 * @returns {void} - Refuses unsafe names and Darwin's Unix socket length limit.
 */
export function assertLimaSocketPath({ limaHome, instance }) {
  assertSafeAbsolutePath(limaHome, true);
  assert.match(
    instance,
    /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
    'Unsafe Lima instance name.',
  );
  assert.ok(
    Buffer.byteLength(`${limaHome}/${instance}/ssh.sock.1234567890123456`) <
      104,
    'Private Lima socket path is too long; use a shorter instance name or temporary parent.',
  );
}

/**
 * A closed parser for this repository's pinned config, not a general YAML
 * parser. Only the images block changes; provision/probes remain byte-identical.
 * Refuse includes, remote fallbacks, extra top-level keys, mounts or downloads
 * introduced outside that deliberately narrow config surface.
 * @param {{config: string, hostArch: string, imagePath: string}} options - Immutable config bytes and owned local image.
 * @returns {{config: string, arch: string, url: string, digest: string, originalConfigSha256: string, derivedConfigSha256: string}} - Exact one-image derivation.
 */
export function deriveLimaConfig({ config, hostArch, imagePath }) {
  assertSafeAbsolutePath(imagePath, true);
  const arch =
    hostArch === 'arm64' || hostArch === 'aarch64'
      ? 'aarch64'
      : hostArch === 'x86_64'
        ? 'x86_64'
        : null;
  assert.ok(arch, 'Unsupported macOS proof architecture.');
  const keys = config
    .split('\n')
    .filter((line) => line && !line.startsWith(' ') && !line.startsWith('#'))
    .map((line) => {
      const match = /^([a-zA-Z][a-zA-Z0-9]*):(?: |$)/.exec(line);
      assert.ok(
        match,
        'Unsupported top-level Lima YAML syntax; re-review host isolation.',
      );
      return match[1];
    });
  assert.deepEqual(
    keys,
    [
      'minimumLimaVersion',
      'vmType',
      'arch',
      'cpus',
      'memory',
      'disk',
      'plain',
      'images',
      'mounts',
      'containerd',
      'provision',
      'probes',
    ],
    'Unexpected Lima config structure; re-review host isolation before changing it.',
  );
  assert.ok(
    /^vmType: vz$/m.test(config) &&
      /^arch: default$/m.test(config) &&
      /^plain: true$/m.test(config),
    'Lima proof must use plain native VZ mode.',
  );
  assert.ok(
    /^mounts: \[\]\ncontainerd:\n {2}system: false\n {2}user: false\n/m.test(
      config,
    ),
    'Lima proof must have no host mounts or containerd downloads.',
  );
  const match =
    /^images:\n((?: {2}- location: https:\/\/[^\s]+\n {4}arch: (?:aarch64|x86_64)\n {4}digest: sha256:[a-f0-9]{64}\n)+)(?=\nmounts:)/m.exec(
      config,
    );
  assert.ok(
    match,
    'Lima images must be explicit pinned HTTPS URL/architecture/digest triples.',
  );
  assert.match(
    config.slice(0, match.index),
    /^minimumLimaVersion: \d+\.\d+\.\d+\n\nvmType: vz\narch: default\ncpus: [1-9]\d*\nmemory: [1-9]\d*(?:MiB|GiB)\ndisk: [1-9]\d*(?:MiB|GiB)\nplain: true\n\n$/,
    'Unexpected values or nested keys before Lima images.',
  );
  const provisionIndex = config.indexOf('\nprovision:\n');
  assert.equal(
    config.slice(match.index + match[0].length, provisionIndex + 1),
    '\nmounts: []\ncontainerd:\n  system: false\n  user: false\n\n',
    'Unexpected Lima mounts/containerd configuration.',
  );
  const probesIndex = config.indexOf('\nprobes:\n');
  assert.match(
    config.slice(provisionIndex + 1, probesIndex + 1),
    /^provision:\n {2}- mode: system\n {4}script: \|\n(?: {6}[^\n]*\n|\n)*$/,
    'Only the original single guest system provision script is allowed.',
  );
  assert.match(
    config.slice(probesIndex + 1),
    /^probes:\n {2}- mode: readiness\n {4}description: [^\n]+\n {4}script: \|\n(?: {6}[^\n]*\n|\n)* {4}hint: \|\n(?: {6}[^\n]*\n|\n)*$/,
    'Only the original readiness script and hint are allowed.',
  );
  const images = [
    ...match[1].matchAll(
      / {2}- location: (\S+)\n {4}arch: (\S+)\n {4}digest: (\S+)\n/g,
    ),
  ];
  assert.equal(
    images.length,
    2,
    'Expected exactly one pinned image per supported architecture.',
  );
  assert.equal(
    new Set(images.map((entry) => entry[2])).size,
    2,
    'Duplicate Lima image architectures.',
  );
  const selected = images.find((entry) => entry[2] === arch);
  assert.ok(selected, 'No image matches the host architecture.');
  const url = new URL(selected[1]);
  assert.ok(
    url.protocol === 'https:' &&
      url.hostname === 'cloud-images.ubuntu.com' &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search &&
      !url.hash,
    'Pinned cloud image URL must be an uncredentialed official Ubuntu HTTPS URL.',
  );
  const expectedSuffix = arch === 'aarch64' ? '-arm64.img' : '-amd64.img';
  assert.ok(
    url.pathname.endsWith(expectedSuffix),
    'Pinned image URL does not match its architecture.',
  );
  const derived = config.replace(
    match[0],
    `images:\n  - location: ${JSON.stringify(imagePath)}\n    arch: ${arch}\n    digest: ${selected[3]}\n`,
  );
  return {
    config: derived,
    arch,
    url: url.href,
    digest: selected[3],
    originalConfigSha256: sha256(config),
    derivedConfigSha256: sha256(derived),
  };
}

/**
 * @param {{configPath: string, hostArch: string, cacheRoot: string, outputRoot: string}} options - Newly owned local paths.
 * @returns {Record<string, any>} - Download plan; this helper never downloads.
 */
export function planLimaImage({ configPath, hostArch, cacheRoot, outputRoot }) {
  assertSafeAbsolutePath(configPath);
  assertSafeAbsolutePath(cacheRoot);
  assertSafeAbsolutePath(outputRoot, true);
  fs.mkdirSync(outputRoot, { mode: 0o700 });
  const imagePath = path.join(cacheRoot, 'cloud-image.img');
  assert.ok(
    !fs.existsSync(imagePath),
    'Task-owned image destination already exists.',
  );
  const result = deriveLimaConfig({
    config: fs.readFileSync(configPath, 'utf8'),
    hostArch,
    imagePath,
  });
  const derivedConfigPath = path.join(outputRoot, 'lima.yaml');
  fs.writeFileSync(derivedConfigPath, result.config, {
    flag: 'wx',
    mode: 0o600,
  });
  const plan = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.image-plan',
    arch: result.arch,
    originalUrl: result.url,
    expectedDigest: result.digest,
    imagePath,
    originalConfigPath: configPath,
    originalConfigSha256: result.originalConfigSha256,
    derivedConfigPath,
    derivedConfigSha256: result.derivedConfigSha256,
    remoteFallbacks: 0,
    hostMounts: [],
  };
  writeJson(path.join(outputRoot, 'image-plan.json'), plan);
  return plan;
}

/**
 * @param {{infoPath: string, limaHome: string, planPath: string}} options - Private read-only limactl info and immutable image plan.
 * @returns {Record<string, any>} - Pre-download host evidence, no VM actions.
 */
export function inspectLimaHost({ infoPath, limaHome, planPath }) {
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'));
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assert.equal(
    info.limaHome,
    limaHome,
    'Lima did not use the private task-owned home.',
  );
  assert.equal(info.hostOS, 'darwin', 'Lima lifecycle proof requires macOS.');
  assert.equal(
    info.hostArch,
    plan.arch,
    'Lima architecture differs from the selected image.',
  );
  const version = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(info.version);
  assert.ok(
    version &&
      (Number(version[1]) > 2 ||
        (Number(version[1]) === 2 && Number(version[2]) >= 1)),
    'Lima 2.1 or newer is required.',
  );
  const guestAgent = info.guestAgents?.[plan.arch]?.location;
  assert.ok(
    typeof guestAgent === 'string' &&
      path.isAbsolute(guestAgent) &&
      fs.statSync(guestAgent).isFile(),
    'A matching locally installed Lima guest agent is required; remote download fallback is not allowed.',
  );
  const receipt = {
    schemaVersion: 1,
    kind: 'wharfie.systemd-proof.host-preflight',
    limaVersion: info.version,
    limaHome,
    hostOS: info.hostOS,
    hostArch: info.hostArch,
    guestAgentPath: fs.realpathSync(guestAgent),
    guestAgentSha256: hashFile(fs.realpathSync(guestAgent)),
    homeRepurposed: false,
    remoteImageFallbacks: 0,
  };
  writeJson(path.join(path.dirname(planPath), 'host-provenance.json'), receipt);
  return receipt;
}

/**
 * @param {string} planPath - Task-owned pinned download plan.
 * @returns {Record<string, any>} - Verified image/config provenance.
 */
export function verifyLimaImage(planPath) {
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  assertSafeAbsolutePath(plan.imagePath);
  assert.equal(
    hashFile(plan.originalConfigPath),
    plan.originalConfigSha256,
    'Original Lima config changed after capture.',
  );
  assert.equal(
    hashFile(plan.derivedConfigPath),
    plan.derivedConfigSha256,
    'Derived Lima config changed after planning.',
  );
  const actualDigest = `sha256:${hashFile(plan.imagePath)}`;
  assert.equal(
    actualDigest,
    plan.expectedDigest,
    'Downloaded Lima image does not match its pinned digest.',
  );
  const receipt = {
    ...plan,
    kind: 'wharfie.systemd-proof.image-provenance',
    actualDigest,
    bytes: fs.statSync(plan.imagePath).size,
    digestVerified: true,
    downloadedIntoPrivateCache: true,
    verifiedAt: new Date().toISOString(),
  };
  writeJson(
    path.join(path.dirname(planPath), 'image-provenance.json'),
    receipt,
  );
  return receipt;
}

/**
 * Reserve the exact commit destination before any image download or VM action.
 * A fixed exclusive staging name also rejects concurrent same-commit proofs.
 * @param {{outputRoot: string, commit: string, tempRoot: string}} options - Requested receipt route and owned temp root.
 * @returns {string} - Newly owned staging/reservation directory.
 */
export function reserveProofReceipt({ outputRoot, commit, tempRoot }) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  const root = path.resolve(outputRoot);
  const privateRoot = fs.realpathSync(tempRoot);
  assertSafeAbsolutePath(privateRoot);
  assert.ok(
    fs.lstatSync(privateRoot).isDirectory(),
    'Private temporary root must be a directory.',
  );
  assertSafeAbsolutePath(root, true);
  assert.ok(
    !within(privateRoot, root),
    'Receipts must outlive the private temporary directory.',
  );
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const destination = path.join(root, commit);
  assert.ok(
    !fs.existsSync(destination) &&
      !fs.lstatSync(destination, { throwIfNoEntry: false }),
    `Proof receipts already exist for ${commit}; refusing to overwrite them.`,
  );
  const staging = path.join(root, `.${commit}.in-progress`);
  fs.mkdirSync(staging, { mode: 0o700 });
  return staging;
}

/**
 * Bind the standalone host helper to the same bytes captured for this proof.
 * The driver executes a private copy from before capture, then retains it in
 * receipt staging so cleanup never needs to load mutable checkout code.
 * @param {{provenancePath: string, helperPath: string}} options - Captured source manifest and frozen executable helper.
 * @returns {void} - Refuses a changed, missing, or ambiguous captured helper.
 */
export function verifyProofHostHelper({ provenancePath, helperPath }) {
  assertSafeAbsolutePath(provenancePath);
  assertSafeAbsolutePath(helperPath);
  const source = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  assert.equal(source.schemaVersion, 1);
  assert.equal(source.kind, 'wharfie.systemd-proof.source-provenance');
  assert.ok(Array.isArray(source.files));
  /** @type {SourceFile[]} */
  const files = source.files;
  const matches = files.filter(
    (file) => file.path === 'scripts/systemd-proof-host.js',
  );
  assert.equal(
    matches.length,
    1,
    'Proof source must capture exactly one host helper.',
  );
  assert.equal(
    hashFile(helperPath),
    matches[0].sha256,
    'Frozen host helper differs from the captured proof source.',
  );
}

/**
 * @param {{directory: string, scenario: string, commit: string, instance: string, limaHome: string, tempRoot: string, instanceAbsent: boolean, instanceRetained: boolean, exitStatus: number}} options - Observed cleanup result, never an authority token.
 * @returns {void} - Retain the existing cleanup contract plus isolation evidence.
 */
export function writeHostCleanup(options) {
  const kind =
    options.scenario === 'lifecycle'
      ? 'wharfie.systemd-proof.host-cleanup'
      : 'wharfie.steady-file-systemd-proof.host-cleanup';
  writeJson(path.join(options.directory, 'cleanup.json'), {
    schemaVersion: 1,
    kind,
    authority: 'none',
    authoritative: false,
    commit: options.commit,
    instance: options.instance,
    observedAt: Date.now(),
    instanceAbsent: options.instanceAbsent,
    instanceRetained: options.instanceRetained,
    limaHome: options.limaHome,
    taskRoot: options.tempRoot,
    taskRootAbsent: !fs.existsSync(options.tempRoot),
    privateImageCacheAbsent: !fs.existsSync(
      path.join(options.tempRoot, 'cache'),
    ),
    homeRepurposed: false,
    exitStatus: options.exitStatus,
  });
}

/**
 * List and validate one flat regular-file receipt directory.
 * @param {string} directory - Existing safe receipt directory.
 * @returns {string[]} - Canonically sorted entry names.
 */
function receiptFileNames(directory) {
  const names = fs.readdirSync(directory).sort();
  for (const name of names) {
    assert.match(
      name,
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/,
      'Unsafe receipt filename.',
    );
    assert.ok(
      fs.lstatSync(path.join(directory, name)).isFile(),
      'Receipt entries must be regular files.',
    );
  }
  return names;
}

/**
 * Build the one canonical checksum document for an exact ordered file set.
 * @param {string} directory - Existing safe receipt directory.
 * @param {string[]} names - Sorted non-seal names.
 * @returns {string} - Canonical checksum bytes.
 */
function receiptChecksumDocument(directory, names) {
  return names
    .map((name) => `${hashFile(path.join(directory, name))}  ${name}\n`)
    .join('');
}

/**
 * Read one regular file without following its final path component.
 * @param {string} file - Exact file path.
 * @returns {string} - UTF-8 file contents.
 */
function readRegularUtf8(file) {
  const descriptor = fs.openSync(
    file,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
  );
  try {
    assert.ok(
      fs.fstatSync(descriptor).isFile(),
      'Receipt entries must be regular files.',
    );
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

/**
 * Require the checksum marker to cover the current exact regular-file set.
 * @param {string} directory - Existing safe receipt directory.
 * @returns {{names: string[], dataNames: string[], checksum: string}} - Validated canonical seal.
 */
function validateReceiptSeal(directory) {
  const names = receiptFileNames(directory);
  assert.ok(names.includes('SHA256SUMS'), 'Seal receipts before publishing.');
  const dataNames = names.filter((name) => name !== 'SHA256SUMS');
  assert.ok(dataNames.length > 0, 'Receipt seal must cover at least one file.');
  const checksum = receiptChecksumDocument(directory, dataNames);
  assert.equal(
    readRegularUtf8(path.join(directory, 'SHA256SUMS')),
    checksum,
    'Receipt checksum seal does not cover the exact current file set.',
  );
  return { names, dataNames, checksum };
}

/**
 * Require an in-progress destination to contain the exact copied data bytes.
 * @param {string} directory - Newly reserved destination.
 * @param {string[]} dataNames - Exact sorted non-seal names.
 * @param {string} checksum - Original canonical checksum document.
 * @returns {void}
 */
function validateCopiedReceiptData(directory, dataNames, checksum) {
  assert.deepEqual(
    receiptFileNames(directory),
    dataNames,
    'Published receipt data set changed during copying.',
  );
  assert.equal(
    receiptChecksumDocument(directory, dataNames),
    checksum,
    'Published receipt bytes changed during copying.',
  );
}

/**
 * @param {string} directory - Owned receipt staging directory, regular files only.
 * @returns {void} - Checksum every retained source, config, receipt and log.
 */
export function sealProofReceipt(directory) {
  assertSafeAbsolutePath(directory);
  const names = receiptFileNames(directory);
  assert.ok(
    names.length > 0 && !names.includes('SHA256SUMS'),
    'Receipt is empty or already sealed.',
  );
  const sums = receiptChecksumDocument(directory, names);
  fs.writeFileSync(path.join(directory, 'SHA256SUMS'), sums, {
    flag: 'wx',
    mode: 0o600,
  });
}

/**
 * @param {{staging: string, commit: string, failed?: boolean}} options - An owned, sealed reservation.
 * @param {{beforeDestinationReserve?: (destination: string) => void, afterCopy?: (name: string, destination: string) => void}} [ports] - Focused race/failure test seams.
 * @returns {string} - Fresh final/failure path; never replaces existing receipts.
 */
export function publishProofReceipt(
  { staging, commit, failed = false },
  ports = {},
) {
  assert.match(commit, /^[a-f0-9]{40}$/);
  assert.equal(
    path.basename(staging),
    `.${commit}.in-progress`,
    'Not an owned proof reservation.',
  );
  assertSafeAbsolutePath(staging);
  if (
    ports.beforeDestinationReserve !== undefined &&
    typeof ports.beforeDestinationReserve !== 'function'
  ) {
    throw new TypeError(
      'Proof receipt beforeDestinationReserve port must be a function.',
    );
  }
  if (ports.afterCopy !== undefined && typeof ports.afterCopy !== 'function') {
    throw new TypeError('Proof receipt afterCopy port must be a function.');
  }
  let seal = validateReceiptSeal(staging);
  const root = path.dirname(staging);
  let destination = path.join(root, commit);
  if (failed) {
    const failures = path.join(root, 'failures');
    assertSafeAbsolutePath(failures, true);
    fs.mkdirSync(failures, { recursive: true, mode: 0o700 });
    destination = path.join(failures, `${commit}-${randomUUID()}`);
  }
  ports.beforeDestinationReserve?.(destination);
  // Revalidate after the race-test boundary and immediately before reserving
  // a visible destination. Later destination hashing catches mid-copy changes.
  seal = validateReceiptSeal(staging);
  try {
    // Creating the final directory is the no-replace primitive.
    fs.mkdirSync(destination, { mode: 0o700 });
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === 'EEXIST') {
      throw new Error(
        'Refusing to replace an existing proof receipt directory.',
        { cause: error },
      );
    }
    throw error;
  }
  /** @type {string[]} */
  const copied = [];
  try {
    for (const name of seal.dataNames) {
      const target = path.join(destination, name);
      fs.copyFileSync(
        path.join(staging, name),
        target,
        fs.constants.COPYFILE_EXCL,
      );
      copied.push(name);
      ports.afterCopy?.(name, target);
    }
    validateCopiedReceiptData(destination, seal.dataNames, seal.checksum);
    fs.writeFileSync(path.join(destination, 'SHA256SUMS'), seal.checksum, {
      flag: 'wx',
      mode: 0o600,
    });
    copied.push('SHA256SUMS');
    const publishedSeal = validateReceiptSeal(destination);
    assert.deepEqual(
      publishedSeal.dataNames,
      seal.dataNames,
      'Published receipt file set changed before completion.',
    );
    assert.equal(
      publishedSeal.checksum,
      seal.checksum,
      'Published receipt checksum changed before completion.',
    );
  } catch (error) {
    for (const name of copied.reverse()) {
      try {
        fs.unlinkSync(path.join(destination, name));
      } catch {
        // Preserve the original publication failure. A nonempty owned route
        // remains fail-closed and can never replace another receipt.
      }
    }
    try {
      fs.rmdirSync(destination);
    } catch {
      // As above, never mask the primary error or remove an unrecognized race.
    }
    throw error;
  }
  fs.rmSync(staging, { recursive: true });
  return destination;
}

/**
 * @param {string[]} args - Small host-only command surface used by the driver.
 * @returns {void} - Only bounded source/private-state/receipt operations.
 */
function main(args) {
  const [command, ...values] = args;
  switch (command) {
    case 'source': {
      assert.equal(values.length, 3);
      const [mode, repoRoot, outputRoot] = values;
      assert.ok(mode === 'commit' || mode === 'snapshot');
      process.stdout.write(
        `${createProofSource({ mode, repoRoot, outputRoot }).commit}\n`,
      );
      break;
    }
    case 'paths':
      assert.equal(values.length, 2);
      assertLimaSocketPath({ limaHome: values[0], instance: values[1] });
      break;
    case 'image-plan': {
      assert.equal(values.length, 4);
      const [configPath, hostArch, cacheRoot, outputRoot] = values;
      process.stdout.write(
        `${planLimaImage({ configPath, hostArch, cacheRoot, outputRoot }).originalUrl}\n`,
      );
      break;
    }
    case 'host-info':
      assert.equal(values.length, 3);
      inspectLimaHost({
        infoPath: values[0],
        limaHome: values[1],
        planPath: values[2],
      });
      break;
    case 'verify-image':
      assert.equal(values.length, 1);
      verifyLimaImage(values[0]);
      break;
    case 'reserve':
      assert.equal(values.length, 3);
      process.stdout.write(
        `${reserveProofReceipt({ outputRoot: values[0], commit: values[1], tempRoot: values[2] })}\n`,
      );
      break;
    case 'verify-helper':
      assert.equal(values.length, 1);
      verifyProofHostHelper({
        provenancePath: values[0],
        helperPath: fileURLToPath(import.meta.url),
      });
      break;
    case 'cleanup':
      assert.equal(values.length, 9);
      assert.ok(values[6] === 'true' || values[6] === 'false');
      assert.ok(values[7] === 'true' || values[7] === 'false');
      assert.match(values[8], /^\d{1,3}$/);
      writeHostCleanup({
        directory: values[0],
        scenario: values[1],
        commit: values[2],
        instance: values[3],
        limaHome: values[4],
        tempRoot: values[5],
        instanceAbsent: values[6] === 'true',
        instanceRetained: values[7] === 'true',
        exitStatus: Number(values[8]),
      });
      break;
    case 'seal':
      assert.equal(values.length, 1);
      sealProofReceipt(values[0]);
      break;
    case 'publish':
      assert.equal(values.length, 3);
      assert.ok(values[2] === 'success' || values[2] === 'failure');
      process.stdout.write(
        `${publishProofReceipt({ staging: values[0], commit: values[1], failed: values[2] === 'failure' })}\n`,
      );
      break;
    default:
      throw new Error('Unknown systemd proof host command.');
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    assert.equal(
      process.version,
      'v24.13.1',
      'Systemd proof host tools require Node 24.13.1.',
    );
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Systemd proof host operation failed.'}\n`,
    );
    process.exitCode = 1;
  }
}
