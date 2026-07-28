/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadApp } from '../../../src/cli/app/load-app.js';

/** @type {string[]} */
const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fsp.rm(directory, { force: true, recursive: true })),
  );
});

/** @returns {Record<string, any>} */
function makeSource() {
  return {
    schemaVersion: 4,
    app: { id: 'source-schedule-app' },
    cli: {
      entrypoint: {
        kind: 'node',
        path: './src/cli.js',
        export: 'main',
      },
    },
    activities: {
      refresh: {
        entrypoint: {
          kind: 'node',
          path: './src/refresh.js',
          export: 'refresh',
        },
      },
    },
    workflows: {
      refresh: {
        steps: [
          {
            id: 'refresh',
            kind: 'activity',
            activity: 'refresh',
            input: { kind: 'workflow-input' },
          },
        ],
      },
    },
    schedules: {
      nightly: {
        cron: '0 0 * * *',
        workflow: 'refresh',
        input: { source: 'manifest' },
        missed: 'latest',
        overlap: 'allow',
      },
    },
  };
}

/** @param {Record<string, any>} source */
async function makeApp(source) {
  const appDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-app-v4-schedules-'),
  );
  temporaryDirectories.push(appDir);
  await fsp.mkdir(path.join(appDir, 'src'));
  await Promise.all([
    fsp.writeFile(
      path.join(appDir, 'package.json'),
      JSON.stringify({ type: 'module' }),
    ),
    fsp.writeFile(
      path.join(appDir, 'src', 'cli.js'),
      'export function main() {}\n',
    ),
    fsp.writeFile(
      path.join(appDir, 'src', 'refresh.js'),
      'export function refresh() {}\n',
    ),
    fsp.writeFile(
      path.join(appDir, 'wharfie.app.js'),
      `export default ${JSON.stringify(source, null, 2)};\n`,
    ),
  ]);
  return appDir;
}

describe('Wharfie app V4 schedule compiler', () => {
  it('keeps a normal CLI valid before workflows or schedules are declared', async () => {
    const source = makeSource();
    delete source.workflows;
    delete source.schedules;
    const appDir = await makeApp(source);

    await expect(loadApp({ dir: appDir })).resolves.toEqual({
      appDir,
      manifest: {
        schemaVersion: 4,
        app: source.app,
        cli: {
          entrypoint: {
            kind: 'node',
            path: 'src/cli.js',
            export: 'main',
          },
        },
        activities: {
          refresh: {
            entrypoint: {
              kind: 'node',
              path: 'src/refresh.js',
              export: 'refresh',
            },
          },
        },
      },
    });
  });

  it('compiles exact V4 schedules into the canonical portable manifest', async () => {
    const source = makeSource();
    const appDir = await makeApp(source);

    await expect(loadApp({ dir: appDir })).resolves.toEqual({
      appDir,
      manifest: {
        ...source,
        cli: {
          entrypoint: {
            kind: 'node',
            path: 'src/cli.js',
            export: 'main',
          },
        },
        activities: {
          refresh: {
            entrypoint: {
              kind: 'node',
              path: 'src/refresh.js',
              export: 'refresh',
            },
          },
        },
      },
    });
  });

  it('rejects schemaVersion 3 instead of preserving a compatibility path', async () => {
    const source = makeSource();
    source.schemaVersion = 3;
    const appDir = await makeApp(source);

    await expect(loadApp({ dir: appDir })).rejects.toThrow(
      /app\.schemaVersion must be the integer 4/i,
    );
  });
});
