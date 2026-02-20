/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadApp } from '../../../cli/app/load-app.js';

describe('Wharfie app loader', () => {
  it('loads a plain object export and compiles manifest.app.name', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-'));

    // Ensure the fixture is treated as ESM (".js" + package.json type=module).
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      "export default { name: 'plain-object-app' };\n",
    );

    const { manifest } = await loadApp({ dir });
    expect(manifest.app.name).toBe('plain-object-app');
  });

  it('loads an ActorSystem export and compiles manifest.app.name', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-'));

    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    );

    const actorSystemPath = fileURLToPath(
      new URL(
        '../../../lambdas/lib/actor/resources/builds/actor-system.js',
        import.meta.url,
      ),
    );
    const actorSystemUrl = pathToFileURL(actorSystemPath).href;

    await fsp.writeFile(
      path.join(dir, 'wharfie.app.js'),
      `
        import ActorSystem from ${JSON.stringify(actorSystemUrl)};

        export default new ActorSystem({
          name: 'actor-system-app',
          properties: {
            resources: {
              db: { adapter: 'vanilla', options: { path: '.wharfie' } },
            },
          },
        });
      `,
    );

    const { manifest } = await loadApp({ dir });
    expect(manifest.app.name).toBe('actor-system-app');
    expect(manifest.capabilities?.db).toBeDefined();
  });
});
