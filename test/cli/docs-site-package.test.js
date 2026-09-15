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
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import {
  parseDocsSiteArgs,
  prepareDocsSite,
} from '../../scripts/prepare-docs-site.js';

const marker = '__WHARFIE_DOCS_SHA256__';
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
    path.join(source, 'edge-router.js'),
    `function handler() { return '${marker}'; } // literal \u0024{neverExpand}\n`,
  );
  writeFileSync(
    path.join(source, 'hosting.template.json'),
    JSON.stringify({
      Resources: {
        DocsRoutes: {
          Properties: { FunctionCode: '__WHARFIE_DOCS_EDGE_CODE__' },
        },
      },
    }),
  );
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
  it('binds exact HTML bytes, all file hashes, staging parameters, and clean Git provenance', () => {
    const outputDir = path.join(directory, 'bundle');
    const manifest = prepareDocsSite({ outputDir, repoRoot });
    const index = readFileSync(path.join(source, 'index.html'));
    expect(readFileSync(path.join(outputDir, 'index.html'))).toEqual(index);
    expect(manifest).toMatchObject({
      format: 'wharfie-docs-site',
      version: 1,
      git: { commit: git('rev-parse', 'HEAD'), dirty: false },
      account: '411430101559',
      region: 'us-east-1',
      stack: 'wharfie-docs',
      bucket: 'wharfie-docs-411430101559-us-east-1',
      contentSha256: digest(index),
      objectKey: `releases/${digest(index)}/index.html`,
    });
    for (const file of manifest.files) {
      const bytes = readFileSync(path.join(outputDir, file.name));
      expect(file).toEqual({
        name: file.name,
        sha256: digest(bytes),
        size: bytes.length,
      });
    }
    expect(
      JSON.parse(readFileSync(path.join(outputDir, 'manifest.json'), 'utf8')),
    ).toEqual(manifest);
    expect(
      JSON.parse(readFileSync(path.join(outputDir, 'parameters.json'), 'utf8')),
    ).toEqual([
      { ParameterKey: 'ContentSha256', ParameterValue: digest(index) },
      { ParameterKey: 'CustomDomain', ParameterValue: '' },
      { ParameterKey: 'CertificateArn', ParameterValue: '' },
    ]);
    const template = JSON.parse(
      readFileSync(path.join(outputDir, 'hosting.template.json'), 'utf8'),
    );
    /** @type {[string, Array<string | {Ref: string}>]} */
    const join =
      template.Resources.DocsRoutes.Properties.FunctionCode['Fn::Join'];
    expect(join[0]).toBe('');
    expect(join[1][1]).toEqual({ Ref: 'ContentSha256' });
    const code = join[1]
      .map((part) => (typeof part === 'string' ? part : manifest.contentSha256))
      .join('');
    expect(code).toContain('${neverExpand}');
    expect(code).not.toContain(marker);
    expect(runInNewContext(`${code}\nhandler();`)).toBe(manifest.contentSha256);
  });

  it('records dirty source accurately, changes the object identity, and copies the optional certificate exactly', () => {
    const first = prepareDocsSite({
      outputDir: path.join(directory, 'first'),
      repoRoot,
    });
    writeFileSync(path.join(source, 'index.html'), '<p>Revised docs.</p>');
    const certificate = Buffer.from('{"Description":"Certificate"}\r\n');
    writeFileSync(path.join(source, 'certificate.template.json'), certificate);
    const outputDir = path.join(directory, 'second');
    const second = prepareDocsSite({ outputDir, repoRoot });
    expect(second.git).toEqual({ commit: first.git.commit, dirty: true });
    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect(second.objectKey).not.toBe(first.objectKey);
    expect(
      readFileSync(path.join(outputDir, 'certificate.template.json')),
    ).toEqual(certificate);
    expect(second.files).toContainEqual({
      name: 'certificate.template.json',
      sha256: digest(certificate),
      size: certificate.length,
    });
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

  it.each(['missing', `${marker} ${marker}`])(
    'rejects ambiguous edge markers before creating output: %s',
    (edge) => {
      writeFileSync(path.join(source, 'edge-router.js'), edge);
      const outputDir = path.join(directory, 'invalid');
      expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow(
        /one content marker/,
      );
      expect(existsSync(outputDir)).toBe(false);
    },
  );

  it('rejects an already-rendered hosting template before creating output', () => {
    writeFileSync(
      path.join(source, 'hosting.template.json'),
      JSON.stringify({
        Resources: {
          DocsRoutes: { Properties: { FunctionCode: 'already-rendered' } },
        },
      }),
    );
    const outputDir = path.join(directory, 'invalid');
    expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow(
      /exact edge-code marker/,
    );
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
