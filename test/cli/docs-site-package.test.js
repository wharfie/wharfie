/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseDocsSiteArgs,
  prepareDocsSite,
} from '../../scripts/prepare-docs-site.js';

const hostingTemplate = readFileSync(
  new URL('../../docs/site/hosting.template.json', import.meta.url),
);
const script = fileURLToPath(
  new URL('../../scripts/prepare-docs-site.js', import.meta.url),
);
/** @type {string} */
let directory;
/** @type {string} */
let repoRoot;
/** @type {string} */
let source;

/** @param {Buffer} bytes */
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** @param {...string} args */
function git(...args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

beforeEach(() => {
  directory = mkdtempSync(path.join(os.tmpdir(), 'wharfie-docs-package-'));
  repoRoot = path.join(directory, 'source');
  source = path.join(repoRoot, 'docs', 'site');
  mkdirSync(source, { recursive: true });
  writeFileSync(
    path.join(source, 'index.html'),
    '<!doctype html>\r\n<p>Current docs.</p>\n',
  );
  writeFileSync(
    path.join(source, '404.html'),
    '<!doctype html>\r\n<p>Use the current documentation.</p>\n',
  );
  writeFileSync(path.join(source, 'hosting.template.json'), hostingTemplate);
  git('init', '-q');
  git('add', '.');
  git(
    '-c',
    'user.name=Docs fixture',
    '-c',
    'user.email=docs-fixture@example.invalid',
    '-c',
    'commit.gpgSign=false',
    'commit',
    '-q',
    '-m',
    'Fixture',
  );
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

describe('local documentation deployment bundle', () => {
  it('binds exact public HTML, the immutable release key, and clean Git provenance', () => {
    const outputDir = path.join(directory, 'bundle');
    const manifest = prepareDocsSite({ outputDir, repoRoot });
    const index = readFileSync(path.join(source, 'index.html'));
    expect(readFileSync(path.join(outputDir, 'index.html'))).toEqual(index);
    expect(manifest).toMatchObject({
      format: 'wharfie-docs-site',
      version: 2,
      provider: 's3-website',
      git: { commit: git('rev-parse', 'HEAD'), dirty: false },
      account: '411430101559',
      region: 'us-east-1',
      stack: 'wharfie-docs',
      bucket: 'wharfie-docs-411430101559-us-east-1',
      contentSha256: digest(index),
      objectKey: 'index.html',
      releaseKey: `releases/${digest(index)}/index.html`,
    });
    expect(manifest.files.map((file) => file.name)).toEqual([
      'index.html',
      '404.html',
      'hosting.template.json',
    ]);
    for (const file of manifest.files) {
      const bytes = readFileSync(path.join(outputDir, file.name));
      expect(bytes).toEqual(readFileSync(path.join(source, file.name)));
      expect(file).toEqual({
        name: file.name,
        sha256: digest(bytes),
        size: bytes.length,
      });
    }
    expect(
      JSON.parse(readFileSync(path.join(outputDir, 'manifest.json'), 'utf8')),
    ).toEqual(manifest);
    expect(readdirSync(outputDir).sort()).toEqual([
      '404.html',
      'hosting.template.json',
      'index.html',
      'manifest.json',
    ]);
  });

  it('records dirty source, changes the rollback identity, and excludes obsolete deployment files', () => {
    const first = prepareDocsSite({
      outputDir: path.join(directory, 'first'),
      repoRoot,
    });
    writeFileSync(path.join(source, 'index.html'), '<p>Revised docs.</p>');
    writeFileSync(path.join(source, 'certificate.template.json'), '{}');
    writeFileSync(path.join(source, 'edge-router.js'), 'obsolete');
    writeFileSync(path.join(source, 'parameters.json'), '[]');
    const outputDir = path.join(directory, 'second');
    const second = prepareDocsSite({ outputDir, repoRoot });
    expect(second.git).toEqual({ commit: first.git.commit, dirty: true });
    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect(second.objectKey).toBe(first.objectKey);
    expect(second.releaseKey).not.toBe(first.releaseKey);
    expect(second.files.map((file) => file.name)).toEqual(
      first.files.map((file) => file.name),
    );
    expect(readdirSync(outputDir).sort()).toEqual([
      '404.html',
      'hosting.template.json',
      'index.html',
      'manifest.json',
    ]);
  });

  it('refuses to overwrite an existing output directory or any of its files', () => {
    const outputDir = path.join(directory, 'existing');
    mkdirSync(outputDir);
    writeFileSync(path.join(outputDir, 'index.html'), 'preserve');
    expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow(/EEXIST/);
    expect(readFileSync(path.join(outputDir, 'index.html'), 'utf8')).toBe(
      'preserve',
    );
    expect(existsSync(path.join(outputDir, 'manifest.json'))).toBe(false);
  });

  it.each(['index.html', '404.html'])(
    'requires each public document before creating output: %s',
    (name) => {
      rmSync(path.join(source, name));
      const outputDir = path.join(directory, 'invalid');
      expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow(/ENOENT/);
      expect(existsSync(outputDir)).toBe(false);
    },
  );

  it('rejects malformed hosting JSON before creating output', () => {
    writeFileSync(path.join(source, 'hosting.template.json'), '{');
    const outputDir = path.join(directory, 'invalid');
    expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow();
    expect(existsSync(outputDir)).toBe(false);
  });

  it.each([
    [[]],
    [['--output-dir']],
    [['--unknown', 'x']],
    [['--output-dir', '--help']],
    [['--output-dir', 'x', '--output-dir', 'y']],
    [['--help', '--output-dir', 'x']],
  ])('rejects missing, unknown, or repeated CLI arguments: %j', (args) => {
    expect(() => parseDocsSiteArgs(args)).toThrow(/Usage:/);
  });

  it('provides help without reading Git or creating an output directory', () => {
    expect(parseDocsSiteArgs(['--output-dir', 'new-bundle'])).toEqual({
      outputDir: 'new-bundle',
    });
    const result = spawnSync(process.execPath, [script, '--help'], {
      cwd: directory,
      encoding: 'utf8',
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--output-dir <new-directory>');
    expect(result.stderr).toBe('');
  });
});

describe('retained S3 website infrastructure', () => {
  const template = JSON.parse(hostingTemplate.toString('utf8'));
  const publicObjects = [
    { 'Fn::Sub': '${DocsBucket.Arn}/index.html' },
    { 'Fn::Sub': '${DocsBucket.Arn}/404.html' },
  ];

  it('keeps the existing bucket identity and retains only the two S3 resources', () => {
    expect(Object.keys(template.Resources).sort()).toEqual([
      'DocsBucket',
      'DocsBucketPolicy',
    ]);
    expect(template.Parameters).toBeUndefined();
    expect(template.Resources.DocsBucket).toMatchObject({
      Type: 'AWS::S3::Bucket',
      DeletionPolicy: 'Retain',
      UpdateReplacePolicy: 'Retain',
      Properties: {
        BucketName: {
          'Fn::Sub': 'wharfie-docs-${AWS::AccountId}-${AWS::Region}',
        },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            { ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } },
          ],
        },
        OwnershipControls: {
          Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }],
        },
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: false,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: false,
        },
        WebsiteConfiguration: {
          IndexDocument: 'index.html',
          ErrorDocument: '404.html',
        },
      },
    });
    expect(template.Resources.DocsBucketPolicy.Properties.Bucket).toEqual({
      Ref: 'DocsBucket',
    });
  });

  it('grants only public HTML reads and keeps other reads and all writes HTTPS-only', () => {
    const statements =
      template.Resources.DocsBucketPolicy.Properties.PolicyDocument.Statement;
    expect(statements).toHaveLength(3);
    expect(
      statements.filter(
        (/** @type {{Effect: string}} */ statement) =>
          statement.Effect === 'Allow',
      ),
    ).toEqual([
      {
        Sid: 'AllowPublicDocumentationReads',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: publicObjects,
      },
    ]);
    expect(statements).toContainEqual({
      Sid: 'DenyInsecureOperationsExceptObjectReads',
      Effect: 'Deny',
      Principal: '*',
      NotAction: 's3:GetObject',
      Resource: [
        { 'Fn::GetAtt': ['DocsBucket', 'Arn'] },
        { 'Fn::Sub': '${DocsBucket.Arn}/*' },
      ],
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    });
    expect(statements).toContainEqual({
      Sid: 'DenyInsecureReadsOutsidePublicDocuments',
      Effect: 'Deny',
      Principal: '*',
      Action: 's3:GetObject',
      NotResource: publicObjects,
      Condition: { Bool: { 'aws:SecureTransport': 'false' } },
    });
  });
});
