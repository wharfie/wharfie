/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';

import { createPackageCommand } from '../../../src/cli/cmds/app_cmds/package.js';
import { getPackageArtifactFileName } from '../../../src/cli/app/package-artifact-file-name.js';
import {
  APPLICATION_PACKAGE_RECEIPT_KIND,
  APPLICATION_PACKAGE_RECEIPT_SCHEMA_VERSION,
  createApplicationPackageReceipt,
} from '../../../src/cli/app/package-command-receipt.js';
import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../src/core/runtime/content-id.js';

const APP_ID = 'package-receipt-demo';
const OUTPUT_DIR = path.resolve(os.tmpdir(), 'wharfie-package-receipt-output');
const LINUX_TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const DARWIN_TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'darwin',
  architecture: 'arm64',
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string | Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} [salt] */
function makeRevision(salt = 'primary') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 3,
      app: { id: APP_ID },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        serve: {
          entrypoint: {
            kind: 'node',
            path: 'src/serve.js',
            export: 'serve',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${salt}`),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependency-lock'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
    },
  });
}

/**
 * @param {ReturnType<typeof makeRevision>} revision
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}} target
 */
function makeProvenance(revision, target) {
  return {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: clone(revision.inputs.runtime.digest),
      toolchainDigest: digest('toolchain'),
    },
    node: {
      version: target.nodeVersion,
      binary: { digest: digest(`node-${target.platform}`) },
    },
    dependencies: {
      lock: clone(revision.inputs.dependencies),
      digest: digest(`dependencies-${target.platform}`),
    },
    signing: { mode: 'unsigned' },
  };
}

/**
 * @param {ReturnType<typeof makeRevision>} revision
 * @param {{nodeVersion: string, platform: string, architecture: string, libc?: string}} target
 * @param {string} contents
 */
function makeArtifact(revision, target, contents) {
  const bytes = Buffer.from(contents, 'utf8');
  const record = createArtifactRecord({
    bytes,
    revision,
    target,
    provenance: makeProvenance(revision, target),
  });
  const fileName = getPackageArtifactFileName({
    appId: APP_ID,
    target: record.target,
    byteDigest: record.byteDigest,
  });
  const artifactPath = path.join(OUTPUT_DIR, fileName);

  return {
    fileName,
    path: artifactPath,
    recordPath: `${artifactPath}.artifact.json`,
    target: clone(record.target),
    artifactId: record.artifactId,
    revisionId: record.revisionId,
    byteDigest: clone(record.byteDigest),
    size: record.size,
    record,
  };
}

/** @returns {any} */
function makePackageResult() {
  const revision = makeRevision();
  return {
    app: { id: APP_ID },
    revision,
    targets: [clone(LINUX_TARGET), clone(DARWIN_TARGET)],
    outputDir: OUTPUT_DIR,
    artifacts: [
      makeArtifact(revision, LINUX_TARGET, 'linux executable bytes'),
      makeArtifact(revision, DARWIN_TARGET, 'darwin executable bytes'),
    ],
  };
}

/** @param {unknown} value */
function expectDeeplyFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}

describe('application package command receipt', () => {
  it('projects one exact target-sorted public handoff document', () => {
    const result = makePackageResult();
    const receipt = createApplicationPackageReceipt(result);

    expect(receipt).toEqual({
      schemaVersion: APPLICATION_PACKAGE_RECEIPT_SCHEMA_VERSION,
      kind: APPLICATION_PACKAGE_RECEIPT_KIND,
      appId: APP_ID,
      revisionId: result.revision.revisionId,
      outputDir: OUTPUT_DIR,
      artifactCount: 2,
      artifacts: [
        {
          artifactId: result.artifacts[1].artifactId,
          target: DARWIN_TARGET,
          fileName: result.artifacts[1].fileName,
          path: result.artifacts[1].path,
          recordPath: result.artifacts[1].recordPath,
          byteDigest: result.artifacts[1].byteDigest,
          size: result.artifacts[1].size,
        },
        {
          artifactId: result.artifacts[0].artifactId,
          target: LINUX_TARGET,
          fileName: result.artifacts[0].fileName,
          path: result.artifacts[0].path,
          recordPath: result.artifacts[0].recordPath,
          byteDigest: result.artifacts[0].byteDigest,
          size: result.artifacts[0].size,
        },
      ],
    });
    expect(receipt).not.toHaveProperty('app');
    expect(receipt).not.toHaveProperty('revision');
    expect(receipt).not.toHaveProperty('targets');
    expect(receipt.artifacts[0]).not.toHaveProperty('record');
    expect(receipt.artifacts[0]).not.toHaveProperty('revisionId');
  });

  it('returns an independent recursively frozen document', () => {
    const result = makePackageResult();
    const receipt = createApplicationPackageReceipt(result);
    const originalPath = receipt.artifacts[0].path;

    expectDeeplyFrozen(receipt);
    result.artifacts[1].path = '/changed-after-projection';
    result.targets[1].platform = 'linux';
    expect(receipt.artifacts[0].path).toBe(originalPath);
    expect(receipt.artifacts[0].target.platform).toBe('darwin');
  });

  it('projects repeated successful publication results identically', () => {
    expect(createApplicationPackageReceipt(makePackageResult())).toEqual(
      createApplicationPackageReceipt(makePackageResult()),
    );
  });

  it.each([
    [
      'top-level package result',
      (/** @type {Record<string, any>} */ result) => {
        result.unexpected = 'package-secret-sentinel';
      },
    ],
    [
      'application identity',
      (/** @type {Record<string, any>} */ result) => {
        result.app.unexpected = 'package-secret-sentinel';
      },
    ],
    [
      'artifact summary',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].unexpected = 'package-secret-sentinel';
      },
    ],
  ])('rejects extra keys in the %s', (_label, mutate) => {
    const result = clone(makePackageResult());
    mutate(result);

    let failure;
    try {
      createApplicationPackageReceipt(result);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(TypeError);
    expect(String(failure)).toMatch(/must contain exactly/i);
    expect(String(failure)).not.toContain('package-secret-sentinel');
  });

  it.each([
    [
      'mixed application identity',
      (/** @type {Record<string, any>} */ result) => {
        result.app.id = 'another-app';
      },
      /must match the packaged application revision/i,
    ],
    [
      'mixed revision identity',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].revisionId = makeRevision('other').revisionId;
      },
      /must belong to the packaged application revision/i,
    ],
    [
      'summary and record target disagreement',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].target.architecture = 'arm64';
      },
      /summary must match its immutable artifact record/i,
    ],
    [
      'summary and record digest disagreement',
      (/** @type {Record<string, any>} */ result) => {
        const changed = digest('changed artifact');
        result.artifacts[0].artifactId = `waf1_${changed.value}`;
        result.artifacts[0].byteDigest = changed;
      },
      /does not match its trusted inputs/i,
    ],
    [
      'summary and record size disagreement',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].size += 1;
      },
      /does not match its trusted inputs/i,
    ],
    [
      'malformed size',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].size = -1;
      },
      /nonnegative safe integer/i,
    ],
    [
      'malformed digest',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].byteDigest.algorithm = 'sha1';
      },
      /algorithm must be 'sha256'/i,
    ],
    [
      'relative output directory',
      (/** @type {Record<string, any>} */ result) => {
        result.outputDir = 'relative-output';
      },
      /normalized absolute path/i,
    ],
    [
      'noncanonical file name',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].fileName = 'latest';
      },
      /canonical content-addressed file name/i,
    ],
    [
      'artifact outside the output directory',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].path = path.resolve(
          OUTPUT_DIR,
          '..',
          'outside-artifact',
        );
      },
      /direct children of packageResult\.outputDir/i,
    ],
    [
      'sidecar path disagreement',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts[0].recordPath = `${result.artifacts[0].path}.json`;
      },
      /direct children of packageResult\.outputDir/i,
    ],
    [
      'top-level target disagreement',
      (/** @type {Record<string, any>} */ result) => {
        result.targets.pop();
      },
      /must exactly match the packaged artifact targets/i,
    ],
    [
      'duplicate target',
      (/** @type {Record<string, any>} */ result) => {
        result.targets[1] = clone(result.targets[0]);
      },
      /unique exact build targets/i,
    ],
    [
      'duplicate artifact identity',
      (/** @type {Record<string, any>} */ result) => {
        const duplicate = result.artifacts[0];
        const artifact = result.artifacts[1];
        artifact.artifactId = duplicate.artifactId;
        artifact.byteDigest = clone(duplicate.byteDigest);
        artifact.size = duplicate.size;
        artifact.record.artifactId = duplicate.artifactId;
        artifact.record.byteDigest = clone(duplicate.byteDigest);
        artifact.record.size = duplicate.size;
      },
      /unique artifact identities/i,
    ],
  ])('rejects %s', (_label, mutate, expected) => {
    const result = clone(makePackageResult());
    mutate(result);
    expect(() => createApplicationPackageReceipt(result)).toThrow(expected);
  });

  it.each([
    {
      label: 'pretty JSON',
      args: [
        'fixture-app',
        '--json',
        '--target',
        'linux-x64',
        '--target',
        'darwin-arm64',
      ],
      targetFilters: ['linux-x64', 'darwin-arm64'],
      pretty: true,
    },
    {
      label: 'compact JSON',
      args: ['fixture-app', '--no-pretty'],
      targetFilters: [],
      pretty: false,
    },
  ])('writes exactly one $label receipt from the command', async (testCase) => {
    const result = makePackageResult();
    const packageApplication = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => result,
    );
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const command = createPackageCommand({
      packageApplication,
      writeOutput,
    });

    await command.parseAsync(testCase.args, { from: 'user' });

    expect(packageApplication).toHaveBeenCalledTimes(1);
    expect(packageApplication).toHaveBeenCalledWith({
      dir: 'fixture-app',
      outputDir: undefined,
      targetFilters: testCase.targetFilters,
    });
    expect(writeOutput).toHaveBeenCalledTimes(1);
    const output = writeOutput.mock.calls[0][0];
    expect(output.endsWith('\n')).toBe(true);
    expect(JSON.parse(output)).toEqual(createApplicationPackageReceipt(result));
    expect(output.startsWith('{\n')).toBe(testCase.pretty);
    if (!testCase.pretty) {
      expect(output.slice(0, -1)).not.toContain('\n');
    }
  });
});
