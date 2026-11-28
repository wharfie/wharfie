/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  APPLICATION_STATE_TABLE_NAME,
  resolveExecutionPayloadStoreId,
} from '../../../src/core/lib/config/db.js';
import {
  InvocationStatus,
  RunStatus,
} from '../../../src/core/lib/db/tables/execution-ledger.js';
import {
  CoordinatorAuthorityConflictError,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
} from '../../../src/core/lib/db/tables/coordinator-authority.js';
import {
  LedgerServiceLifecycleStatus,
  createLedgerServiceId,
  createLedgerServiceLifecycle,
  createLedgerServiceOwnership,
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
 * @param {Record<string, any>} [triggers] - Additional revision-bound definitions.
 * @returns {{kind: 'embedded', manifest: any, embeddedRevision: import('../../../src/core/resources/builds/lib/revision-runtime-assets.js').EmbeddedRevisionRuntimePair}} - Valid embedded execution fixture.
 */
function makeEmbeddedExecution(appId, triggers = {}) {
  const contract = {
    schemaVersion: 4,
    app: { id: appId },
    ...triggers,
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
      tableName: 'wharfie-execution-ledger-v10',
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
  it.each([
    [{ WHARFIE_WEBHOOK_PORT: '8443' }, /WHARFIE_WEBHOOK_TOKEN_ALERTS/],
    [
      {
        WHARFIE_WEBHOOK_PORT: '8443',
        WHARFIE_WEBHOOK_HOST: '0.0.0.0',
        WHARFIE_WEBHOOK_TOKEN_ALERTS: 'x'.repeat(32),
      },
      /both TLS files/,
    ],
  ])(
    'refuses to publish READY with incomplete webhook authentication or TLS',
    async (env, message) => {
      const stores = createConfigurations();
      const appId = 'webhook-startup';
      const execution = makeEmbeddedExecution(appId, {
        workflows: { investigate: { steps: [{ id: 'hold', kind: 'signal' }] } },
        webhooks: { alerts: { workflow: 'investigate' } },
      });
      await expect(
        runLocalResidentActivityService(
          { ...stores, execution },
          /** @type {NodeJS.ProcessEnv} */ (env),
        ),
      ).rejects.toThrow(/** @type {RegExp} */ (message));
      await withExecutionLedger(
        async (ledger) => {
          expect((await ledger.listRuns({ appId })).items).toEqual([]);
        },
        { configuration: stores.configuration, readOnly: true },
      );
    },
  );

  it('admits a webhook once even when the caller loses the receipt and retries after restart', async () => {
    const appId = 'webhook-service';
    const stores = createConfigurations();
    const execution = makeEmbeddedExecution(appId, {
      workflows: { investigate: { steps: [{ id: 'hold', kind: 'signal' }] } },
      webhooks: {
        datadog: { workflow: 'investigate', deliveryIdField: 'event_id' },
        manual: { workflow: 'investigate' },
      },
    });
    const reservation = createServer();
    reservation.listen(0, '127.0.0.1');
    await once(reservation, 'listening');
    const { port } = /** @type {import('node:net').AddressInfo} */ (
      reservation.address()
    );
    await new Promise((resolve) => reservation.close(resolve));
    const env = {
      WHARFIE_WEBHOOK_PORT: String(port),
      WHARFIE_WEBHOOK_TOKEN_DATADOG: 'a'.repeat(32),
      WHARFIE_WEBHOOK_TOKEN_MANUAL: 'b'.repeat(32),
    };
    const url = `http://127.0.0.1:${port}/hooks/datadog`;
    const body = { event_id: 'event-17', service: 'api' };
    /** @param {Record<string, any>} input */
    const post = (input) =>
      fetch(url, {
        method: 'POST',
        body: JSON.stringify(input),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.WHARFIE_WEBHOOK_TOKEN_DATADOG}`,
        },
      });
    let dropped = false;
    /**
     * @param {() => Promise<void>} exercise
     * @param {boolean} [dropReceipt]
     */
    const withWorker = async (exercise, dropReceipt = false) => {
      const controller = new AbortController();
      // Cut the connection precisely after durable admission but before any
      // response bytes. Don't replay in the first process.
      const writeHead = ServerResponse.prototype.writeHead;
      const fault = dropReceipt
        ? jest.spyOn(ServerResponse.prototype, 'writeHead').mockImplementation(
            /** @this {ServerResponse} */ function (...args) {
              if (!dropped && args[0] === 202) {
                dropped = true;
                this.destroy();
              }
              return Reflect.apply(writeHead, this, args);
            },
          )
        : undefined;
      const worker = runLocalResidentActivityService(
        { ...stores, execution, signal: controller.signal },
        env,
      );
      try {
        await Promise.race([
          worker,
          (async () => {
            // Startup includes LMDB adoption and publishing the resident as READY.
            for (let i = 0; i < 200 && !controller.signal.aborted; i++) {
              const response = await post(body).catch(() => null);
              if (!response && dropReceipt && dropped) return;
              if (response && response.status !== 503) {
                expect(response.status).toBe(202);
                await response.body?.cancel();
                return;
              }
              await delay(20);
            }
            throw new Error('Webhook did not become available.');
          })(),
        ]);
        await exercise();
      } finally {
        fault?.mockRestore();
        controller.abort();
        await worker;
      }
    };
    await withWorker(async () => {
      expect(dropped).toBe(true);
    }, true);
    let runId = '';
    let manualRunId = '';
    await withWorker(async () => {
      const replay = await post(body);
      expect(replay.status).toBe(202);
      ({ runId } = await replay.json());
      const conflict = await post({ ...body, service: 'different' });
      expect(conflict.status).toBe(409);
      expect(await conflict.text()).toBe('');
      expect((await post({ service: 'no-id' })).status).toBe(400);
      expect((await fetch(url, { method: 'POST' })).status).toBe(401);
      expect(
        (await fetch(url.replace('datadog', 'investigate'), { method: 'POST' }))
          .status,
      ).toBe(404);
      const manual = url.replace('datadog', 'manual');
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.WHARFIE_WEBHOOK_TOKEN_MANUAL}`,
        'Idempotency-Key': body.event_id,
      };
      const delivery = { method: 'POST', headers, body: JSON.stringify(body) };
      expect(
        (
          await fetch(manual, {
            ...delivery,
            headers: {
              ...headers,
              Authorization: `Bearer ${env.WHARFIE_WEBHOOK_TOKEN_DATADOG}`,
            },
          })
        ).status,
      ).toBe(401);
      expect(
        (await fetch(manual, { ...delivery, body: 'invalid JSON' })).status,
      ).toBe(400);
      expect(
        (await fetch(manual, { ...delivery, body: 'x'.repeat(65537) })).status,
      ).toBe(413);
      const receipt = await fetch(manual, delivery);
      expect(receipt.status).toBe(202);
      manualRunId = (await receipt.json()).runId;
      expect(runId).not.toBe(manualRunId);
    });
    await withExecutionLedger(
      async (ledger) => {
        expect(
          (await ledger.listRuns({ appId })).items
            .map((item) => item.runId)
            .sort(),
        ).toEqual([runId, manualRunId].sort());
        expect(await ledger.getEvents(runId)).toHaveLength(1);
      },
      { configuration: stores.configuration, readOnly: true },
    );
  }, 15000);

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
        const authority = createCoordinatorAuthority({
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
        await expect(
          authority.get({
            appId: submissionExecution.embeddedRevision.runtime.appId,
          }),
        ).resolves.toMatchObject({
          status: CoordinatorAuthorityStatus.RELEASED,
          epoch: 2,
        });
        await expect(
          authority.get({
            appId: workerExecution.embeddedRevision.runtime.appId,
          }),
        ).resolves.toMatchObject({
          status: CoordinatorAuthorityStatus.RELEASED,
          epoch: 1,
        });
      },
      { configuration, readOnly: true },
    );
  });

  it('fails closed on an active predecessor authority and releases local ownership', async () => {
    const { configuration, applicationStateConfiguration } =
      createConfigurations();
    const execution = makeEmbeddedExecution('resident-authority-conflict');
    const appId = execution.embeddedRevision.runtime.appId;

    await withExecutionLedger(
      async (_ledger, controlContext) => {
        const authority = createCoordinatorAuthority({
          db: controlContext.db,
          tableName: controlContext.tableName,
        });
        await authority.acquire({
          appId,
          coordinatorId: 'retained-predecessor',
          requestId: 'retained-predecessor-acquire',
          observedAt: 10,
        });
      },
      { configuration },
    );

    const shutdown = new AbortController();
    shutdown.abort(new Error('test shutdown'));
    await expect(
      runLocalResidentActivityService({
        execution,
        signal: shutdown.signal,
        pollIntervalMs: 1,
        drainTimeoutMs: 1,
        configuration,
        applicationStateConfiguration,
      }),
    ).rejects.toBeInstanceOf(CoordinatorAuthorityConflictError);

    await withExecutionLedger(
      async (_ledger, controlContext) => {
        const lifecycle = createLedgerServiceLifecycle({
          db: controlContext.db,
          tableName: controlContext.tableName,
        });
        const ownership = createLedgerServiceOwnership({
          db: controlContext.db,
          tableName: controlContext.tableName,
        });
        const authority = createCoordinatorAuthority({
          db: controlContext.db,
          tableName: controlContext.tableName,
        });
        const serviceId = createLedgerServiceId({ appId });

        await expect(lifecycle.get({ serviceId })).resolves.toMatchObject({
          status: LedgerServiceLifecycleStatus.STOPPED,
        });
        await expect(ownership.getOwnership({ serviceId })).resolves.toBeNull();
        await expect(authority.get({ appId })).resolves.toMatchObject({
          status: CoordinatorAuthorityStatus.ACTIVE,
          coordinatorId: 'retained-predecessor',
          epoch: 1,
        });
      },
      { configuration, readOnly: true },
    );
  });

  it('a resident told to stop while another process holds its store says so and opens nothing', async () => {
    const { configuration, applicationStateConfiguration } =
      createConfigurations();
    const holder = spawn(
      process.execPath,
      [
        fileURLToPath(
          new URL('../../fixtures/local-store-host-child.js', import.meta.url),
        ),
        configuration.controlPath,
        '0',
      ],
      {
        cwd: fileURLToPath(new URL('../../..', import.meta.url)),
        stdio: ['pipe', 'pipe', 'inherit'],
      },
    );
    const exited = once(holder, 'exit');
    try {
      const lines = createInterface({
        input: /** @type {import('node:stream').Readable} */ (holder.stdout),
      })[Symbol.asyncIterator]();
      expect(JSON.parse(String((await lines.next()).value))).toMatchObject({
        ready: true,
      });
      /** @type {string[]} */
      const written = [];
      const write = jest
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk) => {
          written.push(String(chunk));
          return true;
        });
      try {
        const shutdown = new AbortController();
        setTimeout(() => shutdown.abort(new Error('test shutdown')), 500);
        await expect(
          runLocalResidentActivityService({
            execution: makeEmbeddedExecution('held-store-app'),
            signal: shutdown.signal,
            pollIntervalMs: 1,
            drainTimeoutMs: 1,
            configuration,
            applicationStateConfiguration,
            onStoreHeld: 'wait',
          }),
        ).resolves.toEqual({ processed: 0 });
      } finally {
        write.mockRestore();
      }
      const journal = written.join('');
      expect(journal).toContain('Resident stopped before starting');
      expect(journal).toContain('it did not open the store');
      expect(journal).toContain(`pid ${holder.pid}`);
    } finally {
      holder.kill('SIGKILL');
      await exited;
    }
  }, 30_000);
});
