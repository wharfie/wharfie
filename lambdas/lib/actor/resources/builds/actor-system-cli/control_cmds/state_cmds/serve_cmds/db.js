import { Command } from 'commander';
import { loadRuntimeBootstrap } from '../util/resources.js';
import { startDbService } from '../../../../../../runtime/services/db-service.js';

/**
 * @typedef {'SIGINT'|'SIGTERM'} Signal
 */

const dbCmd = new Command('db')
  .description('Serve the DB resource over gRPC')
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
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', (v) => Number(v), 8788)
  .action(async (opts) => {
    const bootstrap = await loadRuntimeBootstrap(opts);
    const dbSpec = bootstrap.resourcesSpec?.db;
    if (!dbSpec) {
      throw new Error(
        'DB service requires a db capability in the provided resources spec or packaged app manifest.',
      );
    }

    const svc = await startDbService({
      dbSpec,
      host: String(opts.host),
      port: Number(opts.port),
      log: (msg, extra) => console.error('[db-service]', msg, extra ?? ''),
    });

    console.log(`[db-service] listening at ${svc.address}`);

    const keepAlive = setInterval(() => {}, 60_000);

    /**
     * @param {Signal} signal - signal.
     */
    const shutdown = async (signal) => {
      console.log(`[db-service] shutting down (${signal})`);
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

export default dbCmd;
