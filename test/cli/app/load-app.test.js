/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadApp } from '../../../src/cli/app/load-app.js';

/** @typedef {(source: any) => void} SourceMutation */
/** @typedef {[string, SourceMutation, RegExp]} InvalidSourceCase */
/** @typedef {[string, (dir: string) => string, RegExp]} InvalidEntrypointCase */
/** @typedef {[string, string, RegExp]} InvalidModuleCase */

/** @returns {any} */
function makeValidSource() {
  return {
    schemaVersion: 4,
    app: { id: 'portable-app' },
    cli: {
      entrypoint: {
        kind: 'node',
        path: './src/cli.js',
        export: 'main',
      },
      durable: {
        workflow: 'greet-later',
        export: 'toDurableInput',
      },
    },
    targets: [
      {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'arm64',
        libc: 'glibc',
      },
    ],
    activities: {
      greet: {
        entrypoint: {
          kind: 'node',
          path: './src/greet.js',
          export: 'greet',
        },
        externalPackages: [
          { name: 'zeta-package', version: '2.0.0' },
          { name: 'alpha-package', version: '1.2.3' },
        ],
      },
    },
    workflows: {
      'greet-later': {
        steps: [
          {
            id: 'greet',
            kind: 'activity',
            activity: 'greet',
            input: { kind: 'workflow-input' },
          },
          { id: 'pause', kind: 'timer', delayMs: 1_000 },
          { id: 'approved', kind: 'signal' },
          {
            id: 'greet-again',
            kind: 'activity',
            activity: 'greet',
            input: { kind: 'step-output', step: 'approved' },
          },
        ],
      },
    },
  };
}

