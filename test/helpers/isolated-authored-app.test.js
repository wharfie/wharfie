/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadApp } from '../../src/cli/app/load-app.js';
import {
  cleanupIsolatedAuthoredAppFixtures,
  createIsolatedAuthoredAppFixture,
} from './isolated-authored-app.js';

const REPOSITORY_ROOT = path.resolve(
  fileURLToPath(new URL('../..', import.meta.url)),
);

/** @param {string} label */
function createSourceFixture(label) {
  const root = mkdtempSync(path.join(os.tmpdir(), `wharfie-${label}-`));
  writeFileSync(path.join(root, 'package.json'), '{"type":"module"}\n');
  writeFileSync(path.join(root, 'cli.js'), 'export async function main() {}\n');
  mkdirSync(path.join(root, '.wharfie', 'revision-snapshots'), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, '.wharfie', 'revision-snapshots', 'stale'),
    'generated revision\n',
  );
  mkdirSync(path.join(root, 'node_modules', 'generated'), { recursive: true });
  writeFileSync(
    path.join(root, 'node_modules', 'generated', 'index.js'),
    'generated dependency\n',
  );
  return root;
}

describe('isolated authored app fixtures', () => {
  it('preserves module scope for every relocated repository app', async () => {
    /** @type {Array<[string, string]>} */
    const cases = [
      ['scratch/examples/apps/hello-world', 'hello-world-demo'],
      ['scratch/examples/apps/kitchen-sink', 'kitchen-sink-demo'],
      ['test/fixtures/apps/workflow-crash', 'workflow-crash-source'],
    ];
    /** @type {Array<ReturnType<typeof createIsolatedAuthoredAppFixture>>} */
    const fixtures = [];
    try {
      for (const [relativePath, appId] of cases) {
        const fixture = createIsolatedAuthoredAppFixture(
          path.join(REPOSITORY_ROOT, relativePath),
        );
        fixtures.push(fixture);
        await expect(loadApp({ dir: fixture.appDir })).resolves.toMatchObject({
          appDir: fixture.appDir,
          manifest: { app: { id: appId } },
        });
      }
    } finally {
      cleanupIsolatedAuthoredAppFixtures(fixtures);
    }
  });

  it('copies authored bytes, excludes generated trees, and removes its root', () => {
    const sourceRoot = createSourceFixture('isolated-authored-source');
    /** @type {ReturnType<typeof createIsolatedAuthoredAppFixture> | undefined} */
    let fixture;
    try {
      fixture = createIsolatedAuthoredAppFixture(sourceRoot, {
        prefix: 'wharfie-isolated-authored-copy-',
      });

      expect(existsSync(path.join(fixture.appDir, 'package.json'))).toBe(true);
      expect(existsSync(path.join(fixture.appDir, 'cli.js'))).toBe(true);
      expect(existsSync(path.join(fixture.appDir, '.wharfie'))).toBe(false);
      expect(
        existsSync(path.join(fixture.appDir, 'node_modules', 'generated')),
      ).toBe(false);
      expect(
        existsSync(
          path.join(
            fixture.appDir,
            'node_modules',
            '@wharfie',
            'wharfie',
            'src',
            'app.js',
          ),
        ),
      ).toBe(true);
      fixture.assertSourceUnchanged();

      const ownedRoot = fixture.root;
      fixture.cleanup();
      expect(existsSync(ownedRoot)).toBe(false);
    } finally {
      fixture?.cleanup();
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('reports source mutation but still removes the owned copy', () => {
    const sourceRoot = createSourceFixture('mutated-authored-source');
    const fixture = createIsolatedAuthoredAppFixture(sourceRoot);
    try {
      writeFileSync(
        path.join(sourceRoot, 'cli.js'),
        'export async function changed() {}\n',
      );

      expect(() => fixture.cleanup()).toThrow(
        /authored application fixture was mutated/i,
      );
      expect(existsSync(fixture.root)).toBe(false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('attempts every cleanup when one source-containment assertion fails', () => {
    const firstSource = createSourceFixture('first-authored-source');
    const secondSource = createSourceFixture('second-authored-source');
    const first = createIsolatedAuthoredAppFixture(firstSource);
    const second = createIsolatedAuthoredAppFixture(secondSource);
    try {
      writeFileSync(path.join(firstSource, 'cli.js'), 'changed\n');
      const fixtures = [second, first];

      expect(() => cleanupIsolatedAuthoredAppFixtures(fixtures)).toThrow(
        /authored application fixture was mutated/i,
      );
      expect(fixtures).toEqual([]);
      expect(existsSync(first.root)).toBe(false);
      expect(existsSync(second.root)).toBe(false);
    } finally {
      rmSync(first.root, { recursive: true, force: true });
      rmSync(second.root, { recursive: true, force: true });
      rmSync(firstSource, { recursive: true, force: true });
      rmSync(secondSource, { recursive: true, force: true });
    }
  });
});
