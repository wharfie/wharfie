/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { readFileSync } from 'node:fs';
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
      'needs: [publish, registry-consumer]',
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
    const finalizeIndex = workflow.indexOf('\n  finalize:');
    expect(buildIndex).toBeGreaterThan(-1);
    expect(attestIndex).toBeGreaterThan(buildIndex);
    expect(consumerIndex).toBeGreaterThan(attestIndex);
    expect(publishIndex).toBeGreaterThan(-1);
    expect(registryConsumerIndex).toBeGreaterThan(publishIndex);
    expect(finalizeIndex).toBeGreaterThan(registryConsumerIndex);
    const buildJob = workflow.slice(buildIndex, attestIndex);
    const attestJob = workflow.slice(attestIndex, consumerIndex);
    const publishJob = workflow.slice(publishIndex, registryConsumerIndex);
    const registryConsumerJob = workflow.slice(
      registryConsumerIndex,
      finalizeIndex,
    );
    const finalizeJob = workflow.slice(finalizeIndex);
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
    expect(finalizeJob).toContain('needs: [publish, registry-consumer]');
    expect(finalizeJob).toContain('environment: npm-preview-promotion');
    expect(finalizeJob).toContain('fetch-depth: 0');
    expect(jobPermissions(finalizeJob)).toEqual(['contents: write']);
    expect(finalizeJob).toContain('--finalize-only');
    expect(finalizeJob.indexOf('verify publication guard')).toBeLessThan(
      finalizeJob.indexOf('install pinned npm'),
    );
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
});
