/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import appApi, { defineApp, invokeActivity } from '../../src/app.js';
import * as deploymentProfileApi from '../../src/deployment-profile.js';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

const docsToCheck = [
  'docs/README.md',
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
];

describe('docs command surface', () => {
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
    expect(quickstart).toContain('<app> wharfie worker');
    expect(quickstart).toContain('<app> wharfie service install');
    expect(quickstart).toContain('<app> wharfie service status --json');
    expect(quickstart).toContain('<desired-app> wharfie service converge');
    expect(quickstart).toContain('<next-app> wharfie service update');
    expect(quickstart).toContain('<next-app> wharfie service rollback');
    expect(quickstart).toContain('<next-app> wharfie service recover');
    expect(quickstart).toContain('<app> wharfie service uninstall');
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
      '<app> wharfie deployment plan <deployment> --profile <canonical-profile.json> --control-policy <policy>',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment apply --plan <plan.json>',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment inspect <deployment-instance> --region <region>',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment reconcile <deployment-instance> --region <region>',
    );
    expect(quickstart).toContain(
      '<app> wharfie deployment destroy <deployment-instance> --region <region>',
    );
    expect(quickstart).toContain('--confirm-coordinator-stopped');
    expect(quickstart).toMatch(/Direct apply defaults to\s+`bootstrap`/);
    expect(quickstart).toMatch(
      /prepared apply, inspect, reconcile, and destroy default to\s+`require-active`/,
    );
    expect(quickstart).toMatch(
      /Source\s+plan JSON contains exact durable staged-artifact evidence[\s\S]+Packaged\s+plan JSON omits that evidence/,
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
    expect(quickstart).not.toContain('<app> wharfie ops cancel');
    expect(quickstart).not.toContain('<app> wharfie ops start');
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
      expect(document).toContain('schema-v7');
    }

    const quickstart = documents[2];
    expect(quickstart).toContain('schema-v7 redacted run view');
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
