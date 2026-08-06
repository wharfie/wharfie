/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import { getHostBuildTarget } from '../../src/core/runtime/host-build-target.js';

describe('host build target', () => {
  it('returns a canonical Linux target only after positive glibc detection', () => {
    expect(
      getHostBuildTarget({
        nodeVersion: '24.13.1',
        platform: 'linux',
        architecture: 'x64',
        glibcVersionRuntime: '2.39',
      }),
    ).toEqual({
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    });
  });

  it.each([undefined, ''])(
    'rejects Linux when glibc cannot be positively identified (%p)',
    (glibcVersionRuntime) => {
      expect(() =>
        getHostBuildTarget({
          nodeVersion: '24.13.1',
          platform: 'linux',
          architecture: 'x64',
          glibcVersionRuntime,
        }),
      ).toThrow(/positively identified glibc.*musl.*unknown/i);
    },
  );

  it('returns non-Linux hosts without a libc identity', () => {
    expect(
      getHostBuildTarget({
        nodeVersion: '24.13.1',
        platform: 'darwin',
        architecture: 'arm64',
      }),
    ).toEqual({
      nodeVersion: '24.13.1',
      platform: 'darwin',
      architecture: 'arm64',
    });
  });
});