describe('Wharfie app loader', () => {
  /** @type {string} */
  let appDir;
  /** @type {string[]} */
  let cleanupDirs;

  beforeEach(async () => {
    appDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'wharfie-app-v4-'));
    cleanupDirs = [appDir];
    await fsp.mkdir(path.join(appDir, 'src'));
    await Promise.all([
      fsp.writeFile(
        path.join(appDir, 'package.json'),
        JSON.stringify({ type: 'module' }),
      ),
      fsp.writeFile(
        path.join(appDir, 'src', 'cli.js'),
        'export function main() {}\nexport function toDurableInput() { return {}; }\n',
      ),
      fsp.writeFile(
        path.join(appDir, 'src', 'greet.js'),
        'export function greet() {}\n',
      ),
    ]);
  });

  afterEach(async () => {
    await Promise.all(
      cleanupDirs.map((dir) => fsp.rm(dir, { recursive: true, force: true })),
    );
  });

  /** @param {string} sourceText */
  async function writeModule(sourceText) {
    await fsp.writeFile(path.join(appDir, 'wharfie.app.js'), sourceText);
  }

  /** @param {any} source */
  async function loadSource(source) {
    await writeModule(
      'export default ' + JSON.stringify(source, null, 2) + ';\n',
    );
    return loadApp({ dir: appDir });
  }

  it('compiles a strict source definition into one canonical v4 manifest', async () => {
    await expect(loadSource(makeValidSource())).resolves.toEqual({
      appDir,
      manifest: {
        schemaVersion: 4,
        app: { id: 'portable-app' },
        cli: {
          entrypoint: {
            kind: 'node',
            path: 'src/cli.js',
            export: 'main',
          },
          durable: {
            workflow: 'greet-later',
            export: 'toDurableInput',
          },
        },
        targets: [
          {
            nodeVersion: '24.13.1',
            platform: 'linux',
            architecture: 'arm64',
            libc: 'glibc',
          },
        ],
        activities: {
          greet: {
            entrypoint: {
              kind: 'node',
              path: 'src/greet.js',
              export: 'greet',
            },
            externalPackages: [
              { name: 'alpha-package', version: '1.2.3' },
              { name: 'zeta-package', version: '2.0.0' },
            ],
          },
        },
        workflows: {
          'greet-later': {
            steps: [
              {
                id: 'greet',
                kind: 'activity',
                activity: 'greet',
                input: { kind: 'workflow-input' },
              },
              { id: 'pause', kind: 'timer', delayMs: 1_000 },
              { id: 'approved', kind: 'signal' },
              {
                id: 'greet-again',
                kind: 'activity',
                activity: 'greet',
                input: { kind: 'step-output', step: 'approved' },
              },
            ],
          },
        },
      },
    });
  });

  it('keeps the durable CLI handoff optional', async () => {
    const source = makeValidSource();
    delete source.cli.durable;

    const loaded = await loadSource(source);

    expect(loaded.manifest.cli).toEqual({
      entrypoint: {
        kind: 'node',
        path: 'src/cli.js',
        export: 'main',
      },
    });
  });

  it('orders external packages deterministically without using the host locale', async () => {
    const source = makeValidSource();
    source.activities.greet.externalPackages = [
      { name: 'a_b', version: '1.0.0' },
      { name: 'ab', version: '1.0.0' },
      { name: 'a.b', version: '1.0.0' },
      { name: 'a-b', version: '1.0.0' },
    ];

    const loaded = await loadSource(source);

    expect(loaded.manifest.activities.greet.externalPackages).toEqual([
      { name: 'a-b', version: '1.0.0' },
      { name: 'a.b', version: '1.0.0' },
      { name: 'a_b', version: '1.0.0' },
      { name: 'ab', version: '1.0.0' },
    ]);
  });

  /** @type {InvalidSourceCase[]} */
  const invalidSourceCases = [
    [
      'a missing schemaVersion',
      (source) => {
        delete source.schemaVersion;
      },
      /schemaVersion must be the integer 4/i,
    ],
    [
      'a wrong schemaVersion',
      (source) => {
        source.schemaVersion = 3;
      },
      /schemaVersion must be the integer 4/i,
    ],
    [
      'an unknown top-level key',
      (source) => {
        source.debug = true;
      },
      /app\.debug is not supported/i,
    ],
    [
      'an unknown nested key',
      (source) => {
        source.cli.entrypoint.timeout = 100;
      },
      /app\.cli\.entrypoint\.timeout is not supported/i,
    ],
    [
      'the legacy top-level name field',
      (source) => {
        delete source.app;
        source.name = 'portable-app';
      },
      /app\.name is not supported/i,
    ],
    [
      'the legacy functions field',
      (source) => {
        source.functions = [];
      },
      /app\.functions is not supported/i,
    ],
    [
      'the legacy capabilities field',
      (source) => {
        source.capabilities = {};
      },
      /app\.capabilities is not supported/i,
    ],
    [
      'the legacy properties field',
      (source) => {
        source.properties = {};
      },
      /app\.properties is not supported/i,
    ],
    [
      'the removed top-level resources field',
      (source) => {
        source.resources = { db: { adapter: 'vanilla' } };
      },
      /app\.resources is not supported/i,
    ],
    [
      'the removed activity resources field',
      (source) => {
        source.activities.greet.resources = {
          queue: { adapter: 'vanilla' },
        };
      },
      /app\.activities\.greet\.resources is not supported/i,
    ],
    [
      'an empty workflow map',
      (source) => {
        source.workflows = {};
      },
      /manifest\.workflows must not be empty/i,
    ],
    [
      'an unknown workflow field',
      (source) => {
        source.workflows['greet-later'].retry = { attempts: 2 };
      },
      /workflows\.greet-later must contain exactly steps/i,
    ],
    [
      'a workflow activity that is not declared',
      (source) => {
        source.workflows['greet-later'].steps[0].activity = 'missing';
      },
      /steps\[0\]\.activity must reference an activity declared by this manifest/i,
    ],
    [
      'a forward workflow output reference',
      (source) => {
        source.workflows['greet-later'].steps[0].input = {
          kind: 'step-output',
          step: 'approved',
        };
      },
      /steps\[0\]\.input\.step must reference an earlier step/i,
    ],
    [
      'a duplicate workflow step ID',
      (source) => {
        source.workflows['greet-later'].steps[1].id = 'greet';
      },
      /steps\[1\]\.id duplicates an earlier workflow step/i,
    ],
    [
      'a scheduler before a reviewed durable contract exists',
      (source) => {
        source.scheduler = {};
      },
      /app\.scheduler is not supported/i,
    ],
    [
      'an invalid app ID',
      (source) => {
        source.app.id = 'portable_app';
      },
      /app\.id must be a canonical logical ID/i,
    ],
    [
      'an app ID that would require trimming',
      (source) => {
        source.app.id = ' portable-app ';
      },
      /app\.id must be a canonical logical ID/i,
    ],
    [
      'an activity ID that would require trimming',
      (source) => {
        source.activities[' greet '] = source.activities.greet;
        delete source.activities.greet;
      },
      /activities\. greet .*canonical logical ID/i,
    ],
    [
      'a non-object CLI entrypoint',
      (source) => {
        source.cli.entrypoint = './src/cli.js';
      },
      /app\.cli\.entrypoint must be a plain object/i,
    ],
    [
      'a non-Node CLI entrypoint',
      (source) => {
        source.cli.entrypoint.kind = 'wasm';
      },
      /app\.cli\.entrypoint\.kind must be 'node'/i,
    ],
    [
      'a non-canonical entrypoint export',
      (source) => {
        source.cli.entrypoint.export = ' main ';
      },
      /entrypoint\.export must be a nonempty canonical string/i,
    ],
    [
      'a non-object durable CLI handoff',
      (source) => {
        source.cli.durable = 'greet-later';
      },
      /app\.cli\.durable must be a plain object/i,
    ],
    [
      'an unknown durable CLI handoff field',
      (source) => {
        source.cli.durable.input = {};
      },
      /app\.cli\.durable\.input is not supported by schemaVersion 4/i,
    ],
    [
      'a missing durable CLI workflow',
      (source) => {
        delete source.cli.durable.workflow;
      },
      /app\.cli\.durable\.workflow must be a canonical logical ID/i,
    ],
    [
      'a non-canonical durable CLI workflow',
      (source) => {
        source.cli.durable.workflow = ' greet-later ';
      },
      /app\.cli\.durable\.workflow must be a canonical logical ID/i,
    ],
    [
      'a non-canonical durable CLI export',
      (source) => {
        source.cli.durable.export = ' toDurableInput ';
      },
      /app\.cli\.durable\.export must be a nonempty canonical string/i,
    ],
    [
      'a missing durable CLI export',
      (source) => {
        delete source.cli.durable.export;
      },
      /app\.cli\.durable\.export must be a nonempty canonical string/i,
    ],
    [
      'a durable CLI workflow that is not declared',
      (source) => {
        source.cli.durable.workflow = 'missing';
      },
      /manifest\.cli\.durable\.workflow must reference a workflow declared by this manifest/i,
    ],
    [
      'a target with a non-exact Node version',
      (source) => {
        source.targets[0].nodeVersion = '24';
      },
      /nodeVersion must be an exact canonical semantic version/i,
    ],
    [
      'a Linux target without glibc',
      (source) => {
        delete source.targets[0].libc;
      },
      /libc must be 'glibc' for Linux/i,
    ],
    [
      'a duplicate target',
      (source) => {
        source.targets.push({ ...source.targets[0] });
      },
      /duplicates an earlier target/i,
    ],
    [
      'a ranged external package version',
      (source) => {
        source.activities.greet.externalPackages[0].version = '^2.0.0';
      },
      /version must be an exact canonical semantic version/i,
    ],
    [
      'a duplicate external package',
      (source) => {
        source.activities.greet.externalPackages = [
          { name: 'same-package', version: '1.0.0' },
          { name: 'same-package', version: '1.0.0' },
        ];
      },
      /unique packages sorted by name/i,
    ],
  ];

  it.each(invalidSourceCases)('rejects %s', async (_name, mutate, pattern) => {
    const source = makeValidSource();
    mutate(source);
    await expect(loadSource(source)).rejects.toThrow(pattern);
  });

  /** @type {InvalidEntrypointCase[]} */
  const invalidEntrypointCases = [
    [
      'an absolute entrypoint',
      (dir) => path.join(dir, 'src', 'cli.js'),
      /canonical '\.\/'-prefixed app-relative path/i,
    ],
    [
      'an entrypoint with a parent escape',
      () => './../outside.js',
      /without dot segments/i,
    ],
    [
      'a missing entrypoint',
      () => './src/missing.js',
      /must reference an existing file/i,
    ],
  ];

  it.each(invalidEntrypointCases)(
    'rejects %s',
    async (_name, makeEntrypoint, pattern) => {
      const source = makeValidSource();
      source.cli.entrypoint.path = makeEntrypoint(appDir);
      await expect(loadSource(source)).rejects.toThrow(pattern);
    },
  );

  it('rejects an entrypoint that escapes through a symbolic link', async () => {
    const outsideDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-app-outside-'),
    );
    cleanupDirs.push(outsideDir);
    const outsidePath = path.join(outsideDir, 'outside.js');
    await fsp.writeFile(outsidePath, 'export function main() {}\n');
    await fsp.symlink(outsidePath, path.join(appDir, 'src', 'escape.js'));

    const source = makeValidSource();
    source.cli.entrypoint.path = './src/escape.js';

    await expect(loadSource(source)).rejects.toThrow(
      /must not escape.*through a symbolic link/i,
    );
  });

  /** @type {InvalidModuleCase[]} */
  const invalidModuleCases = [
    [
      'an ActorSystem or other class instance',
      'class ActorSystem {} export default new ActorSystem();\n',
      /default export must be a JSON object/i,
    ],
    [
      'a named export without a default export',
      'export const app = ' + JSON.stringify(makeValidSource()) + ';\n',
      /must default-export one schemaVersion 4 app definition/i,
    ],
    [
      'a non-JSON value',
      'const app = ' +
        JSON.stringify(makeValidSource()) +
        '; app.activities.greet.externalPackages[0].version = () => "computed"; export default app;\n',
      /contains an unsupported function value/i,
    ],
  ];

  it.each(invalidModuleCases)(
    'rejects %s',
    async (_name, sourceText, pattern) => {
      await writeModule(sourceText);
      await expect(loadApp({ dir: appDir })).rejects.toThrow(pattern);
    },
  );

  it('rejects removed resources without rendering nested secrets', async () => {
    const secret = 'secret-sentinel-that-must-not-leak';
    const source = makeValidSource();
    source.resources = {
      db: {
        adapter: 'vanilla',
        options: {
          path: 'https://runtime-user:' + secret + '@example.com/db',
        },
      },
    };

    let thrown;
    try {
      await loadSource(source);
    } catch (error) {
      thrown = error;
    }

    if (!(thrown instanceof Error)) {
      throw new Error('Expected loadApp to reject the inline secret.');
    }
    expect(thrown.message).toMatch(/app\.resources is not supported/i);
    expect(thrown.message).not.toContain(secret);
  });
});
