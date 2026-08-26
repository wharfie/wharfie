/* eslint-env jest */

import { afterEach, describe, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

import {
  assertLimaSocketPath,
  createProofSource,
  deriveLimaConfig,
  planLimaImage,
  publishProofReceipt,
  reserveProofReceipt,
  sealProofReceipt,
  verifyLimaImage,
  verifyProofHostHelper,
} from '../../scripts/systemd-proof-host.js';

const PINNED_CONFIG = readFileSync(
  new URL('../systemd/lima.yaml', import.meta.url),
  'utf8',
);
const SAFE_ROOT_NPMRC =
  '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nregistry=https://registry.npmjs.org/\n';
const COMMIT = 'a'.repeat(40);
const ARM_DIGEST =
  'sha256:cafa1a965b591b7c4184b484ffd8e625981a79d48f9b4ae8a4adf7b4c5ade927';
const X86_DIGEST =
  'sha256:5fa5b05e5ec239858c4531485d6023b0896448c2df7c63b34f8dae6ea6051a44';
/** @type {Array<() => void>} */
const cleanups = [];

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {string | Buffer} bytes */
function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function ownedRoot() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'proof-host-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** @param {string} file @param {string | Buffer} contents */
function write(file, contents) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, contents);
}

/** @param {string} key @param {string} value */
function temporaryEnvironment(key, value) {
  const previous = process.env[key];
  process.env[key] = value;
  cleanups.push(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  });
}

/**
 * Every write-capable Git invocation in these tests targets a freshly created
 * task-owned repository. Source setup ignores user configuration and hooks.
 * @param {string} cwd
 * @param {string[]} args
 * @returns {Buffer}
 */
function git(cwd, args) {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('GIT_')) delete environment[key];
  }
  Object.assign(environment, {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: devNull,
    GIT_CONFIG_SYSTEM: devNull,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z',
    LC_ALL: 'C',
  });
  return execFileSync(
    'git',
    [
      '-c',
      'user.name=Private proof test',
      '-c',
      'user.email=private-proof-test@example.invalid',
      '-c',
      'core.hooksPath=/dev/null',
      '-c',
      'core.fsmonitor=false',
      '-c',
      'core.untrackedCache=false',
      '-c',
      `core.attributesFile=${devNull}`,
      '-c',
      'commit.gpgSign=false',
      '-c',
      'filter.proof.clean=',
      '-c',
      'filter.proof.smudge=',
      '-c',
      'filter.proof.process=',
      '-c',
      'filter.proof.required=false',
      ...args,
    ],
    { cwd, env: environment, stdio: ['pipe', 'pipe', 'pipe'], timeout: 15_000 },
  );
}

function sourceFixture() {
  const root = ownedRoot();
  const repoRoot = join(root, 'source');
  const template = join(root, 'empty-template');
  mkdirSync(repoRoot);
  mkdirSync(template);
  git(repoRoot, [
    'init',
    '--quiet',
    '--object-format=sha1',
    '--initial-branch=main',
    `--template=${template}`,
  ]);
  git(repoRoot, ['config', '--local', 'core.autocrlf', 'false']);
  git(repoRoot, ['config', '--local', 'core.fileMode', 'true']);
  git(repoRoot, ['config', '--local', 'core.excludesFile', devNull]);
  write(join(repoRoot, 'test/systemd/lima.yaml'), PINNED_CONFIG);
  write(join(repoRoot, '.gitignore'), 'ignored/\nignored.txt\n');
  write(join(repoRoot, 'tracked.js'), 'original tracked bytes\n');
  write(join(repoRoot, 'deleted.js'), 'delete this tracked file\n');
  write(join(repoRoot, 'bin/run'), '#!/bin/sh\nexit 0\n');
  chmodSync(join(repoRoot, 'bin/run'), 0o755);
  git(repoRoot, ['add', '--all']);
  git(repoRoot, ['commit', '--quiet', '--no-verify', '-m', 'Private fixture']);
  return { root, repoRoot, outputRoot: join(root, 'snapshot') };
}

/** @param {string} repoRoot */
function sourceIdentity(repoRoot) {
  const index = join(repoRoot, '.git/index');
  const indexStat = statSync(index, { bigint: true });
  return {
    head: git(repoRoot, ['rev-parse', 'HEAD']).toString('utf8').trim(),
    index: readFileSync(index),
    indexMode: indexStat.mode,
    indexMtime: indexStat.mtimeNs,
    indexListing: git(repoRoot, ['ls-files', '--stage', '-z']),
    status: git(repoRoot, [
      'status',
      '--porcelain=v1',
      '-z',
      '--untracked-files=all',
    ]),
    config: readFileSync(join(repoRoot, '.git/config')),
    reflog: readFileSync(join(repoRoot, '.git/logs/HEAD')),
    refs: git(repoRoot, ['show-ref']),
  };
}

