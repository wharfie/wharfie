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

if (!['darwin', 'linux'].includes(process.platform)) {
  throw new Error('The real package SEA smoke test requires macOS or Linux');
}
if (!['arm64', 'x64'].includes(process.arch)) {
  throw new Error(`Unsupported SEA smoke-test architecture: ${process.arch}`);
}

// Every spawned npm/bin command must use the same exact Node binary as the SEA
// blob generator. Developer shells can otherwise resolve a newer global Node
// for an installed `#!/usr/bin/env node` bin and silently test another target.
process.env.PATH = [path.dirname(process.execPath), process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter);

const sourceMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
assert.equal(
  process.versions.node,
  sourceMetadata.engines.node,
  'the SEA smoke test must run under the exact repository Node version',
);

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
    ['install', '--no-audit', '--no-fund', packaged.tarballPath],
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
  assert.equal(installedMetadata.version, sourceMetadata.version);
  const installedLmdbMetadata = readJson(
    path.join(installDirectory, 'node_modules', 'lmdb', 'package.json'),
  );

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
        dependencies: {
          lmdb: installedLmdbMetadata.version,
        },
      },
      null,
      2,
    )}\n`,
  );
  runCommand(
    NPM_COMMAND,
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      `lmdb@${installedLmdbMetadata.version}`,
    ],
    {
      cwd: appDirectory,
      env: {
        ...process.env,
        npm_config_cache: path.join(packaged.directory, 'npm-cache'),
      },
    },
  );
  writeFileSync(
    path.join(sourceDirectory, 'activity.ts'),
    `import { open } from 'lmdb';

type GreetInput = { name?: string };
type GreetRuntime = { caller?: { metadata?: { requestId?: string } } };

