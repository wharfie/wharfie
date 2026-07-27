import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SHA256,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE,
  assertAwsRetainedStorageHostPreflightSeaLinuxCheckoutModuleForTest,
  copyAwsRetainedStorageHostPreflightSeaLinuxArtifactForTest,
  createAwsRetainedStorageHostPreflightSeaLinuxGuestVerifier,
  parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv,
  removeAwsRetainedStorageHostPreflightSeaLinuxOwnedRootForTest,
  runAwsRetainedStorageHostPreflightSeaLinuxBoundedChildForTest,
  validateAwsRetainedStorageHostPreflightSeaLinuxCheckoutIndexForTest,
  validateAwsRetainedStorageHostPreflightSeaLinuxGuestJsonFrame,
} from '../../scripts/verify-aws-host-retained-storage-host-preflight-sea-linux.js';

const SOURCE_COMMIT = 'ab'.repeat(20);
const INVOCATION_ID = 'cd'.repeat(16);
const OWNERSHIP_TOKEN = 'ef'.repeat(16);
const WORK_ROOT = `/wharfie-work/invocation-${INVOCATION_ID}`;
const INPUT = Object.freeze({
  sourceCommit: SOURCE_COMMIT,
  invocationId: INVOCATION_ID,
  gitBundlePath: '/wharfie-input/repo.bundle',
  nodeArchivePath: `${WORK_ROOT}/bootstrap/node-v24.13.1-linux-x64.tar.gz`,
  workRoot: WORK_ROOT,
  ownershipToken: OWNERSHIP_TOKEN,
});
const HOST = Object.freeze({
  platform: 'linux',
  architecture: 'x64',
  nodeVersion: '24.13.1',
  executablePath: `${WORK_ROOT}/bootstrap/node-v24.13.1-linux-x64/bin/node`,
  kernelRelease: '6.12.0-linuxkit',
  glibcVersionRuntime: '2.31',
});
const ARTIFACT_PATH = `${WORK_ROOT}/output/artifact`;
const RECORD_PATH = `${WORK_ROOT}/output/artifact.artifact.json`;
const RELOCATED_PATH = `${WORK_ROOT}/relocated/wharfie-host-preflight`;
const ARTIFACT_BYTES = Buffer.from('exact final SEA bytes', 'utf8');
const SOURCE_BYTES = Buffer.from('exact source archive', 'utf8');
const ENTRY_BUNDLE_BYTES = Buffer.from(
  'exact regenerated entry bundle',
  'utf8',
);
const GIT_BUNDLE_BYTES = Buffer.from(
  'exact no-prerequisite Git bundle transport',
  'utf8',
);
const NODE_ARCHIVE_SIZE =
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SIZE;
const STDOUT = Buffer.alloc(0);
const STDERR = Buffer.from(
  'AWS retained-storage host preflight SEA delivery failed.\n',
  'utf8',
);

/** @param {Buffer | string} value */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @param {Buffer | string} value */
function byteObservation(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return { byteDigest: digest(bytes), size: bytes.length };
}

function sourceCheckoutFixture(transport = byteObservation(GIT_BUNDLE_BYTES)) {
  return {
    basis: 'guest-clean-detached-checkout',
    checkedOutCommit: SOURCE_COMMIT,
    clean: true,
    prerequisiteCount: 0,
    transportByteDigest: transport.byteDigest,
    transportSize: transport.size,
  };
}

function recordFixture() {
  return {
    recordId: `whp1_${digest('record').value}`,
    artifactId: `waf1_${digest(ARTIFACT_BYTES).value}`,
    sourceArchive: { format: 'git-archive-tar-v1' },
    entryBundle: { format: 'esbuild-snapshot-node24-cjs-v1' },
  };
}

/** @param {unknown} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/**
 * @param {{
 *   failAt?: string,
 *   host?: Record<string, any>,
 *   ownershipConfirmed?: boolean,
 *   nodeFoundOnRuntimePath?: boolean,
 *   wrongNodeArchiveSize?: boolean,
 *   changedFinalTransport?: boolean,
 *   wrongOutcome?: boolean,
 *   oversizedOutput?: boolean,
 *   deferCleanup?: boolean,
 *   preloadExecuted?: boolean,
 * }} [options]
 */
