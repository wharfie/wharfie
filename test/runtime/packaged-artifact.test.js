/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getRunningExecutablePath,
  inspectArtifactBytes,
} from '../../src/core/runtime/packaged-artifact.js';

/** @type {string[]} */
const roots = [];

afterEach(async () => {
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
});
