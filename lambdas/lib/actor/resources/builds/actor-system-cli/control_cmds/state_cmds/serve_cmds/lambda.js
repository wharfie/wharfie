import { Command } from 'commander';
import { setTimeout as delay } from 'node:timers/promises';

import Function from '../../../../function.js';
import { createActorSystemResources } from '../../../../../../runtime/resources.js';
import { createGrpcRpcClient } from '../../../../../../runtime/services/rpc-grpc.js';
import { startLambdaService } from '../../../../../../runtime/services/lambda-service.js';

import { loadResourcesSpec } from '../util/resources.js';

const lambdaCmd = new Command('lambda')
  .description('Serve the Lambda execution plane over gRPC')
  .option(
    '--resources-file <path>',
    'JSON file containing ActorSystem resources spec',
  )
  .option('--resources <json>', 'Inline JSON ActorSystem resources spec')
  .option('--host <host>', 'Bind host', '0.0.0.0')
  .option('--port <port>', 'Bind port', (v) => Number(v), 8787)
  .requiredOption('--db-address <host:port>', 'DB service gRPC address')
  .requiredOption('--queue-address <host:port>', 'Queue service gRPC address')
  .option(
    '--poll-queue-url <queueUrl>',
    'Queue URL to poll for lambda invocations (repeatable)',
    /**
     * @param {string} v
     * @param {string[]} prev
     * @returns {string[]}
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
    const resourcesSpec = loadResourcesSpec(opts);

    const dbAddress = String(opts.dbAddress);
    const queueAddress = String(opts.queueAddress);

    const db = createGrpcRpcClient({
      address: dbAddress,
      log: (msg, extra) => console.error('[db-client]', msg, extra ?? ''),
    });
    const queue = createGrpcRpcClient({
      address: queueAddress,
      log: (msg, extra) => console.error('[queue-client]', msg, extra ?? ''),
    });

    const objectStorageSpec = resourcesSpec?.objectStorage;
    const { resources: local, close: closeLocal } = objectStorageSpec
      ? await createActorSystemResources({ objectStorage: objectStorageSpec })
      : await createActorSystemResources({});

    const objectStorage = local.objectStorage;

    const pollQueueUrls = Array.isArray(opts.pollQueueUrl)
      ? /** @type {string[]} */ (opts.pollQueueUrl)
      : [];

    const svc = await startLambdaService({
      host: String(opts.host),
      port: Number(opts.port),
      log: (msg, extra) => console.error('[lambda-service]', msg, extra ?? ''),
      execute: async ({ functionName, event, context }) => {
        const ctx = context && typeof context === 'object' ? context : {};

        await Function.run(functionName, event, ctx, {
          resources: {
            ...(db ? { db } : {}),
            ...(queue ? { queue } : {}),
            ...(objectStorage ? { objectStorage } : {}),
          },
        });
      },
      poll:
        pollQueueUrls && pollQueueUrls.length > 0
          ? {
              queue,
              queueUrls: pollQueueUrls,
              waitTimeSeconds: Number(opts.pollWaitSeconds),
              maxNumberOfMessages: Number(opts.pollMaxMessages),
              visibilityTimeout: Number(opts.pollVisibilityTimeout),
              log: (msg, extra) =>
                console.error('[lambda-service:poll]', msg, extra ?? ''),
            }
          : undefined,
    });

    console.log(`[lambda-service] listening at ${svc.address} (gRPC Invoke)`);

    if (pollQueueUrls.length > 0) {
      console.log(
        `[lambda-service] polling queues: ${pollQueueUrls.join(', ')}`,
      );
    }

    /**
     * @param {NodeJS.Signals} signal
     */
    const shutdown = async (signal) => {
      console.log(`[lambda-service] shutting down (${signal})`);
      await svc.close();
      await closeLocal();
      try {
        db.__wharfie_closeTransport && db.__wharfie_closeTransport();
      } catch {}
      try {
        queue.__wharfie_closeTransport && queue.__wharfie_closeTransport();
      } catch {}
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    // keep alive
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await delay(60_000);
    }
  });

export default lambdaCmd;
