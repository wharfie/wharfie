/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import {
  assertSeaNodeVersionCompatible,
  normalizeExactNodeVersion,
} from '../../../src/core/resources/builds/lib/sea-node-version.js';

const MISMATCHED_NODE_VERSION =
  process.versions.node === '0.0.0' ? '0.0.1' : '0.0.0';

describe('SEA Node version compatibility', () => {
  it('normalizes an exact matching Node version', () => {
    expect(normalizeExactNodeVersion(` v${process.versions.node} `)).toBe(
      process.versions.node,
    );
    expect(assertSeaNodeVersionCompatible(`v${process.versions.node}`)).toBe(
      process.versions.node,
    );
  });

  it('rejects release-line prefixes and exact-version mismatches', () => {
    expect(() => assertSeaNodeVersionCompatible('24')).toThrow(
      /must be an exact Node\.js version in x\.y\.z form/i,
    );
    expect(() =>
      assertSeaNodeVersionCompatible(MISMATCHED_NODE_VERSION),
    ).toThrow(/blob generator and target binary.*same exact Node version/i);
  });
});
