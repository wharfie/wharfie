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
  parseApplicationPackageReceiptOutput,
  validateApplicationPackageReceipt,
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
const WINDOWS_TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'win32',
  architecture: 'x64',
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @param {string | Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/**
 * @param {string} [salt]
 * @param {boolean} [durable]
 */
function makeRevision(salt = 'primary', durable = false) {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: APP_ID },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
        ...(durable
          ? {
              durable: {
                workflow: 'serve-once',
                export: 'toDurableInput',
              },
            }
          : {}),
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
      ...(durable
        ? {
            workflows: {
              'serve-once': {
                steps: [
                  {
                    id: 'serve',
                    kind: 'activity',
                    activity: 'serve',
                    input: { kind: 'workflow-input' },
                  },
                ],
              },
            },
          }
        : {}),
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
 * @param {string} [outputDir]
 */
function makeArtifact(revision, target, contents, outputDir = OUTPUT_DIR) {
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
  const artifactPath = path.join(outputDir, fileName);

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

/**
 * @param {boolean} [durable]
 * @param {string} [outputDir]
 * @returns {any}
 */
function makePackageResult(durable = false, outputDir = OUTPUT_DIR) {
  const revision = makeRevision('primary', durable);
  return {
    app: { id: APP_ID },
    revision,
    targets: [clone(LINUX_TARGET), clone(DARWIN_TARGET)],
    outputDir,
    artifacts: [
      makeArtifact(revision, LINUX_TARGET, 'linux executable bytes', outputDir),
      makeArtifact(
        revision,
        DARWIN_TARGET,
        'darwin executable bytes',
        outputDir,
      ),
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

  it('validates an independent recursively frozen public receipt', () => {
    const input = clone(createApplicationPackageReceipt(makePackageResult()));
    const receipt = validateApplicationPackageReceipt(input);
    const originalPath = receipt.artifacts[0].path;

    expect(receipt).toEqual(input);
    expect(receipt).not.toBe(input);
    expectDeeplyFrozen(receipt);
    input.artifacts[0].path = '/changed-after-validation';
    expect(receipt.artifacts[0].path).toBe(originalPath);
  });

  it('parses the complete one-document stdout contract', () => {
    const receipt = createApplicationPackageReceipt(makePackageResult());
    expect(
      parseApplicationPackageReceiptOutput(`\n${JSON.stringify(receipt)}\n`),
    ).toEqual(receipt);
    expect(() =>
      parseApplicationPackageReceiptOutput(
        `diagnostic\n${JSON.stringify(receipt)}\n`,
      ),
    ).toThrow(/exactly one JSON document/i);
    expect(() =>
      parseApplicationPackageReceiptOutput(
        `${JSON.stringify(receipt)}\n${JSON.stringify(receipt)}\n`,
      ),
    ).toThrow(/exactly one JSON document/i);
  });

  it.each([
    [
      'extra top-level fields',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.revision = makeRevision();
      },
      /must contain exactly/i,
    ],
    [
      'extra artifact fields',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifacts[0].record = makePackageResult().artifacts[0].record;
      },
      /must contain exactly/i,
    ],
    [
      'wrong document kind',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.kind = 'wharfie.application.package.other';
      },
      /kind must be/i,
    ],
    [
      'wrong schema version',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.schemaVersion = 2;
      },
      /schemaVersion must be the integer 1/i,
    ],
    [
      'count disagreement',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifactCount -= 1;
      },
      /exactly artifactCount entries/i,
    ],
    [
      'artifact identity and digest disagreement',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifacts[0].artifactId = receipt.artifacts[1].artifactId;
      },
      /must name its exact byteDigest/i,
    ],
    [
      'noncanonical target order',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifacts.reverse();
      },
      /sorted by canonical target identity/i,
    ],
    [
      'duplicate target',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifacts[1].target = clone(receipt.artifacts[0].target);
      },
      /one artifact per exact target/i,
    ],
    [
      'noncanonical file name',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifacts[0].fileName = 'latest';
      },
      /canonical content-addressed file name/i,
    ],
    [
      'noncanonical artifact path',
      (/** @type {Record<string, any>} */ receipt) => {
        receipt.artifacts[0].path = path.join(OUTPUT_DIR, 'latest');
      },
      /direct children/i,
    ],
  ])('public validator rejects %s', (_label, mutate, expected) => {
    const receipt = clone(createApplicationPackageReceipt(makePackageResult()));
    mutate(receipt);
    expect(() => validateApplicationPackageReceipt(receipt)).toThrow(expected);
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
      args: ['fixture-app', '--json', '--no-pretty'],
      targetFilters: [],
      pretty: false,
    },
    {
      label: 'backward-compatible compact JSON from bare --no-pretty',
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
    const readHostTarget = jest.fn(() => {
      throw new Error('JSON output must not inspect the command host.');
    });
    const command = createPackageCommand({
      packageApplication,
      writeOutput,
      readHostTarget,
    });

    await command.parseAsync(testCase.args, { from: 'user' });

    expect(packageApplication).toHaveBeenCalledTimes(1);
    expect(packageApplication).toHaveBeenCalledWith({
      dir: 'fixture-app',
      outputDir: undefined,
      targetFilters: testCase.targetFilters,
    });
    expect(writeOutput).toHaveBeenCalledTimes(1);
    expect(readHostTarget).not.toHaveBeenCalled();
    const output = writeOutput.mock.calls[0][0];
    expect(output.endsWith('\n')).toBe(true);
    expect(JSON.parse(output)).toEqual(createApplicationPackageReceipt(result));
    expect(output.startsWith('{\n')).toBe(testCase.pretty);
    if (!testCase.pretty) {
      expect(output.slice(0, -1)).not.toContain('\n');
    }
  });
  it('writes a concise human summary and durable next command by default', async () => {
    const result = makePackageResult(true);
    const packageApplication = jest.fn(
      async (/** @type {Record<string, any>} */ options) => {
        options.onProgress({
          phase: 'build',
          message: 'Building executable artifacts',
        });
        return result;
      },
    );
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const writeDiagnostic = jest.fn(
      (/** @type {string} */ _value) => undefined,
    );
    const command = createPackageCommand({
      packageApplication,
      writeOutput,
      writeDiagnostic,
      readHostTarget: () => ({ ...LINUX_TARGET, nodeVersion: '99.0.0' }),
    });

    await command.parseAsync(['fixture-app'], { from: 'user' });

    expect(packageApplication).toHaveBeenCalledWith({
      dir: 'fixture-app',
      outputDir: undefined,
      targetFilters: [],
      onProgress: expect.any(Function),
    });
    expect(writeDiagnostic).toHaveBeenCalledWith(
      '  Building executable artifacts\n',
    );
    expect(writeOutput).toHaveBeenCalledTimes(1);
    const output = writeOutput.mock.calls[0][0];
    expect(output).toContain(`✓ Packaged ${APP_ID} (2 artifacts)\n`);
    expect(output).toContain('node24.13.1-linux-x64-glibc');
    expect(output).toContain('node24.13.1-darwin-arm64');
    expect(output).toContain(OUTPUT_DIR);
    expect(output).toMatch(/Next: .* wharfie run --name first-run --\n$/);
    expect(() => JSON.parse(output)).toThrow();
  });

  it('hands a non-durable app directly to its packaged artifact', async () => {
    const result = makePackageResult();
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const command = createPackageCommand({
      packageApplication: async () => result,
      writeOutput,
      readHostTarget: () => ({ ...LINUX_TARGET, nodeVersion: '99.0.0' }),
    });

    await command.parseAsync(['fixture-app'], { from: 'user' });

    const output = writeOutput.mock.calls[0][0];
    const nextLine = output
      .split(String.fromCharCode(10))
      .find((line) => line.startsWith('Next:'));
    expect(nextLine).toBe('Next: ' + result.artifacts[0].path);
    expect(nextLine).not.toContain(' wharfie ');
  });

  it('keeps printable artifact paths as copy-pasteable shell commands', async () => {
    const outputDir = path.join(os.tmpdir(), "wharfie package joe's");
    const result = makePackageResult(true, outputDir);
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const command = createPackageCommand({
      packageApplication: async () => result,
      writeOutput,
      readHostTarget: () => ({ ...LINUX_TARGET, nodeVersion: '99.0.0' }),
    });

    await command.parseAsync(['fixture-app'], { from: 'user' });

    const output = writeOutput.mock.calls[0][0];
    const nextLine = output
      .split(String.fromCharCode(10))
      .find((line) => line.startsWith('Next:'));
    const shellApostrophe = "'" + String.fromCharCode(92) + "''";
    const expectedPath =
      "'" + result.artifacts[0].path.replaceAll("'", shellApostrophe) + "'";
    expect(nextLine).toBe(
      'Next: ' + expectedPath + ' wharfie run --name first-run --',
    );
  });

  it('renders control-bearing paths inert and omits a false shell command', async () => {
    const escape = String.fromCharCode(0x1b);
    const lineFeed = String.fromCharCode(10);
    const bidiOverride = String.fromCharCode(0x202e);
    const outputDir = path.join(
      os.tmpdir(),
      'wharfie-package-' + escape + '[31m-' + lineFeed + '-' + bidiOverride,
    );
    const result = makePackageResult(true, outputDir);
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const command = createPackageCommand({
      packageApplication: async () => result,
      writeOutput,
      readHostTarget: () => ({ ...LINUX_TARGET, nodeVersion: '99.0.0' }),
    });

    await command.parseAsync(['fixture-app'], { from: 'user' });

    const output = writeOutput.mock.calls[0][0];
    const slash = String.fromCharCode(92);
    expect(output).not.toContain(escape);
    expect(output).not.toContain(bidiOverride);
    expect(output).toContain(slash + 'u001b');
    expect(output).toContain(slash + 'n');
    expect(output).toContain(slash + 'u202e');
    expect(output).toContain('path (JSON): "');
    expect(output.split(lineFeed)).toHaveLength(7);

    const nextLine = output
      .split(lineFeed)
      .find((line) => line.startsWith('Next:'));
    expect(nextLine).toContain('shell command omitted');
    expect(nextLine).toContain('--json');
    expect(nextLine).not.toContain('wharfie run');
  });

  it('does not render POSIX quoting as a Windows shell command', async () => {
    const revision = makeRevision();
    const outputDir = path.join(os.tmpdir(), 'Wharfie Windows Package');
    const artifact = makeArtifact(
      revision,
      WINDOWS_TARGET,
      'windows executable bytes',
      outputDir,
    );
    const result = {
      app: { id: APP_ID },
      revision,
      targets: [clone(WINDOWS_TARGET)],
      outputDir,
      artifacts: [artifact],
    };
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const command = createPackageCommand({
      packageApplication: async () => result,
      writeOutput,
      readHostTarget: () => ({
        ...WINDOWS_TARGET,
        nodeVersion: '99.0.0',
      }),
    });

    await command.parseAsync(['fixture-app'], { from: 'user' });

    const output = writeOutput.mock.calls[0][0];
    expect(output).toContain(artifact.path);
    expect(output).toContain(
      'Next: invoke the artifact shown above from your Windows shell;',
    );
    expect(output).toContain('cmd.exe and PowerShell');
    expect(output).not.toContain(`Next: '${artifact.path}'`);
  });
  it('selects self-deployable packaging without changing the public receipt', async () => {
    const result = makePackageResult();
    const packageApplication = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => result,
    );
    const packageSelfDeployableApplication = jest.fn(
      async (/** @type {Record<string, any>} */ _options) => ({
        ...result,
        deploymentPayload: {
          kind: 'singleNodeDeploymentPayload',
          payloadId: 'private-payload-authority',
        },
      }),
    );
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const command = createPackageCommand({
      packageApplication,
      packageSelfDeployableApplication,
      writeOutput,
    });

    await command.parseAsync(
      [
        'fixture-app',
        '--self-deployable',
        '--json',
        '--target',
        'darwin-arm64',
        '--no-pretty',
      ],
      { from: 'user' },
    );

    expect(packageApplication).not.toHaveBeenCalled();
    expect(packageSelfDeployableApplication).toHaveBeenCalledTimes(1);
    expect(packageSelfDeployableApplication).toHaveBeenCalledWith({
      dir: 'fixture-app',
      outputDir: undefined,
      targetFilters: ['darwin-arm64'],
    });
    expect(JSON.parse(writeOutput.mock.calls[0][0])).toEqual(
      createApplicationPackageReceipt(result),
    );
    expect(writeOutput.mock.calls[0][0]).not.toContain(
      'private-payload-authority',
    );
  });

  it('keeps human progress and the host-safe handoff for self-deployable packaging', async () => {
    const result = makePackageResult(true);
    const packageApplication = jest.fn(async () => result);
    const packageSelfDeployableApplication = jest.fn(
      async (/** @type {Record<string, any>} */ options) => {
        options.onProgress({
          phase: 'build',
          message: 'Building self-deployable executable artifacts',
        });
        return {
          ...result,
          deploymentPayload: {
            kind: 'singleNodeDeploymentPayload',
            payloadId: 'private-payload-authority',
          },
        };
      },
    );
    const writeOutput = jest.fn((/** @type {string} */ _value) => undefined);
    const writeDiagnostic = jest.fn(
      (/** @type {string} */ _value) => undefined,
    );
    const command = createPackageCommand({
      packageApplication,
      packageSelfDeployableApplication,
      writeOutput,
      writeDiagnostic,
      readHostTarget: () => ({ ...LINUX_TARGET, nodeVersion: '99.0.0' }),
    });

    await command.parseAsync(['fixture-app', '--self-deployable'], {
      from: 'user',
    });

    expect(packageApplication).not.toHaveBeenCalled();
    expect(packageSelfDeployableApplication).toHaveBeenCalledWith({
      dir: 'fixture-app',
      outputDir: undefined,
      targetFilters: [],
      onProgress: expect.any(Function),
    });
    expect(writeDiagnostic).toHaveBeenCalledWith(
      '  Building self-deployable executable artifacts\n',
    );
    const output = writeOutput.mock.calls[0][0];
    expect(output).toMatch(/Next: .* wharfie run --name first-run --\n$/);
    expect(output).not.toContain('private-payload-authority');
  });
});
