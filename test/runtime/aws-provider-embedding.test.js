/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import path from 'node:path';

import {
  resolveAwsProviderEmbedding,
  withEmbeddedAwsProvider,
} from '../../src/core/lib/esbuild.js';

const INCOMPATIBLE_MESSAGE =
  "AWS deployment support is incompatible. Install matching '@wharfie/aws@0.0.15' and '@wharfie/wharfie@0.0.15' packages and retry.";
const GENERATED_ENTRY = `
import runtimeOperatorCli from './operator.js';
const ledgerServiceCmd = {};
async function runPackagedApp() {}
(async () => {
  await runPackagedApp({
    runtimeModules: {
      operatorCli: runtimeOperatorCli,
      'ledger-service': ledgerServiceCmd,
    },
  });
})();
`;

/** @param {Record<string, string>} resolutions */
function requireRef(resolutions) {
  return /** @type {NodeRequire} */ (
    /** @type {unknown} */ ({
      resolve: jest.fn(
        /** @param {string} specifier */ (specifier) => {
          const resolved = resolutions[specifier];
          if (resolved) return resolved;
          throw Object.assign(new Error(`Cannot find module '${specifier}'`), {
            code: 'MODULE_NOT_FOUND',
          });
        },
      ),
    })
  );
}

describe('AWS provider SEA embedding boundary', () => {
  it('binds the actual companion package identity and root', () => {
    const resolved = resolveAwsProviderEmbedding();

    expect(resolved).toBeDefined();
    expect(resolved?.packageJsonPath).toBe(
      path.join(resolved?.packageRoot || '', 'package.json'),
    );
    expect(
      path.relative(resolved?.packageRoot || '', resolved?.entrypoint || ''),
    ).not.toMatch(/^\.\.(?:[/\\]|$)/u);
  });

  it.each([
    [
      'wrong package name',
      { name: '@wharfie/not-aws', version: '0.0.15' },
      '/tmp/wharfie-provider/src/index.js',
    ],
    [
      'wrong package version',
      { name: '@wharfie/aws', version: '0.0.14' },
      '/tmp/wharfie-provider/src/index.js',
    ],
    [
      'entrypoint outside package root',
      { name: '@wharfie/aws', version: '0.0.15' },
      '/tmp/other-provider/index.js',
    ],
  ])(
    'rejects %s before importing provider code',
    (_label, metadata, entrypoint) => {
      const packageJsonPath = '/tmp/wharfie-provider/package.json';

      expect(() =>
        resolveAwsProviderEmbedding({
          requireRef: requireRef({
            '@wharfie/aws': entrypoint,
            '@wharfie/aws/package.json': packageJsonPath,
          }),
          readPackageJson: () => JSON.stringify(metadata),
        }),
      ).toThrow(
        expect.objectContaining({
          code: 'WHARFIE_AWS_PROVIDER_INCOMPATIBLE',
          reason: 'incompatible',
          message: INCOMPATIBLE_MESSAGE,
        }),
      );
    },
  );

  it('maps an installed companion import failure to the stable incompatible error', async () => {
    const transitiveFailure = Object.assign(
      new Error(
        "Cannot find package '@aws-sdk/client-sts' imported from /tmp/provider/node_modules/@wharfie/aws/src/index.js",
      ),
      { code: 'ERR_MODULE_NOT_FOUND' },
    );

    await expect(
      withEmbeddedAwsProvider(
        { stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() } },
        {
          resolveProvider: () =>
            Object.freeze({
              entrypoint: '/tmp/wharfie-provider/src/index.js',
              packageJsonPath: '/tmp/wharfie-provider/package.json',
              packageRoot: '/tmp/wharfie-provider',
            }),
          importProvider: async () => {
            throw transitiveFailure;
          },
        },
      ),
    ).rejects.toMatchObject({
      code: 'WHARFIE_AWS_PROVIDER_INCOMPATIBLE',
      reason: 'incompatible',
      message: INCOMPATIBLE_MESSAGE,
      cause: transitiveFailure,
    });
  });

  it('prepares the provider entry idempotently', async () => {
    const prepared = await withEmbeddedAwsProvider({
      stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
    });
    const preparedAgain = await withEmbeddedAwsProvider(prepared);

    expect(prepared.stdin?.contents).toContain('wharfieEmbeddedAwsProvider');
    expect(preparedAgain).toBe(prepared);
  });
});
