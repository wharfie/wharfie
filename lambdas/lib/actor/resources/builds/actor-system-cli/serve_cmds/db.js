import { Command } from 'commander';
import { loadResourcesSpec } from '../control_cmds/state_cmds/util/resources.js';
import { startDbService } from '../../../../runtime/services/db-service.js';

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
  .option('--host <host>', 'Bind host', '127.0.0.1')
  .option('--port <port>', 'Bind port', (v) => Number(v), 8788)
  .action(async (opts) => {
    const spec = loadResourcesSpec(opts);
    const dbSpec = spec?.db;
    if (!dbSpec) {
      throw new Error('DB service requires resources.db in the provided spec');
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