/** @param {string} archive */
function archiveFiles(archive) {
  return execFileSync('tar', ['-tf', archive], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((entry) => !entry.endsWith('/'))
    .sort();
}

/** @param {string} archive @param {string} file */
function archiveFile(archive, file) {
  return execFileSync('tar', ['-xOf', archive, file]);
}

describe('private systemd source snapshots', () => {
  test('captures working bytes, deletions and new files without changing original HEAD, index or status', () => {
    const value = sourceFixture();
    write(join(value.repoRoot, 'tracked.js'), 'staged bytes\n');
    git(value.repoRoot, ['add', 'tracked.js']);
    write(join(value.repoRoot, 'tracked.js'), 'unstaged current bytes\r\n');
    rmSync(join(value.repoRoot, 'deleted.js'));
    write(join(value.repoRoot, 'new.js'), 'new untracked source\n');
    write(join(value.repoRoot, 'staged-new.js'), 'staged new source\n');
    git(value.repoRoot, ['add', 'staged-new.js']);
    const before = sourceIdentity(value.repoRoot);
    const manifest = createProofSource({ ...value, mode: 'snapshot' });
    const archive = join(value.outputRoot, 'source.tar');
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
    expect(existsSync(join(value.repoRoot, '.git/index.lock'))).toBe(false);
    expect(git(value.repoRoot, ['show', ':tracked.js']).toString('utf8')).toBe(
      'staged bytes\n',
    );
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      kind: 'wharfie.systemd-proof.source-provenance',
      authority: 'none',
      authoritative: false,
      mode: 'snapshot',
      originalHead: before.head,
      originalRepositoryWritten: false,
      fileManifestScope: 'exact-snapshot-source',
      deleted: ['deleted.js'],
    });
    expect(manifest.commit).toMatch(/^[a-f0-9]{40}$/);
    expect(manifest.snapshotCommit).toBe(manifest.commit);
    expect(manifest.commit).not.toBe(before.head);
    expect(manifest.originalStatusPorcelainV1ZBase64).toBe(
      before.status.toString('base64'),
    );
    expect(manifest.originalStatusSha256).toBe(hash(before.status));
    expect(manifest.originalIndexListingSha256).toBe(hash(before.indexListing));
    expect(manifest.sourceTreeSha256).toBe(
      hash(
        JSON.stringify({
          files: manifest.files,
          excluded: manifest.excluded,
          deleted: manifest.deleted,
        }),
      ),
    );
    expect(manifest.archive).toEqual({
      name: 'source.tar',
      sha256: hash(readFileSync(archive)),
      bytes: statSync(archive).size,
    });
    expect(manifest.originalConfigSha256).toBe(hash(PINNED_CONFIG));
    expect(
      JSON.parse(
        readFileSync(join(value.outputRoot, 'source-provenance.json'), 'utf8'),
      ),
    ).toEqual(manifest);
    expect(archiveFile(archive, 'tracked.js').toString('utf8')).toBe(
      'unstaged current bytes\r\n',
    );
    expect(archiveFile(archive, 'new.js').toString('utf8')).toBe(
      'new untracked source\n',
    );
    expect(archiveFiles(archive)).not.toContain('deleted.js');
    expect(archiveFiles(archive)).toEqual(
      manifest.files.map((/** @type {{path: string}} */ file) => file.path),
    );
    expect(manifest.files).toContainEqual({
      path: 'bin/run',
      mode: '100755',
      bytes: 17,
      sha256: hash('#!/bin/sh\nexit 0\n'),
    });
    expect(
      git(join(value.outputRoot, 'repo'), ['rev-parse', '--git-common-dir'])
        .toString('utf8')
        .trim(),
    ).toBe('.git');
  });

  test('excludes ignored files, local credentials and tool state while retaining safe env templates', () => {
    const value = sourceFixture();
    const excluded = [
      '.env',
      '.env.production',
      '.aws/credentials',
      '.npmrc',
      'keys/server.pem',
      '.codex/state.json',
      'node_modules/private/index.js',
      'dist/build.js',
    ];
    for (const file of excluded)
      write(join(value.repoRoot, file), 'fictional private fixture data\n');
    write(join(value.repoRoot, 'ignored/file.js'), 'ignored fixture\n');
    write(join(value.repoRoot, 'ignored.txt'), 'ignored fixture\n');
    write(join(value.repoRoot, '.env.example'), 'EXAMPLE=value\n');
    write(join(value.repoRoot, '.env.local.template'), 'EXAMPLE=value\n');
    const before = sourceIdentity(value.repoRoot);
    const manifest = createProofSource({ ...value, mode: 'snapshot' });
    const files = archiveFiles(join(value.outputRoot, 'source.tar'));
    expect(files).toEqual(
      expect.arrayContaining([
        '.env.example',
        '.env.local.template',
        'tracked.js',
      ]),
    );
    expect(files).not.toEqual(expect.arrayContaining(excluded));
    for (const file of [...excluded, 'ignored/file.js', 'ignored.txt'])
      expect(files).not.toContain(file);
    expect(
      manifest.excluded.map((/** @type {{path: string}} */ item) => item.path),
    ).toEqual([...excluded].sort());
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
  });

  test('snapshot commit and archive are deterministic across fresh private output roots', () => {
    const value = sourceFixture();
    write(join(value.repoRoot, 'new.js'), 'unchanged dirty source\n');
    const first = createProofSource({ ...value, mode: 'snapshot' });
    const second = createProofSource({
      repoRoot: value.repoRoot,
      outputRoot: join(value.root, 'snapshot-two'),
      mode: 'snapshot',
    });
    expect(second.commit).toBe(first.commit);
    expect(second.sourceTreeSha256).toBe(first.sourceTreeSha256);
    expect(second.originalStatusSha256).toBe(first.originalStatusSha256);
    expect(second.archive).toEqual(first.archive);
  });

  test('attributes cannot transform bytes or export-ignore files, and source filters/hooks never execute', () => {
    const value = sourceFixture();
    const marker = join(value.root, 'hook-ran');
    const hook = join(value.root, 'forbidden-hook');
    write(hook, `#!/bin/sh\n: > ${JSON.stringify(marker)}\nexit 91\n`);
    chmodSync(hook, 0o755);
    write(
      join(value.repoRoot, '.gitattributes'),
      '*.js filter=proof text eol=lf\ntracked.js export-ignore\n',
    );
    write(join(value.repoRoot, 'tracked.js'), 'untouched CRLF\r\n');
    for (const key of [
      'filter.proof.clean',
      'filter.proof.smudge',
      'filter.proof.process',
      'core.fsmonitor',
      'gpg.program',
    ])
      git(value.repoRoot, ['config', '--local', key, hook]);
    git(value.repoRoot, ['config', '--local', 'filter.proof.required', 'true']);
    git(value.repoRoot, ['config', '--local', 'commit.gpgSign', 'true']);
    const hooks = join(value.root, 'hooks');
    mkdirSync(hooks);
    for (const name of ['pre-commit', 'post-commit', 'post-checkout'])
      symlinkSync(hook, join(hooks, name));
    git(value.repoRoot, ['config', '--local', 'core.hooksPath', hooks]);
    const xdg = join(value.root, 'xdg');
    const globalConfig = join(xdg, 'git/config');
    write(
      globalConfig,
      `[core]\n\thooksPath = ${hooks}\n\n[commit]\n\tgpgSign = true\n\n[gpg]\n\tprogram = ${hook}\n\n[init]\n\ttemplateDir = ${hooks}\n`,
    );
    temporaryEnvironment('XDG_CONFIG_HOME', xdg);
    const globalBefore = readFileSync(globalConfig);
    const before = sourceIdentity(value.repoRoot);
    const homeBefore = process.env.HOME;
    const manifest = createProofSource({ ...value, mode: 'snapshot' });
    expect(
      archiveFile(join(value.outputRoot, 'source.tar'), 'tracked.js').toString(
        'utf8',
      ),
    ).toBe('untouched CRLF\r\n');
    expect(
      manifest.files.map((/** @type {{path: string}} */ file) => file.path),
    ).toContain('tracked.js');
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(globalConfig)).toEqual(globalBefore);
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
    expect(process.env.HOME).toBe(homeBefore);
  });

  test('inherited Git routing/configuration cannot redirect private writes into the original checkout', () => {
    const value = sourceFixture();
    const before = sourceIdentity(value.repoRoot);
    const redirectedIndex = join(value.root, 'must-not-create-index');
    temporaryEnvironment('GIT_DIR', join(value.repoRoot, '.git'));
    temporaryEnvironment('GIT_WORK_TREE', value.repoRoot);
    temporaryEnvironment('GIT_INDEX_FILE', redirectedIndex);
    temporaryEnvironment(
      'GIT_CONFIG_PARAMETERS',
      'deliberately invalid config injection',
    );
    const manifest = createProofSource({ ...value, mode: 'snapshot' });
    expect(manifest.originalHead).toBe(before.head);
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
    expect(existsSync(redirectedIndex)).toBe(false);
  });

  /** @type {Array<[string, (value: ReturnType<typeof sourceFixture>) => void]>} */
  const races = [
    [
      'contents while status remains modified',
      (value) =>
        write(join(value.repoRoot, 'tracked.js'), 'second dirty content\n'),
    ],
    [
      'index',
      (value) => {
        git(value.repoRoot, ['add', 'tracked.js']);
      },
    ],
    [
      'HEAD',
      (value) => {
        git(value.repoRoot, ['add', 'tracked.js']);
        git(value.repoRoot, [
          'commit',
          '--quiet',
          '--no-verify',
          '-m',
          'Concurrent private fixture edit',
        ]);
      },
    ],
    [
      'file selection',
      (value) =>
        write(
          join(value.repoRoot, 'concurrent-new.js'),
          'new concurrent file\n',
        ),
    ],
  ];
  test.each(races)(
    'rejects a source race changing %s without issuing provenance',
    (_name, mutate) => {
      const value = sourceFixture();
      write(join(value.repoRoot, 'tracked.js'), 'first dirty content\n');
      expect(() =>
        createProofSource(
          { ...value, mode: 'snapshot' },
          { afterCapture: () => mutate(value) },
        ),
      ).toThrow(/changed during source capture/);
      expect(existsSync(join(value.outputRoot, 'source-provenance.json'))).toBe(
        false,
      );
    },
  );

  test('commit mode rejects dirty source before creating its output', () => {
    const value = sourceFixture();
    write(join(value.repoRoot, 'new.js'), 'uncommitted source\n');
    const before = sourceIdentity(value.repoRoot);
    expect(() => createProofSource({ ...value, mode: 'commit' })).toThrow(
      'worktree is dirty',
    );
    expect(existsSync(value.outputRoot)).toBe(false);
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
  });

  test('clean commit mode uses original HEAD and does not create a private repository', () => {
    const value = sourceFixture();
    const before = sourceIdentity(value.repoRoot);
    const manifest = createProofSource({ ...value, mode: 'commit' });
    expect(manifest.commit).toBe(before.head);
    expect(manifest.snapshotCommit).toBeNull();
    expect(existsSync(join(value.outputRoot, 'repo'))).toBe(false);
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
  });

  /** @type {Array<[string, (value: ReturnType<typeof sourceFixture>) => void]>} */
  const hiddenWorktreeChanges = [
    [
      'an assume-unchanged content edit',
      (value) => {
        git(value.repoRoot, [
          'update-index',
          '--assume-unchanged',
          'tracked.js',
        ]);
        write(join(value.repoRoot, 'tracked.js'), 'hidden changed bytes\n');
      },
    ],
    [
      'a missing skip-worktree file',
      (value) => {
        git(value.repoRoot, ['update-index', '--skip-worktree', 'tracked.js']);
        rmSync(join(value.repoRoot, 'tracked.js'));
      },
    ],
    [
      'an executable-bit change hidden by core.fileMode=false',
      (value) => {
        git(value.repoRoot, ['config', '--local', 'core.fileMode', 'false']);
        chmodSync(join(value.repoRoot, 'tracked.js'), 0o755);
      },
    ],
    [
      'CRLF checkout bytes hidden by committed eol attributes',
      (value) => {
        write(
          join(value.repoRoot, '.gitattributes'),
          'tracked.js text eol=crlf\n',
        );
        git(value.repoRoot, ['add', '.gitattributes']);
        git(value.repoRoot, [
          'commit',
          '--quiet',
          '--no-verify',
          '-m',
          'CRLF checkout policy fixture',
        ]);
        rmSync(join(value.repoRoot, 'tracked.js'));
        git(value.repoRoot, ['checkout', '--', 'tracked.js']);
        expect(readFileSync(join(value.repoRoot, 'tracked.js'), 'utf8')).toBe(
          'original tracked bytes\r\n',
        );
      },
    ],
  ];
  test.each(hiddenWorktreeChanges)(
    'clean commit archives HEAD bytes and modes despite %s',
    (_name, mutate) => {
      const value = sourceFixture();
      mutate(value);
      expect(
        git(value.repoRoot, [
          'status',
          '--porcelain=v1',
          '--untracked-files=all',
        ]).length,
      ).toBe(0);
      const before = sourceIdentity(value.repoRoot);

      const manifest = createProofSource({ ...value, mode: 'commit' });
      const archive = join(value.outputRoot, 'source.tar');

      expect(manifest.commit).toBe(before.head);
      expect(archiveFile(archive, 'tracked.js').toString('utf8')).toBe(
        'original tracked bytes\n',
      );
      expect(manifest.files).toContainEqual({
        path: 'tracked.js',
        mode: '100644',
        bytes: 23,
        sha256: hash('original tracked bytes\n'),
      });
      expect(sourceIdentity(value.repoRoot)).toEqual(before);
    },
  );

  test('clean commit archives exactly its captured allowlist and excludes tracked local tool state', () => {
    const value = sourceFixture();
    write(
      join(value.repoRoot, '.codex/auth.json'),
      '{"fixture":"must-not-enter-proof-archive"}\n',
    );
    write(join(value.repoRoot, 'dist/generated.bin'), 'generated fixture\n');
    git(value.repoRoot, ['add', '--all']);
    git(value.repoRoot, [
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'Tracked local tool-state fixture',
    ]);

    const manifest = createProofSource({ ...value, mode: 'commit' });
    const archive = join(value.outputRoot, 'source.tar');
    const archivedPaths = archiveFiles(archive);
    expect(archivedPaths).toEqual(
      manifest.files.map((/** @type {{path: string}} */ file) => file.path),
    );
    expect(archivedPaths).not.toContain('.codex/auth.json');
    expect(archivedPaths).not.toContain('dist/generated.bin');
    expect(manifest.excluded).toEqual(
      expect.arrayContaining([
        {
          path: '.codex/auth.json',
          reason: 'generated-or-local-tool-state',
        },
        {
          path: 'dist/generated.bin',
          reason: 'generated-or-local-tool-state',
        },
      ]),
    );
    for (const file of manifest.files) {
      expect(hash(archiveFile(archive, file.path))).toBe(file.sha256);
    }
    expect(manifest.fileManifestScope).toBe('exact-clean-commit-allowlist');
    expect(manifest.exclusionScope).toBe('clean-commit-archive');
  });

  test('clean mode accepts only the exact root npm token placeholder while snapshots exclude it', () => {
    expect(readFileSync(new URL('../../.npmrc', import.meta.url), 'utf8')).toBe(
      SAFE_ROOT_NPMRC,
    );
    const value = sourceFixture();
    write(join(value.repoRoot, '.npmrc'), SAFE_ROOT_NPMRC);
    git(value.repoRoot, ['add', '.npmrc']);
    git(value.repoRoot, [
      'commit',
      '--quiet',
      '--no-verify',
      '-m',
      'Safe public registry placeholder fixture',
    ]);
    const before = sourceIdentity(value.repoRoot);

    const committed = createProofSource({ ...value, mode: 'commit' });
    expect(committed.commit).toBe(before.head);
    expect(
      archiveFile(join(value.outputRoot, 'source.tar'), '.npmrc').toString(
        'utf8',
      ),
    ).toBe(SAFE_ROOT_NPMRC);
    expect(committed.excluded).not.toContainEqual(
      expect.objectContaining({ path: '.npmrc' }),
    );

    const outputRoot = join(value.root, 'filtered-snapshot');
    const snapshot = createProofSource({
      repoRoot: value.repoRoot,
      outputRoot,
      mode: 'snapshot',
    });
    expect(snapshot.excluded).toContainEqual({
      path: '.npmrc',
      reason: 'local-credential-path',
    });
    expect(archiveFiles(join(outputRoot, 'source.tar'))).not.toContain(
      '.npmrc',
    );
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
  });

  test.each([
    ['a literal token', '//example.invalid/:_authToken=fictional-test-value\n'],
    ['additional npm configuration', `${SAFE_ROOT_NPMRC}always-auth=true\n`],
  ])(
    'clean mode refuses %s in tracked .npmrc while snapshot mode excludes it',
    (_name, npmrc) => {
      const value = sourceFixture();
      write(join(value.repoRoot, '.npmrc'), npmrc);
      git(value.repoRoot, ['add', '.npmrc']);
      git(value.repoRoot, [
        'commit',
        '--quiet',
        '--no-verify',
        '-m',
        'Private credential-path fixture',
      ]);
      const before = sourceIdentity(value.repoRoot);
      expect(() => createProofSource({ ...value, mode: 'commit' })).toThrow(
        /credential|placeholder/i,
      );
      expect(existsSync(join(value.outputRoot, 'source-provenance.json'))).toBe(
        false,
      );
      const outputRoot = join(value.root, 'filtered-snapshot');
      const manifest = createProofSource({
        repoRoot: value.repoRoot,
        outputRoot,
        mode: 'snapshot',
      });
      expect(manifest.excluded).toContainEqual({
        path: '.npmrc',
        reason: 'local-credential-path',
      });
      expect(archiveFiles(join(outputRoot, 'source.tar'))).not.toContain(
        '.npmrc',
      );
      expect(sourceIdentity(value.repoRoot)).toEqual(before);
    },
  );

  test('clean mode refuses local info/attributes while snapshots ignore its uncommitted export rules', () => {
    const value = sourceFixture();
    const attributes = join(value.repoRoot, '.git/info/attributes');
    const bytes = 'tracked.js export-ignore\n';
    write(attributes, bytes);
    const before = sourceIdentity(value.repoRoot);
    expect(before.status.length).toBe(0);
    expect(() => createProofSource({ ...value, mode: 'commit' })).toThrow(
      /attributes/i,
    );
    expect(existsSync(join(value.outputRoot, 'source-provenance.json'))).toBe(
      false,
    );
    const outputRoot = join(value.root, 'attributes-snapshot');
    createProofSource({
      repoRoot: value.repoRoot,
      outputRoot,
      mode: 'snapshot',
    });
    expect(
      archiveFile(join(outputRoot, 'source.tar'), 'tracked.js').toString(
        'utf8',
      ),
    ).toBe('original tracked bytes\n');
    expect(readFileSync(attributes, 'utf8')).toBe(bytes);
    expect(sourceIdentity(value.repoRoot)).toEqual(before);
  });

  test('rejects output within the source and an existing output instead of overwriting', () => {
    const value = sourceFixture();
    expect(() =>
      createProofSource({
        ...value,
        outputRoot: join(value.repoRoot, 'capture'),
        mode: 'snapshot',
      }),
    ).toThrow('outside the original checkout');
    mkdirSync(value.outputRoot);
    write(join(value.outputRoot, 'keep'), 'existing evidence');
    expect(() => createProofSource({ ...value, mode: 'snapshot' })).toThrow();
    expect(readFileSync(join(value.outputRoot, 'keep'), 'utf8')).toBe(
      'existing evidence',
    );
  });

  test('rejects source symlinks without copying their target', () => {
    const value = sourceFixture();
    const outside = join(value.root, 'outside-secret');
    write(outside, 'private fixture target');
    symlinkSync(outside, join(value.repoRoot, 'link.js'));
    expect(() => createProofSource({ ...value, mode: 'snapshot' })).toThrow(
      'symlink',
    );
    expect(existsSync(join(value.outputRoot, 'repo/link.js'))).toBe(false);
    expect(existsSync(join(value.outputRoot, 'source-provenance.json'))).toBe(
      false,
    );
  });
});

