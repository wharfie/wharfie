/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest, test } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const binPath = fileURLToPath(new URL('../../../bin/wharfie', import.meta.url));
const BUILD_SELF_IMPORT = '../../../cli/cmds/build_self.js';
const NODE_BINARY_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/node-binary.js';
const SEA_BUILD_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/sea-build.js';
const MACOS_SIGNATURE_IMPORT =
  '../../../lambdas/lib/actor/resources/builds/macos-binary-signature.js';

/**
 * @returns {string} - Result.
 */
function makeTmpRepo() {
  const root = mkdtempSync(path.join(tmpdir(), 'wharfie-build-self-'));
  mkdirSync(path.join(root, 'cli', 'project', 'project_structure_examples'), {
    recursive: true,
  });
  mkdirSync(
    path.join(root, 'cli', 'project', 'project_structure_examples', 'nested'),
    {
      recursive: true,
    },
  );

  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'wharfie-build-self-fixture', private: true }),
    'utf8',
  );
  writeFileSync(
    path.join(root, 'cli', 'project', 'project_structure_examples', 'base.txt'),
    'base template',
    'utf8',
  );
  writeFileSync(
    path.join(
      root,
      'cli',
      'project',
      'project_structure_examples',
      'nested',
      'child.txt',
    ),
    'nested template',
    'utf8',
  );

  return root;
}

describe('wharfie build-self', () => {
  it('is disabled under jest to avoid network downloads', () => {
    const res = spawnSync(process.execPath, [binPath, 'build-self'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        WHARFIE_DISABLE_UPDATE_CHECK: '1',
      },
    });

    expect(res.status).toBe(1);
    expect(`${res.stdout}\n${res.stderr}`).toMatch(/disabled under jest/i);
  });

  it('buildSelf creates a dist binary and template manifest with mocked builders', async () => {
    const previousCwd = process.cwd();
    const tmpRepo = makeTmpRepo();

    /** @type {Array<{ properties: Record<string, any>, binaryPath: string }>} */
    const nodeBinaryInstances = [];
    /** @type {Array<{ properties: Record<string, any>, binaryPath: string }>} */
    const seaBuildInstances = [];
    const signatureReconcile = jest.fn(async () => {});

    try {
      process.chdir(tmpRepo);
      jest.resetModules();

      jest.unstable_mockModule(NODE_BINARY_IMPORT, () => ({
        default: class FakeNodeBinary {
          /**
           * @param {{ properties: Record<string, any> }} options - options.
           */
          constructor(options) {
            this.properties = options.properties;
            this.binaryPath = path.join(tmpRepo, '.fake-build', 'node-binary');
            nodeBinaryInstances.push(this);
          }

          /**
           * @returns {Promise<void>} - Result.
           */
          async reconcile() {
            mkdirSync(path.dirname(this.binaryPath), { recursive: true });
            writeFileSync(this.binaryPath, 'fake node binary', 'utf8');
          }

          /**
           * @param {string} key - key.
           * @returns {string} - Result.
           */
          get(key) {
            if (key === 'binaryPath') return this.binaryPath;
            if (key === 'exactVersion') return `v${this.properties.version}`;
            throw new Error(`Unsupported NodeBinary get(${key})`);
          }
        },
      }));

      jest.unstable_mockModule(SEA_BUILD_IMPORT, () => ({
        default: class FakeSeaBuild {
          /**
           * @param {{ properties: Record<string, any> }} options - options.
           */
          constructor(options) {
            this.properties = options.properties;
            this.binaryPath = path.join(tmpRepo, '.fake-build', 'sea-binary');
            seaBuildInstances.push(this);
          }

          /**
           * @returns {Promise<void>} - Result.
           */
          async reconcile() {
            mkdirSync(path.dirname(this.binaryPath), { recursive: true });
            writeFileSync(this.binaryPath, 'fake sea binary', 'utf8');
          }

          /**
           * @param {string} key - key.
           * @returns {string} - Result.
           */
          get(key) {
            if (key === 'binaryPath') return this.binaryPath;
            throw new Error(`Unsupported SeaBuild get(${key})`);
          }
        },
      }));

      jest.unstable_mockModule(MACOS_SIGNATURE_IMPORT, () => ({
        default: class FakeMacOSBinarySignature {
          /**
           * @returns {Promise<void>} - Result.
           */
          async reconcile() {
            await signatureReconcile();
          }
        },
      }));

      const mod = await import(BUILD_SELF_IMPORT);
      await mod.buildSelf({
        platform: 'linux',
        arch: 'amd64',
        nodeVersion: '24.13.1',
      });

      const distBinaryPath = path.join(tmpRepo, 'dist', 'wharfie-linux-x64');
      const manifestPath = path.join(
        tmpRepo,
        'dist',
        'wharfie-templates.manifest.json',
      );
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

      expect(nodeBinaryInstances).toHaveLength(1);
      expect(nodeBinaryInstances[0].properties).toMatchObject({
        version: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
      });

      expect(seaBuildInstances).toHaveLength(1);
      expect(typeof seaBuildInstances[0].properties.assets).toBe('function');
      expect(existsSync(distBinaryPath)).toBe(true);
      expect(readFileSync(distBinaryPath, 'utf8')).toBe('fake sea binary');
      expect(statSync(distBinaryPath).mode & 0o111).toBeGreaterThan(0);
      expect(manifest.files.sort()).toEqual(['base.txt', 'nested/child.txt']);
      expect(signatureReconcile).not.toHaveBeenCalled();
      expect(mod.normalizeArch('amd64')).toBe('x64');
      expect(mod.normalizePlatform('linux')).toBe('linux');
      expect(mod.findRepoRoot(path.join(tmpRepo, 'cli'))).toBe(tmpRepo);
    } finally {
      process.chdir(previousCwd);
      rmSync(tmpRepo, { recursive: true, force: true });
      jest.resetModules();
      jest.restoreAllMocks();
    }
  });
});
