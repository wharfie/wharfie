import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Header } from 'tar';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_ARCHIVE_FORMAT,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_FILE_BYTES,
  createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-source.js';

const SOURCE_COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const TAR_BLOCK_BYTES = 512;
const REQUIRED_FILES = Object.freeze([
  'package.json',
  'package-lock.json',
  'scripts/aws-host-retained-storage-host-preflight-sea-delivery.js',
  'scripts/collect-aws-host-retained-storage-preflight-linux.js',
  'scripts/aws-host-retained-storage-host-preflight.js',
  'src/core/lib/node-sea.js',
  'src/core/runtime/canonical-order.js',
  'src/core/runtime/content-id.js',
  'src/core/runtime/json-value.js',
  'src/core/runtime/manifest-security.js',
]);
const testDirectories = new Set();

/**
 * @typedef RawEntry
 * @property {string} path - Exact tar path.
 * @property {'File'|'Directory'|'SymbolicLink'} type - Tar entry type.
 * @property {Buffer | string} [content] - Optional file bytes.
 * @property {string} [linkpath] - Optional symbolic-link target.
 * @property {number} [mode] - Optional exact tar permission bits.
 */

/** @param {RawEntry[]} entries @returns {Buffer} */
function createRawTar(entries) {
  const blocks = [];
  for (const entry of entries) {
    const content =
      entry.type === 'File'
        ? Buffer.from(entry.content || '')
        : Buffer.alloc(0);
    const headerBlock = Buffer.alloc(TAR_BLOCK_BYTES);
    const header = new Header({
      path: entry.path,
      type: entry.type,
      linkpath: entry.linkpath,
      mode: entry.mode ?? (entry.type === 'Directory' ? 0o755 : 0o644),
      uid: 0,
      gid: 0,
      size: content.length,
      mtime: new Date(0),
    });
    header.encode(headerBlock);
    blocks.push(headerBlock);
    if (content.length > 0) {
      blocks.push(content);
      const remainder = content.length % TAR_BLOCK_BYTES;
      if (remainder > 0) {
        blocks.push(Buffer.alloc(TAR_BLOCK_BYTES - remainder));
      }
    }
  }
  blocks.push(Buffer.alloc(2 * TAR_BLOCK_BYTES));
  return Buffer.concat(blocks);
}

/** @returns {RawEntry[]} */
function requiredArchiveEntries() {
  const directories = new Set();
  for (const file of REQUIRED_FILES) {
    const components = file.split('/');
    for (let index = 1; index < components.length; index += 1) {
      directories.add(components.slice(0, index).join('/'));
    }
  }
  return [
    ...Array.from(directories)
      .sort()
      .map((directory) => ({
        path: `${directory}/`,
        type: /** @type {'Directory'} */ ('Directory'),
      })),
    ...REQUIRED_FILES.map((file) => ({
      path: file,
      type: /** @type {'File'} */ ('File'),
      content: `exact bytes for ${file}\n`,
    })),
  ];
}

/** @returns {Buffer} */
function createValidArchive() {
  return createRawTar(requiredArchiveEntries());
}

/** @param {Buffer | string} content @param {'sha1'|'sha256'} [objectFormat] @returns {string} */
function createGitBlobId(content, objectFormat = 'sha1') {
  const bytes = Buffer.from(content);
  return createHash(objectFormat)
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}

/** @param {RawEntry[]} [entries] @param {'sha1'|'sha256'} [objectFormat] @returns {Buffer} */
function createGitTreeOutput(
  entries = requiredArchiveEntries(),
  objectFormat = 'sha1',
) {
  return Buffer.from(
    entries
      .filter((entry) => entry.type === 'File')
      .map((entry) => {
        const content = entry.content || '';
        const mode = entry.mode === 0o755 ? '100755' : '100644';
        return `${mode} blob ${createGitBlobId(content, objectFormat)}\t${entry.path}\0`;
      })
      .join(''),
  );
}

/**
 * @param {Buffer} archive
 * @param {{resolvedCommit?: string, archiveCommit?: string, objectFormat?: string, treeOutput?: Buffer, failure?: Error}} [options]
 */
