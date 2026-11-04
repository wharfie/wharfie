/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import JSZip from 'jszip';
import { c } from 'tar';

import NodeBinary from '../../../src/core/resources/builds/node-binary.js';

const ORIGINAL_BINARIES_DIR = NodeBinary.BINARIES_DIR;
const ORIGINAL_TEMP_DIR = NodeBinary.TEMP_DIR;
const TEST_VERSION = 'v24.13.1';
const LINUX_ARCHIVE_FILE_NAME = 'node-v24.13.1-linux-x64.tar.gz';

function makeLinuxVersionMetadata(files = ['linux-x64']) {
  return {
    version: TEST_VERSION,
    date: '2026-01-01',
    files,
    npm: '11.10.0',
    v8: '13.6',
    uv: '1.50.0',
    zlib: '1.3.0',
    openssl: '3.4.0',
    modules: '137',
    lts: 'Jod',
    security: 'false',
  };
}

function setLinuxVersionMetadata() {
  NodeBinary.versions = [makeLinuxVersionMetadata()];
}

/**
 * @param {string | NodeJS.ArrayBufferView} value - Value to hash.
 * @returns {string} - SHA-256 digest.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * @param {(progress: {version: string, downloadedBytes: number, totalBytes: number|null}) => unknown} [onDownloadProgress]
 */
function makeLinuxBinary(onDownloadProgress) {
  return new NodeBinary({
    name: 'node-linux',
    onDownloadProgress,
    properties: {
      version: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
    },
  });
}

