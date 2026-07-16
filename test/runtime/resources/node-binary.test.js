/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { c } from 'tar';

import NodeBinary from '../../../src/core/resources/builds/node-binary.js';

const ORIGINAL_BINARIES_DIR = NodeBinary.BINARIES_DIR;
const ORIGINAL_TEMP_DIR = NodeBinary.TEMP_DIR;
const TEST_VERSION = 'v24.13.1';
const LINUX_ARCHIVE_FILE_NAME = 'node-v24.13.1-linux-x64.tar.gz';

function setLinuxVersionMetadata() {
  NodeBinary.versions = [
    {
      version: TEST_VERSION,
      date: '2026-01-01',
      files: ['linux-x64'],
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
}

/**
 * @param {string | NodeJS.ArrayBufferView} value - Value to hash.
 * @returns {string} - SHA-256 digest.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function makeLinuxBinary() {
  return new NodeBinary({
    name: 'node-linux',
    properties: {
      version: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
    },
  });
}

describe('NodeBinary', () => {
  afterEach(() => {
    NodeBinary.versions = undefined;
    NodeBinary.BINARIES_DIR = ORIGINAL_BINARIES_DIR;
    NodeBinary.TEMP_DIR = ORIGINAL_TEMP_DIR;
    jest.restoreAllMocks();
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
    await expect(macBinary.getChecksumsUrl()).resolves.toBe(
      'https://nodejs.org/dist/v24.13.1/SHASUMS256.txt',
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

  it('does not resolve an exact patch request to a longer prefix match', async () => {
    NodeBinary.versions = [
      {
        version: 'v24.13.10',
        date: '2026-02-01',
        files: ['linux-x64'],
        npm: '11.10.0',
        v8: '13.6',
        uv: '1.50.0',
        zlib: '1.3.0',
        openssl: '3.4.0',
        modules: '137',
        lts: 'Jod',
        security: 'false',
      },
      {
        version: 'v24.13.1',
        date: '2026-01-01',
        files: ['linux-x64'],
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

    await expect(makeLinuxBinary().getExactVersion()).resolves.toBe('v24.13.1');
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

  it('accepts an archive only when its bytes match the official checksum entry', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-download-good-'),
    );
    const archiveBytes = Buffer.from('verified archive bytes');
    const expectedChecksum = sha256(archiveBytes);
    setLinuxVersionMetadata();
    NodeBinary.TEMP_DIR = path.join(tmpRoot, 'extracts');

    const binary = makeLinuxBinary();
    const fetchText = jest
      .spyOn(binary, 'fetchText')
      .mockResolvedValue(
        `${'0'.repeat(64)}  unrelated.tar.gz\n${expectedChecksum}  ${LINUX_ARCHIVE_FILE_NAME}\n`,
      );
    jest
      .spyOn(binary, 'downloadUrlToFile')
      .mockImplementation(async (_url, destinationPath) => {
        await fsp.writeFile(destinationPath, archiveBytes);
      });

    try {
      const downloaded = await binary.download();

      expect(downloaded).toEqual({
        path: path.join(NodeBinary.TEMP_DIR, 'node-v24.13.1-linux-x64.tar.gz'),
        fileName: LINUX_ARCHIVE_FILE_NAME,
        sha256: expectedChecksum,
        version: TEST_VERSION,
      });
      await expect(fsp.readFile(downloaded.path)).resolves.toEqual(
        archiveBytes,
      );
      expect(fetchText).toHaveBeenCalledWith(
        'https://nodejs.org/dist/v24.13.1/SHASUMS256.txt',
      );
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('removes a mismatched temporary download and never exposes it at the final archive path', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-download-mismatch-'),
    );
    const expectedBytes = Buffer.from('expected archive bytes');
    const mismatchedBytes = Buffer.from('corrupted archive bytes');
    setLinuxVersionMetadata();
    NodeBinary.TEMP_DIR = path.join(tmpRoot, 'extracts');

    const binary = makeLinuxBinary();
    jest
      .spyOn(binary, 'fetchText')
      .mockResolvedValue(
        `${sha256(expectedBytes)}  ${LINUX_ARCHIVE_FILE_NAME}\n`,
      );
    jest
      .spyOn(binary, 'downloadUrlToFile')
      .mockImplementation(async (_url, destinationPath) => {
        await fsp.writeFile(destinationPath, mismatchedBytes);
      });

    try {
      const finalArchivePath = await binary.getArchivePath();
      await expect(binary.download()).rejects.toThrow(
        /archive checksum mismatch/i,
      );
      expect(existsSync(finalArchivePath)).toBe(false);
      await expect(fsp.readdir(NodeBinary.TEMP_DIR)).resolves.toEqual([]);
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('keeps the final archive untouched until a complete verified temporary file is ready', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-download-atomic-'),
    );
    const previousBytes = Buffer.from('previous complete archive');
    const replacementBytes = Buffer.from('replacement complete archive');
    setLinuxVersionMetadata();
    NodeBinary.TEMP_DIR = path.join(tmpRoot, 'extracts');

    const binary = makeLinuxBinary();
    const finalArchivePath = await binary.getArchivePath();
    await fsp.mkdir(NodeBinary.TEMP_DIR, { recursive: true });
    await fsp.writeFile(finalArchivePath, previousBytes);
    jest
      .spyOn(binary, 'fetchText')
      .mockResolvedValue(
        `${sha256(replacementBytes)}  ${LINUX_ARCHIVE_FILE_NAME}\n`,
      );
    let observedTemporaryPath = '';
    jest
      .spyOn(binary, 'downloadUrlToFile')
      .mockImplementation(async (_url, destinationPath) => {
        observedTemporaryPath = destinationPath;
        expect(destinationPath).not.toBe(finalArchivePath);
        await expect(fsp.readFile(finalArchivePath)).resolves.toEqual(
          previousBytes,
        );
        await fsp.writeFile(destinationPath, replacementBytes.subarray(0, 8));
        await expect(fsp.readFile(finalArchivePath)).resolves.toEqual(
          previousBytes,
        );
        await fsp.appendFile(destinationPath, replacementBytes.subarray(8));
      });

    try {
      await binary.download();

      expect(observedTemporaryPath).toMatch(/\.download$/);
      expect(existsSync(observedTemporaryPath)).toBe(false);
      await expect(fsp.readFile(finalArchivePath)).resolves.toEqual(
        replacementBytes,
      );
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('detects cached binary tampering and refuses to reuse the cache entry', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-cache-integrity-'),
    );
    const originalBinary = Buffer.from('cached-node-a');
    const tamperedBinary = Buffer.from('cached-node-b');
    setLinuxVersionMetadata();
    NodeBinary.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    NodeBinary.TEMP_DIR = path.join(tmpRoot, 'extracts');

    const receiptWriter = makeLinuxBinary();

    try {
      const binaryPath = await receiptWriter.getBinaryPath();
      const receiptPath =
        await receiptWriter.getIntegrityReceiptPath(binaryPath);
      const archivePath = await receiptWriter.getArchivePath();
      const archiveSource = path.join(
        tmpRoot,
        'archive-source',
        'node-v24.13.1-linux-x64',
      );
      await fsp.mkdir(path.join(archiveSource, 'bin'), { recursive: true });
      await fsp.mkdir(NodeBinary.TEMP_DIR, { recursive: true });
      await fsp.writeFile(
        path.join(archiveSource, 'bin', 'node'),
        originalBinary,
      );
      await c(
        {
          cwd: path.dirname(archiveSource),
          gzip: true,
          file: archivePath,
        },
        [path.basename(archiveSource)],
      );
      const archive = {
        path: archivePath,
        fileName: LINUX_ARCHIVE_FILE_NAME,
        sha256: sha256(await fsp.readFile(archivePath)),
        version: TEST_VERSION,
      };
      await receiptWriter.extract(archive);
      expect(existsSync(receiptPath)).toBe(true);
      expect(existsSync(archivePath)).toBe(false);
      expect(existsSync(`${archivePath}-extract`)).toBe(false);

      const binary = makeLinuxBinary();
      await expect(binary.getBinaryPath()).resolves.toBe(binaryPath);
      await expect(binary.validateCachedBinary(binaryPath)).resolves.toBe(true);

      await fsp.writeFile(binaryPath, tamperedBinary);
      await expect(binary.validateCachedBinary(binaryPath)).resolves.toBe(
        false,
      );

      const download = jest
        .spyOn(binary, 'download')
        .mockImplementation(async () => {
          expect(existsSync(binaryPath)).toBe(false);
          expect(existsSync(receiptPath)).toBe(false);
          return archive;
        });
      const extract = jest.spyOn(binary, 'extract').mockResolvedValue();

      await binary._reconcile();

      expect(download).toHaveBeenCalledTimes(1);
      expect(extract).toHaveBeenCalledWith(archive);
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });
});
