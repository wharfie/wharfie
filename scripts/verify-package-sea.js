import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  createPackageTarball,
  NPM_COMMAND,
  readJson,
  REPO_ROOT,
  runCommand,
} from './package-verification.js';

if (process.platform !== 'linux') {
  throw new Error('The real package SEA smoke test must run on Linux');
}
if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported Linux smoke-test architecture: ${process.arch}`);
}

const packaged = createPackageTarball();
const installDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'wharfie-package-install-'),
);
const cleanRunDirectory = mkdtempSync(
  path.join(os.tmpdir(), 'wharfie-generated-sea-run-'),
);

try {
  writeFileSync(
    path.join(installDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'wharfie-package-smoke',
        private: true,
        version: '0.0.0',
      },
      null,
      2,
    )}\n`,
  );

  runCommand(
    NPM_COMMAND,
    [
      'install',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      packaged.tarballPath,
    ],
    {
      cwd: installDirectory,
      env: {
        ...process.env,
        npm_config_cache: path.join(packaged.directory, 'npm-cache'),
      },
    },
  );

  const installedPackageRoot = path.join(
    installDirectory,
    'node_modules',
    '@wharfie',
    'wharfie',
  );
  const installedMetadata = readJson(
    path.join(installedPackageRoot, 'package.json'),
  );
  const sourceMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
  assert.equal(installedMetadata.version, sourceMetadata.version);

  const wharfieBin = path.join(
    installDirectory,
    'node_modules',
    '.bin',
    'wharfie',
  );
  assert.ok(
    existsSync(wharfieBin),
    `Missing installed bin link: ${wharfieBin}`,
  );

  const installedVersion = runCommand(wharfieBin, ['--version'], {
    cwd: installDirectory,
    capture: true,
  }).stdout.trim();
  assert.equal(installedVersion, installedMetadata.version);

  const appDirectory = path.join(installDirectory, 'portable-app');
  const sourceDirectory = path.join(appDirectory, 'src');
  const outputDirectory = path.join(appDirectory, 'dist');
  mkdirSync(sourceDirectory, { recursive: true });

  writeFileSync(
    path.join(appDirectory, 'package.json'),
    `${JSON.stringify(
      {
        name: 'wharfie-generated-sea-smoke',
        private: true,
        type: 'module',
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    path.join(sourceDirectory, 'activity.ts'),
    `type GreetEvent = { name?: string };
type GreetContext = { requestId?: string };

export async function greet(
  event: GreetEvent = {},
  context: GreetContext = {},
) {
  return {
    message: \`hello \${event.name || 'world'}\`,
    requestId: context.requestId || null,
    runtime: 'activity',
  };
}

export default greet;
`,
  );
  writeFileSync(
    path.join(sourceDirectory, 'cli.ts'),
    `import { invokeActivity } from '@wharfie/wharfie/app';

export async function main(argv: string[] = process.argv) {
  const [command, name] = argv.slice(2);
  if (command !== 'greet') {
    throw new Error("Usage: portable-app greet <name>");
  }

  const result = await invokeActivity('greet', {
    event: { name: name || 'world' },
    context: { requestId: 'portable-smoke' },
  });
  process.stdout.write(JSON.stringify(result) + '\\n');
}

export default main;
`,
  );
  writeFileSync(
    path.join(appDirectory, 'source-runner.js'),
    `import { main } from './src/cli.ts';
await main(process.argv);
`,
  );
  writeFileSync(
    path.join(appDirectory, 'wharfie.app.js'),
    `import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  name: 'portable-app',
  cli: {
    entrypoint: './src/cli.ts',
    export: 'main',
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
  }],
  activities: {
    greet: {
      entrypoint: {
        path: './src/activity.ts',
        export: 'greet',
      },
    },
  },
});
`,
  );

  const sourceResult = JSON.parse(
    runCommand(
      process.execPath,
      [path.join(appDirectory, 'source-runner.js'), 'greet', 'source-user'],
      { cwd: appDirectory, capture: true },
    ).stdout,
  );
  assert.deepEqual(sourceResult, {
    message: 'hello source-user',
    requestId: 'portable-smoke',
    runtime: 'activity',
  });

  runCommand(
    wharfieBin,
    [
      'app',
      'package',
      appDirectory,
      '--output-dir',
      outputDirectory,
      '--no-pretty',
    ],
    { cwd: appDirectory },
  );

  const artifactName = `portable-app-node${process.versions.node}-linux-${process.arch}-glibc`;
  const artifactPath = path.join(outputDirectory, artifactName);
  assert.ok(
    existsSync(artifactPath),
    `Missing generated SEA artifact: ${artifactPath}`,
  );

  const cleanArtifactPath = path.join(cleanRunDirectory, artifactName);
  copyFileSync(artifactPath, cleanArtifactPath);
  chmodSync(cleanArtifactPath, 0o755);

  const emptyBinDirectory = path.join(cleanRunDirectory, 'empty-bin');
  mkdirSync(emptyBinDirectory);
  const cleanEnvironment = {
    HOME: cleanRunDirectory,
    LANG: 'C.UTF-8',
    PATH: emptyBinDirectory,
    TZ: 'UTC',
  };
  const unavailableNode = spawnSync('node', ['--version'], {
    encoding: 'utf8',
    env: cleanEnvironment,
  });
  assert.equal(
    unavailableNode.error?.code,
    'ENOENT',
    'Clean SEA smoke environment unexpectedly exposes a Node executable',
  );
  const generatedResult = JSON.parse(
    runCommand(cleanArtifactPath, ['greet', 'packaged-user'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.deepEqual(generatedResult, {
    message: 'hello packaged-user',
    requestId: 'portable-smoke',
    runtime: 'activity',
  });

  const embeddedManifest = JSON.parse(
    runCommand(cleanArtifactPath, ['wharfie', 'manifest', '--no-pretty'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.deepEqual(embeddedManifest.app, { name: 'portable-app' });
  assert.deepEqual(embeddedManifest.targets, [
    {
      nodeVersion: process.versions.node,
      platform: 'linux',
      architecture: process.arch,
      libc: 'glibc',
    },
  ]);
  assert.equal(embeddedManifest.cli.entrypoint, 'wharfie:embedded/cli');
  assert.equal(
    embeddedManifest.activities.greet.entrypoint.path,
    'wharfie:embedded/activity/greet',
  );

  const artifactSize = statSync(cleanArtifactPath).size;
  process.stdout.write(
    `Verified installed Wharfie ${installedVersion}, source CLI activity, and clean generated Linux SEA activity with Node unavailable on PATH (${artifactSize} bytes)\n`,
  );
} finally {
  packaged.cleanup();
  rmSync(installDirectory, { recursive: true, force: true });
  rmSync(cleanRunDirectory, { recursive: true, force: true });
}
