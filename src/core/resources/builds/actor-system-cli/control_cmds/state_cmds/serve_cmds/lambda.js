import { Command } from 'commander';
import Function from '../../../../function.js';
import makeOperationsStore from '../../../../../../lib/graph/operations-store.js';
import { resolveOperationsTableName } from '../../../../../../lib/config/db.js';
import { createActorSystemResources } from '../../../../../../runtime/resources.js';
import { createGrpcRpcClient } from '../../../../../../runtime/services/rpc-grpc.js';
import { startLambdaService } from '../../../../../../runtime/services/lambda-service.js';
import { readEmbeddedRevisionRuntimePair } from '../../../../lib/revision-runtime-assets.js';

import { loadRuntimeBootstrap } from '../util/resources.js';

/**
 * @typedef {'SIGINT'|'SIGTERM'} Signal
 */

const lambdaCmd = new Command('lambda')
  .description('Serve the Lambda execution plane over gRPC')
  .option(
    '--resources-file <path>',
    'JSON file containing ActorSystem resources spec',
  )
  .option('--resources <json>', 'Inline JSON ActorSystem resources spec')
  .option(
    '--manifest-file <path>',
    'JSON file containing the packaged app manifest',
  )
  .option('--manifest <json>', 'Inline JSON packaged app manifest')
  .option('--host <host>', 'Bind host', '0.0.0.0')
  .option('--port <port>', 'Bind port', (v) => Number(v), 8787)
  .option('--db-address <host:port>', 'DB service gRPC address')
  .option('--queue-address <host:port>', 'Queue service gRPC address')
  .option(
    '--poll-queue-url <queueUrl>',
    'Queue URL to poll for lambda invocations (repeatable)',
    /**
     * @param {string} v - v.
     * @param {string[]} prev - prev.
     * @returns {string[]} - Result.
     */
    (v, prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      return [...arr, String(v)];
    },
    /** @type {string[]} */ ([]),
  )
  .option(
    '--poll-wait-seconds <n>',
    'Long poll seconds (0-20)',
    (v) => Number(v),
    20,
  )
  .option(
    '--poll-max-messages <n>',
    'Max messages per receive (1-10)',
    (v) => Number(v),
    10,
  )
  .option(
    '--poll-visibility-timeout <n>',
    'Visibility timeout seconds',
    (v) => Number(v),
    30,
  )
  .action(async (opts) => {
    const bootstrap = await loadRuntimeBootstrap(opts);
    const resourcesSpec = bootstrap.resourcesSpec;

    const dbAddress =
      typeof opts.dbAddress === 'string' && opts.dbAddress.trim()
        ? String(opts.dbAddress)
        : undefined;
    const queueAddress =
      typeof opts.queueAddress === 'string' && opts.queueAddress.trim()
        ? String(opts.queueAddress)
        : undefined;

    if (bootstrap.servicePlan.db && !dbAddress) {
      throw new Error(
        'Lambda service requires --db-address when the app manifest declares a db capability.',
      );
    }

    if (
      (bootstrap.servicePlan.queue || bootstrap.pollQueueUrls.length > 0) &&
      !queueAddress
    ) {
      throw new Error(
        'Lambda service requires --queue-address when the app manifest declares a queue capability or queue polling is enabled.',
      );
    }

    const db = dbAddress
      ? createGrpcRpcClient({
          address: dbAddress,
          log: (msg, extra) => console.error('[db-client]', msg, extra ?? ''),
        })
      : undefined;
    const queue = queueAddress
      ? createGrpcRpcClient({
          address: queueAddress,
          log: (msg, extra) =>
            console.error('[queue-client]', msg, extra ?? ''),
        })
      : undefined;

    const objectStorageSpec = resourcesSpec?.objectStorage;
    const { resources: local, close: closeLocal } = objectStorageSpec
      ? await createActorSystemResources({ objectStorage: objectStorageSpec })
      : await createActorSystemResources({});

    const objectStorage = local.objectStorage;
    const pollQueueUrls = bootstrap.pollQueueUrls;
    const operationsTableName = resolveOperationsTableName();
    const appId =
      typeof bootstrap.manifest?.app?.id === 'string'
        ? bootstrap.manifest.app.id
        : undefined;
    const pollOptions = await (async () => {
      if (!queue || pollQueueUrls.length === 0) return undefined;
      if (!db || !appId) {
        throw new Error(
          'Durable queue polling requires a DB service and an embedded application ID.',
        );
      }
      const embeddedIdentity = await readEmbeddedRevisionRuntimePair();
      if (embeddedIdentity.runtime.appId !== appId) {
        throw new Error(
          'Durable queue polling application ID does not match the embedded immutable revision.',
        );
      }
      return {
        queue,
        queueUrls: pollQueueUrls,
        waitTimeSeconds: Number(opts.pollWaitSeconds),
        maxNumberOfMessages: Number(opts.pollMaxMessages),
        visibilityTimeout: Number(opts.pollVisibilityTimeout),
        operationsStore: makeOperationsStore({
          db,
          tableName: operationsTableName,
        }),
        appId,
        revisionId: embeddedIdentity.runtime.revisionId,
        log: (/** @type {string} */ msg, /** @type {any} */ extra) =>
          console.error('[lambda-service:poll]', msg, extra ?? ''),
      };
    })();

    const svc = await startLambdaService({
      host: String(opts.host),
      port: Number(opts.port),
      log: (msg, extra) => console.error('[lambda-service]', msg, extra ?? ''),
      execute: async ({ functionName, revisionId, event, context }) => {
        if (
          revisionId &&
          pollOptions &&
          revisionId !== pollOptions.revisionId
        ) {
          throw new Error(
            `Activity revision '${revisionId}' does not match the running artifact revision '${pollOptions.revisionId}'.`,
          );
        }
        const ctx = context && typeof context === 'object' ? context : {};

        await Function.run(functionName, event, ctx, {
          resources: {
            ...(db ? { db } : {}),
            ...(queue ? { queue } : {}),
            ...(objectStorage ? { objectStorage } : {}),
          },
        });
      },
      poll: pollOptions,
    });

    console.log(`[lambda-service] listening at ${svc.address} (gRPC Invoke)`);

    if (pollQueueUrls.length > 0) {
      console.log(
        `[lambda-service] polling queues: ${pollQueueUrls.join(', ')}`,
      );
    }

    const keepAlive = setInterval(() => {}, 60_000);

    /**
     * @param {Signal} signal - signal.
     */
    const shutdown = async (signal) => {
      console.log(`[lambda-service] shutting down (${signal})`);
      await svc.close();
      await closeLocal();
      try {
        db?.__wharfie_closeTransport && db.__wharfie_closeTransport();
      } catch {}
      try {
        queue?.__wharfie_closeTransport && queue.__wharfie_closeTransport();
      } catch {}
      clearInterval(keepAlive);
    };

    await new Promise((resolve) => {
      /**
       * @param {Signal} signal - signal.
       */
      const onSignal = (signal) => {
        shutdown(signal).finally(() => resolve(undefined));
      };

      process.on('SIGINT', () => onSignal('SIGINT'));
      process.on('SIGTERM', () => onSignal('SIGTERM'));
    });
  });

export default lambdaCmd;