function createGitHarness(archive, options = {}) {
  /** @type {Array<{args: Readonly<string[]>, input: Buffer | null, maxOutputBytes: number, receiver: Record<string, any>}>} */
  const calls = [];
  const gitPort = {
    /**
     * @param {Readonly<string[]>} args - Fixed Git argv.
     * @param {Buffer | null} input - Optional stdin.
     * @param {number} maxOutputBytes - Output bound.
     * @returns {Promise<Buffer>}
     */
    async run(args, input, maxOutputBytes) {
      calls.push({ args, input, maxOutputBytes, receiver: this });
      if (options.failure) throw options.failure;
      const operation = args[2];
      if (operation === 'rev-parse') {
        if (args.includes('--show-object-format')) {
          return Buffer.from(`${options.objectFormat || 'sha1'}\n`);
        }
        return Buffer.from(`${options.resolvedCommit || SOURCE_COMMIT}\n`);
      }
      if (operation === 'ls-tree') {
        return options.treeOutput || createGitTreeOutput();
      }
      if (operation === 'archive') return archive;
      if (operation === 'get-tar-commit-id') {
        return Buffer.from(`${options.archiveCommit || SOURCE_COMMIT}\n`);
      }
      throw new Error(`Unexpected Git operation ${String(operation)}`);
    },
  };
  return { calls, gitPort };
}

/** @returns {Promise<Set<string>>} */
async function listOwnedTempRoots() {
  return new Set(
    (await fsp.readdir(os.tmpdir())).filter((entry) =>
      entry.startsWith('wharfie-host-preflight-sea-source-'),
    ),
  );
}

afterEach(async () => {
  await Promise.all(
    Array.from(testDirectories, (directory) =>
      fsp.rm(directory, { recursive: true, force: true }),
    ),
  );
  testDirectories.clear();
});

