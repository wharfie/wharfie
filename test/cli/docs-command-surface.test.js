/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import appApi, { defineApp, invokeActivity } from '../../src/app.js';
import { createSourceAppCommand } from '../../src/cli/cmds/app.js';
import { createSourceOpsCommand } from '../../src/cli/cmds/ops.js';
import { createProgram as createPackagedOperatorProgram } from '../../src/core/resources/builds/actor-system-cli/index.js';
import {
  isOperatorInvocation,
  OPERATOR_NAMESPACE,
} from '../../src/core/resources/builds/packaged-app-entry.js';
import * as deploymentProfileApi from '../../src/deployment-profile.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const docsToCheck = [
  'docs/README.md',
  'docs/guides/golden-path.md',
  'docs/guides/quickstart.md',
  'docs/guides/installation.md',
  'docs/guides/application-structure.md',
  'contributing/FAQ.md',
  'contributing/project.md',
];

const staleCommands = [
  'wharfie deployment create',
  'wharfie project init',
  'wharfie project plan',
  'wharfie project apply',
  'wharfie project cost',
  'wharfie project dev',
  'wharfie config',
  'wharfie init',
  'wharfie build-self',
  'wharfie ops run --recover',
  '--operation-id',
];

const staleClaims = [
  'runtime resource needs',
  'persisting local operations',
  'pure TypeScript path has a clean generated-SEA release proof',
  'There is no public workflow-start command yet',
  'schema-v5 redacted run view',
  'schema-v6 redacted run view',
  'Wharfie does not yet install it as an OS service',
  'The remaining evidence gate is a clean supported Linux/systemd service lifecycle',
  'Wharfie does not currently expose a purge command',
];

/**
 * @param {import('commander').Command} parent
 * @param {string} name
 * @returns {import('commander').Command}
 */
function findCommand(parent, name) {
  const command = parent.commands.find(
    (candidate) => candidate.name() === name,
  );
  if (!command) {
    throw new Error(`Expected '${parent.name()} ${name}' command.`);
  }
  return command;
}

/**
 * @param {import('commander').Command} command
 * @param {{
 *   name: string,
 *   arguments?: Array<{name: string, required: boolean, variadic: boolean}>,
 *   options: string[],
 *   requiredOptions?: string[]
 * }} expected
 */
function expectCommandShape(
  command,
  { name, arguments: expectedArguments = [], options, requiredOptions = [] },
) {
  expect(command.name()).toBe(name);
  expect(
    command.registeredArguments.map((argument) => ({
      name: argument.name(),
      required: argument.required,
      variadic: argument.variadic,
    })),
  ).toEqual(expectedArguments);
  expect(command.options.map((option) => option.long).sort()).toEqual(
    [...options].sort(),
  );
  expect(
    command.options
      .filter((option) => option.mandatory)
      .map((option) => option.long)
      .sort(),
  ).toEqual([...requiredOptions].sort());
}

