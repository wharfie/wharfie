/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { createSourceOpsCommand } from '../../src/cli/cmds/ops.js';
import { createProgram as createPackagedOperatorProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import { createPackagedDurableSubmitCommand } from '../../src/core/resources/builds/actor-system-cli/control_cmds/submit.js';
import { createPackagedDurableWorkerCommand } from '../../src/core/resources/builds/actor-system-cli/control_cmds/worker.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import { createDurableSubmitCommand } from '../../src/core/runtime/operator/durable-submit-command.js';
import { createDurableWorkerCommand } from '../../src/core/runtime/operator/durable-worker-command.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import { createManualLedgerRunId } from '../../src/core/runtime/manual-ledger-run.js';

const sourceOps = createSourceOpsCommand();

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/**
 * @param {string} value - Digest source bytes.
 * @returns {import('../../src/core/runtime/application-revision.js').Sha256Digest} - Test SHA-256 digest.
 */
function digest(value) {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @returns {Extract<import('../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution, {kind: 'embedded'}>} - Valid embedded test execution.
 */
function makeEmbeddedExecution() {
  const contract = {
    schemaVersion: 3,
    app: { id: 'resident-command-demo' },
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

/**
 * @param {import('commander').Command | undefined} command - Optional command under test.
 * @returns {string[]} - Declared option flags.
 */
function flags(command) {
  return command?.options.map((option) => option.flags) || [];
}

describe('resident activity operator commands', () => {
  it('mounts matching source and packaged submit/worker surfaces with --dir only in source', () => {
    const packaged = createPackagedOperatorProgram({
      resolveExpectedIdentity: async () => ({
        appId: 'resident-command-demo',
      }),
      loadDurableSubmitExecution: async () => ({
        execution: makeEmbeddedExecution(),
      }),
      loadDurableWorkerExecution: async () => ({
        execution: makeEmbeddedExecution(),
      }),
    });
    const sourceSubmit = sourceOps.commands.find(
      (command) => command.name() === 'submit',
    );
    const sourceWorker = sourceOps.commands.find(
      (command) => command.name() === 'worker',
    );
    const packagedSubmit = packaged.commands.find(
      (command) => command.name() === 'submit',
    );
    const packagedWorker = packaged.commands.find(
      (command) => command.name() === 'worker',
    );

    expect(sourceSubmit).toBeDefined();
    expect(sourceWorker).toBeDefined();
    expect(packagedSubmit).toBeDefined();
    expect(packagedWorker).toBeDefined();
    expect(sourceSubmit?.description()).toBe(packagedSubmit?.description());
    expect(sourceWorker?.description()).toBe(packagedWorker?.description());
    expect(flags(sourceSubmit)).toEqual([
      '--dir <dir>',
      '--activity <activityName>',
      '--idempotency-key <idempotencyKey>',
      '--input <json>',
      '--caller-metadata <json>',
      '--json',
    ]);
    expect(flags(packagedSubmit)).toEqual(flags(sourceSubmit).slice(1));
    expect(flags(sourceWorker)).toEqual(['--dir <dir>']);
    expect(flags(packagedWorker)).toEqual([]);
    expect(
      packagedSubmit?.options.find(
        (option) => option.long === '--idempotency-key',
      )?.mandatory,
    ).toBe(true);
    expect(sourceOps.helpInformation()).toContain('submit');
    expect(sourceOps.helpInformation()).toContain('worker');
    expect(packaged.helpInformation()).toContain('submit');
    expect(packaged.helpInformation()).toContain('worker');
  });

  it('submits embedded work promptly with packaged authority and redacted JSON', async () => {
    const execution = makeEmbeddedExecution();
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'resident-submit-1';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const cleanup = jest.fn(async () => undefined);
    const submit = jest.fn(
      /** @type {import('../../src/core/runtime/operator/durable-submit-command.js').ResidentActivitySubmit} */
      (
        async () => ({
          accepted: true,
          reused: false,
          runId,
          appId,
          revisionId,
          invocationId: 'manual',
          activityId: 'greet',
          runStatus: 'RUNNING',
          invocationStatus: 'RUNNABLE',
          idempotencyKey,
        })
      ),
    );
    const output = {
      json: jest.fn(),
      table: jest.fn(),
      success: jest.fn(),
      failure: jest.fn(),
    };
    /** @type {import('../../src/core/runtime/operator/durable-submit-command.js').DurableSubmitProcess} */
    const processRef = { exitCode: undefined };
    const command = createDurableSubmitCommand({
      loadExecution: async () => ({ execution, cleanup }),
      submit,
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

    expect(submit).toHaveBeenCalledWith({
      execution,
      activityName: 'greet',
      idempotencyKey,
      input: { name: 'Ada' },
      callerMetadata: { requestId: 'request-1' },
      actor: { kind: 'packaged-operator', id: revisionId },
    });
    expect(output.json).toHaveBeenCalledWith({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-submit',
      appId,
      runId,
      revisionId,
      activityId: 'greet',
      idempotencyKey,
      reused: false,
      runStatus: 'RUNNING',
      invocationStatus: 'RUNNABLE',
    });
    expect(Object.isFrozen(output.json.mock.calls[0][0])).toBe(true);
    expect(output.table).not.toHaveBeenCalled();
    expect(output.success).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.exitCode).toBeUndefined();
  });

  it('rejects the obsolete projected submission result', async () => {
    const execution = makeEmbeddedExecution();
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'resident-submit-obsolete';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const json = jest.fn();
    const failure = jest.fn();
    /** @type {import('../../src/core/runtime/operator/durable-submit-command.js').DurableSubmitProcess} */
    const processRef = { exitCode: undefined };
    const command = createDurableSubmitCommand({
      loadExecution: async () => ({ execution }),
      submit: async () => ({
        appId,
        revisionId,
        activityName: 'greet',
        idempotencyKey,
        runId,
        outcome: {
          run: { runId, appId, revisionId, status: 'RUNNING' },
          invocation: {
            runId,
            appId,
            revisionId,
            activityId: 'greet',
            status: 'RUNNABLE',
          },
        },
        reused: false,
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

  it('emits the exact same redacted receipt from source and packaged submit hosts', async () => {
    const execution = makeEmbeddedExecution();
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'resident-submit-parity';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const result = Object.freeze({
      accepted: true,
      reused: true,
      runId,
      appId,
      revisionId,
      invocationId: 'manual',
      activityId: 'greet',
      runStatus: 'RUNNING',
      invocationStatus: 'RUNNABLE',
      idempotencyKey,
    });
    const sourceJson = jest.fn();
    const packagedJson = jest.fn();
    const source = createDurableSubmitCommand({
      includeDirOption: true,
      loadExecution: async () => ({ execution }),
      submit: async () => result,
      output: { json: sourceJson },
      processRef: { exitCode: undefined, cwd: () => '/source' },
    });
    const packaged = createPackagedDurableSubmitCommand({
      loadExecution: async () => ({ execution }),
      submit: async () => result,
      output: { json: packagedJson },
      processRef: { exitCode: undefined },
    });
    const commonArguments = [
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
      '--input',
      '{"private":"input-secret"}',
      '--caller-metadata',
      '{"private":"metadata-secret"}',
      '--json',
    ];

    await source.parseAsync([
      'node',
      'wharfie',
      '--dir',
      '/source',
      ...commonArguments,
    ]);
    await packaged.parseAsync(['node', 'artifact', ...commonArguments]);

    expect(sourceJson).toHaveBeenCalledTimes(1);
    expect(packagedJson).toHaveBeenCalledTimes(1);
    expect(sourceJson.mock.calls[0][0]).toEqual(packagedJson.mock.calls[0][0]);
    expect(sourceJson.mock.calls[0][0]).toEqual({
      schemaVersion: 1,
      kind: 'wharfie.execution-ledger.activity-submit',
      appId,
      runId,
      revisionId,
      activityId: 'greet',
      idempotencyKey,
      reused: true,
      runStatus: 'RUNNING',
      invocationStatus: 'RUNNABLE',
    });
    expect(JSON.stringify(sourceJson.mock.calls[0][0])).not.toMatch(
      /input-secret|metadata-secret/,
    );
  });

  it('keeps the existing snake-case human submission row', async () => {
    const execution = makeEmbeddedExecution();
    const appId = execution.embeddedRevision.runtime.appId;
    const revisionId = execution.embeddedRevision.runtime.revisionId;
    const idempotencyKey = 'resident-submit-human';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const table = jest.fn();
    const success = jest.fn();
    const command = createDurableSubmitCommand({
      loadExecution: async () => ({ execution }),
      submit: async () => ({
        accepted: true,
        reused: false,
        runId,
        appId,
        revisionId,
        invocationId: 'manual',
        activityId: 'greet',
        runStatus: 'RUNNING',
        invocationStatus: 'RUNNABLE',
        idempotencyKey,
      }),
      output: { table, success },
      processRef: { exitCode: undefined },
    });

    await command.parseAsync([
      'node',
      'artifact',
      '--activity',
      'greet',
      '--idempotency-key',
      idempotencyKey,
    ]);

    expect(table).toHaveBeenCalledWith([
      {
        idempotency_key: idempotencyKey,
        run_id: runId,
        revision: revisionId,
        activity: 'greet',
        status: 'RUNNING',
        invocation_status: 'RUNNABLE',
        attempt_generation: 0,
        attempt_status: '',
        reused: false,
      },
    ]);
    expect(success).toHaveBeenCalledWith(
      `Accepted durable activity run ${runId}.`,
    );
  });

  it('rejects a mismatched compact identity before emitting JSON', async () => {
    const execution = makeEmbeddedExecution();
    const appId = execution.embeddedRevision.runtime.appId;
    const idempotencyKey = 'resident-submit-mismatch';
    const runId = createManualLedgerRunId({ appId, idempotencyKey });
    const json = jest.fn();
    const failure = jest.fn();
    /** @type {import('../../src/core/runtime/operator/durable-submit-command.js').DurableSubmitProcess} */
    const processRef = { exitCode: undefined };
    const command = createDurableSubmitCommand({
      loadExecution: async () => ({ execution }),
      submit: async () => ({
        accepted: true,
        reused: false,
        runId,
        appId,
        revisionId: 'wrv1_wrong-revision',
        invocationId: 'manual',
        activityId: 'greet',
        runStatus: 'RUNNING',
        invocationStatus: 'RUNNABLE',
        idempotencyKey,
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

  it('does not echo malformed submit JSON', async () => {
    const execution = makeEmbeddedExecution();
    const secret = 'private-submit-secret{';
    const json = jest.fn();
    const failure = jest.fn();
    const loadExecution = jest.fn(async () => ({ execution }));
    /** @type {import('../../src/core/runtime/operator/durable-submit-command.js').DurableSubmitProcess} */
    const processRef = { exitCode: undefined };
    const command = createDurableSubmitCommand({
      loadExecution,
      output: { json, failure },
      processRef,
    });

    await command.parseAsync([
      'node',
      'artifact',
      '--activity',
      'greet',
      '--idempotency-key',
      'malformed-submit',
      '--input',
      secret,
      '--json',
    ]);

    expect(loadExecution).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(failure).toHaveBeenCalledTimes(1);
    const reported = failure.mock.calls[0][0];
    expect(reported).toBeInstanceOf(Error);
    expect(/** @type {Error} */ (reported).message).toBe('Invalid input JSON.');
    expect(String(reported)).not.toContain(secret);
    expect(processRef.exitCode).toBe(1);
  });

  it('drains the resident worker on SIGTERM before execution cleanup', async () => {
    const execution = makeEmbeddedExecution();
    /** @type {string[]} */
    const order = [];
    const cleanup = jest.fn(async () => {
      order.push('cleanup');
    });
    /** @type {EventEmitter & import('../../src/core/runtime/operator/durable-worker-command.js').DurableWorkerProcess} */
    const processRef = Object.assign(new EventEmitter(), {
      exitCode: undefined,
    });
    const runWorker = jest.fn(
      /** @type {import('../../src/core/runtime/operator/durable-worker-command.js').ResidentActivityWorkerRunner} */
      (
        async ({ signal }) => {
          order.push('worker-started');
          if (!signal.aborted) {
            await new Promise((resolve) =>
              signal.addEventListener('abort', () => resolve(undefined), {
                once: true,
              }),
            );
          }
          order.push('worker-drained');
          return { processed: 1 };
        }
      ),
    );
    const output = {
      info: jest.fn(),
      success: jest.fn(() => order.push('success')),
      failure: jest.fn(),
    };
    const command = createDurableWorkerCommand({
      loadExecution: async () => ({ execution, cleanup }),
      runWorker,
      output,
      processRef,
    });

    const running = command.parseAsync(['node', 'artifact']);
    await new Promise((resolve) => setImmediate(resolve));
    processRef.emit('SIGTERM');
    await running;

    expect(runWorker).toHaveBeenCalledWith({
      execution,
      signal: expect.any(AbortSignal),
    });
    expect(runWorker.mock.calls[0][0].signal.aborted).toBe(true);
    expect(runWorker.mock.calls[0][0].signal.reason).toMatchObject({
      name: 'ResidentWorkerShutdownRequested',
      code: 'resident-worker-shutdown-requested',
      details: { signal: 'SIGTERM' },
    });
    expect(order).toEqual([
      'worker-started',
      'worker-drained',
      'cleanup',
      'success',
    ]);
    expect(output.failure).not.toHaveBeenCalled();
    expect(processRef.listenerCount('SIGINT')).toBe(0);
    expect(processRef.listenerCount('SIGTERM')).toBe(0);
    expect(processRef.exitCode).toBeUndefined();
  });

  it('rejects --dir on both packaged resident commands', async () => {
    const submit = createPackagedDurableSubmitCommand({
      loadExecution: async () => ({ execution: makeEmbeddedExecution() }),
    });
    const worker = createPackagedDurableWorkerCommand({
      loadExecution: async () => ({ execution: makeEmbeddedExecution() }),
    });
    submit.exitOverride();
    worker.exitOverride();
    submit.configureOutput({ writeErr: () => undefined });
    worker.configureOutput({ writeErr: () => undefined });

    await expect(
      submit.parseAsync([
        'node',
        'artifact',
        '--dir',
        '/tmp/source',
        '--activity',
        'greet',
        '--idempotency-key',
        'request-1',
      ]),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
    await expect(
      worker.parseAsync(['node', 'artifact', '--dir', '/tmp/source']),
    ).rejects.toMatchObject({ code: 'commander.unknownOption' });
  });
});
