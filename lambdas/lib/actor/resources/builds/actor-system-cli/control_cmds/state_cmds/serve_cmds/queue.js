import { Command } from 'commander';
import { loadResourcesSpec } from '../util/resources.js';
import { startQueueService } from '../../../../../../runtime/services/queue-service.js';

/**
 * @typedef {'SIGINT'|'SIGTERM'} Signal
 */

const queueCmd = new Command('queue')
  .description('Serve the Queue resource over gRPC')
  .option(
    '--resources-file <path>',
    'JSON file containing ActorSystem resources spec',
  )
  .option('--resources <json>', 'Inline JSON ActorSystem resources spec')
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', (v) => Number(v), 8789)
  .action(async (opts) => {
    const spec = loadResourcesSpec(opts);
    const queueSpec = spec?.queue;
    if (!queueSpec) {
      throw new Error(
        'Queue service requires resources.queue in the provided spec',
      );
    }

    const svc = await startQueueService({
      queueSpec,
      host: String(opts.host),
      port: Number(opts.port),
      log: (msg, extra) => console.error('[queue-service]', msg, extra ?? ''),
    });

    console.log(`[queue-service] listening at ${svc.address}`);

    const keepAlive = setInterval(() => {}, 60_000);

    /**
     * @param {Signal} signal - signal.
     */
    const shutdown = async (signal) => {
      console.log(`[queue-service] shutting down (${signal})`);
      await svc.close();
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

export default queueCmd;
