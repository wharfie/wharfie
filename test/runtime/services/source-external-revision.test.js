/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../../src/core/runtime/application-revision.js';

const APP_RUNS_IMPORT = '../../../src/core/runtime/app-runs.js';
const FUNCTION_IMPORT = '../../../src/core/resources/builds/function.js';
const FUNCTION_RESOURCE_IMPORT =
  '../../../src/core/resources/builds/function-resource.js';

const externalArchive = Buffer.from('locked external archive');
/** @type {any[]} */
const functionResourceOptions = [];
/** @type {any} */
let receiptDependencyLockInput;

const esbuild = jest.fn(async () => 'prepared locked bundle');
const bundleExternals = jest.fn(async () => ({
  externalsTar: externalArchive.toString('base64'),
  receipt: {
    dependencyLockInput: receiptDependencyLockInput,
    closureDigest: digest('closure'),
    plan: {
      activity: 'work',
      target: {
        nodeVersion: process.versions.node,
        platform: process.platform,
        architecture: process.arch,
        ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
      },
      roots: [
        {
          name: 'locked-package',
          version: '1.2.3',
          location: 'node_modules/locked-package',
        },
      ],
      lock: receiptDependencyLockInput,
    },
  },
}));
const runPreparedActivityAttempt = jest.fn(
  /**
   * @param {string} _name
   * @param {any} _bundle
   * @param {any} startFrame
   * @param {any} _options
   */
  async (_name, _bundle, startFrame, _options) => ({
    status: 'completed',
    terminal: {
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'completed',
      attemptId: startFrame.attemptId,
      sequence: 1,
      result: { source: 'locked-closure' },
    },
    start: startFrame,
  }),
);

class MockFunctionResource {
  /** @param {any} options */
  constructor(options) {
    functionResourceOptions.push(options);
  }

  async esbuild() {
    return await esbuild();
  }

  async bundleExternals() {
    return await bundleExternals();
  }
}

class MockWharfieFunction {
  constructor() {}

  /**
   * @param {string} name
   * @param {any} bundle
   * @param {any} startFrame
   * @param {any} options
   */
  static async runPreparedActivityAttempt(name, bundle, startFrame, options) {
    return await runPreparedActivityAttempt(name, bundle, startFrame, options);
  }

  static async run() {
    throw new Error('embedded execution is not expected in this test');
  }
}

jest.unstable_mockModule(FUNCTION_IMPORT, () => ({
  default: MockWharfieFunction,
}));
jest.unstable_mockModule(FUNCTION_RESOURCE_IMPORT, () => ({
  default: MockFunctionResource,
}));

/** @param {string | Buffer | Uint8Array} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @returns {Record<string, any>} */
function makeManifest() {
  return {
    schemaVersion: 2,
    app: { id: 'source-external-test' },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
    activities: {
      work: {
        entrypoint: {
          kind: 'node',
          path: 'activity.js',
          export: 'work',
        },
        externalPackages: [{ name: 'locked-package', version: '1.2.3' }],
      },
    },
  };
}