describe('frozen proof host helper', () => {
  function capturedHelper() {
    const fixture = sourceFixture();
    const originalPath = join(
      fixture.repoRoot,
      'scripts/systemd-proof-host.js',
    );
    const helperPath = join(fixture.root, 'host-helper.mjs');
    const bytes = 'export const capturedHelper = true;\n';
    write(originalPath, bytes);
    write(helperPath, bytes);
    createProofSource({ ...fixture, mode: 'snapshot' });
    return {
      originalPath,
      helperPath,
      provenancePath: join(fixture.outputRoot, 'source-provenance.json'),
    };
  }

  test('the retained helper stays bound to captured bytes after checkout changes', () => {
    const value = capturedHelper();
    expect(() => verifyProofHostHelper(value)).not.toThrow();
    write(value.originalPath, 'throw new Error("mutable checkout");\n');
    expect(() => verifyProofHostHelper(value)).not.toThrow();
  });

  test('changed frozen helper bytes cannot execute under another source receipt', () => {
    const value = capturedHelper();
    write(value.helperPath, 'export const capturedHelper = false;\n');
    expect(() => verifyProofHostHelper(value)).toThrow(
      'Frozen host helper differs from the captured proof source.',
    );
  });

  test.each(['missing', 'duplicate'])('rejects a %s helper entry', (kind) => {
    const value = capturedHelper();
    const manifest = JSON.parse(readFileSync(value.provenancePath, 'utf8'));
    const entry = {
      path: 'scripts/systemd-proof-host.js',
      sha256: hash(readFileSync(value.helperPath)),
    };
    manifest.files = kind === 'missing' ? [] : [entry, entry];
    write(value.provenancePath, JSON.stringify(manifest));
    expect(() => verifyProofHostHelper(value)).toThrow(
      'Proof source must capture exactly one host helper.',
    );
  });
});

