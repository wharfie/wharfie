/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { jest } from '@jest/globals';
import { create as createTar } from 'tar';

import {
  packageInstalledWharfieCli,
  validateInstalledWharfieSelfHost,
} from '../../../src/cli/app/installed-wharfie-self-package.js';

const EXPECTED_VERSION = '0.0.15';
const OTHER_INTEGRITY = `sha512-${createHash('sha512')
  .update('different-packed-release')
  .digest('base64')}`;

describe('installed Wharfie self packaging', () => {
  /** @type {string} */
  let installRoot;
  /** @type {string} */
  let packageRoot;
  /** @type {string} */
  let lockPath;
  /** @type {string} */
  let tarballPath;
  /** @type {string} */
  let expectedIntegrity;
  /** @type {{version: string, integrity: string, tarballPath: string}} */
  let expectedRelease;

  beforeEach(async () => {
    installRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-self-package-'),
    );
    packageRoot = path.join(installRoot, 'node_modules', '@wharfie', 'wharfie');
    lockPath = path.join(installRoot, 'package-lock.json');
    await fsp.mkdir(packageRoot, { recursive: true });
    await fsp.writeFile(
      path.join(packageRoot, 'package.json'),
      `${JSON.stringify({
        name: '@wharfie/wharfie',
        version: EXPECTED_VERSION,
        main: './src/cli/entry.js',
      })}\n`,
    );
    const candidateStage = path.join(installRoot, 'candidate-stage');
    await fsp.mkdir(candidateStage);
    await fsp.cp(packageRoot, path.join(candidateStage, 'package'), {
      recursive: true,
    });
    tarballPath = path.join(installRoot, 'wharfie-wharfie-0.0.15.tgz');
    await createTar(
      {
        cwd: candidateStage,
        file: tarballPath,
        gzip: true,
        portable: true,
      },
      ['package'],
    );
    expectedIntegrity = `sha512-${createHash('sha512')
      .update(await fsp.readFile(tarballPath))
      .digest('base64')}`;
    expectedRelease = Object.freeze({
      version: EXPECTED_VERSION,
      integrity: expectedIntegrity,
      tarballPath,
    });
    await fsp.writeFile(
      lockPath,
      `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/@wharfie/wharfie': {
            version: EXPECTED_VERSION,
            resolved: 'file:wharfie-wharfie-0.0.15.tgz',
            integrity: expectedIntegrity,
          },
        },
      })}\n`,
    );
  });

  afterEach(async () => {
    await fsp.rm(installRoot, { recursive: true, force: true });
  });

  it('accepts only the exact consumer lock for an installed package', async () => {
    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, expectedRelease),
    ).resolves.toEqual({
      root: packageRoot,
      lockPath,
      version: EXPECTED_VERSION,
      integrity: expectedIntegrity,
      tarballPath,
    });
  });

  it('passes narrow framework authority to the normal package transaction', async () => {
    const packageApplication = jest.fn(async () => ({ artifacts: [] }));
    const dependencies = /** @type {any} */ ({ packageApplication });

    await expect(
      packageInstalledWharfieCli(
        {
          dir: packageRoot,
          dependencyLockPath: lockPath,
          expectedRelease,
          outputDir: path.join(installRoot, 'release'),
        },
        dependencies,
      ),
    ).resolves.toEqual({ artifacts: [] });

    expect(packageApplication).toHaveBeenCalledWith(
      {
        dir: packageRoot,
        outputDir: path.join(installRoot, 'release'),
        awsProviderEmbeddingPolicy: 'provider-free',
      },
      {
        dependencyLockPath: lockPath,
        runtimeRoot: packageRoot,
        trustInstalledRuntimeGraph: true,
      },
    );
  });

  it('keeps the installed release executable provider-free', async () => {
    const packageApplication = jest.fn(async () => ({ artifacts: [] }));
    const dependencies = /** @type {any} */ ({ packageApplication });

    await expect(
      packageInstalledWharfieCli(
        {
          dir: packageRoot,
          dependencyLockPath: lockPath,
          expectedRelease,
          awsProviderEmbeddingPolicy: 'embed-if-available',
        },
        dependencies,
      ),
    ).rejects.toThrow('owns the AWS provider embedding policy');
    expect(packageApplication).not.toHaveBeenCalled();
  });

  it('rejects source-like paths outside the installed package location', async () => {
    await expect(
      validateInstalledWharfieSelfHost(installRoot, lockPath, expectedRelease),
    ).rejects.toThrow(
      'requires a clean node_modules/@wharfie/wharfie installation',
    );
  });

  it('rejects a lock whose integrity does not match the packed tarball', async () => {
    await fsp.writeFile(
      lockPath,
      `${JSON.stringify({
        lockfileVersion: 3,
        packages: {
          'node_modules/@wharfie/wharfie': {
            version: EXPECTED_VERSION,
            integrity: OTHER_INTEGRITY,
          },
        },
      })}\n`,
    );

    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, expectedRelease),
    ).rejects.toThrow('must bind this exact installed Wharfie version');
  });

  it('rejects fabricated expected integrity before granting authority', async () => {
    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, {
        version: EXPECTED_VERSION,
        integrity: 'sha512-release-integrity',
        tarballPath,
      }),
    ).rejects.toThrow('must be a canonical sha512 integrity');
  });

  it('rejects an expected version that is not the packed package version', async () => {
    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, {
        version: '0.0.16',
        integrity: expectedIntegrity,
        tarballPath,
      }),
    ).rejects.toThrow('requires the canonical installed package');
  });

  it('rejects a symlinked installed package root', async () => {
    const movedRoot = path.join(installRoot, 'moved-wharfie');
    await fsp.rename(packageRoot, movedRoot);
    await fsp.symlink(movedRoot, packageRoot, 'dir');

    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, expectedRelease),
    ).rejects.toThrow(/non-symlink directory|symlinked installed-package/u);
  });

  it('rejects a symlinked consumer lock', async () => {
    const movedLock = path.join(installRoot, 'actual-package-lock.json');
    await fsp.rename(lockPath, movedLock);
    await fsp.symlink(movedLock, lockPath, 'file');

    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, expectedRelease),
    ).rejects.toThrow(/non-symlink file|symlinked consumer package lock/u);
  });

  it('rejects installed bytes changed after the lock was written', async () => {
    await fsp.writeFile(
      path.join(packageRoot, 'package.json'),
      '{"name":"@wharfie/wharfie","version":"0.0.15","main":"./src/cli/entry.js","tampered":true}\n',
    );

    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, expectedRelease),
    ).rejects.toThrow(/bytes do not match the packed candidate/u);
  });

  it('rejects a candidate tarball whose bytes do not match expected integrity', async () => {
    await fsp.appendFile(tarballPath, 'tampered');

    await expect(
      validateInstalledWharfieSelfHost(packageRoot, lockPath, expectedRelease),
    ).rejects.toThrow(/tarball bytes do not match their integrity/u);
  });
});
