/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { c } from 'tar';

import NodeBinary from '../../../lambdas/lib/actor/resources/builds/node-binary.js';

describe('NodeBinary', () => {
  afterEach(() => {
    NodeBinary.versions = undefined;
  });

  it('builds platform-specific download URLs from cached index metadata', async () => {
    NodeBinary.versions = [
      {
        version: 'v24.13.1',
        date: '2026-01-01',
        files: ['osx-arm64-tar', 'win-x64-zip'],
        npm: '11.10.0',
        v8: '13.6',
        uv: '1.50.0',
        zlib: '1.3.0',
        openssl: '3.4.0',
        modules: '137',
        lts: 'Jod',
        security: 'false',
      },
    ];

    const macBinary = new NodeBinary({
      name: 'node-mac',
      properties: {
        version: '24.13',
        platform: 'darwin',
        architecture: 'arm64',
      },
    });
    const winBinary = new NodeBinary({
      name: 'node-win',
      properties: {
        version: '24.13',
        platform: 'win32',
        architecture: 'x64',
      },
    });

    await expect(macBinary.getUrl()).resolves.toBe(
      'https://nodejs.org/dist/v24.13.1/node-v24.13.1-darwin-arm64.tar.gz',
    );
    await expect(winBinary.getUrl()).resolves.toBe(
      'https://nodejs.org/dist/v24.13.1/node-v24.13.1-win-x64.zip',
    );
    expect(NodeBinary.resolveTargetSpec('win32', 'ia32')).toEqual({
      token: 'win',
      normPlatform: 'win',
      normArch: 'x86',
      ext: '.zip',
      packagingKey: 'zip',
      isWin: true,
      isMac: false,
    });
    expect(NodeBinary.candidateFilesKeys('osx', 'arm64', 'tar')).toEqual([
      'osx-arm64-tar',
      'osx-arm64',
    ]);
  });

  it('extracts a local unix node archive without downloading anything', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-binary-'),
    );
    const archivePath = path.join(tmpRoot, 'node-v24.13.1-linux-x64.tar.gz');
    const archiveRoot = path.join(tmpRoot, 'node-v24.13.1-linux-x64');
    const archiveBinaryPath = path.join(archiveRoot, 'bin', 'node');

    await fsp.mkdir(path.dirname(archiveBinaryPath), { recursive: true });
    await fsp.writeFile(archiveBinaryPath, 'fake node binary\n', 'utf8');
    await c(
      {
        cwd: tmpRoot,
        gzip: true,
        file: archivePath,
      },
      ['node-v24.13.1-linux-x64'],
    );

    const binary = new NodeBinary({
      name: 'node-linux',
      properties: {
        version: '24.13',
        platform: 'linux',
        architecture: 'x64',
      },
    });

    const extractedBinaryPath = await binary.extractUnixTar(archivePath);

    await expect(fsp.readFile(extractedBinaryPath, 'utf8')).resolves.toEqual(
      'fake node binary\n',
    );
    await fsp.rm(tmpRoot, { recursive: true, force: true });
  });
});
