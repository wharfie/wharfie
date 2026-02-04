import { Command } from 'commander';
import { randomUUID } from 'node:crypto';

import NodeAgent from '../../../../../runtime/services/node-agent.js';
import { loadResourcesSpec } from './util/resources.js';
import { getSelfSpawnCommand } from './util/spawn-self.js';

const startCmd = new Command('start')
  .description(
    'Start the node agent: supervises lambda/db/queue services and exposes a control-plane health endpoint',
  )
  .option(
    '--resources-file <path>',
    'JSON file containing ActorSystem resources spec',
  )
  .option('--resources <json>', 'Inline JSON ActorSystem resources spec')
  .option('--role <role>', 'all | leader | worker', 'all')
  .option('--lambda-host <host>', 'Lambda service bind host', '0.0.0.0')
  .option('--lambda-port <port>', 'Lambda service port', (v) => Number(v), 8787)
  .option('--db-host <host>', 'DB service bind host', '127.0.0.1')
  .option('--db-port <port>', 'DB service port', (v) => Number(v), 8788)
  .option('--queue-host <host>', 'Queue service bind host', '127.0.0.1')
  .option('--queue-port <port>', 'Queue service port', (v) => Number(v), 8789)
  .option('--control-host <host>', 'Control plane bind host', '0.0.0.0')
  .option('--control-port <port>', 'Control plane port', (v) => Number(v), 8790)
  .option(
    '--db-address <host:port>',
    'Remote DB service gRPC address (skips local db service)',
  )
  .option(
    '--queue-address <host:port>',
    'Remote Queue service gRPC address (skips local queue service)',
  )
  .option(
    '--poll-queue-url <queueUrl>',
    'Queue URL to poll for lambda invocations (repeatable)',
    (v, prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      arr.push(String(v));
      return arr;
    },
    [],
  )
  .action(async (opts) => {
    const nodeId = randomUUID();
    const role = String(opts.role || 'all');

    const resourcesSpec = loadResourcesSpec(opts);

    const { cmd, prefixArgs } = getSelfSpawnCommand();

    const agent = new NodeAgent({
      nodeId,
      role,
      resourcesSpec,
      cmd,
      prefixArgs,
      lambdaHost: String(opts.lambdaHost),
      lambdaPort: Number(opts.lambdaPort),
      dbHost: String(opts.dbHost),
      dbPort: Number(opts.dbPort),
      queueHost: String(opts.queueHost),
      queuePort: Number(opts.queuePort),
      controlHost: String(opts.controlHost),
      controlPort: Number(opts.controlPort),
      dbAddressOverride: opts.dbAddress ? String(opts.dbAddress) : null,
      queueAddressOverride: opts.queueAddress
        ? String(opts.queueAddress)
        : null,
      pollQueueUrls: Array.isArray(opts.pollQueueUrl) ? opts.pollQueueUrl : [],
    });

    await agent.start();

    const shutdown = async (signal) => {
      await agent.stop(signal);
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));

    await agent.waitForever();
  });

export default startCmd;