describe('AWS retained-storage host-preflight SEA source snapshot', () => {
  it.each([
    [''],
    ['A'.repeat(40)],
    ['a'.repeat(39)],
    [`${'a'.repeat(40)}^{commit}`],
  ])(
    'rejects an invalid commit before Git or filesystem I/O',
    async (sourceCommit) => {
      const run = jest.fn();
      const before = await listOwnedTempRoots();

      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit,
          gitPort: { run },
        }),
      ).rejects.toThrow(/lowercase 40-hex/i);

      expect(run).not.toHaveBeenCalled();
      expect(await listOwnedTempRoots()).toEqual(before);
    },
  );

  it('verifies fixed Git operations and returns one frozen owned snapshot', async () => {
    const archive = createValidArchive();
    const harness = createGitHarness(archive);
    const snapshot =
      await createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: harness.gitPort,
      });
    const ownedRoot = path.dirname(snapshot.root);
    const neighbor = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-source-neighbor-'),
    );
    testDirectories.add(neighbor);

    try {
      expect(Object.isFrozen(snapshot)).toBe(true);
      expect(Object.isFrozen(snapshot.archive)).toBe(true);
      expect(Object.isFrozen(snapshot.archive.byteDigest)).toBe(true);
      expect(Reflect.ownKeys(snapshot)).toEqual([
        'sourceCommit',
        'root',
        'archive',
        'close',
      ]);
      expect(snapshot.sourceCommit).toBe(SOURCE_COMMIT);
      expect(snapshot.archive).toEqual({
        format: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_ARCHIVE_FORMAT,
        byteDigest: {
          algorithm: 'sha256',
          value: createHash('sha256').update(archive).digest('base64url'),
        },
        size: archive.length,
      });
      expect((await fsp.stat(ownedRoot)).mode & 0o777).toBe(0o700);
      expect((await fsp.stat(snapshot.root)).mode & 0o777).toBe(0o700);
      expect(
        (await fsp.stat(path.join(snapshot.root, 'package.json'))).mode & 0o777,
      ).toBe(0o600);
      expect(
        (await fsp.stat(path.join(snapshot.root, 'scripts'))).mode & 0o777,
      ).toBe(0o700);
      expect(await fsp.realpath(snapshot.root)).toBe(snapshot.root);
      expect(
        await fsp.readFile(
          path.join(
            snapshot.root,
            'scripts/aws-host-retained-storage-host-preflight-sea-delivery.js',
          ),
          'utf8',
        ),
      ).toBe(
        'exact bytes for scripts/aws-host-retained-storage-host-preflight-sea-delivery.js\n',
      );

      expect(harness.calls).toHaveLength(5);
      expect(harness.calls.map((call) => call.args)).toEqual([
        [
          '-C',
          expect.any(String),
          'rev-parse',
          '--verify',
          '--end-of-options',
          `${SOURCE_COMMIT}^{commit}`,
        ],
        ['-C', expect.any(String), 'rev-parse', '--show-object-format'],
        [
          '-C',
          expect.any(String),
          'ls-tree',
          '-r',
          '-z',
          '--full-tree',
          SOURCE_COMMIT,
        ],
        ['-C', expect.any(String), 'archive', '--format=tar', SOURCE_COMMIT],
        ['-C', expect.any(String), 'get-tar-commit-id'],
      ]);
      expect(new Set(harness.calls.map((call) => call.args[1])).size).toBe(1);
      for (const call of harness.calls) {
        expect(call.receiver).toBe(harness.gitPort);
        expect(Object.isFrozen(call.args)).toBe(true);
      }
      expect(harness.calls[0].input).toBeNull();
      expect(harness.calls[1].input).toBeNull();
      expect(harness.calls[2].input).toBeNull();
      expect(harness.calls[3].input).toBeNull();
      expect(harness.calls[4].input).toEqual(
        archive.subarray(0, 2 * TAR_BLOCK_BYTES),
      );

      await snapshot.close();
      await snapshot.close();
      expect(existsSync(ownedRoot)).toBe(false);
      expect(existsSync(neighbor)).toBe(true);
    } finally {
      await snapshot.close();
    }
  });

  it('retries an owned close after a transient removal failure', async () => {
    const harness = createGitHarness(createValidArchive());
    const snapshot =
      await createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: harness.gitPort,
      });
    const ownedRoot = path.dirname(snapshot.root);
    const originalRm = fsp.rm.bind(fsp);
    const rmSpy = jest
      .spyOn(fsp, 'rm')
      .mockImplementation(
        async (target, options) => await originalRm(target, options),
      );
    rmSpy.mockRejectedValueOnce(new Error('transient removal failure'));

    try {
      await expect(snapshot.close()).rejects.toThrow(
        /transient removal failure/i,
      );
      expect(existsSync(ownedRoot)).toBe(true);

      await snapshot.close();
      await snapshot.close();
      expect(existsSync(ownedRoot)).toBe(false);
      expect(rmSpy).toHaveBeenCalledTimes(2);
    } finally {
      rmSpy.mockRestore();
      if (existsSync(ownedRoot)) {
        await originalRm(ownedRoot, { recursive: true, force: true });
      }
    }
  });

  it('rejects extracted bytes that no longer match the selected Git blob', async () => {
    const before = await listOwnedTempRoots();
    const originalChmod = fsp.chmod.bind(fsp);
    let mutated = false;
    const chmodSpy = jest
      .spyOn(fsp, 'chmod')
      .mockImplementation(async (target, mode) => {
        await originalChmod(target, mode);
        if (
          !mutated &&
          mode === 0o600 &&
          String(target).endsWith(`${path.sep}package.json`)
        ) {
          mutated = true;
          await fsp.writeFile(target, 'post-extraction mutation\n');
        }
      });

    try {
      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: createGitHarness(createValidArchive()).gitPort,
        }),
      ).rejects.toThrow(/extracted file bytes.*exact selected commit/i);
      expect(mutated).toBe(true);
      expect(await listOwnedTempRoots()).toEqual(before);
    } finally {
      chmodSpy.mockRestore();
    }
  });

  it('rejects an oversized extracted file before reading its content', async () => {
    const before = await listOwnedTempRoots();
    const originalChmod = fsp.chmod.bind(fsp);
    let enlarged = false;
    const chmodSpy = jest
      .spyOn(fsp, 'chmod')
      .mockImplementation(async (target, mode) => {
        await originalChmod(target, mode);
        if (
          !enlarged &&
          mode === 0o600 &&
          String(target).endsWith(`${path.sep}package.json`)
        ) {
          enlarged = true;
          await fsp.truncate(
            target,
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_FILE_BYTES + 1,
          );
        }
      });

    try {
      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: createGitHarness(createValidArchive()).gitPort,
        }),
      ).rejects.toThrow(/extracted file exceeds its byte limit/i);
      expect(enlarged).toBe(true);
      expect(await listOwnedTempRoots()).toEqual(before);
    } finally {
      chmodSpy.mockRestore();
    }
  });

  it('rejects an extracted tree whose private mode normalization did not hold', async () => {
    const executableEntries = requiredArchiveEntries().map((entry) =>
      entry.path === REQUIRED_FILES[0] ? { ...entry, mode: 0o755 } : entry,
    );
    const before = await listOwnedTempRoots();
    const originalChmod = fsp.chmod.bind(fsp);
    let distorted = false;
    const chmodSpy = jest
      .spyOn(fsp, 'chmod')
      .mockImplementation(async (target, mode) => {
        if (
          !distorted &&
          mode === 0o600 &&
          String(target).endsWith(`${path.sep}package.json`)
        ) {
          distorted = true;
          await originalChmod(target, 0o640);
          return;
        }
        await originalChmod(target, mode);
      });

    try {
      const harness = createGitHarness(createRawTar(executableEntries), {
        treeOutput: createGitTreeOutput(executableEntries),
      });
      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: harness.gitPort,
        }),
      ).rejects.toThrow(/permissions are not normalized and private/i);
      expect(distorted).toBe(true);
      expect(await listOwnedTempRoots()).toEqual(before);
    } finally {
      chmodSpy.mockRestore();
    }
  });

  it.each([
    [
      'resolved object',
      { resolvedCommit: OTHER_COMMIT },
      /exact requested commit/i,
      1,
    ],
    [
      'archive header',
      { archiveCommit: OTHER_COMMIT },
      /exact requested commit/i,
      5,
    ],
  ])(
    'rejects a mismatched %s before extraction',
    async (_label, options, expectedError, expectedCalls) => {
      const before = await listOwnedTempRoots();
      const harness = createGitHarness(createValidArchive(), options);

      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: harness.gitPort,
        }),
      ).rejects.toThrow(expectedError);

      expect(harness.calls).toHaveLength(expectedCalls);
      expect(await listOwnedTempRoots()).toEqual(before);
    },
  );

  it.each([
    [
      'mutated blob bytes',
      () =>
        createRawTar(
          requiredArchiveEntries().map((entry) =>
            entry.path === REQUIRED_FILES[0]
              ? { ...entry, content: 'ambient export substitution\n' }
              : entry,
          ),
        ),
      createGitTreeOutput(),
      /archive bytes.*exact selected commit/i,
    ],
    [
      'extra archive file',
      () =>
        createRawTar([
          ...requiredArchiveEntries(),
          { path: 'ambient.txt', type: 'File', content: 'ambient\n' },
        ]),
      createGitTreeOutput(),
      /archive file set.*exact selected commit/i,
    ],
    [
      'changed executable mode',
      () =>
        createRawTar(
          requiredArchiveEntries().map((entry) =>
            entry.path === REQUIRED_FILES[0]
              ? { ...entry, mode: 0o755 }
              : entry,
          ),
        ),
      createGitTreeOutput(),
      /archive bytes or modes.*exact selected commit/i,
    ],
    [
      'omitted committed file',
      createValidArchive,
      createGitTreeOutput([
        ...requiredArchiveEntries(),
        { path: 'committed.txt', type: 'File', content: 'committed\n' },
      ]),
      /archive file set.*exact selected commit/i,
    ],
  ])(
    'rejects an archive with %s even when its commit header matches',
    async (_label, createArchive, treeOutput, expectedError) => {
      const before = await listOwnedTempRoots();
      const harness = createGitHarness(createArchive(), { treeOutput });

      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: harness.gitPort,
        }),
      ).rejects.toThrow(expectedError);

      expect(harness.calls).toHaveLength(5);
      expect(await listOwnedTempRoots()).toEqual(before);
    },
  );

  it.each([
    [
      'symbolic-link blob',
      Buffer.from(`120000 blob ${createGitBlobId('target')}\tescape\0`),
    ],
    [
      'submodule commit',
      Buffer.from(`160000 commit ${'c'.repeat(40)}\tvendor/module\0`),
    ],
    [
      'non-blob tree',
      Buffer.from(`040000 tree ${'c'.repeat(40)}\tdirectory\0`),
    ],
  ])(
    'rejects a selected commit containing a %s before archive creation',
    async (_label, treeOutput) => {
      const before = await listOwnedTempRoots();
      const harness = createGitHarness(createValidArchive(), { treeOutput });

      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: harness.gitPort,
        }),
      ).rejects.toThrow(/Git tree contains a non-regular entry/i);

      expect(harness.calls).toHaveLength(3);
      expect(await listOwnedTempRoots()).toEqual(before);
    },
  );

  it('rejects an object format inconsistent with the fixed commit ID and malformed tree output', async () => {
    const before = await listOwnedTempRoots();
    const formatHarness = createGitHarness(createValidArchive(), {
      objectFormat: 'sha256',
    });
    await expect(
      createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: formatHarness.gitPort,
      }),
    ).rejects.toThrow(/object format.*requested commit ID/i);
    expect(formatHarness.calls).toHaveLength(2);

    const treeHarness = createGitHarness(createValidArchive(), {
      treeOutput: Buffer.from('100644 blob malformed\tpackage.json'),
    });
    await expect(
      createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: treeHarness.gitPort,
      }),
    ).rejects.toThrow(/tree listing is malformed/i);
    expect(treeHarness.calls).toHaveLength(3);
    expect(await listOwnedTempRoots()).toEqual(before);
  });

  it.each([
    [
      'symbolic link',
      () =>
        createRawTar([
          ...requiredArchiveEntries(),
          {
            path: 'escape',
            type: 'SymbolicLink',
            linkpath: '/tmp/outside',
          },
        ]),
      /non-regular entry/i,
    ],
    [
      'non-canonical traversal',
      () =>
        createRawTar([
          ...requiredArchiveEntries(),
          { path: '../escape', type: 'File', content: 'x' },
        ]),
      /non-canonical path/i,
    ],
    [
      'duplicate path',
      () =>
        createRawTar([
          ...requiredArchiveEntries(),
          {
            path: REQUIRED_FILES[0],
            type: 'File',
            content: 'replacement',
          },
        ]),
      /duplicate path/i,
    ],
    [
      'file-under-file layout',
      () =>
        createRawTar([
          ...requiredArchiveEntries(),
          { path: 'collision', type: 'File', content: 'parent' },
          { path: 'collision/child', type: 'File', content: 'child' },
        ]),
      /beneath a regular file/i,
    ],
    [
      'oversized file',
      () =>
        createRawTar([
          ...requiredArchiveEntries(),
          {
            path: 'oversized',
            type: 'File',
            content: Buffer.alloc(
              AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_FILE_BYTES + 1,
            ),
          },
        ]),
      /file exceeds its byte limit/i,
    ],
  ])(
    'rejects a structurally unsafe %s archive without materializing it',
    async (_label, createArchive, expectedError) => {
      const before = await listOwnedTempRoots();
      const harness = createGitHarness(createArchive());

      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: harness.gitPort,
        }),
      ).rejects.toThrow(expectedError);

      expect(await listOwnedTempRoots()).toEqual(before);
    },
  );

  it('rejects oversized archive bytes and incomplete required closure', async () => {
    for (const archive of [
      Buffer.alloc(
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_SOURCE_MAX_ARCHIVE_BYTES + 1,
      ),
      createRawTar([
        { path: 'README.md', type: 'File', content: 'not the closure' },
      ]),
    ]) {
      const before = await listOwnedTempRoots();
      const harness = createGitHarness(archive);

      await expect(
        createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
          sourceCommit: SOURCE_COMMIT,
          gitPort: harness.gitPort,
        }),
      ).rejects.toThrow(/byte limit|missing required file/i);

      expect(await listOwnedTempRoots()).toEqual(before);
    }
  });

  it('captures the exact Git port once and rejects expanded authority surfaces', async () => {
    const archive = createValidArchive();
    const harness = createGitHarness(archive);
    const originalRun = harness.gitPort.run;
    const promise =
      createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: harness.gitPort,
      });
    harness.gitPort.run = async () => {
      throw new Error('replacement');
    };
    const snapshot = await promise;
    expect(harness.calls).toHaveLength(5);
    expect(originalRun).not.toBe(harness.gitPort.run);
    await snapshot.close();

    await expect(
      createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: {
          run() {},
          writeFile() {},
        },
      }),
    ).rejects.toThrow(/exact required keys/i);
    await expect(
      createAwsRetainedStorageHostPreflightSeaSourceSnapshotForTest({
        sourceCommit: SOURCE_COMMIT,
        gitPort: { run() {} },
        outputPath: '/tmp/source',
      }),
    ).rejects.toThrow(/exact required keys/i);
  });
});
