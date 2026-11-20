// An operator process that inspects, takes over, and replays a coordinator
// takeover against one local control store, printing one JSON line.
// argv: <controlPath> <tableName> <appId>.
import { join } from 'node:path';

import {
  inspectCoordinatorAuthority,
  takeoverCoordinatorAuthority,
} from '../../src/core/runtime/operator/coordinator-authority-command.js';

const [controlPath, tableName, appId] = process.argv.slice(2);
const configuration = {
  adapterName: /** @type {const} */ ('lmdb'),
  controlPath,
  tableName,
  payloadPath: join(controlPath, '..', 'payloads'),
  payloadStoreId: `${appId}-payloads`,
  sessionPath: join(controlPath, '..', 'sessions'),
};
try {
  const inspection = await inspectCoordinatorAuthority({
    appId,
    configuration,
  });
  const request = {
    appId,
    coordinatorId: 'successor',
    requestId: 'successor-takeover',
    inspection,
    confirmAuthorityReplacement: true,
    configuration,
  };
  const applied = await takeoverCoordinatorAuthority(request);
  const replayed = await takeoverCoordinatorAuthority(request);
  process.stdout.write(
    `${JSON.stringify({ inspection, applied, replayed })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      error: {
        name: /** @type {Error} */ (error)?.name,
        code: /** @type {any} */ (error)?.code,
        message: /** @type {Error} */ (error)?.message,
      },
    })}\n`,
  );
}