function fixture(options = {}) {
  /** @type {Array<{name: string, input: any}>} */
  const calls = [];
  let publicationRemoved = false;
  /** @type {(() => void) | undefined} */
  let resolveCleanup;
  const cleanupGate = options.deferCleanup
    ? new Promise((resolve) => {
        resolveCleanup = () => resolve(undefined);
      })
    : null;
  const artifactId = `waf1_${digest(ARTIFACT_BYTES).value}`;
  const record = recordFixture();
  /** @param {string} name @param {any} input @param {any} [result] @returns {Promise<any>} */
  const mark = async (name, input, result) => {
    calls.push({ name, input });
    if (options.failAt === name) throw new Error(`failed ${name}`);
    return typeof result === 'function' ? await result() : result;
  };
  const deterministicV82Execution = {
    status: 1,
    stdout: STDOUT,
    stderr: STDERR,
  };
  const ports = {
    /** @param {Readonly<Record<string, any>>} input */
    confirmOwnership(input) {
      return mark(
        'confirmOwnership',
        input,
        options.ownershipConfirmed !== false,
      );
    },
    /** @param {Readonly<Record<string, any>>} input */
    prepare(input) {
      return mark('prepare', input, {
        checkoutRoot: `${WORK_ROOT}/checkout`,
        outputDirectory: `${WORK_ROOT}/output`,
        npmVersion: '11.12.0',
        sourceCheckout: sourceCheckoutFixture(),
      });
    },
    /** @param {Readonly<Record<string, any>>} input */
    observeSourceCheckout(input) {
      return mark(
        'observeSourceCheckout',
        input,
        sourceCheckoutFixture(
          options.changedFinalTransport
            ? byteObservation('changed Git bundle transport')
            : byteObservation(GIT_BUNDLE_BYTES),
        ),
      );
    },
    /** @param {Readonly<Record<string, any>>} input */
    nodeFoundOnRuntimePath(input) {
      return mark(
        'nodeFoundOnRuntimePath',
        input,
        options.nodeFoundOnRuntimePath === true,
      );
    },
    /** @param {Readonly<Record<string, any>>} input */
    observeBootstrapNodeArchive(input) {
      return mark('observeBootstrapNodeArchive', input, {
        fileName: 'node-v24.13.1-linux-x64.tar.gz',
        byteDigest: {
          algorithm: 'sha256',
          value:
            AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_LINUX_NODE_ARCHIVE_SHA256,
        },
        size: options.wrongNodeArchiveSize
          ? NODE_ARCHIVE_SIZE - 1
          : NODE_ARCHIVE_SIZE,
      });
    },
    /** @param {Readonly<Record<string, any>>} input */
    packageSea(input) {
      return mark('packageSea', input, {
        artifactPath: ARTIFACT_PATH,
        recordPath: RECORD_PATH,
      });
    },
    /** @param {Readonly<Record<string, any>>} input */
    assertRegularFile(input) {
      return mark('assertRegularFile', input, true);
    },
    /** @param {Readonly<Record<string, any>>} input */
    loadArtifactRecord(input) {
      return mark('loadArtifactRecord', input, record);
    },
    /** @param {Readonly<Record<string, any>>} input */
    observeArtifact(input) {
      return mark('observeArtifact', input, {
        artifactId,
        ...byteObservation(ARTIFACT_BYTES),
      });
    },
    /** @param {Readonly<Record<string, any>>} input */
    reproduceSourceArchive(input) {
      return mark(
        'reproduceSourceArchive',
        input,
        byteObservation(SOURCE_BYTES),
      );
    },
    /** @param {Readonly<Record<string, any>>} input */
    regenerateEntryBundle(input) {
      return mark(
        'regenerateEntryBundle',
        input,
        byteObservation(ENTRY_BUNDLE_BYTES),
      );
    },
    /** @param {Readonly<{path: string, arguments: ReadonlyArray<string>, controlledPreload: boolean}>} input */
    executeArtifact(input) {
      return mark('executeArtifact', input, () => {
        const relocated = input.path === RELOCATED_PATH;
        if (relocated && !publicationRemoved) {
          throw new Error('relocated execution preceded original removal');
        }
        if (options.oversizedOutput) {
          return {
            ...deterministicV82Execution,
            stdout: Buffer.alloc(1024 * 1024 + 1),
            ...(input.controlledPreload ? { preloadExecuted: false } : {}),
          };
        }
        return {
          ...deterministicV82Execution,
          ...(options.wrongOutcome ? { status: 0 } : {}),
          ...(input.controlledPreload
            ? { preloadExecuted: options.preloadExecuted === true }
            : {}),
        };
      });
    },
    /** @param {Readonly<Record<string, any>>} input */
    copyArtifact(input) {
      return mark('copyArtifact', input);
    },
    /** @param {Readonly<Record<string, any>>} input */
    removeOriginalPublication(input) {
      return mark('removeOriginalPublication', input, () => {
        publicationRemoved = true;
      });
    },
    /** @param {Readonly<Record<string, any>>} input */
    publicationAbsent(input) {
      return mark('publicationAbsent', input, publicationRemoved);
    },
    /** @param {Readonly<Record<string, any>>} input */
    async cleanup(input) {
      await mark('cleanup', input);
      if (cleanupGate) await cleanupGate;
    },
    /** @param {Readonly<Record<string, any>>} input */
    guestWorkAbsent(input) {
      return mark('guestWorkAbsent', input, true);
    },
  };
  return {
    calls,
    releaseCleanup() {
      resolveCleanup?.();
    },
    verifier: createAwsRetainedStorageHostPreflightSeaLinuxGuestVerifier({
      host: options.host || HOST,
      ports,
    }),
  };
}

