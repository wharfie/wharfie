/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  APPLICATION_STATE_TABLE_NAME,
  resolveExecutionPayloadStoreId,
} from '../../../src/core/lib/config/db.js';
import {
  InvocationStatus,
  RunStatus,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import {
  LedgerServiceLifecycleStatus,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
} from '../../../src/core/lib/db/tables/ledger-service-lifecycle.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../../src/core/runtime/application-revision.js';
import { MANUAL_LEDGER_INVOCATION_ID } from '../../../src/core/runtime/manual-ledger-run.js';
import { withExecutionLedger } from '../../../src/core/runtime/operator/execution-ledger-store.js';
import {
  runLocalResidentActivityService,
  submitLocalDurableManifestActivity,
} from '../../../src/core/runtime/services/resident-activity-worker.js';

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @type {string[]} */
const roots = [];

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/**
 * @param {string} value - Fixture digest input.
 * @returns {{algorithm: 'sha256', value: string}} - Application-revision digest.
 */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/**
 * @param {string} appId - Fixture application identity.
 * @returns {{kind: 'embedded', manifest: any, embeddedRevision: import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair}} - Valid embedded execution fixture.
 */
function makeEmbeddedExecution(appId) {
  const contract = {
    schemaVersion: 2,
    app: { id: appId },
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
      source: {
        format: SOURCE_TREE_INPUT_FORMAT,
        digest: digest(`${appId}:source`),
      },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest(`${appId}:dependencies`),
      },
      runtime: {
        format: RUNTIME_INPUT_FORMAT,
        digest: digest(`${appId}:runtime`),
      },
    },
  });
  return {
    kind: /** @type {const} */ ('embedded'),
    manifest: { ...contract, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  };
}

function createConfigurations() {
  const root = mkdtempSync(join(tmpdir(), 'wharfie-resident-worker-smoke-'));
  roots.push(root);
  const controlPath = join(root, 'control');
  const payloadPath = join(root, 'payloads');
  return {
    configuration: Object.freeze({
      adapterName: /** @type {const} */ ('lmdb'),
      controlPath,
      tableName: 'wharfie-execution-ledger-v9',
      payloadPath,
      payloadStoreId: resolveExecutionPayloadStoreId(payloadPath),
      sessionPath: join(root, 'sessions'),
    }),
    applicationStateConfiguration: Object.freeze({
      adapterName: /** @type {const} */ ('lmdb'),
      storePath: join(root, 'application-state'),
      tableName: APPLICATION_STATE_TABLE_NAME,
    }),
  };
}

describe('local resident activity service', () => {
  it('durably deduplicates offline submissions and records a clean idle stop', async () => {
    const { configuration, applicationStateConfiguration } =
      createConfigurations();
    const submissionExecution = makeEmbeddedExecution('resident-submit-smoke');
    const workerExecution = makeEmbeddedExecution('resident-idle-smoke');
    const idempotencyKey = 'stable-offline-request';
    const request = {
      execution: submissionExecution,
      activityName: 'greet',
      idempotencyKey,
      input: { name: 'Ada' },
      callerMetadata: { requestId: 'request-1' },
      actor: { kind: 'test', id: 'offline-submitter' },
      configuration,
    };

    const first = await submitLocalDurableManifestActivity(request);
    const repeated = await submitLocalDurableManifestActivity(request);

    expect(first).toMatchObject({
      accepted: true,
      reused: false,
      appId: submissionExecution.embeddedRevision.runtime.appId,
      revisionId: submissionExecution.embeddedRevision.runtime.revisionId,
      activityId: 'greet',
      idempotencyKey,
      runStatus: RunStatus.RUNNING,
      invocationStatus: InvocationStatus.RUNNABLE,
    });
    expect(repeated).toEqual({ ...first, reused: true });

    await withExecutionLedger(
      async (ledger) => {
        const view = await ledger.rebuildRun(first.runId);
        expect(view?.run).toMatchObject({
          runId: first.runId,
          appId: submissionExecution.embeddedRevision.runtime.appId,
          revisionId: submissionExecution.embeddedRevision.runtime.revisionId,
          status: RunStatus.RUNNING,
        });
        expect(view?.invocations).toEqual([
          expect.objectContaining({
            invocationId: MANUAL_LEDGER_INVOCATION_ID,
            activityId: 'greet',
            status: InvocationStatus.RUNNABLE,
          }),
        ]);
        expect(view?.attempts).toEqual([]);
      },
      { configuration, readOnly: true },
    );

    const shutdown = new AbortController();
    shutdown.abort(new Error('test shutdown'));
    await expect(
      runLocalResidentActivityService({
        execution: workerExecution,
        signal: shutdown.signal,
        pollIntervalMs: 1,
        drainTimeoutMs: 1,
        configuration,
        applicationStateConfiguration,
      }),
    ).resolves.toEqual({ processed: 0 });

    await withExecutionLedger(
      async (_ledger, controlContext) => {
        const lifecycle = createLedgerServiceLifecycle({
          db: controlContext.db,
          tableName: controlContext.tableName,
        });
        await expect(
          lifecycle.get({
            serviceId: createLedgerServiceId({
              appId: workerExecution.embeddedRevision.runtime.appId,
            }),
          }),
        ).resolves.toMatchObject({
          appId: workerExecution.embeddedRevision.runtime.appId,
          revisionId: workerExecution.embeddedRevision.runtime.revisionId,
          generation: 1,
          status: LedgerServiceLifecycleStatus.STOPPED,
        });
      },
      { configuration, readOnly: true },
    );
  });
});
