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

const siteFiles = [
  '404.html',
  '_headers',
  '_routes.json',
  '_worker.js',
  'index.html',
];
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
    path.join(source, '_worker.js'),
    'export default { fetch() { return new Response("Not found", {status:404}); } };\n',
  );
  writeFileSync(
    path.join(source, '404.html'),
    '<!doctype html><title>Not found</title>\n',
  );
  writeFileSync(
    path.join(source, '_headers'),
    '/*\n  Cache-Control: no-store\n',
  );
  writeFileSync(
    path.join(source, '_routes.json'),
    JSON.stringify({ version: 1, include: ['/*'], exclude: ['/'] }),
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

describe('local Cloudflare Pages documentation bundle', () => {
  it('binds exact site bytes, all file hashes, and clean Git provenance outside the upload directory', () => {
    const outputDir = path.join(directory, 'bundle');
    const manifest = prepareDocsSite({ outputDir, repoRoot });
    const index = readFileSync(path.join(source, 'index.html'));
    expect(readFileSync(path.join(outputDir, 'site', 'index.html'))).toEqual(
      index,
    );
    expect(manifest).toMatchObject({
      format: 'wharfie-docs-site',
      version: 2,
      provider: 'cloudflare-pages',
      deployDirectory: 'site',
      git: { commit: git('rev-parse', 'HEAD'), dirty: false },
      contentSha256: digest(index),
    });
    expect(readdirSync(outputDir).sort()).toEqual(['manifest.json', 'site']);
    expect(readdirSync(path.join(outputDir, 'site')).sort()).toEqual(siteFiles);
    expect(manifest.files.map((file) => file.name).sort()).toEqual(
      siteFiles.map((name) => `site/${name}`),
    );
    for (const file of manifest.files) {
      const bytes = readFileSync(path.join(outputDir, file.name));
      expect(bytes).toEqual(
        readFileSync(path.join(source, path.basename(file.name))),
      );
      expect(file).toEqual({
        name: file.name,
        sha256: digest(bytes),
        size: bytes.length,
      });
    }
    expect(
      JSON.parse(readFileSync(path.join(outputDir, 'manifest.json'), 'utf8')),
    ).toEqual(manifest);
  });

  it('records changed source accurately without putting unlisted files or private evidence in the upload directory', () => {
    const first = prepareDocsSite({
      outputDir: path.join(directory, 'first'),
      repoRoot,
    });
    writeFileSync(path.join(source, 'index.html'), '<p>Revised docs.</p>');
    writeFileSync(path.join(source, '.env'), 'TOKEN=private-test-value\n');
    writeFileSync(
      path.join(source, 'manifest.json'),
      '{"private":"test-evidence"}\n',
    );
    writeFileSync(
      path.join(source, 'hosting.template.json'),
      '{"obsolete":true}\n',
    );
    const outputDir = path.join(directory, 'second');
    const second = prepareDocsSite({ outputDir, repoRoot });
    expect(second.git).toEqual({ commit: first.git.commit, dirty: true });
    expect(second.contentSha256).not.toBe(first.contentSha256);
    expect(readdirSync(path.join(outputDir, 'site')).sort()).toEqual(siteFiles);
    expect(JSON.stringify(second)).not.toMatch(
      /private-test-value|test-evidence|obsolete/,
    );
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

  it('refuses routing changes that would send ordinary landing requests through Functions', () => {
    writeFileSync(
      path.join(source, '_routes.json'),
      JSON.stringify({ version: 1, include: ['/*'], exclude: [] }),
    );
    const outputDir = path.join(directory, 'invalid');
    expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow(
      /landing page must remain outside Pages Functions/,
    );
    expect(existsSync(outputDir)).toBe(false);
  });

  it('refuses an incomplete source before creating an output directory', () => {
    rmSync(path.join(source, '_worker.js'));
    const outputDir = path.join(directory, 'invalid');
    expect(() => prepareDocsSite({ outputDir, repoRoot })).toThrow(/ENOENT/);
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
