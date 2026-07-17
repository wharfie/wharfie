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
const RUNTIME_RESOURCES_IMPORT = '../../../src/core/runtime/resources.js';

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
const runPreparedBundle = jest.fn(
  /**
   * @param {string} _name
   * @param {any} _bundle
   * @param {any} _event
   * @param {any} _context
   * @param {any} _options
   */
  async (_name, _bundle, _event, _context, _options) => ({
    source: 'locked-closure',
  }),
);
const ambientFn = jest.fn(
  /** @param {any} _event @param {any} _context @param {any} _options */
  async (_event, _context, _options) => {
    throw new Error('ambient Function.fn must not run');
  },
);
const closeFunctionResources = jest.fn(async () => {});
const closeBaseResources = jest.fn(async () => {});
const createActorSystemResources = jest.fn(async () => ({
  resources: { base: true },
  close: closeBaseResources,
}));

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

  /** @param {any} event @param {any} context @param {any} options */
  async fn(event, context, options) {
    return await ambientFn(event, context, options);
  }

  async closeRuntimeResources() {
    await closeFunctionResources();
  }

  /**
   * @param {string} name
   * @param {any} bundle
   * @param {any} event
   * @param {any} context
   * @param {any} options
   */
  static async runPreparedBundle(name, bundle, event, context, options) {
    return await runPreparedBundle(name, bundle, event, context, options);
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
jest.unstable_mockModule(RUNTIME_RESOURCES_IMPORT, () => ({
  createActorSystemResources,
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
        resources: {
          db: { adapter: 'vanilla', options: { path: 'tmp/source-test' } },
        },
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

function makeSourceRevision(revision = makeRevision()) {
  return {
    revision,
    dependencyLock: {
      path: path.resolve('/tmp/source-external-package-lock.json'),
      input: revision.inputs.dependencies,
    },
  };
}

beforeEach(() => {
  functionResourceOptions.length = 0;
  receiptDependencyLockInput = makeRevision().inputs.dependencies;
  esbuild.mockClear();
  bundleExternals.mockClear();
  runPreparedBundle.mockClear();
  ambientFn.mockClear();
  closeFunctionResources.mockClear();
  closeBaseResources.mockClear();
  createActorSystemResources.mockClear();
});

describe('revision-backed source externals', () => {
  it('fails closed before ambient resolution when sourceRevision is absent', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);

    await expect(
      invokeManifestActivity({
        manifest: makeManifest(),
        appDir: path.resolve('/tmp/source-external-app'),
        activityName: 'work',
        event: {},
        context: {},
        executionMode: 'source',
      }),
    ).rejects.toThrow(/requires a prepared sourceRevision/i);

    expect(functionResourceOptions).toHaveLength(0);
    expect(ambientFn).not.toHaveBeenCalled();
    expect(createActorSystemResources).not.toHaveBeenCalled();
  });

  it('builds only the selected activity from the sealed lock and never invokes ambient Function.fn', async () => {
    const { getHostSourceBuildTarget, invokeManifestActivity } = await import(
      APP_RUNS_IMPORT
    );
    const manifest = makeManifest();
    const revision = makeRevision(manifest);
    const sourceRevision = makeSourceRevision(revision);
    receiptDependencyLockInput = revision.inputs.dependencies;

    await expect(
      invokeManifestActivity({
        manifest,
        appDir: path.resolve('/tmp/sealed-source-external-app'),
        sourceRevision,
        activityName: 'work',
        event: { value: 1 },
        context: { trace: 'source' },
        executionMode: 'source',
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
      dependencyLock: sourceRevision.dependencyLock,
    });
    expect(esbuild).toHaveBeenCalledTimes(1);
    expect(bundleExternals).toHaveBeenCalledTimes(1);
    expect(ambientFn).not.toHaveBeenCalled();
    expect(runPreparedBundle).toHaveBeenCalledWith(
      'work',
      expect.objectContaining({
        codeString: 'prepared locked bundle',
        externalsTar: externalArchive,
        externalArchiveDigest: digest(externalArchive),
        resourceSpecs: manifest.activities.work.resources,
      }),
      { value: 1 },
      { trace: 'source' },
      { resources: { base: true } },
    );
    expect(closeBaseResources).toHaveBeenCalledTimes(1);
  });

  it('rejects manifest, lock-handle, and materialization-receipt drift', async () => {
    const { invokeManifestActivity } = await import(APP_RUNS_IMPORT);
    const manifest = makeManifest();
    const revision = makeRevision(manifest);
    const sourceRevision = makeSourceRevision(revision);

    const changedManifest = makeManifest();
    changedManifest.activities.work.externalPackages[0].version = '1.2.4';
    await expect(
      invokeManifestActivity({
        manifest: changedManifest,
        appDir: path.resolve('/tmp/source-external-app'),
        sourceRevision,
        activityName: 'work',
        executionMode: 'source',
      }),
    ).rejects.toThrow(/does not match.*revision contract/i);

    const wrongLock = {
      revision,
      dependencyLock: {
        path: sourceRevision.dependencyLock.path,
        input: {
          ...sourceRevision.dependencyLock.input,
          digest: digest('wrong-lock'),
        },
      },
    };
    await expect(
      invokeManifestActivity({
        manifest,
        appDir: path.resolve('/tmp/source-external-app'),
        sourceRevision: wrongLock,
        activityName: 'work',
        executionMode: 'source',
      }),
    ).rejects.toThrow(/lock descriptor does not match/i);

    receiptDependencyLockInput = {
      format: DEPENDENCY_LOCK_INPUT_FORMAT,
      digest: digest('wrong-receipt'),
    };
    await expect(
      invokeManifestActivity({
        manifest,
        appDir: path.resolve('/tmp/source-external-app'),
        sourceRevision,
        activityName: 'work',
        executionMode: 'source',
      }),
    ).rejects.toThrow(/receipt does not match/i);
    expect(runPreparedBundle).not.toHaveBeenCalled();
    expect(closeBaseResources).toHaveBeenCalledTimes(1);
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