describe('docs command surface', () => {
  it('keeps the magnetic copied starter small, separated, and release-gated', async () => {
    const [
      rootMetadataSource,
      starterMetadataSource,
      starterReadme,
      canonicalManifest,
      demoSource,
      verificationSource,
      playgroundReadme,
      quickstart,
      workflow,
    ] = await Promise.all(
      [
        'package.json',
        'examples/hello-world/package.json',
        'examples/hello-world/README.md',
        'examples/hello-world/app/wharfie.app.js',
        'examples/hello-world/scripts/demo.js',
        'scripts/verify-magnetic-first-run.js',
        'examples/hello-world/playground/README.md',
        'docs/guides/quickstart.md',
        '.github/workflows/ci.yml',
      ].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );
    const rootMetadata = JSON.parse(rootMetadataSource);
    const starterMetadata = JSON.parse(starterMetadataSource);

    expect(starterMetadata.devDependencies['@wharfie/wharfie']).toBe(
      rootMetadata.version,
    );
    expect(starterMetadata.engines).toEqual({ node: '>=24.13.1 <25' });
    expect(starterMetadata).not.toHaveProperty('packageManager');
    expect(starterMetadata.scripts.demo).toBe('node ./scripts/demo.js');
    expect(rootMetadata.scripts['verify:magnetic-first-run']).toBe(
      'node ./scripts/verify-magnetic-first-run.js',
    );
    expect(rootMetadata.files).toContain('examples/hello-world/');
    expect(canonicalManifest.trim()).toBe(
      [
        "import { defineApp } from '@wharfie/wharfie/app';",
        '',
        'export default defineApp({',
        "  id: 'hello-world',",
        "  main: './hello.js',",
        '});',
      ].join('\n'),
    );
    expect(starterReadme.indexOf('npm run demo -- Ada')).toBeLessThan(
      starterReadme.indexOf('npm run hello -- Ada'),
    );
    expect(demoSource).toContain('canonicalAppRoot');
    expect(demoSource).toContain('showcaseAppRoot');
    expect(demoSource).toContain('hideDisposableAcceptanceBuilder');
    expect(demoSource).toContain('createArtifactEnvironment');
    expect(verificationSource).toContain(
      'WHARFIE_MAGNETIC_ACCEPTANCE_BUILDER_ROOT: starterRoot',
    );
    expect(verificationSource).toContain(
      ": ['install', '--no-audit', '--no-fund'];",
    );
    expect(demoSource).toContain("'--confirm-sensitive-output'");
    expect(demoSource).toContain(
      'Later process verified the retained terminal output',
    );
    expect(demoSource).not.toContain('/Users/');
    expect(demoSource).not.toContain('file:');
    expect(playgroundReadme).toContain('not onboarding');
    expect(quickstart).toContain('npm run verify:magnetic-first-run');
    expect(workflow).toContain('magnetic-first-run:');
    expect(workflow).toContain('npm run verify:magnetic-first-run');
  });

  it('keeps the runtime app API aligned with its declared public exports', async () => {
    const runtimeModule = await import('../../src/app.js');

    expect(Object.keys(runtimeModule).sort()).toEqual([
      'default',
      'defineApp',
      'invokeActivity',
    ]);
    expect(appApi).toEqual({ defineApp, invokeActivity });
  });

  it('exposes only the narrow deployment-profile authoring API', () => {
    expect(Object.keys(deploymentProfileApi).sort()).toEqual([
      'DEPLOYMENT_MODE',
      'createAwsSingleNodeProvider',
      'createDeploymentProfile',
    ]);

    const profile = deploymentProfileApi.createDeploymentProfile({
      profile: { id: 'production' },
      appId: 'docs-app',
      target: {
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        libc: 'glibc',
      },
      mode: deploymentProfileApi.DEPLOYMENT_MODE,
      provider: deploymentProfileApi.createAwsSingleNodeProvider('us-east-1'),
    });

    expect(profile).toMatchObject({
      schemaVersion: 2,
      kind: 'deploymentProfile',
      profileRevisionId: expect.stringMatching(/^wpr2_[A-Za-z0-9_-]{43}$/),
      appId: 'docs-app',
      provider: {
        kind: 'aws',
        contractVersion: 3,
        scope: { region: 'us-east-1' },
      },
    });
    expect(Object.isFrozen(profile)).toBe(true);
  });

  it('does not advertise unsupported command groups in public docs', async () => {
    const contents = await Promise.all(
      docsToCheck.map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const content of contents) {
      for (const staleCommand of staleCommands) {
        expect(content).not.toContain(staleCommand);
      }
      for (const staleClaim of staleClaims) {
        expect(content).not.toContain(staleClaim);
      }
    }
  });

  it('documents the honest source-only installation path', async () => {
    const installationDoc = await fsp.readFile(
      path.join(repoRoot, 'docs/guides/installation.md'),
      'utf8',
    );

    expect(installationDoc).toContain('npm ci');
    expect(installationDoc).toContain('node ./bin/wharfie --help');
    expect(installationDoc).toContain('standalone builder binary');
    expect(installationDoc).toContain('release-ready binary installer');
    expect(installationDoc).not.toContain('releases/latest');
    expect(installationDoc).not.toContain('install.sh');
    expect(installationDoc).not.toContain('install.ps1');

    await expect(
      fsp.access(path.join(repoRoot, 'install.sh')),
    ).rejects.toThrow();
    await expect(
      fsp.access(path.join(repoRoot, 'install.ps1')),
    ).rejects.toThrow();
  });

  it('narrows the published npm surface to supported CLI modules', async () => {
    const packageJson = JSON.parse(
      await fsp.readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    );

    expect(packageJson.files).toContain('src/core/**');
    expect(packageJson.files).toContain('src/cli/**');
    expect(packageJson.files).not.toContain('src/');
    expect(
      packageJson.files.some((/** @type {string} */ entry) =>
        entry.startsWith('!'),
      ),
    ).toBe(false);
    expect(Object.keys(packageJson.exports).sort()).toEqual([
      '.',
      './app',
      './deployment-profile',
      './package.json',
      './single-node-deployment',
    ]);
    expect(packageJson.files).toEqual(
      expect.arrayContaining([
        'src/deployment-profile.js',
        'src/deployment-profile.d.ts',
      ]),
    );
  });

  it('documents working onboarding commands in the quickstart', async () => {
    const quickstart = await fsp.readFile(
      path.join(repoRoot, 'docs/guides/quickstart.md'),
      'utf8',
    );

    expect(quickstart).toContain('wharfie.app.js');
    expect(quickstart).toContain('wharfie app manifest ./path/to/app');
    expect(quickstart).toContain(
      `wharfie app run <activity-id> --dir ./path/to/app --input '{"who":"cli-user"}'`,
    );
    expect(quickstart).toContain(
      'wharfie ops run --activity <activity-id> --dir ./path/to/app',
    );
    expect(quickstart).toContain(
      'wharfie ops submit --activity <activity-id> --dir ./path/to/app',
    );
    expect(quickstart).toContain(
      'wharfie ops start --workflow <workflow-id> --dir ./path/to/app',
    );
    expect(quickstart).toContain(
      'wharfie ops signal --run-id <run-id> --signal <signal-step-id>',
    );
    expect(quickstart).toContain(
      'wharfie ops list --dir ./path/to/app --limit 50 --json',
    );
    expect(quickstart).toContain(
      'wharfie ops logs --app-id <app-id> --run-id <run-id> --attempt-id <attempt-id>',
    );
    expect(quickstart).toContain(
      'wharfie ops output --app-id <app-id> --run-id <run-id>',
    );
    expect(quickstart).toContain('wharfie ops worker --dir ./path/to/app');
    expect(quickstart).toContain(
      '<app> wharfie submit --activity <activity-id>',
    );
    expect(quickstart).toContain(
      '<app> wharfie start --workflow <workflow-id>',
    );
    expect(quickstart).toContain(
      '<app> wharfie signal --run-id <run-id> --signal <signal-step-id>',
    );
    expect(quickstart).toContain('<app> wharfie list --limit 50 --json');
    expect(quickstart).toContain(
      '<app> wharfie logs --run-id <run-id> --attempt-id <attempt-id>',
    );
    expect(quickstart).toContain('<app> wharfie output --run-id <run-id>');
    expect(quickstart).toContain('<app> wharfie worker');
    expect(quickstart).toContain('<app> wharfie service install');
    expect(quickstart).toContain('<app> wharfie service status --json');
    expect(quickstart).toContain('<desired-app> wharfie service converge');
    expect(quickstart).toContain('<next-app> wharfie service update');
    expect(quickstart).toContain('<next-app> wharfie service rollback');
    expect(quickstart).toContain('<next-app> wharfie service recover');
    expect(quickstart).toContain('<app> wharfie service uninstall');
    expect(quickstart).toContain(
      '<app> wharfie service purge --confirm-data-loss <app-id>',
    );
    expect(quickstart).toContain(
      "} from '@wharfie/wharfie/deployment-profile';",
    );
    expect(quickstart).toContain('createDeploymentProfile({');
    expect(quickstart).toContain(
      'node ./make-deployment-profile.mjs > deployment-profile.json',
    );
    expect(quickstart).toContain(
      'wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy>',
    );
    expect(quickstart).toContain('wharfie deployment apply --plan <plan.json>');
    expect(quickstart).toContain(
      'wharfie deployment inspect <deployment-instance> --region <region>',
    );
    expect(quickstart).toContain(
      'wharfie deployment reconcile <deployment-instance> --region <region>',
    );
    expect(quickstart).toContain(
      'wharfie deployment destroy <deployment-instance> --region <region>',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment apply --deployment <logical-id> --provider aws --region <region> --allow-ssh-from <ipv4/32>...',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment apply --deployment <logical-id> --provider hetzner --location <name> --allow-ssh-from <ipv4/32>...',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment preview --deployment <logical-id> --provider aws --region <region> --allow-ssh-from <ipv4/32>...',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment preview --deployment <logical-id> --provider hetzner --location <name> --allow-ssh-from <ipv4/32>...',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]',
    );
    expect(quickstart).toContain(
      '<next-app> wharfie deployment update --deployment-instance <id> [--data-root <absolute>] [--json]',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment recover --deployment-instance <id> [--data-root <absolute>] [--json]',
    );
    expect(quickstart).toContain(
      'joins it with an exact provider observation and the pinned guest',
    );
    expect(quickstart).toContain(
      "authority is bound to the embedded app identity, not to the\nouter SEA's current revision",
    );
    expect(quickstart).toContain(
      'It creates no missing local state and mutates neither cloud resources\nnor the guest',
    );
    expect(quickstart).toContain(
      'Status accepts no\n`--provider`, `--region`, or `--location`',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment destroy --deployment-instance <id> [--data-root <absolute>] [--json]',
    );
    expect(quickstart).not.toContain(
      '<app> wharfie deployment destroy --deployment-instance <id> --provider',
    );
    expect(quickstart).not.toContain(
      '<app> wharfie deployment destroy --deployment-instance <id> --region',
    );
    expect(quickstart).not.toContain(
      '<app> wharfie deployment destroy --deployment-instance <id> --location',
    );
    expect(quickstart).toContain('wharfie app package --self-deployable');
    expect(quickstart).toContain('ordinary credential chain');
    expect(quickstart).toContain('`HCLOUD_TOKEN`');
    expect(quickstart).toContain(
      'Packaged `deployment inspect` and `deployment reconcile` are not exposed',
    );
    expect(quickstart).toContain('--confirm-coordinator-stopped');
    expect(quickstart).toMatch(/Direct apply defaults to\s+`bootstrap`/);
    expect(quickstart).toMatch(
      /prepared apply, inspect, reconcile, and destroy default to\s+`require-active`/,
    );
    expect(quickstart).toMatch(
      /Source\s+plan JSON contains exact durable staged-artifact evidence/,
    );
    expect(quickstart).not.toContain('Update and rollback remain unavailable');
    expect(quickstart).toContain('--idempotency-key <stable-key>');
    expect(quickstart).not.toContain('--operation-id');
    expect(quickstart).toContain('append-only run → invocation → attempt');
    expect(quickstart).toContain('wharfie ops inspect --run-id <run-id>');
    expect(quickstart).toContain(
      'wharfie ops recover --run-id <run-id> --confirm-runner-stopped',
    );
    expect(quickstart).toContain(
      'wharfie ops cancel --run-id <run-id> --request-id <stable-request-id>',
    );
    expect(quickstart).toContain('<app> wharfie inspect --run-id <run-id>');
    expect(quickstart).toContain(
      '<app> wharfie recover --run-id <run-id> --confirm-runner-stopped',
    );
    expect(quickstart).toContain(
      '<app> wharfie cancel --run-id <run-id> --request-id <stable-request-id>',
    );
    expect(quickstart).toContain(
      'wharfie ops reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped',
    );
    expect(quickstart).toContain(
      '<app> wharfie reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped',
    );
    expect(quickstart).toContain(
      'wharfie ops retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped',
    );
    expect(quickstart).toContain(
      '<app> wharfie retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped',
    );
    expect(quickstart).not.toMatch(/^wharfie list(?:\s|$)/m);
    expect(quickstart).not.toContain('<app> wharfie logs --app-id');
    expect(quickstart).not.toContain('<app> wharfie output --app-id');
    expect(quickstart).not.toContain('wharfie ops output --dir');
    expect(quickstart).not.toContain('<app> wharfie ops cancel');
    expect(quickstart).not.toContain('<app> wharfie ops start');
  });

  it('documents the versioned local application-package handoff', async () => {
    const documents = await Promise.all(
      [
        'README.md',
        'docs/README.md',
        'docs/guides/quickstart.md',
        'src/cli/README.md',
        'docs/architecture/decisions/0030-versioned-application-package-receipt.md',
      ].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const document of documents) {
      expect(document).toContain('wharfie.application.package');
      expect(document).toMatch(/schema-version\s+1/i);
      expect(document).toMatch(/local\s+discovery|discovery data/i);
      expect(document).toMatch(
        /not[\s\S]{0,80}authority|grant no .*authority/i,
      );
    }

    const quickstart = documents[2];
    expect(quickstart).toContain(
      'wharfie app package ./path/to/app --target linux-x64',
    );
    expect(quickstart).toContain('--json --no-pretty > package-receipt.json');
    expect(quickstart).toContain('package-receipt.json');
    expect(quickstart).toContain('receipt.artifactCount');
    expect(quickstart).toContain('receipt.artifacts[0].path');
    expect(quickstart).toContain('"$artifact_path" wharfie service converge');
    expect(quickstart).toContain('Bare `--no-pretty` still\nimplies JSON');
    expect(quickstart).toContain(
      '`--target` filters only a matrix declared in the manifest',
    );
  });

  it('documents the reset-era packaged command and storage migration', async () => {
    const [readme, quickstart, cliReadme, storageDecision, packageDecision] =
      await Promise.all(
        [
          'README.md',
          'docs/guides/quickstart.md',
          'src/cli/README.md',
          'docs/architecture/decisions/0020-systemd-user-service-lifecycle.md',
          'docs/architecture/decisions/0030-versioned-application-package-receipt.md',
        ].map((relativePath) =>
          fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
        ),
      );

    expect(quickstart).toContain('<app> wharfie run --name greet-ada -- Ada');
    expect(quickstart).toContain('<app> wharfie activity run --activity greet');
    expect(quickstart).toContain('exit with 130 and 143 respectively');
    expect(quickstart).not.toMatch(/^<app> wharfie run --activity/m);

    for (const document of [readme, quickstart, cliReadme, packageDecision]) {
      expect(document).toContain('--json --no-pretty');
      expect(document).toMatch(/bare `--no-pretty`/i);
      expect(document).toMatch(/compatibility/);
    }

    for (const document of [readme, quickstart, cliReadme, storageDecision]) {
      expect(document).toContain('WHARFIE_DATA_ROOT');
      expect(document).toMatch(/canonical absolute/);
      expect(document).toMatch(/legacy|retired/);
      expect(document).toMatch(/no automatic|does not automatically/);
    }
  });

  it('keeps the single-host developer preview on the packaged command surface', async () => {
    const document = await fsp.readFile(
      path.join(repoRoot, 'docs/guides/developer-preview.md'),
      'utf8',
    );
    const normalized = document
      .replace(/\\\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ');

    expect(normalized).toContain(
      'npm pack --ignore-scripts --pack-destination /absolute/path/to/wharfie-handoff',
    );
    expect(normalized).toContain(
      'cp -R node_modules/@wharfie/wharfie/examples/steady-file ./steady-file',
    );
    expect(normalized).toContain(
      './node_modules/.bin/wharfie app manifest ./steady-file',
    );
    expect(normalized).toContain(
      './node_modules/.bin/wharfie app package ./steady-file --target node24.13.1-linux-x64-glibc --output-dir ./dist --json',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie start --json -- /absolute/path/to/artifact.tar',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie service install --json',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie list --limit 10 --json',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie inspect --run-id <run-id> --json',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie output --run-id <run-id> --confirm-sensitive-output --json',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie service uninstall --json',
    );
    expect(normalized).toContain(
      '<steady-file> wharfie service purge --confirm-data-loss steady-file-demo --json',
    );
    await expect(
      fsp.access(path.join(repoRoot, 'examples', 'steady-file', 'README.md')),
    ).resolves.toBeUndefined();
  });

  it('keeps every steady-file golden-path invocation on the mounted command surface', async () => {
    const document = await fsp.readFile(
      path.join(repoRoot, 'docs/guides/golden-path.md'),
      'utf8',
    );
    const normalized = document
      .replace(/\\\s*\n\s*/g, ' ')
      .replace(/\s+/g, ' ');

    expect(normalized).toContain(
      'node ./examples/steady-file/local.js /absolute/path/to/artifact.tar',
    );
    expect(normalized).toContain(
      'node ./bin/wharfie app manifest ./examples/steady-file',
    );
    expect(normalized).toContain(
      'node ./bin/wharfie ops start --dir ./examples/steady-file --json -- /absolute/path/to/artifact.tar',
    );
    expect(normalized).toContain(
      `node ./bin/wharfie ops start --dir ./examples/steady-file --workflow verify-stable --input '{"path":"/absolute/path/to/artifact.tar"}' --idempotency-key artifact-build-42 --json`,
    );
    expect(normalized).toContain(
      'node ./bin/wharfie ops worker --dir ./examples/steady-file',
    );
    expect(normalized).toContain(
      'node ./bin/wharfie ops inspect --run-id <run-id> --json',
    );
    expect(normalized).toContain(
      'node ./bin/wharfie ops output --app-id steady-file-demo --run-id <run-id> --confirm-sensitive-output --json',
    );
    expect(normalized).toContain(
      'node ./bin/wharfie app package ./examples/steady-file --target node24.13.1-darwin-arm64 --json',
    );
    expect(document).toContain('--target node24.13.1-linux-x64-glibc');
    expect(document).toContain('--target node24.13.1-linux-arm64-glibc');
    expect(normalized).toContain(
      '<steady-file-artifact> /absolute/path/to/artifact.tar',
    );
    expect(normalized).toContain(
      '<steady-file-artifact> wharfie start --json -- /absolute/path/to/artifact.tar',
    );
    expect(normalized).toContain('<steady-file-artifact> wharfie worker');
    expect(normalized).toContain(
      '<steady-file-artifact> wharfie output --run-id <run-id> --confirm-sensitive-output --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie start --json -- /absolute/path/to/artifact.tar',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie list --limit 10 --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie inspect --run-id <run-id> --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie service status --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie service install --json',
    );
    expect(normalized).toContain(
      '<steady-file-b> wharfie service update --json',
    );
    expect(normalized).toContain(
      '<steady-file-b> wharfie service rollback --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie service uninstall --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie service prune --json',
    );
    expect(normalized).toContain(
      '<steady-file-a> wharfie service purge --confirm-data-loss steady-file-demo --json',
    );

    await expect(
      fsp.access(path.join(repoRoot, 'examples', 'steady-file', 'local.js')),
    ).resolves.toBeUndefined();
    expect(OPERATOR_NAMESPACE).toBe('wharfie');
    expect(
      isOperatorInvocation([
        'node',
        '<steady-file-artifact>',
        '/absolute/path/to/artifact.tar',
      ]),
    ).toBe(false);
    expect(
      isOperatorInvocation([
        'node',
        '<steady-file-artifact>',
        'wharfie',
        'start',
      ]),
    ).toBe(true);

    const sourceApp = createSourceAppCommand();
    expect(sourceApp.name()).toBe('app');
    expectCommandShape(findCommand(sourceApp, 'manifest'), {
      name: 'manifest',
      arguments: [{ name: 'dir', required: false, variadic: false }],
      options: ['--json', '--no-pretty'],
    });
    expectCommandShape(findCommand(sourceApp, 'package'), {
      name: 'package',
      arguments: [{ name: 'dir', required: false, variadic: false }],
      options: [
        '--output-dir',
        '--target',
        '--self-deployable',
        '--json',
        '--no-pretty',
      ],
    });

    const sourceOps = createSourceOpsCommand();
    expect(sourceOps.name()).toBe('ops');
    expectCommandShape(findCommand(sourceOps, 'start'), {
      name: 'start',
      arguments: [{ name: 'appArgs', required: false, variadic: true }],
      options: [
        '--dir',
        '--workflow',
        '--idempotency-key',
        '--input',
        '--caller-metadata',
        '--json',
      ],
    });
    expectCommandShape(findCommand(sourceOps, 'worker'), {
      name: 'worker',
      options: ['--dir'],
    });
    expectCommandShape(findCommand(sourceOps, 'inspect'), {
      name: 'inspect',
      options: ['--run-id', '--json'],
    });
    expectCommandShape(findCommand(sourceOps, 'output'), {
      name: 'output',
      options: ['--app-id', '--run-id', '--confirm-sensitive-output', '--json'],
    });

    const packagedOperator = createPackagedOperatorProgram();
    expect(packagedOperator.name()).toBe('wharfie');
    expectCommandShape(findCommand(packagedOperator, 'run'), {
      name: 'run',
      arguments: [{ name: 'appArgs', required: false, variadic: true }],
      options: ['--name'],
      requiredOptions: ['--name'],
    });
    const packagedActivity = findCommand(packagedOperator, 'activity');
    expectCommandShape(packagedActivity, {
      name: 'activity',
      options: [],
    });
    expectCommandShape(findCommand(packagedActivity, 'run'), {
      name: 'run',
      options: [
        '--activity',
        '--input',
        '--caller-metadata',
        '--idempotency-key',
        '--json',
      ],
    });
    expectCommandShape(findCommand(packagedOperator, 'start'), {
      name: 'start',
      arguments: [{ name: 'appArgs', required: false, variadic: true }],
      options: [
        '--workflow',
        '--idempotency-key',
        '--input',
        '--caller-metadata',
        '--json',
      ],
    });
    expectCommandShape(findCommand(packagedOperator, 'worker'), {
      name: 'worker',
      options: [],
    });
    expectCommandShape(findCommand(packagedOperator, 'list'), {
      name: 'list',
      options: ['--limit', '--cursor', '--json'],
    });
    expectCommandShape(findCommand(packagedOperator, 'inspect'), {
      name: 'inspect',
      options: ['--run-id', '--json'],
    });
    expectCommandShape(findCommand(packagedOperator, 'output'), {
      name: 'output',
      options: ['--run-id', '--confirm-sensitive-output', '--json'],
    });
    const packagedService = findCommand(packagedOperator, 'service');
    expectCommandShape(packagedService, {
      name: 'service',
      options: [],
    });
    for (const action of [
      'install',
      'status',
      'update',
      'rollback',
      'uninstall',
      'prune',
    ]) {
      expectCommandShape(findCommand(packagedService, action), {
        name: action,
        options: ['--json'],
      });
    }
    expectCommandShape(findCommand(packagedService, 'purge'), {
      name: 'purge',
      options: ['--confirm-data-loss', '--json'],
    });
  });

  it('documents the explicit sensitive activity-log disclosure boundary', async () => {
    const documents = await Promise.all(
      [
        'README.md',
        'docs/guides/quickstart.md',
        'src/cli/README.md',
        'docs/architecture/decisions/0023-sensitive-activity-log-disclosure.md',
      ].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const document of documents) {
      expect(document).toContain('wharfie ops logs');
      expect(document).toContain('<app> wharfie logs');
      expect(document).toContain('--confirm-sensitive-output');
      expect(document).toContain('application-sensitive-unredacted');
      expect(document).toMatch(/non-authoritative/i);
      expect(document).toMatch(/tail|tailing/);
    }
  });

  it('documents the explicit sensitive logical run-output boundary', async () => {
    const documents = await Promise.all(
      [
        'README.md',
        'docs/guides/quickstart.md',
        'src/cli/README.md',
        'docs/architecture/decisions/0031-verified-sensitive-run-output.md',
      ].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const document of documents) {
      const normalized = document
        .replace(/\\\s*\n\s*/g, ' ')
        .replace(/\s+/g, ' ');

      expect(normalized).toContain(
        'wharfie ops output --app-id <app-id> --run-id <run-id> --confirm-sensitive-output',
      );
      expect(normalized).toContain(
        '<app> wharfie output --run-id <run-id> --confirm-sensitive-output',
      );
      expect(document).toContain('wharfie.execution-ledger.run-output');
      expect(document).toContain('application-sensitive-unredacted');
      expect(document).toMatch(
        /non-authoritative|grants? no authority|authority `none`/i,
      );
      expect(normalized).toMatch(
        /raw application-controlled values.{0,160}(secret|internal-looking)/i,
      );
      expect(document).toMatch(/polling/i);
      expect(document).toMatch(/terminal/i);
      expect(document).toMatch(
        /inspect[\s\S]{0,100}redacted|redacted[\s\S]{0,100}inspect/i,
      );
    }
  });

  it('documents the public linear workflow operator boundary', async () => {
    const documents = await Promise.all(
      [
        'README.md',
        'docs/README.md',
        'docs/guides/quickstart.md',
        'docs/guides/application-structure.md',
        'src/cli/README.md',
      ].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const document of documents) {
      expect(document).toContain('wharfie ops start');
      expect(document).toContain('<app> wharfie start');
      expect(document).toContain('wharfie ops signal');
      expect(document).toContain('<app> wharfie signal');
      expect(document).toMatch(/activity[\s\S]*timer[\s\S]*signal/i);
      expect(document).toMatch(
        /workflow-aware|workflow cursor|activation-aware cursor/,
      );
      expect(document).toMatch(
        /workflow\s+cancellation|workflow `cancel`|run-level `cancel`/i,
      );
      expect(document).toContain('stable-delivery-id');
      expect(document).toContain('early-signal');
      expect(document).toContain('unexpected-signal');
      expect(document).toContain('late-signal');
      expect(document).toContain('schema-v8');
    }

    const quickstart = documents[2];
    expect(quickstart).toContain('schema-v8 redacted run view');
    expect(quickstart).toContain('reused: true');
    expect(quickstart).toContain('original uncertainty event');
    expect(quickstart).not.toContain('schema-v5 redacted run view');
    expect(quickstart).not.toContain('schema-v6 redacted run view');
  });

  it('documents the trusted redacted effect-reconciliation contract', async () => {
    const documents = await Promise.all(
      ['README.md', 'docs/guides/quickstart.md'].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const document of documents) {
      expect(document).toContain(
        'wharfie ops reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped',
      );
      expect(document).toContain(
        '<app> wharfie reconcile-effect --run-id <run-id> --effect-id <effect-id> --reconciliation-id <stable-id> --confirm-runner-stopped',
      );
      expect(document).toContain('app-scoped LMDB local-owner protocol');
      expect(document).toContain('after a lost response');
      expect(document).toContain('redacted');
    }
  });

  it('documents the finite public managed-effect successor contract', async () => {
    const documents = await Promise.all(
      ['README.md', 'docs/guides/quickstart.md'].map((relativePath) =>
        fsp.readFile(path.join(repoRoot, relativePath), 'utf8'),
      ),
    );

    for (const document of documents) {
      expect(document).toContain(
        'wharfie ops retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped',
      );
      expect(document).toContain(
        '<app> wharfie retry-effect --run-id <run-id> --effect-id <effect-id> --successor-id <stable-id> --confirm-runner-stopped',
      );
      expect(document).toContain('after a lost response');
      expect(document).toContain('one retained target');
      expect(document).toContain('redacted `--json`');
      expect(document).toContain('dedicated effect-only lifecycle');
      expect(document).toMatch(
        /never\s+redispatches\s+the\s+abandoned authored activity/,
      );
      expect(document).toContain('not generic handler\nretry or compensation');
    }
  });
});