describe('AWS retained-storage host preflight SEA Linux guest verifier', () => {
  it('orders owned packaging and observations before exact cleanup and returns a frozen guest draft', async () => {
    const value = fixture();

    const draft = await value.verifier.verify(INPUT);

    expect(value.calls.map(({ name }) => name)).toEqual([
      'confirmOwnership',
      'prepare',
      'nodeFoundOnRuntimePath',
      'observeBootstrapNodeArchive',
      'packageSea',
      'assertRegularFile',
      'assertRegularFile',
      'loadArtifactRecord',
      'observeArtifact',
      'reproduceSourceArchive',
      'regenerateEntryBundle',
      'observeSourceCheckout',
      'executeArtifact',
      'copyArtifact',
      'removeOriginalPublication',
      'publicationAbsent',
      'observeArtifact',
      'executeArtifact',
      'executeArtifact',
      'executeArtifact',
      'cleanup',
      'guestWorkAbsent',
    ]);
    expect(draft.subject).toEqual({
      sourceCommit: SOURCE_COMMIT,
      recordId: `whp1_${digest('record').value}`,
      artifactId: `waf1_${digest(ARTIFACT_BYTES).value}`,
    });
    expect(draft.builderClaims.artifactRecord).toEqual(recordFixture());
    expect(draft.independentObservations.cleanup).toEqual({
      guestWork: {
        invocationId: INVOCATION_ID,
        removed: true,
      },
    });
    expect(
      Object.hasOwn(draft.independentObservations.cleanup, 'containerAbsent'),
    ).toBe(false);
    expectDeepFrozen(draft);
  });

  it('binds both source-checkout observations to the exact Git bundle bytes', async () => {
    const value = fixture();

    const draft = await value.verifier.verify(INPUT);

    expect(draft.independentObservations.sourceCheckout).toEqual(
      sourceCheckoutFixture(),
    );
    expect(value.calls.find(({ name }) => name === 'prepare')?.input).toEqual(
      INPUT,
    );
    expect(
      value.calls.find(({ name }) => name === 'observeSourceCheckout')?.input,
    ).toEqual({
      checkoutRoot: `${WORK_ROOT}/checkout`,
      gitBundlePath: INPUT.gitBundlePath,
      sourceCommit: SOURCE_COMMIT,
      prerequisiteCount: 0,
    });

    const changed = fixture({ changedFinalTransport: true });
    await expect(changed.verifier.verify(INPUT)).rejects.toThrow(
      /source transport changed during verification/u,
    );
    expect(changed.calls.at(-2)?.name).toBe('cleanup');
    expect(changed.calls.at(-1)?.name).toBe('guestWorkAbsent');
  });

  it('removes the original and sidecar before every alternate-path execution', async () => {
    const value = fixture();

    await value.verifier.verify(INPUT);

    const removeIndex = value.calls.findIndex(
      ({ name }) => name === 'removeOriginalPublication',
    );
    const alternateExecutions = value.calls
      .map(({ name, input }, index) => ({ name, input, index }))
      .filter(
        ({ name, input }) =>
          name === 'executeArtifact' && input.path === RELOCATED_PATH,
      );
    expect(alternateExecutions).toHaveLength(3);
    expect(alternateExecutions.every(({ index }) => index > removeIndex)).toBe(
      true,
    );
    expect(
      value.calls.find(({ name }) => name === 'publicationAbsent'),
    ).toEqual({
      name: 'publicationAbsent',
      input: {
        artifactPath: ARTIFACT_PATH,
        recordPath: RECORD_PATH,
      },
    });
  });

  it('records the deterministic V82 extra-argument outcome without inventing an isolation claim', async () => {
    const value = fixture();

    const draft = await value.verifier.verify(INPUT);
    const observed = draft.independentObservations.executions.extraArgument;

    expect(observed).toEqual({
      status: 1,
      stdout: byteObservation(STDOUT),
      stderr: byteObservation(STDERR),
    });
    expect(Object.hasOwn(observed, 'argumentRejected')).toBe(false);
    expect(Object.hasOwn(observed, 'passed')).toBe(false);
  });

  it('does not clean a root before exact ownership is confirmed', async () => {
    const refused = fixture({ ownershipConfirmed: false });

    await expect(refused.verifier.verify(INPUT)).rejects.toThrow(
      /did not acquire cleanup ownership/u,
    );
    expect(refused.calls.map(({ name }) => name)).toEqual(['confirmOwnership']);

    const failed = fixture({ failAt: 'confirmOwnership' });
    await expect(failed.verifier.verify(INPUT)).rejects.toThrow(
      /failed confirmOwnership/u,
    );
    expect(failed.calls.map(({ name }) => name)).toEqual(['confirmOwnership']);
  });

  it('rejects Node found on the recorded runtime PATH and cleans only after ownership', async () => {
    const value = fixture({ nodeFoundOnRuntimePath: true });

    await expect(value.verifier.verify(INPUT)).rejects.toThrow(
      /found Node on the recorded runtime PATH/u,
    );
    expect(value.calls.map(({ name }) => name)).toEqual([
      'confirmOwnership',
      'prepare',
      'nodeFoundOnRuntimePath',
      'cleanup',
      'guestWorkAbsent',
    ]);
    expect(value.calls[2]?.input).toEqual({
      environment: {
        PATH: '/usr/bin:/bin',
        HOME: '/tmp',
        TMPDIR: '/tmp',
        LANG: 'C',
        LC_ALL: 'C',
      },
    });
  });

  it('rejects a bootstrap Node archive with the right identity but wrong byte count', async () => {
    const value = fixture({ wrongNodeArchiveSize: true });

    await expect(value.verifier.verify(INPUT)).rejects.toThrow(
      /bootstrap archive is invalid/u,
    );
    expect(value.calls.at(-2)?.name).toBe('cleanup');
    expect(value.calls.at(-1)?.name).toBe('guestWorkAbsent');
  });

  it('refuses the wrong runtime without claiming ownership or attempting cleanup', async () => {
    const value = fixture({
      host: { ...HOST, nodeVersion: '24.11.0' },
    });

    await expect(value.verifier.verify(INPUT)).rejects.toThrow(
      /requires Linux\/x64 Node 24\.13\.1 and npm 11\.12\.0/u,
    );
    expect(value.calls).toEqual([]);
  });

  it('rejects any execution result that differs from the deterministic V82 outcome', async () => {
    const value = fixture({ wrongOutcome: true });

    await expect(value.verifier.verify(INPUT)).rejects.toThrow(
      /deterministic execution matrix differs/u,
    );
    expect(value.calls.at(-2)?.name).toBe('cleanup');
    expect(value.calls.at(-1)?.name).toBe('guestWorkAbsent');
  });

  it('bounds every captured execution stream and cleans after rejection', async () => {
    const value = fixture({ oversizedOutput: true });

    await expect(value.verifier.verify(INPUT)).rejects.toThrow(
      /exceeds its output limit/u,
    );
    expect(value.calls.at(-2)?.name).toBe('cleanup');
    expect(value.calls.at(-1)?.name).toBe('guestWorkAbsent');
  });

  it.each([
    'prepare',
    'nodeFoundOnRuntimePath',
    'observeBootstrapNodeArchive',
    'packageSea',
    'assertRegularFile',
    'loadArtifactRecord',
    'observeArtifact',
    'reproduceSourceArchive',
    'regenerateEntryBundle',
    'observeSourceCheckout',
    'executeArtifact',
    'copyArtifact',
    'removeOriginalPublication',
    'publicationAbsent',
  ])('cleans the owned guest root when %s fails', async (failAt) => {
    const value = fixture({ failAt });

    await expect(value.verifier.verify(INPUT)).rejects.toThrow();

    expect(value.calls.some(({ name }) => name === 'cleanup')).toBe(true);
    expect(value.calls.at(-1)?.name).toBe('guestWorkAbsent');
  });

  it('passes exact ownership identity to cleanup and proves only the exact root absent', async () => {
    const value = fixture();

    const draft = await value.verifier.verify(INPUT);

    expect(value.calls.find(({ name }) => name === 'confirmOwnership')).toEqual(
      {
        name: 'confirmOwnership',
        input: {
          invocationId: INVOCATION_ID,
          workRoot: WORK_ROOT,
          ownershipToken: OWNERSHIP_TOKEN,
        },
      },
    );
    expect(value.calls.find(({ name }) => name === 'cleanup')).toEqual({
      name: 'cleanup',
      input: {
        invocationId: INVOCATION_ID,
        workRoot: WORK_ROOT,
        ownershipToken: OWNERSHIP_TOKEN,
      },
    });
    expect(value.calls.find(({ name }) => name === 'guestWorkAbsent')).toEqual({
      name: 'guestWorkAbsent',
      input: { workRoot: WORK_ROOT },
    });
    expect(draft.independentObservations.cleanup.guestWork).toEqual({
      invocationId: INVOCATION_ID,
      removed: true,
    });
  });

  it('does not resolve or expose a guest draft before cleanup completes', async () => {
    const value = fixture({ deferCleanup: true });
    let settled = false;
    const verification = value.verifier.verify(INPUT).finally(() => {
      settled = true;
    });

    await new Promise((resolve) => setImmediate(resolve));

    expect(value.calls.at(-1)?.name).toBe('cleanup');
    expect(settled).toBe(false);
    value.releaseCleanup();
    const draft = await verification;
    expect(draft.independentObservations.cleanup.guestWork).toEqual({
      invocationId: INVOCATION_ID,
      removed: true,
    });
  });

  it('rejects preload execution and cleanup failure without returning evidence', async () => {
    const preload = fixture({ preloadExecuted: true });
    await expect(preload.verifier.verify(INPUT)).rejects.toThrow(
      /invalid or exceeds its output limit/u,
    );
    expect(preload.calls.at(-2)?.name).toBe('cleanup');
    expect(preload.calls.at(-1)?.name).toBe('guestWorkAbsent');

    const cleanupFailure = fixture({ failAt: 'cleanup' });
    await expect(cleanupFailure.verifier.verify(INPUT)).rejects.toThrow(
      /cleanup was incomplete/u,
    );
  });

  it('parses only exact bootstrap and owned-verification invocations', () => {
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv([
        '/usr/local/bin/node',
        '/wharfie-input/verifier.js',
        '--bootstrap',
        SOURCE_COMMIT,
        INVOCATION_ID,
        INPUT.gitBundlePath,
        WORK_ROOT,
      ]),
    ).toEqual({
      mode: 'bootstrap',
      sourceCommit: SOURCE_COMMIT,
      invocationId: INVOCATION_ID,
      gitBundlePath: INPUT.gitBundlePath,
      workRoot: WORK_ROOT,
    });
    expect(
      parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv([
        HOST.executablePath,
        '/wharfie-input/verifier.js',
        '--verify-owned',
        SOURCE_COMMIT,
        INVOCATION_ID,
        INPUT.gitBundlePath,
        WORK_ROOT,
        INPUT.nodeArchivePath,
        OWNERSHIP_TOKEN,
      ]),
    ).toEqual({ mode: 'verify-owned', input: INPUT });

    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv([
        '/usr/local/bin/node',
        '/wharfie-input/verifier.js',
        '--bootstrap',
        SOURCE_COMMIT,
        INVOCATION_ID,
        '/wrong/repo.bundle',
        WORK_ROOT,
      ]),
    ).toThrow(/bootstrap invocation is invalid/u);
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv([
        '/usr/bin/node',
        '/wharfie-input/verifier.js',
        '--verify-owned',
        SOURCE_COMMIT,
        INVOCATION_ID,
        INPUT.gitBundlePath,
        WORK_ROOT,
        INPUT.nodeArchivePath,
        OWNERSHIP_TOKEN,
      ]),
    ).toThrow(/did not use the pinned Node executable/u);
    expect(() =>
      parseAwsRetainedStorageHostPreflightSeaLinuxVerifierArgv([
        HOST.executablePath,
        '/wharfie-input/verifier.js',
        '--verify-owned',
        SOURCE_COMMIT.toUpperCase(),
        INVOCATION_ID,
        INPUT.gitBundlePath,
        WORK_ROOT,
        INPUT.nodeArchivePath,
        OWNERSHIP_TOKEN,
      ]),
    ).toThrow(/identities are invalid/u);
  });

  it('accepts only one canonical newline-terminated guest JSON frame', () => {
    const frame = Buffer.from('{"a":1,"nested":{"b":2}}\n', 'utf8');

    const value =
      validateAwsRetainedStorageHostPreflightSeaLinuxGuestJsonFrame(frame);

    expect(value).toEqual({ a: 1, nested: { b: 2 } });
    expectDeepFrozen(value);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxGuestJsonFrame(
        Buffer.from('{"nested":{"b":2},"a":1}\n', 'utf8'),
      ),
    ).toThrow(/not canonical/u);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxGuestJsonFrame(
        Buffer.from('{"a":1}\n{"b":2}\n', 'utf8'),
      ),
    ).toThrow(/stdout frame is invalid/u);
  });

  it('proves a checkout module is one real regular file beneath the checkout', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-guest-module-boundary-'),
    );
    try {
      const checkoutRoot = path.join(root, 'checkout');
      const scriptsRoot = path.join(checkoutRoot, 'scripts');
      const outsidePath = path.join(root, 'outside.js');
      const modulePath = path.join(scriptsRoot, 'module.js');
      const linkPath = path.join(scriptsRoot, 'linked.js');
      await fsp.mkdir(scriptsRoot, { recursive: true, mode: 0o700 });
      await fsp.writeFile(modulePath, 'export default true;\n', {
        mode: 0o600,
      });
      await fsp.writeFile(outsidePath, 'export default false;\n', {
        mode: 0o600,
      });
      await fsp.symlink(outsidePath, linkPath);

      await expect(
        assertAwsRetainedStorageHostPreflightSeaLinuxCheckoutModuleForTest(
          checkoutRoot,
          'scripts/module.js',
        ),
      ).resolves.toBe(modulePath);
      await expect(
        assertAwsRetainedStorageHostPreflightSeaLinuxCheckoutModuleForTest(
          checkoutRoot,
          'scripts/linked.js',
        ),
      ).rejects.toThrow(/not one real regular file/u);
      await expect(
        assertAwsRetainedStorageHostPreflightSeaLinuxCheckoutModuleForTest(
          checkoutRoot,
          '../outside.js',
        ),
      ).rejects.toThrow(/module path is invalid/u);
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('rejects symlinks and gitlinks anywhere in the tracked checkout before importing modules', () => {
    const objectId = '12'.repeat(20);
    const regularIndex = Buffer.from(
      `100644 ${objectId} 0\tpackage.json\0` +
        `100755 ${objectId} 0\tscripts/tool.js\0`,
      'utf8',
    );
    expect(
      validateAwsRetainedStorageHostPreflightSeaLinuxCheckoutIndexForTest(
        regularIndex,
      ),
    ).toBe(2);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxCheckoutIndexForTest(
        Buffer.from(`120000 ${objectId} 0\tscripts/tool.js\0`, 'utf8'),
      ),
    ).toThrow(/non-regular tracked path/u);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaLinuxCheckoutIndexForTest(
        Buffer.from(`160000 ${objectId} 0\tvendor/submodule\0`, 'utf8'),
      ),
    ).toThrow(/non-regular tracked path/u);
  });

  it('refuses a relocated-artifact parent symlink and copies only beneath the owned root', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-guest-relocation-boundary-'),
    );
    try {
      const ownedRoot = path.join(root, 'owned');
      const outputRoot = path.join(ownedRoot, 'output');
      const outsideRoot = path.join(root, 'outside');
      const relocatedRoot = path.join(ownedRoot, 'relocated');
      const sourcePath = path.join(outputRoot, 'artifact');
      const destinationPath = path.join(
        relocatedRoot,
        'wharfie-host-preflight',
      );
      await Promise.all([
        fsp.mkdir(outputRoot, { recursive: true, mode: 0o700 }),
        fsp.mkdir(outsideRoot, { mode: 0o700 }),
      ]);
      await fsp.writeFile(sourcePath, ARTIFACT_BYTES, { mode: 0o700 });
      await fsp.symlink(outsideRoot, relocatedRoot);

      await expect(
        copyAwsRetainedStorageHostPreflightSeaLinuxArtifactForTest({
          sourcePath,
          destinationPath,
          ownedRoot,
        }),
      ).rejects.toThrow(/relocation directory is not a real owned directory/u);
      await expect(
        fsp.lstat(path.join(outsideRoot, 'wharfie-host-preflight')),
      ).rejects.toMatchObject({ code: 'ENOENT' });

      await fsp.unlink(relocatedRoot);
      await copyAwsRetainedStorageHostPreflightSeaLinuxArtifactForTest({
        sourcePath,
        destinationPath,
        ownedRoot,
      });
      await expect(fsp.readFile(destinationPath)).resolves.toEqual(
        ARTIFACT_BYTES,
      );
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('removes only the originally observed owned-directory device and inode', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-guest-ownership-boundary-'),
    );
    try {
      const removable = path.join(root, 'removable');
      await fsp.mkdir(removable, { mode: 0o700 });
      const removableStats = await fsp.lstat(removable, { bigint: true });
      await removeAwsRetainedStorageHostPreflightSeaLinuxOwnedRootForTest(
        removable,
        { dev: removableStats.dev, ino: removableStats.ino },
      );
      await expect(fsp.lstat(removable)).rejects.toMatchObject({
        code: 'ENOENT',
      });

      const workRoot = path.join(root, 'owned');
      const displacedRoot = path.join(root, 'displaced');
      await fsp.mkdir(workRoot, { mode: 0o700 });
      const originalStats = await fsp.lstat(workRoot, { bigint: true });
      await fsp.rename(workRoot, displacedRoot);
      await fsp.mkdir(workRoot, { mode: 0o700 });

      await expect(
        removeAwsRetainedStorageHostPreflightSeaLinuxOwnedRootForTest(
          workRoot,
          { dev: originalStats.dev, ino: originalStats.ino },
        ),
      ).rejects.toThrow(/refuses to remove an unowned root/u);
      await expect(fsp.lstat(workRoot)).resolves.toMatchObject({});
      await expect(fsp.lstat(displacedRoot)).resolves.toMatchObject({});
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('rejects within a second deadline when a killed child leaves an escaped pipe holder', async () => {
    const started = Date.now();
    const escapedPipeHolder = [
      "const {spawn}=process.getBuiltinModule('node:child_process');",
      "const child=spawn(process.execPath,['-e','setTimeout(()=>{},400)'],",
      "{detached:true,stdio:['ignore',1,2]});",
      'child.unref();',
      'setInterval(()=>{},1000);',
    ].join('');

    await expect(
      runAwsRetainedStorageHostPreflightSeaLinuxBoundedChildForTest({
        command: process.execPath,
        args: ['-e', escapedPipeHolder],
        environment: {
          PATH: process.env.PATH || '/usr/bin:/bin',
          HOME: os.tmpdir(),
          TMPDIR: os.tmpdir(),
          LANG: 'C',
          LC_ALL: 'C',
        },
        timeoutMs: 100,
        forcedTerminationReapTimeoutMs: 50,
      }),
    ).rejects.toThrow(/did not close after forced termination/u);
    expect(Date.now() - started).toBeLessThan(350);

    await new Promise((resolve) => setTimeout(resolve, 450));
  });
});
