/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  assertPreviewReleaseMetadata,
  assertPreviewReleaseTag,
  formatSha256Sums,
  parsePreviewReleaseArgs,
  PREVIEW_TARGET,
  stringifyPreviewReleaseManifest,
} from '../../scripts/build-preview-release.js';
import appManifest from '../../wharfie.app.js';

const packageMetadata = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
);

/**
 * @param {string} workflow - Workflow source.
 * @returns {string[]} Referenced action coordinates.
 */
function actionReferences(workflow) {
  return [...workflow.matchAll(/^\s*(?:-\s+)?uses:\s+([^\s#]+)/gmu)].map(
    (match) => match[1],
  );
}

/**
 * @param {string} job - One workflow job section.
 * @returns {string[]} Explicit job permissions.
 */
function jobPermissions(job) {
  const match = /\n {4}permissions:\n((?: {6}[^\n]+\n)+) {4}steps:/u.exec(job);
  if (!match) return [];
  return match[1]
    .trim()
    .split('\n')
    .map((line) => line.trim());
}

describe('preview release contract', () => {
  it('binds publishable metadata to the exact standalone target', () => {
    expect(assertPreviewReleaseMetadata(packageMetadata, appManifest)).toEqual({
      version: '0.0.15',
      tag: 'v0.0.15',
    });
    expect(PREVIEW_TARGET).toEqual({
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    });
  });

  it('requires the package version tag and parses only bounded options', () => {
    expect(
      parsePreviewReleaseArgs([
        '--tag',
        'v0.0.15',
        '--output-dir',
        '/tmp/preview',
      ]),
    ).toEqual({
      check: false,
      tag: 'v0.0.15',
      outputDir: '/tmp/preview',
    });
    expect(parsePreviewReleaseArgs(['--check'])).toEqual({ check: true });
    expect(() => parsePreviewReleaseArgs(['--publish'])).toThrow(
      /Unknown preview release option/u,
    );
    expect(() => assertPreviewReleaseTag('v0.0.16', '0.0.15')).toThrow(
      /must be exactly v0\.0\.15/u,
    );
  });

  it('writes canonical manifests and sorted checksums', () => {
    expect(stringifyPreviewReleaseManifest({ z: 1, a: { z: 2, a: 3 } })).toBe(
      '{\n  "a": {\n    "a": 3,\n    "z": 2\n  },\n  "z": 1\n}\n',
    );
    expect(
      formatSha256Sums([
        { fileName: 'z.tgz', sha256: '2222' },
        { fileName: 'a', sha256: '1111' },
      ]),
    ).toBe('1111  a\n2222  z.tgz\n');
  });

  it('keeps release publication guarded and the dry run in ordinary CI', () => {
    const workflow = readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'release-preview.yml'),
      'utf8',
    );
    const ci = readFileSync(
      path.join(process.cwd(), '.github', 'workflows', 'ci.yml'),
      'utf8',
    );
    for (const expected of [
      "tags:\n      - 'v*'",
      "node-version-file: '.nvmrc'",
      'npm run test:ci',
      'npm run build:release:preview',
      'uses: actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4',
      'environment: npm-preview',
      'environment: npm-preview-promotion',
      "vars.WHARFIE_PREVIEW_PUBLISH_ENABLED == 'true'",
      'node ./scripts/assert-preview-publish.js',
      'node ./scripts/publish-preview-release.js',
      'needs: [attest, consumer]',
      'node ./scripts/verify-preview-consumer.js',
      '--defer-finalize',
      'registry-consumer:',
      'needs: [publish, registry-consumer, draft-recipient]',
      '--finalize-only',
      '--registry-manifest',
      'wharfie-aws-${version}.tgz',
    ]) {
      expect(workflow).toContain(expected);
    }
    const allowedActionReferences = new Set([
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
      'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
      'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6',
    ]);
    const requiredSharedActionReferences = [
      'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803',
      'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
      'actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f',
      'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    ];
    const releaseActionReferences = actionReferences(workflow);
    const ciActionReferences = actionReferences(ci);
    for (const reference of requiredSharedActionReferences) {
      expect(releaseActionReferences).toContain(reference);
      expect(ciActionReferences).toContain(reference);
    }
    expect(releaseActionReferences).toContain(
      'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6',
    );
    for (const workflowText of [workflow, ci]) {
      const references = actionReferences(workflowText);
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(reference).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/u);
        expect(allowedActionReferences.has(reference)).toBe(true);
      }
      const npmBootstraps = workflowText
        .split('\n')
        .filter((line) => line.includes('npm install --global'));
      expect(npmBootstraps.length).toBeGreaterThan(0);
      for (const bootstrap of npmBootstraps) {
        expect(bootstrap).toContain('--ignore-scripts');
        expect(bootstrap).toContain('--no-audit');
        expect(bootstrap).toContain('--no-fund');
        expect(bootstrap).toContain('--registry=https://registry.npmjs.org');
      }
    }
    expect(workflow).not.toMatch(/uses:\s+actions\/[^@\s]+@v\d+/u);
    expect(ci).not.toMatch(/uses:\s+actions\/[^@\s]+@v\d+/u);
    expect(workflow).not.toContain('post-publish-consumer:');
    expect(workflow).not.toContain('persist-credentials: true');
    expect(
      workflow.match(
        /uses: actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/gu,
      ) || [],
    ).toHaveLength(
      (workflow.match(/persist-credentials: false/gu) || []).length,
    );
    const publishIndex = workflow.indexOf('\n  publish:');
    const buildIndex = workflow.indexOf('\n  build:');
    const attestIndex = workflow.indexOf('\n  attest:');
    const consumerIndex = workflow.indexOf('\n  consumer:');
    const registryConsumerIndex = workflow.indexOf('\n  registry-consumer:');
    const draftRecipientIndex = workflow.indexOf('\n  draft-recipient:');
    const finalizeIndex = workflow.indexOf('\n  finalize:');
    const publicRecipientIndex = workflow.indexOf('\n  public-recipient:');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(attestIndex).toBeGreaterThan(buildIndex);
    expect(consumerIndex).toBeGreaterThan(attestIndex);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(registryConsumerIndex).toBeGreaterThan(publishIndex);
    expect(draftRecipientIndex).toBeGreaterThan(registryConsumerIndex);
    expect(finalizeIndex).toBeGreaterThan(draftRecipientIndex);
    expect(publicRecipientIndex).toBeGreaterThan(finalizeIndex);
    const buildJob = workflow.slice(buildIndex, attestIndex);
    const attestJob = workflow.slice(attestIndex, consumerIndex);
    const publishJob = workflow.slice(publishIndex, registryConsumerIndex);
    const registryConsumerJob = workflow.slice(
      registryConsumerIndex,
      draftRecipientIndex,
    );
    const draftRecipientJob = workflow.slice(
      draftRecipientIndex,
      finalizeIndex,
    );
    const finalizeJob = workflow.slice(finalizeIndex, publicRecipientIndex);
    const publicRecipientJob = workflow.slice(publicRecipientIndex);
    expect(jobPermissions(buildJob)).toEqual([]);
    expect(attestJob).toContain('needs: build');
    expect(jobPermissions(attestJob)).toEqual([
      'contents: read',
      'id-token: write',
      'attestations: write',
    ]);
    expect(attestJob).not.toContain('artifact-metadata: write');
    expect(jobPermissions(publishJob)).toEqual([
      'contents: write',
      'id-token: write',
    ]);
    expect(publishJob).toContain('fetch-depth: 0');
    expect(publishJob).toContain('--defer-finalize');
    expect(publishJob.indexOf('verify publication guard')).toBeLessThan(
      publishJob.indexOf('install pinned npm'),
    );
    expect(registryConsumerJob).toContain('needs: publish');
    expect(jobPermissions(registryConsumerJob)).toEqual([]);
    expect(registryConsumerJob).not.toContain('GH_TOKEN');
    expect(draftRecipientJob).toContain('needs: publish');
    expect(draftRecipientJob).toContain('timeout-minutes: 120');
    expect(jobPermissions(draftRecipientJob)).toEqual(['contents: write']);
    expect(draftRecipientJob).toContain('GH_TOKEN: ${{ github.token }}');
    expect(draftRecipientJob).toContain('--tag "$GITHUB_REF_NAME" --draft');
    expect(draftRecipientJob).not.toContain('actions/download-artifact');
    expect(draftRecipientJob).not.toContain('--artifact-dir');
    expect(draftRecipientJob).not.toContain('--download-only');
    expect(finalizeJob).toContain(
      'needs: [publish, registry-consumer, draft-recipient]',
    );
    expect(finalizeJob).toContain('environment: npm-preview-promotion');
    expect(finalizeJob).toContain('fetch-depth: 0');
    expect(jobPermissions(finalizeJob)).toEqual(['contents: write']);
    expect(finalizeJob).toContain('--finalize-only');
    expect(finalizeJob.indexOf('verify publication guard')).toBeLessThan(
      finalizeJob.indexOf('install pinned npm'),
    );
    expect(publicRecipientJob).toContain('needs: finalize');
    expect(publicRecipientJob).toContain('timeout-minutes: 30');
    expect(jobPermissions(publicRecipientJob)).toEqual(['contents: read']);
    expect(publicRecipientJob).toContain('env -u GH_TOKEN -u GITHUB_TOKEN');
    expect(publicRecipientJob).toContain(
      '--tag "$GITHUB_REF_NAME" --download-only',
    );
    expect(publicRecipientJob).not.toContain('${{ github.token }}');
    expect(publicRecipientJob).not.toContain('--draft');
    expect(publicRecipientJob).not.toContain('actions/download-artifact');
    for (const recipientJob of [draftRecipientJob, publicRecipientJob]) {
      expect(recipientJob).toContain(
        'node ./scripts/verify-preview-recipient.js',
      );
      expect(recipientJob).toContain('--expected-commit "$GITHUB_SHA"');
      expect(recipientJob).toContain('--report "$RUNNER_TEMP/');
      expect(recipientJob).toContain('if: ${{ always() }}');
      expect(recipientJob).not.toContain('publish-preview-release.js');
      expect(recipientJob).not.toContain('id-token: write');
    }
    const selfHostIndex = ci.indexOf('\n  preview-self-host:');
    const recipientIndex = ci.indexOf('\n  preview-recipient:');
    const previewConsumerIndex = ci.indexOf('\n  preview-consumer:');
    expect(recipientIndex).toBeGreaterThan(selfHostIndex);
    expect(previewConsumerIndex).toBeGreaterThan(recipientIndex);
    const selfHostJob = ci.slice(selfHostIndex, recipientIndex);
    const recipientJob = ci.slice(recipientIndex, previewConsumerIndex);
    expect(selfHostJob).toContain('name: wharfie-preview-recipient-candidate');
    expect(selfHostJob).toContain(
      'path: ${{ runner.temp }}/wharfie-preview-release/',
    );
    expect(recipientJob).toContain('needs: preview-self-host');
    expect(recipientJob).toContain('timeout-minutes: 105');
    expect(recipientJob).toContain('name: wharfie-preview-recipient-candidate');
    expect(recipientJob).toContain(
      '--artifact-dir "$RUNNER_TEMP/wharfie-preview-recipient-candidate"',
    );
    expect(recipientJob).toContain('--expected-commit "$GITHUB_SHA"');
    expect(recipientJob).not.toContain('--download-only');
    expect(recipientJob).not.toContain('GH_TOKEN');
    for (const fullProofJob of [recipientJob, draftRecipientJob]) {
      expect(fullProofJob).toContain(
        'bash scripts/prepare-preview-recipient-github-linux.sh',
      );
      expect(fullProofJob).toContain(
        'WHARFIE_PREVIEW_RECIPIENT_DISPOSABLE: github-actions',
      );
      expect(fullProofJob).toContain(
        '--cleanup "$RUNNER_TEMP/wharfie-recipient-account-cleanup.json"',
      );
      expect(fullProofJob.indexOf('--cleanup')).toBeGreaterThan(
        fullProofJob.indexOf('node ./scripts/verify-preview-recipient.js'),
      );
      expect(fullProofJob).toContain(
        'path: |\n            ${{ runner.temp }}/wharfie-',
      );
    }
    expect(ci).toContain('permissions:\n  contents: read');
    expect(ci).toContain(
      'env:\n  NPM_CONFIG_REGISTRY: https://registry.npmjs.org',
    );
    expect(workflow).toContain(
      'env:\n  NPM_CONFIG_REGISTRY: https://registry.npmjs.org',
    );
    expect(ci).toContain("node-version-file: '.nvmrc'");
    expect(ci).toContain('npm run verify:release:preview');
  });

  it('owns the exact socket root and keeps native temporary files inside the recipient home', () => {
    const preparation = readFileSync(
      path.join(
        process.cwd(),
        'scripts/prepare-preview-recipient-github-linux.sh',
      ),
      'utf8',
    );
    const socketPreflight =
      '[[ ! -e /tmp/wharfie-60707 && ! -L /tmp/wharfie-60707 ]] || exit 1';
    expect(preparation).toContain(socketPreflight);
    expect(preparation.indexOf(socketPreflight)).toBeLessThan(
      preparation.indexOf('fd = os.open(marker, os.O_CREAT | os.O_EXCL'),
    );
    expect(preparation).toContain("socket_root = Path('/tmp/wharfie-60707')");
    expect(preparation).toContain('socket_info = socket_root.lstat()');
    expect(preparation).toContain(
      'assert stat.S_ISDIR(socket_info.st_mode) and socket_info.st_uid == uid',
    );
    expect(preparation).toContain(
      'assert shutil.rmtree.avoids_symlink_attacks',
    );
    expect(preparation).toContain('            shutil.rmtree(socket_root)');
    expect(preparation.indexOf('shutil.rmtree(socket_root)')).toBeGreaterThan(
      preparation.indexOf("run('/usr/sbin/userdel', '--remove', name)"),
    );
    expect(preparation).toContain(
      "report['socketRootAbsent'] = absent(socket_root)",
    );
    expect(preparation).toContain(
      "'runtimeAbsent', 'socketRootAbsent', 'lingerAbsent'",
    );
    expect(
      preparation.match(/TMPDIR=\/home\/wharfie-recipient\/recipient\/tmp/gu),
    ).toHaveLength(2);
    expect(preparation).toContain('  /home/wharfie-recipient/recipient/tmp\n');
  });

  it.each([
    { GITHUB_ACTIONS: 'false', RUNNER_ENVIRONMENT: 'github-hosted' },
    { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'self-hosted' },
  ])(
    'refuses recipient preparation outside the disposable runner: %j',
    (env) => {
      const result = spawnSync(
        '/bin/bash',
        ['scripts/prepare-preview-recipient-github-linux.sh'],
        {
          cwd: process.cwd(),
          env: { PATH: '/usr/bin:/bin', ...env },
          encoding: 'utf8',
        },
      );
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    },
  );
});
