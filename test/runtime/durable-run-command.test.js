/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

import sourceRunCommand, {
  createForegroundCancellation as createSourceForegroundCancellation,
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
    schemaVersion: 2,
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
          run: { runId, revisionId, status: 'COMPLETED' },
          invocation: { activityId: 'greet', status: 'COMPLETED' },
          attempt: { generation: 1, status: 'COMPLETED' },
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
      idempotency_key: idempotencyKey,
      run_id: runId,
      revision: revisionId,
      activity: 'greet',
      status: 'COMPLETED',
      invocation_status: 'COMPLETED',
      attempt_generation: 1,
      attempt_status: 'COMPLETED',
    });
    expect(output.info).not.toHaveBeenCalled();
    expect(output.table).not.toHaveBeenCalled();
    expect(output.success).not.toHaveBeenCalled();
    expect(output.failure).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(processRef.listenerCount('SIGINT')).toBe(0);
    expect(processRef.listenerCount('SIGTERM')).toBe(0);
    expect(processRef.exitCode).toBeUndefined();
  });

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
