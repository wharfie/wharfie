/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getRunningExecutablePath,
  inspectArtifactBytes,
  openHeldArtifactSource,
} from '../../src/core/runtime/packaged-artifact.js';

/** @type {string[]} */
const roots = [];

/** @param {Promise<unknown>} promise @returns {Promise<unknown>} */
async function captureRejection(promise) {
  let rejected = false;
  /** @type {unknown} */
  let reason;
  try {
    await promise;
  } catch (error) {
    rejected = true;
    reason = error;
  }
  if (!rejected) throw new Error('Expected promise to reject.');
  return reason;
}

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

describe('packaged artifact bytes', () => {
  it('binds Linux observations to the running executable inode', () => {
    expect(
      getRunningExecutablePath({
        platform: 'linux',
        execPath: '/replaceable/app',
      }),
    ).toBe('/proc/self/exe');
    expect(
      getRunningExecutablePath({
        platform: 'darwin',
        execPath: '/Applications/example',
      }),
    ).toBe('/Applications/example');
  });

  it('returns the exact regular-file SHA-256 identity', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    const bytes = Buffer.from('exact packaged bytes');
    await fsp.writeFile(artifactPath, bytes);
    const digest = createHash('sha256').update(bytes).digest('base64url');

    await expect(inspectArtifactBytes(artifactPath)).resolves.toEqual({
      artifactId: `waf1_${digest}`,
      byteDigest: { algorithm: 'sha256', value: digest },
      size: bytes.length,
    });
    await expect(inspectArtifactBytes(root)).rejects.toThrow(/regular file/);
    await expect(inspectArtifactBytes('relative/app')).rejects.toThrow(
      /canonical path/,
    );
  });

  it('uploads the opened inode even after its pathname is replaced', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    const displacedPath = path.join(root, 'opened-app');
    const openedBytes = Buffer.from('bytes from the held inode');
    const replacementBytes = Buffer.from('bytes from a replacement path');
    await fsp.writeFile(artifactPath, openedBytes);

    const source = await openHeldArtifactSource(artifactPath);
    try {
      await fsp.rename(artifactPath, displacedPath);
      await fsp.writeFile(artifactPath, replacementBytes);

      const chunks = [];
      for await (const chunk of source.createReadStream()) chunks.push(chunk);

      expect(Buffer.concat(chunks)).toEqual(openedBytes);
      expect(Buffer.concat(chunks)).not.toEqual(replacementBytes);
    } finally {
      await source.close();
    }
  });

  it('freezes the observation and verifies unchanged bytes after streaming', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    const bytes = Buffer.from('stable artifact bytes');
    await fsp.writeFile(artifactPath, bytes);
    const digest = createHash('sha256').update(bytes).digest('base64url');

    const source = await openHeldArtifactSource(artifactPath);
    try {
      expect(Object.isFrozen(source)).toBe(true);
      expect(Object.isFrozen(source.observation)).toBe(true);
      expect(Object.isFrozen(source.observation.byteDigest)).toBe(true);
      expect(source.observation).toEqual({
        artifactId: `waf1_${digest}`,
        byteDigest: { algorithm: 'sha256', value: digest },
        size: bytes.length,
      });

      const chunks = [];
      for await (const chunk of source.createReadStream()) chunks.push(chunk);

      expect(Buffer.concat(chunks)).toEqual(bytes);
      await expect(source.verifyUnchanged()).resolves.toBe(source.observation);
    } finally {
      await source.close();
    }
  });

  it('detects descriptor mutation during the upload lifecycle', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    const original = Buffer.alloc(256 * 1024, 0x61);
    const replacement = Buffer.alloc(original.length, 0x62);
    await fsp.writeFile(artifactPath, original);

    const source = await openHeldArtifactSource(artifactPath);
    try {
      const stream = source.createReadStream();
      const iterator = stream[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({ done: false });
      await fsp.writeFile(artifactPath, replacement);
      let nextChunk;
      do {
        nextChunk = await iterator.next();
      } while (!nextChunk.done);

      await expect(source.verifyUnchanged()).rejects.toThrow(/bytes changed/);
    } finally {
      await source.close();
    }
  });

  it('rejects unsafe lifecycle and concurrent read operations', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    await fsp.writeFile(artifactPath, Buffer.alloc(128 * 1024, 0x61));

    const source = await openHeldArtifactSource(artifactPath);
    await expect(source.verifyUnchanged()).rejects.toThrow(/must be streamed/);
    const stream = source.createReadStream();
    expect(() => source.createReadStream()).toThrow(/active read stream/);
    await expect(source.verifyUnchanged()).rejects.toThrow(
      /active read stream/,
    );

    const firstClose = source.close();
    const secondClose = source.close();
    expect(secondClose).toBe(firstClose);
    await firstClose;
    expect(stream.destroyed).toBe(true);
    expect(() => source.createReadStream()).toThrow(/closed/);
    await expect(source.verifyUnchanged()).rejects.toThrow(/closed/);
  });

  it('closes each opened descriptor exactly once on success and failure', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    await fsp.writeFile(artifactPath, 'descriptor lifecycle');
    const originalOpen = fsp.open.bind(fsp);
    /** @type {number[]} */
    const closeCounts = [];
    jest.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const originalClose = handle.close.bind(handle);
      const index = closeCounts.push(0) - 1;
      handle.close = async () => {
        closeCounts[index] += 1;
        await originalClose();
      };
      return handle;
    });

    const source = await openHeldArtifactSource(artifactPath);
    const firstClose = source.close();
    expect(source.close()).toBe(firstClose);
    await firstClose;
    await expect(openHeldArtifactSource(root)).rejects.toThrow(/regular file/);

    expect(closeCounts).toEqual([1, 1]);
  });

  it('preserves validation and descriptor-close failures in deterministic order', async () => {
    const primaryFailure = undefined;
    const closeFailure = 'descriptor close failed';
    const close = jest.fn(async () => {
      throw closeFailure;
    });
    jest.spyOn(fsp, 'open').mockImplementationOnce(
      async () =>
        /** @type {any} */ ({
          stat: async () => {
            throw primaryFailure;
          },
          close,
        }),
    );

    const failure = await captureRejection(
      openHeldArtifactSource(path.resolve('/virtual-selected-sea')),
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (failure).errors).toEqual([
      primaryFailure,
      closeFailure,
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('preserves an arbitrary validation failure unchanged when descriptor close succeeds', async () => {
    const primaryFailure = Symbol('artifact validation failed');
    const close = jest.fn(async () => {});
    jest.spyOn(fsp, 'open').mockImplementationOnce(
      async () =>
        /** @type {any} */ ({
          stat: async () => {
            throw primaryFailure;
          },
          close,
        }),
    );

    await expect(
      captureRejection(
        openHeldArtifactSource(path.resolve('/virtual-selected-sea')),
      ),
    ).resolves.toBe(primaryFailure);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('preserves descriptor-close failure unchanged after successful inspection', async () => {
    const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-artifact-'));
    roots.push(root);
    const artifactPath = path.join(root, 'app');
    await fsp.writeFile(artifactPath, 'successful descriptor observation');
    const closeFailure = Object.freeze({ code: 'CLOSE_FAILED' });
    const originalOpen = fsp.open.bind(fsp);
    jest.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      const originalClose = handle.close.bind(handle);
      handle.close = async () => {
        await originalClose();
        throw closeFailure;
      };
      return handle;
    });

    await expect(
      captureRejection(inspectArtifactBytes(artifactPath)),
    ).resolves.toBe(closeFailure);
  });
});