function makeRevision(manifest = makeManifest()) {
  const contract = structuredClone(manifest);
  delete contract.targets;
  return createApplicationRevision({
    contract,
    inputs: {
      source: { format: SOURCE_TREE_INPUT_FORMAT, digest: digest('source') },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
}

function makePrepared(
  manifest = makeManifest(),
  revision = makeRevision(manifest),
) {
  return {
    revision,
    appDir: path.resolve('/tmp/source-external-app'),
    manifest,
    assets: {},
    dependencyLock: {
      path: path.resolve('/tmp/source-external-package-lock.json'),
      input: revision.inputs.dependencies,
    },
    verifyRuntime: async () => {},
    cleanup: async () => {},
  };
}

beforeEach(() => {
  functionResourceOptions.length = 0;
  receiptDependencyLockInput = makeRevision().inputs.dependencies;
  esbuild.mockClear();
  bundleExternals.mockClear();
  runPreparedActivityAttempt.mockClear();
});

describe('revision-backed source externals', () => {
  it('fails closed before bundling when a complete prepared execution handle is absent', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);

    await expect(
      invokeManifestActivity({
        activityName: 'work',
        input: {},
        callerMetadata: {},
        execution: { kind: 'prepared-source' },
      }),
    ).rejects.toThrow(/prepared application revision/i);

    expect(functionResourceOptions).toHaveLength(0);
  });

  it('builds only the selected activity from the sealed lock and never invokes ambient Function.fn', async () => {
    const { getHostSourceBuildTarget, invokeManifestActivity } = await import(
      APP_RUNS_IMPORT
    );
    const manifest = makeManifest();
    const revision = makeRevision(manifest);
    const prepared = makePrepared(manifest, revision);
    prepared.appDir = path.resolve('/tmp/sealed-source-external-app');
    receiptDependencyLockInput = revision.inputs.dependencies;

    await expect(
      invokeManifestActivity({
        activityName: 'work',
        input: { value: 1 },
        callerMetadata: { trace: 'source' },
        execution: { kind: 'prepared-source', prepared },
      }),
    ).resolves.toEqual({ source: 'locked-closure' });

    expect(functionResourceOptions).toHaveLength(1);
    expect(functionResourceOptions[0]).toMatchObject({
      properties: {
        functionName: 'work',
        entrypoint: {
          path: path.resolve('/tmp/sealed-source-external-app/activity.js'),
          export: 'work',
        },
        external: [{ name: 'locked-package', version: '1.2.3' }],
        buildTarget: getHostSourceBuildTarget(),
      },
      dependencyLock: prepared.dependencyLock,
    });
    expect(esbuild).toHaveBeenCalledTimes(1);
    expect(bundleExternals).toHaveBeenCalledTimes(1);
    expect(runPreparedActivityAttempt).toHaveBeenCalledWith(
      'work',
      expect.objectContaining({
        codeString: 'prepared locked bundle',
        externalsTar: externalArchive,
        externalArchiveDigest: digest(externalArchive),
      }),
      expect.objectContaining({
        revisionId: revision.revisionId,
        activityId: 'work',
        input: { value: 1 },
        caller: { metadata: { trace: 'source' } },
      }),
      {},
    );
  });

  it('forwards durable effect controls through the prepared external seam', async () => {
    const { invokeManifestActivityAttemptWithStart } = await import(
      APP_RUNS_IMPORT
    );
    const manifest = makeManifest();
    const revision = makeRevision(manifest);
    const prepared = makePrepared(manifest, revision);
    receiptDependencyLockInput = revision.inputs.dependencies;
    const startFrame = {
      protocol: 'wharfie.activity',
      protocolVersion: 1,
      type: 'start',
      revisionId: revision.revisionId,
      activityId: 'work',
      runId: 'durable-run-1',
      invocationId: 'durable-invocation-1',
      attemptId: 'durable-attempt-1',
      fencingToken: 'durable-fence-1',
      input: { value: 1 },
      caller: { metadata: { source: 'scheduler' } },
    };
    const controller = new AbortController();
    const handleEffect = () => {
      throw new Error('Effect execution is not expected in this seam test.');
    };

    await invokeManifestActivityAttemptWithStart({
      activityName: 'work',
      startFrame,
      execution: { kind: 'prepared-source', prepared },
      signal: controller.signal,
      handleEffect,
    });

    expect(runPreparedActivityAttempt).toHaveBeenCalledWith(
      'work',
      expect.objectContaining({
        codeString: 'prepared locked bundle',
        externalsTar: externalArchive,
        externalArchiveDigest: digest(externalArchive),
      }),
      expect.objectContaining({
        revisionId: revision.revisionId,
        activityId: 'work',
        attemptId: 'durable-attempt-1',
      }),
      { signal: controller.signal, handleEffect },
    );
  });

  it('rejects manifest, lock-handle, and materialization-receipt drift', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
    const manifest = makeManifest();
    const revision = makeRevision(manifest);
    const prepared = makePrepared(manifest, revision);

    const changedManifest = makeManifest();
    changedManifest.activities.work.externalPackages[0].version = '1.2.4';
    await expect(
      invokeManifestActivity({
        activityName: 'work',
        execution: {
          kind: 'prepared-source',
          prepared: { ...prepared, manifest: changedManifest },
        },
      }),
    ).rejects.toThrow(/does not match.*revision contract/i);

    const wrongLock = {
      ...prepared,
      dependencyLock: {
        path: prepared.dependencyLock.path,
        input: {
          ...prepared.dependencyLock.input,
          digest: digest('wrong-lock'),
        },
      },
    };
    await expect(
      invokeManifestActivity({
        activityName: 'work',
        execution: { kind: 'prepared-source', prepared: wrongLock },
      }),
    ).rejects.toThrow(/lock descriptor does not match/i);

    receiptDependencyLockInput = {
      format: DEPENDENCY_LOCK_INPUT_FORMAT,
      digest: digest('wrong-receipt'),
    };
    await expect(
      invokeManifestActivity({
        activityName: 'work',
        execution: { kind: 'prepared-source', prepared },
      }),
    ).rejects.toThrow(/receipt does not match/i);
    expect(runPreparedActivityAttempt).not.toHaveBeenCalled();
  });

  it('requires positive glibc detection for Linux source targets', async () => {
    const { getHostSourceBuildTarget } = await import(APP_RUNS_IMPORT);

    expect(
      getHostSourceBuildTarget({
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        glibcVersionRuntime: '2.39',
      }),
    ).toEqual({
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    });
    expect(() =>
      getHostSourceBuildTarget({
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        glibcVersionRuntime: undefined,
      }),
    ).toThrow(/positively identified glibc/i);
  });
});
