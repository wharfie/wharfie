/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import {
  createForegroundCancellation as createSourceForegroundCancellation,
  createSourceDurableRunCommand,
} from '../../src/cli/cmds/ops_cmds/run.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import { createProgram as createPackagedOperatorProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import { createPackagedDurableRunCommand } from '../../src/core/resources/builds/actor-system-cli/control_cmds/run.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import {
  createDurableRunCommand,
  createForegroundCancellation,
} from '../../src/core/runtime/operator/durable-run-command.js';
import { createManualLedgerRunId } from '../../src/core/runtime/manual-ledger-run.js';

const sourceRunCommand = createSourceDurableRunCommand();

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string} value - Fixture digest input. */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @returns {import('../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} - Valid embedded execution fixture. */
function makeEmbeddedExecution() {
  const contract = {
    schemaVersion: 4,
    app: { id: 'packaged-run-demo' },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
    activities: {
      greet: {
        entrypoint: {
          kind: 'node',
          path: 'activities/greet.js',
          export: 'greet',
        },
      },
    },
  };
  const revision = createApplicationRevision({
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
  return {
    kind: 'embedded',
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: contract.app.id,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  };
}

describe('shared durable run command', () => {
  it('keeps source-only directory selection off the packaged surface', () => {
    expect(sourceRunCommand.helpInformation()).toContain('--dir <dir>');
    expect(sourceRunCommand.helpInformation()).toContain('--json');
    expect(createSourceForegroundCancellation).toBe(
      createForegroundCancellation,
    );

    const packaged = createPackagedDurableRunCommand({
      loadExecution: async () => ({ execution: makeEmbeddedExecution() }),
    });
    const help = packaged.helpInformation();
    expect(help).toContain('--activity <activityName>');
    expect(help).toContain('--idempotency-key <idempotencyKey>');
    expect(help).toContain('--caller-metadata <json>');
    expect(help).toContain('--json');
    expect(help).not.toContain('--dir');

    const program = createPackagedOperatorProgram({
      resolveExpectedIdentity: async () => ({
        appId: 'packaged-run-demo',
      }),
      loadDurableRunExecution: async () => ({
        execution: makeEmbeddedExecution(),
      }),
    });
    const mountedRun = program.commands.find(
      (candidate) => candidate.name() === 'run',
    );
    expect(program.helpInformation()).toMatch(/\brun\b/);
    expect(mountedRun?.helpInformation()).not.toContain('--dir');
  });

  it('runs an embedded identity with packaged authority and redacted JSON', async () => {
    const execution = makeEmbeddedExecution();
    if (execution.kind !== 'embedded') {
      throw new Error('Expected embedded execution fixture.');
    }
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'stable-packaged-request';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const cleanup = jest.fn(async () => undefined);
    const loadExecution = jest.fn(async () => ({ execution, cleanup }));
    const runActivity = jest.fn(
      async (
        /** @type {Parameters<typeof import('../../src/core/runtime/durable-activity-host.js').runLocalDurableManifestActivity>[0]} */ _request,
      ) => ({
        appId,
        revisionId,
        activityName: 'greet',
        idempotencyKey,
        runId,
        outcome: {
          disposition: 'completed',
          reused: false,
          run: {
            runId,
            appId,
            revisionId,
            trigger: { kind: 'manual' },
            status: 'COMPLETED',
          },
          invocation: {
            runId,
            appId,
            revisionId,
            invocationId: 'manual',
            activityId: 'greet',
            generation: 1,
            status: 'COMPLETED',
          },
          attempt: {
            runId,
            appId,
            revisionId,
            invocationId: 'manual',
            activityId: 'greet',
            generation: 1,
            status: 'COMPLETED',
          },
        },
      }),
    );
    const output = {
      json: jest.fn(),
      table: jest.fn(),
      info: jest.fn(),
      success: jest.fn(),
      failure: jest.fn(),
    };
    const processRef = Object.assign(new EventEmitter(), {
      exitCode: undefined,
    });
    const command = createDurableRunCommand({
      loadExecution,
      runActivity,
      output,
      processRef,
    });

    await command.parseAsync([
      'node',
      'artifact',
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
      '--input',
      '{"name":"Ada"}',
      '--caller-metadata',
      '{"requestId":"request-1"}',
      '--json',
    ]);

    expect(loadExecution).toHaveBeenCalledTimes(1);
    expect(runActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        execution,
        activityName: 'greet',
        idempotencyKey,
        input: { name: 'Ada' },
        callerMetadata: { requestId: 'request-1' },
        signal: expect.any(AbortSignal),
        actor: { kind: 'packaged-operator', id: revisionId },
      }),
    );
    expect(output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-run',
      appId,
      runId,
      revisionId,
      activityId: 'greet',
      idempotencyKey,
      disposition: 'completed',
      reused: false,
      runStatus: 'COMPLETED',
      invocationStatus: 'COMPLETED',
      attempt: { generation: 1, status: 'COMPLETED' },
    });
    const receipt = /** @type {Record<string, any>} */ (
      output.json.mock.calls[0][0]
    );
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.attempt)).toBe(true);
    expect(output.info).not.toHaveBeenCalled();
    expect(output.table).not.toHaveBeenCalled();
    expect(output.success).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.listenerCount('SIGINT')).toBe(0);
    expect(processRef.listenerCount('SIGTERM')).toBe(0);
    expect(processRef.exitCode).toBeUndefined();
  });

  it('emits the exact same JSON receipt from source and packaged hosts', async () => {
    const execution = makeEmbeddedExecution();
    if (execution.kind !== 'embedded') {
      throw new Error('Expected embedded execution fixture.');
    }
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'source-packaged-parity';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const result = {
      appId,
      revisionId,
      activityName: 'greet',
      idempotencyKey,
      runId,
      outcome: {
        disposition: 'completed',
        reused: true,
        run: {
          runId,
          appId,
          revisionId,
          trigger: { kind: 'manual' },
          status: 'COMPLETED',
        },
        invocation: {
          runId,
          appId,
          revisionId,
          invocationId: 'manual',
          activityId: 'greet',
          generation: 2,
          status: 'COMPLETED',
        },
        attempt: {
          runId,
          appId,
          revisionId,
          invocationId: 'manual',
          activityId: 'greet',
          attemptId: 'private-attempt-id',
          fencingToken: 'private-fence',
          generation: 2,
          status: 'COMPLETED',
        },
        terminalSummary: { private: 'terminal-secret' },
        evidenceRef: { private: 'evidence-secret' },
      },
    };
    const sourceJson = jest.fn();
    const packagedJson = jest.fn();
    const source = createDurableRunCommand({
      includeDirOption: true,
      loadExecution: async () => ({ execution }),
      runActivity: async () => result,
      output: { json: sourceJson },
      processRef: Object.assign(new EventEmitter(), {
        exitCode: undefined,
        cwd: () => '/source',
      }),
    });
    const packaged = createPackagedDurableRunCommand({
      loadExecution: async () => ({ execution }),
      runActivity: async () => result,
      output: { json: packagedJson },
      processRef: Object.assign(new EventEmitter(), {
        exitCode: undefined,
      }),
    });

    await source.parseAsync([
      'node',
      'wharfie',
      '--dir',
      '/source',
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
      '--json',
    ]);
    await packaged.parseAsync([
      'node',
      'artifact',
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
      '--json',
    ]);

    expect(sourceJson).toHaveBeenCalledTimes(1);
    expect(packagedJson).toHaveBeenCalledTimes(1);
    expect(sourceJson.mock.calls[0][0]).toEqual(packagedJson.mock.calls[0][0]);
    expect(sourceJson.mock.calls[0][0]).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-run',
      appId,
      runId,
      revisionId,
      activityId: 'greet',
      idempotencyKey,
      disposition: 'completed',
      reused: true,
      runStatus: 'COMPLETED',
      invocationStatus: 'COMPLETED',
      attempt: { generation: 2, status: 'COMPLETED' },
    });
    expect(JSON.stringify(sourceJson.mock.calls[0][0])).not.toMatch(
      /private-attempt-id|private-fence|terminal-secret|evidence-secret/,
    );
  });

  it('emits a valid blocked receipt before reporting the non-completed run', async () => {
    const execution = makeEmbeddedExecution();
    if (execution.kind !== 'embedded') {
      throw new Error('Expected embedded execution fixture.');
    }
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'blocked-receipt';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const json = jest.fn();
    const failure = jest.fn();
    const processRef = Object.assign(new EventEmitter(), {
      exitCode: undefined,
    });
    const command = createDurableRunCommand({
      loadExecution: async () => ({ execution }),
      runActivity: async () => ({
        appId,
        revisionId,
        activityName: 'greet',
        idempotencyKey,
        runId,
        outcome: {
          disposition: 'blocked',
          reused: true,
          run: {
            runId,
            appId,
            revisionId,
            trigger: { kind: 'manual' },
            status: 'BLOCKED',
          },
          invocation: {
            runId,
            appId,
            revisionId,
            invocationId: 'manual',
            activityId: 'greet',
            generation: 3,
            status: 'UNCERTAIN',
          },
          attempt: {
            runId,
            appId,
            revisionId,
            invocationId: 'manual',
            activityId: 'greet',
            attemptId: 'private-blocked-attempt',
            generation: 3,
            status: 'ABANDONED',
          },
          evidenceRef: { private: 'blocked-evidence' },
        },
      }),
      output: { json, failure },
      processRef,
    });

    await command.parseAsync([
      'node',
      'artifact',
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
      '--json',
    ]);

    expect(json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-run',
      appId,
      runId,
      revisionId,
      activityId: 'greet',
      idempotencyKey,
      disposition: 'blocked',
      reused: true,
      runStatus: 'BLOCKED',
      invocationStatus: 'UNCERTAIN',
      attempt: { generation: 3, status: 'ABANDONED' },
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toMatch(
      /private-blocked-attempt|blocked-evidence/,
    );
    expect(failure).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBe(1);
  });

  it('rejects a mismatched returned identity before emitting JSON', async () => {
    const execution = makeEmbeddedExecution();
    if (execution.kind !== 'embedded') {
      throw new Error('Expected embedded execution fixture.');
    }
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'identity-mismatch';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const json = jest.fn();
    const failure = jest.fn();
    const processRef = Object.assign(new EventEmitter(), {
      exitCode: undefined,
    });
    const command = createDurableRunCommand({
      loadExecution: async () => ({ execution }),
      runActivity: async () => ({
        appId,
        revisionId,
        activityName: 'greet',
        idempotencyKey,
        runId: 'wlm_wrong-run',
        outcome: {
          disposition: 'completed',
          reused: false,
          run: {
            runId,
            appId,
            revisionId,
            trigger: { kind: 'manual' },
            status: 'COMPLETED',
          },
          invocation: {
            runId,
            appId,
            revisionId,
            invocationId: 'manual',
            activityId: 'greet',
            generation: 1,
            status: 'COMPLETED',
          },
          attempt: {
            runId,
            appId,
            revisionId,
            invocationId: 'manual',
            activityId: 'greet',
            generation: 1,
            status: 'COMPLETED',
          },
        },
      }),
      output: { json, failure },
      processRef,
    });

    await command.parseAsync([
      'node',
      'artifact',
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
      '--json',
    ]);

    expect(json).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBe(1);
  });

  it.each([
    ['input', '--input', 'private-input-secret{', 'Invalid input JSON.'],
    [
      'caller metadata',
      '--caller-metadata',
      'private-metadata-secret{',
      'Invalid caller metadata JSON.',
    ],
  ])(
    'does not echo malformed %s JSON',
    async (_label, flag, secret, expectedMessage) => {
      const execution = makeEmbeddedExecution();
      const json = jest.fn();
      const failure = jest.fn();
      const loadExecution = jest.fn(async () => ({ execution }));
      const processRef = Object.assign(new EventEmitter(), {
        exitCode: undefined,
      });
      const command = createDurableRunCommand({
        loadExecution,
        output: { json, failure },
        processRef,
      });

      await command.parseAsync([
        'node',
        'artifact',
        '--activity',
        'greet',
        flag,
        secret,
        '--json',
      ]);

      expect(loadExecution).not.toHaveBeenCalled();
      expect(json).not.toHaveBeenCalled();
      expect(failure).toHaveBeenCalledTimes(1);
      const reported = failure.mock.calls[0][0];
      expect(reported).toBeInstanceOf(Error);
      expect(/** @type {Error} */ (reported).message).toBe(expectedMessage);
      expect(String(reported)).not.toContain(secret);
      expect(processRef.exitCode).toBe(1);
    },
  );

  it('creates a random manual key and always cleans up after host failure', async () => {
    const execution = makeEmbeddedExecution();
    const cleanup = jest.fn(async () => undefined);
    const runActivity = jest.fn(
      async (
        /** @type {Parameters<typeof import('../../src/core/runtime/durable-activity-host.js').runLocalDurableManifestActivity>[0]} */ _request,
      ) => {
        throw new Error('host failed');
      },
    );
    const failure = jest.fn();
    const processRef = Object.assign(new EventEmitter(), {
      exitCode: undefined,
    });
    const command = createDurableRunCommand({
      loadExecution: async () => ({ execution, cleanup }),
      runActivity,
      output: { failure, info: jest.fn() },
      processRef,
    });

    await command.parseAsync(['node', 'artifact', '--activity', 'greet']);

    expect(runActivity).toHaveBeenCalledTimes(1);
    expect(runActivity.mock.calls[0]?.[0].idempotencyKey).toMatch(
      /^manual-[0-9a-f-]{36}$/,
    );
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(failure).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'host failed' }),
    );
    expect(processRef.exitCode).toBe(1);
  });
});