export async function greet(
  input: GreetInput = {},
  runtime: GreetRuntime = {},
) {
  const message = \`hello \${input.name || 'world'}\`;
  const database = open({
    path: './lmdb-smoke',
    eventTurnBatching: false,
    commitDelay: 0,
  });
  try {
    database.putSync('greeting', { message });
    return {
      message,
      requestId: runtime.caller?.metadata?.requestId || null,
      runtime: 'activity',
      nativeRecord: database.get('greeting'),
    };
  } finally {
    await database.close();
  }
}

export default greet;
`,
  );
  writeFileSync(
    path.join(sourceDirectory, 'cli.ts'),
    `import { invokeActivity } from '@wharfie/wharfie/app';

export async function main(argv: string[] = process.argv) {
  const [command, ...args] = argv.slice(2);
  if (command === 'probe-cli') {
    const [rawExitCode, ...applicationArgs] = args;
    const exitCode = Number(rawExitCode);
    if (!Number.isSafeInteger(exitCode) || exitCode < 0 || exitCode > 255) {
      throw new Error('probe-cli requires an exit code between 0 and 255');
    }

    let stdin = '';
    for await (const chunk of process.stdin) {
      stdin += String(chunk);
    }

    process.stdout.write(JSON.stringify({
      argvTail: argv.slice(2),
      applicationArgs,
      stdin,
    }) + '\\n');
    process.stderr.write('portable-stderr\\n');
    process.exitCode = exitCode;
    return;
  }

  if (command !== 'greet') {
    throw new Error("Usage: portable-app greet <name>");
  }

  const result = await invokeActivity('greet', {
    input: { name: args[0] || 'world' },
    callerMetadata: { requestId: 'portable-smoke' },
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
  schemaVersion: 2,
  app: { id: 'portable-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.ts',
      export: 'main',
    },
  },
  targets: [{
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
  }],
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activity.ts',
        export: 'greet',
      },
      externalPackages: [{
        name: 'lmdb',
        version: ${JSON.stringify(installedLmdbMetadata.version)},
      }],
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
    nativeRecord: { message: 'hello source-user' },
  });

  const cliProbeArgs = [
    'probe-cli',
    '23',
    'alpha',
    'two words',
    'snowman-☃',
    '',
  ];
  const cliProbeInput = 'first line\nsecond line without newline';
  const expectedCliProbe = {
    argvTail: cliProbeArgs,
    applicationArgs: cliProbeArgs.slice(2),
    stdin: cliProbeInput,
  };
  const sourceCliProbe = spawnSync(
    process.execPath,
    [path.join(appDirectory, 'source-runner.js'), ...cliProbeArgs],
    {
      cwd: appDirectory,
      encoding: 'utf8',
      env: process.env,
      input: cliProbeInput,
      maxBuffer: 20 * 1024 * 1024,
    },
  );
  if (sourceCliProbe.error) throw sourceCliProbe.error;
  assert.equal(sourceCliProbe.signal, null);
  assert.equal(sourceCliProbe.status, 23);
  assert.deepEqual(JSON.parse(sourceCliProbe.stdout), expectedCliProbe);
  assert.equal(sourceCliProbe.stderr, 'portable-stderr\n');

  rmSync(path.join(appDirectory, 'lmdb-smoke'), {
    recursive: true,
    force: true,
  });

  const packageOutput = runCommand(
    wharfieBin,
    [
      'app',
      'package',
      appDirectory,
      '--output-dir',
      outputDirectory,
      '--no-pretty',
    ],
    { cwd: appDirectory, capture: true },
  ).stdout;
  const packageResult = JSON.parse(
    packageOutput.trim().split('\n').filter(Boolean).at(-1),
  );
  assert.match(packageResult.revision.revisionId, /^wrv1_[A-Za-z0-9_-]{43}$/);
  assert.equal(packageResult.artifacts.length, 1);
  const packagedArtifact = packageResult.artifacts[0];
  const artifactName = packagedArtifact.fileName;
  const artifactPath = path.join(outputDirectory, artifactName);
  assert.ok(
    existsSync(artifactPath),
    `Missing generated SEA artifact: ${artifactPath}`,
  );
  assert.equal(packagedArtifact.path, artifactPath);
  assert.ok(
    existsSync(packagedArtifact.recordPath),
    `Missing generated artifact record: ${packagedArtifact.recordPath}`,
  );
  assert.deepEqual(
    readJson(packagedArtifact.recordPath),
    packagedArtifact.record,
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
    nativeRecord: { message: 'hello packaged-user' },
  });

  const generatedCliProbe = spawnSync(cleanArtifactPath, cliProbeArgs, {
    cwd: cleanRunDirectory,
    encoding: 'utf8',
    env: cleanEnvironment,
    input: cliProbeInput,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (generatedCliProbe.error) throw generatedCliProbe.error;
  assert.equal(generatedCliProbe.signal, null);
  assert.equal(generatedCliProbe.status, 23);
  assert.deepEqual(JSON.parse(generatedCliProbe.stdout), expectedCliProbe);
  assert.equal(generatedCliProbe.stderr, 'portable-stderr\n');

  const embeddedManifest = JSON.parse(
    runCommand(cleanArtifactPath, ['wharfie', 'manifest', '--no-pretty'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.equal(embeddedManifest.schemaVersion, 2);
  assert.deepEqual(embeddedManifest.app, { id: 'portable-app' });
  assert.deepEqual(embeddedManifest.targets, [
    {
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: process.arch,
      ...(process.platform === 'linux' ? { libc: 'glibc' } : {}),
    },
  ]);
  assert.deepEqual(embeddedManifest.cli.entrypoint, {
    kind: 'node',
    path: 'src/cli.ts',
    export: 'main',
  });
  assert.equal(
    embeddedManifest.activities.greet.entrypoint.path,
    'src/activity.ts',
  );
  assert.deepEqual(embeddedManifest.activities.greet.externalPackages, [
    { name: 'lmdb', version: installedLmdbMetadata.version },
  ]);

  const embeddedMetadata = JSON.parse(
    runCommand(cleanArtifactPath, ['wharfie', 'metadata', '--no-pretty'], {
      cwd: cleanRunDirectory,
      capture: true,
      env: cleanEnvironment,
    }).stdout,
  );
  assert.equal(
    embeddedMetadata.revision.revisionId,
    packageResult.revision.revisionId,
  );
  assert.deepEqual(embeddedMetadata.revision, packageResult.revision);
  assert.deepEqual(embeddedMetadata.runtime.target, packagedArtifact.target);
  assert.equal(
    embeddedMetadata.runtime.revisionId,
    packagedArtifact.revisionId,
  );
  assert.equal(
    embeddedMetadata.artifact.artifactId,
    packagedArtifact.artifactId,
  );
  assert.deepEqual(
    embeddedMetadata.artifact.byteDigest,
    packagedArtifact.byteDigest,
  );
  assert.equal(embeddedMetadata.artifact.size, packagedArtifact.size);

  const artifactSize = statSync(cleanArtifactPath).size;
  process.stdout.write(
    `Verified installed Wharfie ${installedVersion}, source and generated CLI argv/stdio/exit semantics, source CLI activity, and clean generated ${process.platform} SEA activity with locked LMDB and Node unavailable on PATH (${artifactSize} bytes)\n`,
  );
} finally {
  packaged.cleanup();
  rmSync(installDirectory, { recursive: true, force: true });
  rmSync(cleanRunDirectory, { recursive: true, force: true });
}