describe('pinned one-image Lima configuration', () => {
  test.each([
    ['arm64', 'aarch64', ARM_DIGEST, '-arm64.img'],
    ['aarch64', 'aarch64', ARM_DIGEST, '-arm64.img'],
    ['x86_64', 'x86_64', X86_DIGEST, '-amd64.img'],
  ])(
    'selects %s without changing provision/probe bytes',
    (hostArch, arch, digest, suffix) => {
      const root = ownedRoot();
      const imagePath = join(root, 'private image.img');
      const result = deriveLimaConfig({
        config: PINNED_CONFIG,
        hostArch,
        imagePath,
      });
      expect(result).toMatchObject({
        arch,
        digest,
        originalConfigSha256: hash(PINNED_CONFIG),
      });
      expect(result.url).toMatch(/^https:\/\/cloud-images\.ubuntu\.com\//);
      expect(result.url.endsWith(suffix)).toBe(true);
      expect(result.config.match(/^ {2}- location:/gm)).toHaveLength(1);
      expect(result.config).toContain(
        `  - location: ${JSON.stringify(imagePath)}\n    arch: ${arch}\n    digest: ${digest}\n`,
      );
      expect(result.config.slice(result.config.indexOf('mounts:'))).toBe(
        PINNED_CONFIG.slice(PINNED_CONFIG.indexOf('mounts:')),
      );
      expect(result.config.slice(0, result.config.indexOf('images:'))).toBe(
        PINNED_CONFIG.slice(0, PINNED_CONFIG.indexOf('images:')),
      );
      expect(result.derivedConfigSha256).toBe(hash(result.config));
      expect(existsSync(imagePath)).toBe(false);
    },
  );

  /** @type {Array<[string, (config: string) => string]>} */
  const unsafeConfigurations = [
    ['quoted ssh key', (config) => `${config}\n"ssh":\n  forwardAgent: true\n`],
    [
      'single-quoted ssh key',
      (config) => `${config}\n'ssh':\n  forwardAgent: true\n`,
    ],
    [
      'unrecognized top-level key',
      (config) => `${config}\nssh:\n  forwardAgent: true\n`,
    ],
    [
      'unrecognized nonalphabetic key',
      (config) => `${config}\nunsupported_key: true\n`,
    ],
    [
      'host mount',
      (config) =>
        config.replace(
          'mounts: []',
          'mounts:\n  - location: /Users\n    writable: true',
        ),
    ],
    [
      'system containerd download',
      (config) => config.replace('  system: false', '  system: true'),
    ],
    [
      'user containerd download',
      (config) => config.replace('  user: false', '  user: true'),
    ],
    [
      'duplicate nested containerd override',
      (config) =>
        config.replace('  user: false\n', '  user: false\n  user: true\n'),
    ],
    [
      'additional containerd archive download',
      (config) =>
        config.replace(
          '  user: false\n',
          '  user: false\n  archives:\n    - location: https://example.invalid/archive\n',
        ),
    ],
    [
      'additional host provision command',
      (config) =>
        config.replace(
          '\nprobes:\n',
          '\n  - mode: host\n    script: |\n      exit 0\n\nprobes:\n',
        ),
    ],
    [
      'extra remote fallback',
      (config) =>
        config.replace(
          '\nmounts:',
          `  - location: https://cloud-images.ubuntu.com/extra-arm64.img\n    arch: aarch64\n    digest: ${ARM_DIGEST}\n\nmounts:`,
        ),
    ],
    [
      'duplicate image architecture',
      (config) => config.replace('    arch: x86_64', '    arch: aarch64'),
    ],
    [
      'unofficial image host',
      (config) =>
        config.replaceAll('cloud-images.ubuntu.com', 'example.invalid'),
    ],
    [
      'credentialed image URL',
      (config) =>
        config.replaceAll(
          'https://cloud-images',
          'https://user:password@cloud-images',
        ),
    ],
    [
      'image query',
      (config) =>
        config.replace(
          'cloudimg-arm64.img',
          'cloudimg-arm64.img?token=fixture',
        ),
    ],
    [
      'wrong architecture suffix',
      (config) => config.replace('cloudimg-arm64.img', 'cloudimg-amd64.img'),
    ],
  ];
  test.each(unsafeConfigurations)('refuses %s', (_name, change) => {
    const root = ownedRoot();
    expect(() =>
      deriveLimaConfig({
        config: change(PINNED_CONFIG),
        hostArch: 'arm64',
        imagePath: join(root, 'image.img'),
      }),
    ).toThrow();
  });

  test('rejects unsupported host architecture and symlinked image route', () => {
    const root = ownedRoot();
    expect(() =>
      deriveLimaConfig({
        config: PINNED_CONFIG,
        hostArch: 'riscv64',
        imagePath: join(root, 'image.img'),
      }),
    ).toThrow('Unsupported');
    const real = join(root, 'cache');
    mkdirSync(real);
    const link = join(root, 'cache-link');
    symlinkSync(real, link);
    expect(() =>
      deriveLimaConfig({
        config: PINNED_CONFIG,
        hostArch: 'arm64',
        imagePath: join(link, 'image.img'),
      }),
    ).toThrow('symlink');
  });

  test('image planning does not download and digest/config verification fails closed', () => {
    const root = ownedRoot();
    const imageBytes = Buffer.from('task-owned image fixture, not a VM image');
    const digest = `sha256:${hash(imageBytes)}`;
    const configPath = join(root, 'captured.yaml');
    write(configPath, PINNED_CONFIG.replace(ARM_DIGEST, digest));
    const cacheRoot = join(root, 'cache');
    mkdirSync(cacheRoot);
    const outputRoot = join(root, 'image-evidence');
    const plan = planLimaImage({
      configPath,
      hostArch: 'arm64',
      cacheRoot,
      outputRoot,
    });
    expect(readdirSync(cacheRoot)).toEqual([]);
    expect(plan).toMatchObject({
      remoteFallbacks: 0,
      hostMounts: [],
      expectedDigest: digest,
    });
    const planPath = join(outputRoot, 'image-plan.json');
    write(plan.imagePath, 'wrong image bytes');
    expect(() => verifyLimaImage(planPath)).toThrow('pinned digest');
    expect(existsSync(join(outputRoot, 'image-provenance.json'))).toBe(false);
    write(plan.imagePath, imageBytes);
    const derived = readFileSync(plan.derivedConfigPath);
    write(plan.derivedConfigPath, 'changed configuration');
    expect(() => verifyLimaImage(planPath)).toThrow(
      'Derived Lima config changed',
    );
    write(plan.derivedConfigPath, derived);
    const original = readFileSync(configPath);
    write(configPath, 'changed captured source config');
    expect(() => verifyLimaImage(planPath)).toThrow(
      'Original Lima config changed',
    );
    write(configPath, original);
    const receipt = verifyLimaImage(planPath);
    expect(receipt).toMatchObject({
      actualDigest: digest,
      bytes: imageBytes.length,
      digestVerified: true,
      downloadedIntoPrivateCache: true,
    });
    expect(() => verifyLimaImage(planPath)).toThrow();
  });

  test('socket validation refuses traversal, control characters and long socket namespaces', () => {
    const root = ownedRoot();
    for (const instance of ['../other', 'instance/name', 'line\nfeed'])
      expect(() => assertLimaSocketPath({ limaHome: root, instance })).toThrow(
        'Unsafe Lima',
      );
    expect(() =>
      assertLimaSocketPath({ limaHome: root, instance: 'x'.repeat(104) }),
    ).toThrow('socket path is too long');
  });
});

describe('proof receipt reservation, sealing and publication', () => {
  function receiptFixture() {
    const root = ownedRoot();
    const tempRoot = join(root, 'task-private');
    mkdirSync(tempRoot);
    const outputRoot = join(root, 'receipts');
    const staging = reserveProofReceipt({
      outputRoot,
      commit: COMMIT,
      tempRoot,
    });
    return { root, tempRoot, outputRoot, staging };
  }

  test('reserves exclusively, hashes exact files and publishes without replacement', () => {
    const value = receiptFixture();
    expect(basename(value.staging)).toBe(`.${COMMIT}.in-progress`);
    expect(() => reserveProofReceipt({ ...value, commit: COMMIT })).toThrow();
    write(join(value.staging, 'prepare.json'), '{"ready":true}\n');
    write(join(value.staging, 'boot.json'), '{"automaticStart":false}\n');
    sealProofReceipt(value.staging);
    expect(readFileSync(join(value.staging, 'SHA256SUMS'), 'utf8')).toBe(
      `${hash('{"automaticStart":false}\n')}  boot.json\n${hash('{"ready":true}\n')}  prepare.json\n`,
    );
    expect(statSync(join(value.staging, 'SHA256SUMS')).mode & 0o777).toBe(
      0o600,
    );
    expect(() => sealProofReceipt(value.staging)).toThrow('already sealed');
    const destination = publishProofReceipt({ ...value, commit: COMMIT });
    expect(destination).toBe(join(value.outputRoot, COMMIT));
    expect(existsSync(value.staging)).toBe(false);
    expect(readFileSync(join(destination, 'prepare.json'), 'utf8')).toBe(
      '{"ready":true}\n',
    );
    expect(() => reserveProofReceipt({ ...value, commit: COMMIT })).toThrow(
      'already exist',
    );
  });

  test('a destination created after reservation is never overwritten', () => {
    const value = receiptFixture();
    write(join(value.staging, 'proof.json'), '{}');
    sealProofReceipt(value.staging);
    const destination = join(value.outputRoot, COMMIT);
    mkdirSync(destination);
    write(join(destination, 'keep'), 'existing receipt');
    expect(() => publishProofReceipt({ ...value, commit: COMMIT })).toThrow(
      'Refusing to replace',
    );
    expect(readFileSync(join(destination, 'keep'), 'utf8')).toBe(
      'existing receipt',
    );
    expect(existsSync(value.staging)).toBe(true);
  });

  test('atomically refuses a destination raced into existence at publication', () => {
    const value = receiptFixture();
    write(join(value.staging, 'proof.json'), '{"complete":true}\n');
    sealProofReceipt(value.staging);
    const expectedStaging = readdirSync(value.staging).sort();
    const destination = join(value.outputRoot, COMMIT);

    expect(() =>
      publishProofReceipt(
        { ...value, commit: COMMIT },
        {
          beforeDestinationReserve(candidate) {
            expect(candidate).toBe(destination);
            mkdirSync(candidate);
            write(join(candidate, 'keep'), 'raced receipt');
          },
        },
      ),
    ).toThrow('Refusing to replace');
    expect(readFileSync(join(destination, 'keep'), 'utf8')).toBe(
      'raced receipt',
    );
    expect(readdirSync(value.staging).sort()).toEqual(expectedStaging);
  });

  /** @type {Array<[string, (value: ReturnType<typeof receiptFixture>) => void]>} */
  const sealedReceiptMutations = [
    [
      'mutated file bytes',
      (value) => write(join(value.staging, 'proof.json'), '{"changed":true}\n'),
    ],
    [
      'an added file',
      (value) => write(join(value.staging, 'late.log'), 'late evidence\n'),
    ],
    [
      'a forged checksum document',
      (value) => write(join(value.staging, 'SHA256SUMS'), 'forged\n'),
    ],
  ];
  test.each(sealedReceiptMutations)(
    'refuses %s after sealing without reserving a destination',
    (_name, mutate) => {
      const value = receiptFixture();
      write(join(value.staging, 'proof.json'), '{"complete":true}\n');
      sealProofReceipt(value.staging);
      mutate(value);

      expect(() => publishProofReceipt({ ...value, commit: COMMIT })).toThrow(
        /checksum seal|exact current file set/,
      );
      expect(existsSync(join(value.outputRoot, COMMIT))).toBe(false);
      expect(existsSync(value.staging)).toBe(true);
    },
  );

  test('refuses a manually forged seal that was never created by sealing', () => {
    const value = receiptFixture();
    write(join(value.staging, 'proof.json'), '{"complete":true}\n');
    write(join(value.staging, 'SHA256SUMS'), '');

    expect(() => publishProofReceipt({ ...value, commit: COMMIT })).toThrow(
      /checksum seal/,
    );
    expect(existsSync(join(value.outputRoot, COMMIT))).toBe(false);
    expect(existsSync(value.staging)).toBe(true);
  });

  test('removes its reserved destination and preserves staging after a mid-copy failure', () => {
    const value = receiptFixture();
    write(join(value.staging, 'first.json'), '{"first":true}\n');
    write(join(value.staging, 'second.json'), '{"second":true}\n');
    sealProofReceipt(value.staging);
    const staged = readdirSync(value.staging).sort();
    const destination = join(value.outputRoot, COMMIT);

    expect(() =>
      publishProofReceipt(
        { ...value, commit: COMMIT },
        {
          afterCopy() {
            throw new Error('injected mid-copy failure');
          },
        },
      ),
    ).toThrow('injected mid-copy failure');
    expect(existsSync(destination)).toBe(false);
    expect(readdirSync(value.staging).sort()).toEqual(staged);
  });

  test('revalidates copied destination bytes before exposing SHA256SUMS', () => {
    const value = receiptFixture();
    write(join(value.staging, 'proof.json'), '{"complete":true}\n');
    sealProofReceipt(value.staging);
    const destination = join(value.outputRoot, COMMIT);

    expect(() =>
      publishProofReceipt(
        { ...value, commit: COMMIT },
        {
          afterCopy(_name, target) {
            writeFileSync(target, '{"corrupt":true}\n');
          },
        },
      ),
    ).toThrow('bytes changed during copying');
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(value.staging)).toBe(true);
  });

  test('failed evidence publishes to a unique failure directory, preserving the success slot', () => {
    const value = receiptFixture();
    write(join(value.staging, 'failure.log'), 'bounded failure');
    sealProofReceipt(value.staging);
    const failure = publishProofReceipt({
      ...value,
      commit: COMMIT,
      failed: true,
    });
    expect(dirname(failure)).toBe(join(value.outputRoot, 'failures'));
    expect(basename(failure)).toMatch(new RegExp(`^${COMMIT}-[a-f0-9-]+$`));
    expect(existsSync(join(value.outputRoot, COMMIT))).toBe(false);
    expect(reserveProofReceipt({ ...value, commit: COMMIT })).toBe(
      value.staging,
    );
  });

  test('refuses transient receipt roots and symlinked output routes', () => {
    const root = ownedRoot();
    const tempRoot = join(root, 'task');
    mkdirSync(tempRoot);
    expect(() =>
      reserveProofReceipt({
        outputRoot: join(tempRoot, 'receipts'),
        tempRoot,
        commit: COMMIT,
      }),
    ).toThrow('must outlive');
    expect(() =>
      reserveProofReceipt({
        outputRoot: join(tempRoot, 'trailing-receipts'),
        tempRoot: `${tempRoot}${sep}`,
        commit: COMMIT,
      }),
    ).toThrow('must outlive');
    const tempAlias = join(root, 'task-alias');
    symlinkSync(tempRoot, tempAlias, 'dir');
    expect(() =>
      reserveProofReceipt({
        outputRoot: join(tempRoot, 'aliased-receipts'),
        tempRoot: tempAlias,
        commit: COMMIT,
      }),
    ).toThrow('must outlive');
    const retained = join(root, 'retained');
    mkdirSync(retained);
    const link = join(root, 'receipt-link');
    symlinkSync(retained, link);
    expect(() =>
      reserveProofReceipt({ outputRoot: link, tempRoot, commit: COMMIT }),
    ).toThrow('symlink');
    expect(readdirSync(retained)).toEqual([]);
  });

  test.each(['symlink', 'directory', 'unsafe filename'])(
    'will not seal a %s entry',
    (kind) => {
      const value = receiptFixture();
      if (kind === 'symlink') {
        const target = join(value.root, 'outside.txt');
        write(target, 'not a receipt');
        symlinkSync(target, join(value.staging, 'linked.txt'));
      } else if (kind === 'directory') mkdirSync(join(value.staging, 'nested'));
      else write(join(value.staging, 'space name.txt'), 'unsafe');
      expect(() => sealProofReceipt(value.staging)).toThrow();
      expect(existsSync(join(value.staging, 'SHA256SUMS'))).toBe(false);
    },
  );

  test('requires a sealed, correctly named reservation before publication', () => {
    const value = receiptFixture();
    expect(() => publishProofReceipt({ ...value, commit: COMMIT })).toThrow();
    expect(() =>
      publishProofReceipt({ staging: value.outputRoot, commit: COMMIT }),
    ).toThrow('Not an owned');
    expect(lstatSync(value.staging).isDirectory()).toBe(true);
  });
});