/** @param {'linux'|'win32'} [platform] */
async function createExtractionFixture(platform = 'linux') {
  const root = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-node-extraction-'),
  );
  NodeBinary.versions = [
    makeLinuxVersionMetadata(['linux-x64', 'win-x64-zip']),
  ];
  NodeBinary.BINARIES_DIR = path.join(root, 'cache');
  NodeBinary.TEMP_DIR = path.join(root, 'downloads');
  await fsp.mkdir(NodeBinary.TEMP_DIR);
  const binary = new NodeBinary({
    name: 'node-extraction',
    properties: { version: '24.13.1', platform, architecture: 'x64' },
  });
  const binaryPath = await binary.getBinaryPath();
  const fileName = await binary.getOfficialArchiveFileName();
  const archivePath = path.join(NodeBinary.TEMP_DIR, fileName);
  const bytes = Buffer.from('complete verified node binary');
  if (platform === 'win32') {
    const zip = new JSZip();
    zip.file('node-v24.13.1-win-x64/node.exe', bytes);
    await fsp.writeFile(
      archivePath,
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
  } else {
    const source = path.join(root, 'source');
    const relative = 'node-v24.13.1-linux-x64/bin/node';
    await fsp.mkdir(path.dirname(path.join(source, relative)), {
      recursive: true,
    });
    await fsp.writeFile(path.join(source, relative), bytes, { mode: 0o755 });
    await c({ cwd: source, gzip: true, file: archivePath }, [
      'node-v24.13.1-linux-x64',
    ]);
  }
  const archive = {
    path: archivePath,
    fileName,
    sha256: sha256(await fsp.readFile(archivePath)),
    version: TEST_VERSION,
  };
  const previous = Buffer.from('previous verified cache entry');
  await fsp.writeFile(binaryPath, previous);
  await binary.writeIntegrityReceipt(
    { ...archive, sha256: sha256('prior archive') },
    binaryPath,
  );
  const receiptPath = await binary.getIntegrityReceiptPath(binaryPath);
  const previousReceipt = await fsp.readFile(receiptPath);
  const unrelated = await fsp.mkdtemp(
    path.join(NodeBinary.BINARIES_DIR, '.node-extract-'),
  );
  await fsp.writeFile(path.join(unrelated, 'another-invocation'), 'untouched');
  return {
    root,
    binary,
    binaryPath,
    receiptPath,
    archive,
    bytes,
    previous,
    previousReceipt,
    unrelated,
  };
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

  it('reports bounded byte progress while streaming a Node archive', async () => {
    setLinuxVersionMetadata();
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-download-progress-'),
    );
    const destinationPath = path.join(tmpRoot, 'node.tar.gz');
    const chunks = Array.from({ length: 5 }, () => Buffer.alloc(600 * 1024));
    const totalBytes = chunks.reduce((total, chunk) => total + chunk.length, 0);
    const onDownloadProgress = jest.fn();
    const binary = makeLinuxBinary(onDownloadProgress);
    const response = /** @type {import('node:http').IncomingMessage} */ (
      Object.assign(Readable.from(chunks), {
        statusCode: 200,
        headers: {
          'content-type': 'application/gzip',
          'content-length': String(totalBytes),
        },
      })
    );
    jest.spyOn(binary, 'requestUrl').mockResolvedValue(response);

    try {
      await binary.downloadUrlToFile(
        'https://nodejs.org/node.tar.gz',
        destinationPath,
      );

      await expect(fsp.stat(destinationPath)).resolves.toMatchObject({
        size: totalBytes,
      });
      expect(
        onDownloadProgress.mock.calls.map(([progress]) => progress),
      ).toEqual([
        { version: TEST_VERSION, downloadedBytes: 0, totalBytes },
        { version: TEST_VERSION, downloadedBytes: 1_228_800, totalBytes },
        { version: TEST_VERSION, downloadedBytes: 2_457_600, totalBytes },
        { version: TEST_VERSION, downloadedBytes: 3_072_000, totalBytes },
      ]);
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['24.13.1', 'v24.13.1'],
    ['v24.13.1', 'v24.13.1'],
    ['24.13.1-rc.1', 'v24.13.1-rc.1'],
    ['24.13.1+build.7', 'v24.13.1+build.7'],
  ])(
    'resolves the exact literal %s locally as %s',
    async (requestedVersion, exactVersion) => {
      const getVersions = jest.spyOn(NodeBinary, 'getVersions');
      const binary = new NodeBinary({
        name: 'node-linux',
        properties: {
          version: requestedVersion,
          platform: 'linux',
          architecture: 'x64',
        },
      });

      await expect(binary.getExactVersion()).resolves.toBe(exactVersion);
      expect(getVersions).not.toHaveBeenCalled();
    },
  );

  it('uses the release catalog to resolve a partial version', async () => {
    const getVersions = jest
      .spyOn(NodeBinary, 'getVersions')
      .mockResolvedValue([makeLinuxVersionMetadata()]);
    const binary = new NodeBinary({
      name: 'node-linux',
      properties: {
        version: '24.13',
        platform: 'linux',
        architecture: 'x64',
      },
    });

    await expect(binary.getExactVersion()).resolves.toBe(TEST_VERSION);
    expect(getVersions).toHaveBeenCalledTimes(1);
  });

  it('rejects an unsafe exact-looking suffix through the release catalog', async () => {
    const getVersions = jest
      .spyOn(NodeBinary, 'getVersions')
      .mockResolvedValue([]);
    const binary = new NodeBinary({
      name: 'node-linux',
      properties: {
        version: '24.13.1-../../escape',
        platform: 'linux',
        architecture: 'x64',
      },
    });

    await expect(binary.getBinaryName()).rejects.toThrow(
      'No Node.js version found for 24.13.1-../../escape',
    );
    expect(getVersions).toHaveBeenCalledTimes(1);
    expect(binary.has('binaryPath')).toBe(false);
  });

  it('reuses an exact cached binary offline without querying the release catalog', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-cache-offline-'),
    );
    const binaryBytes = Buffer.from('cached verified node');
    NodeBinary.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    NodeBinary.TEMP_DIR = path.join(tmpRoot, 'extracts');

    const binary = makeLinuxBinary();
    const binaryPath = await binary.getBinaryPath();
    const receiptPath = await binary.getIntegrityReceiptPath(binaryPath);
    await fsp.writeFile(binaryPath, binaryBytes);
    await fsp.writeFile(
      receiptPath,
      `${JSON.stringify({
        version: 1,
        target: {
          nodeVersion: TEST_VERSION,
          platform: 'linux',
          architecture: 'x64',
        },
        archive: {
          fileName: LINUX_ARCHIVE_FILE_NAME,
          sha256: 'a'.repeat(64),
        },
        binary: {
          sha256: sha256(binaryBytes),
          size: binaryBytes.length,
        },
      })}\n`,
      'utf8',
    );
    const getVersions = jest
      .spyOn(NodeBinary, 'getVersions')
      .mockRejectedValue(new Error('offline'));
    const download = jest.spyOn(binary, 'download');

    try {
      await expect(binary._reconcile()).resolves.toBeUndefined();
      expect(getVersions).not.toHaveBeenCalled();
      expect(download).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
  });

  it('keeps catalog target validation on an exact cache miss', async () => {
    const tmpRoot = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-node-cache-miss-'),
    );
    NodeBinary.BINARIES_DIR = path.join(tmpRoot, 'binaries');
    NodeBinary.TEMP_DIR = path.join(tmpRoot, 'extracts');

    const getVersions = jest
      .spyOn(NodeBinary, 'getVersions')
      .mockResolvedValue([makeLinuxVersionMetadata([])]);
    const binary = makeLinuxBinary();
    const downloadUrlToFile = jest.spyOn(binary, 'downloadUrlToFile');

    try {
      await expect(binary._reconcile()).rejects.toThrow(
        'does not publish binaries for linux-x64',
      );
      expect(getVersions).toHaveBeenCalledTimes(1);
      expect(downloadUrlToFile).not.toHaveBeenCalled();
    } finally {
      await fsp.rm(tmpRoot, { recursive: true, force: true });
    }
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

  it.each(['linux', 'win32'])(
    'publishes %s extraction atomically when downloads and the cache are on different filesystems',
    async (platform) => {
      const fixture = await createExtractionFixture(
        /** @type {'linux'|'win32'} */ (platform),
      );
      const rename = fsp.rename.bind(fsp);
      let staging = '';
      jest
        .spyOn(fsp, 'rename')
        .mockImplementation(async (source, destination) => {
          // Model the Ubuntu runner's separate /tmp and /home mounts at the
          // actual filesystem rename boundary while exercising real extraction.
          if (
            String(source).startsWith(`${NodeBinary.TEMP_DIR}${path.sep}`) &&
            String(destination).startsWith(
              `${NodeBinary.BINARIES_DIR}${path.sep}`,
            )
          ) {
            throw Object.assign(new Error('cross-device link not permitted'), {
              code: 'EXDEV',
            });
          }
          if (destination === fixture.binaryPath) {
            staging = path.join(
              NodeBinary.BINARIES_DIR,
              path
                .relative(NodeBinary.BINARIES_DIR, String(source))
                .split(path.sep)[0],
            );
            expect(path.basename(staging)).toMatch(/^\.node-extract-/);
            expect((await fsp.stat(staging)).mode & 0o777).toBe(0o700);
            await expect(fsp.readFile(fixture.binaryPath)).resolves.toEqual(
              fixture.previous,
            );
            await expect(fsp.readFile(fixture.receiptPath)).resolves.toEqual(
              fixture.previousReceipt,
            );
            await expect(fsp.readFile(source)).resolves.toEqual(fixture.bytes);
          }
          return rename(source, destination);
        });
      try {
        await fixture.binary.extract(fixture.archive);
        await expect(fsp.readFile(fixture.binaryPath)).resolves.toEqual(
          fixture.bytes,
        );
        await expect(fixture.binary.validateCachedBinary()).resolves.toBe(true);
        expect(staging).not.toBe('');
        expect(existsSync(staging)).toBe(false);
        expect(existsSync(fixture.archive.path)).toBe(false);
        await expect(
          fsp.readFile(
            path.join(fixture.unrelated, 'another-invocation'),
            'utf8',
          ),
        ).resolves.toBe('untouched');
        if (platform === 'linux')
          expect((await fsp.stat(fixture.binaryPath)).mode & 0o111).toBe(0o111);
      } finally {
        await fsp.rm(fixture.root, { recursive: true, force: true });
      }
    },
  );

  it.each(['extraction', 'publication', 'receipt'])(
    'cleans only owned staging after %s failure and retains any unpublished cache entry',
    async (failureAt) => {
      const fixture = await createExtractionFixture();
      const failure = Object.assign(new Error(`${failureAt} failed`), {
        code: 'EIO',
      });
      if (failureAt === 'extraction') {
        jest
          .spyOn(fixture.binary, 'extractUnixTar')
          .mockImplementation(async (_archive, staging) => {
            await fsp.writeFile(
              path.join(/** @type {string} */ (staging), 'partial-node'),
              'partial',
            );
            throw failure;
          });
      } else if (failureAt === 'publication') {
        const rename = fsp.rename.bind(fsp);
        jest
          .spyOn(fsp, 'rename')
          .mockImplementation(async (source, destination) => {
            if (destination === fixture.binaryPath) throw failure;
            return rename(source, destination);
          });
      } else {
        jest
          .spyOn(fixture.binary, 'writeIntegrityReceipt')
          .mockRejectedValue(failure);
      }
      try {
        await expect(fixture.binary.extract(fixture.archive)).rejects.toBe(
          failure,
        );
        if (failureAt === 'receipt') {
          expect(existsSync(fixture.binaryPath)).toBe(false);
          expect(existsSync(fixture.receiptPath)).toBe(false);
        } else {
          await expect(fsp.readFile(fixture.binaryPath)).resolves.toEqual(
            fixture.previous,
          );
          await expect(fsp.readFile(fixture.receiptPath)).resolves.toEqual(
            fixture.previousReceipt,
          );
          await expect(fixture.binary.validateCachedBinary()).resolves.toBe(
            true,
          );
        }
        expect(existsSync(fixture.archive.path)).toBe(false);
        expect(
          (await fsp.readdir(NodeBinary.BINARIES_DIR)).filter((entry) =>
            entry.startsWith('.node-extract-'),
          ),
        ).toEqual([path.basename(fixture.unrelated)]);
        await expect(
          fsp.readFile(
            path.join(fixture.unrelated, 'another-invocation'),
            'utf8',
          ),
        ).resolves.toBe('untouched');
      } finally {
        await fsp.rm(fixture.root, { recursive: true, force: true });
      }
    },
  );

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
