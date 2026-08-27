/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { build } from 'esbuild';

import {
  AWS_PROVIDER_EMBEDDING_POLICY,
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
  it('does not resolve build-only paths while merely loading ordinary app code', async () => {
    const resolveProvider = jest.fn(() => undefined);
    const resolveProviderLoader = jest.fn(() => {
      throw new Error('build-only path resolution must stay lazy');
    });
    const args = {
      stdin: { contents: 'process.stdout.write("hello\\n");' },
    };

    await expect(
      withEmbeddedAwsProvider(args, {
        resolveProvider,
        resolveProviderLoader,
      }),
    ).resolves.toBe(args);
    expect(resolveProvider).not.toHaveBeenCalled();
    expect(resolveProviderLoader).not.toHaveBeenCalled();
  });

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
          embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
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
    const prepared = await withEmbeddedAwsProvider(
      {
        stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
      },
      {
        embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
      },
    );
    const preparedAgain = await withEmbeddedAwsProvider(prepared, {
      embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
    });

    expect(prepared.stdin?.contents).toContain('wharfieEmbeddedAwsProvider');
    expect(preparedAgain).toBe(prepared);
  });

  it('reattaches the fixed resolver when prepared entry options are reconstructed', async () => {
    const prepared = await withEmbeddedAwsProvider({
      stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
    });
    const reconstructed = { ...prepared, plugins: [] };

    const repaired = await withEmbeddedAwsProvider(reconstructed);

    expect(repaired).not.toBe(reconstructed);
    expect(repaired.stdin).toBe(reconstructed.stdin);
    expect(repaired.plugins).toEqual([
      expect.objectContaining({
        name: 'wharfie-fixed-aws-provider-boundary',
      }),
    ]);
    expect(await withEmbeddedAwsProvider(repaired)).toBe(repaired);
  });

  it('seals an outer operator when the explicitly optional companion is absent', async () => {
    const resolveProvider = jest.fn(() => undefined);
    const importProvider = jest.fn(async () => ({}));
    const prepared = await withEmbeddedAwsProvider(
      {
        stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
      },
      {
        embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
        resolveProvider,
        importProvider,
      },
    );

    expect(resolveProvider).toHaveBeenCalledTimes(1);
    expect(importProvider).not.toHaveBeenCalled();
    expect(prepared.stdin?.contents).toContain(
      'sealWharfieAwsProviderUnavailable();',
    );
    expect(prepared.stdin?.contents).not.toContain(
      'wharfieEmbeddedAwsProvider',
    );
  });

  it('seals generated app entries provider-free without consulting the ambient install', async () => {
    const resolveProvider = jest.fn(() => {
      throw new Error('provider-free builds must not inspect companions');
    });
    const prepared = await withEmbeddedAwsProvider(
      {
        stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
      },
      { resolveProvider },
    );

    expect(resolveProvider).not.toHaveBeenCalled();
    expect(prepared.stdin?.contents).toContain(
      'sealWharfieAwsProviderUnavailable();',
    );
    expect(prepared.stdin?.contents).not.toContain(
      'wharfieEmbeddedAwsProvider',
    );
  });

  it('seals a copied self-host runtime boundary in a provider-free bundle', async () => {
    const root = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-provider-free-linux-bundle-'),
    );
    const snapshotProviderPath = path.join(
      root,
      'snapshot',
      'src',
      'core',
      'runtime',
      'aws-provider-module.js',
    );
    const snapshotVersionPath = path.join(
      root,
      'snapshot',
      'src',
      'core',
      'lib',
      'version.js',
    );
    const fakeProviderRoot = path.join(root, 'node_modules', '@wharfie', 'aws');
    const providerImportMarker = path.join(root, 'provider-imported');
    const bundlePath = path.join(root, 'provider-free-linux.cjs');
    const authoredBoundaryPath = path.join(
      root,
      'authored',
      'src',
      'core',
      'runtime',
      'aws-provider-module.js',
    );
    try {
      await Promise.all([
        fsp.mkdir(path.dirname(snapshotProviderPath), { recursive: true }),
        fsp.mkdir(path.dirname(snapshotVersionPath), { recursive: true }),
        fsp.mkdir(fakeProviderRoot, { recursive: true }),
        fsp.mkdir(path.dirname(authoredBoundaryPath), { recursive: true }),
      ]);
      await Promise.all([
        fsp.copyFile(
          path.resolve('src/core/runtime/aws-provider-module.js'),
          snapshotProviderPath,
        ),
        fsp.copyFile(
          path.resolve('src/core/lib/version.js'),
          snapshotVersionPath,
        ),
        fsp.writeFile(
          path.join(root, 'snapshot', 'package.json'),
          `${JSON.stringify({ version: '0.0.15' })}\n`,
        ),
        fsp.writeFile(
          path.join(root, 'operator.js'),
          'export default async function operatorCli() {}\n',
        ),
        fsp.writeFile(
          authoredBoundaryPath,
          'export const authoredBoundary = "authored-boundary";\n',
        ),
        fsp.writeFile(
          path.join(fakeProviderRoot, 'package.json'),
          `${JSON.stringify({
            name: '@wharfie/aws',
            version: '0.0.15',
            type: 'module',
            exports: './index.js',
          })}\n`,
        ),
        fsp.writeFile(
          path.join(fakeProviderRoot, 'index.js'),
          [
            "import { writeFileSync } from 'node:fs';",
            'writeFileSync(process.env.WHARFIE_PROVIDER_IMPORT_MARKER, "imported");',
            'export const WHARFIE_AWS_PROVIDER_PACKAGE_VERSION = "0.0.15";',
            'export const WHARFIE_AWS_PROVIDER_CONTRACT_VERSION = 1;',
            'export const getAwsSdkBindings = () => Object.freeze({});',
            '',
          ].join('\n'),
        ),
      ]);
      const prepared = await withEmbeddedAwsProvider({
        stdin: {
          contents: [
            `import { requireAwsProvider } from ${JSON.stringify(snapshotProviderPath)};`,
            `import { authoredBoundary } from ${JSON.stringify(authoredBoundaryPath)};`,
            "import runtimeOperatorCli from './operator.js';",
            'const ledgerServiceCmd = {};',
            'async function runPackagedApp() {}',
            '(async () => {',
            '  await runPackagedApp({',
            '    runtimeModules: {',
            '      operatorCli: runtimeOperatorCli,',
            "      'ledger-service': ledgerServiceCmd,",
            '    },',
            '  });',
            '  if (authoredBoundary !== "authored-boundary") throw new Error("authored boundary was replaced");',
            '  await requireAwsProvider();',
            '})();',
          ].join('\n'),
          resolveDir: root,
          sourcefile: 'index.js',
        },
      });
      await build({
        ...prepared,
        bundle: true,
        format: 'cjs',
        logLevel: 'silent',
        outfile: bundlePath,
        platform: 'node',
        target: 'node24.13.1',
      });

      const result = spawnSync(process.execPath, [bundlePath], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          WHARFIE_PROVIDER_IMPORT_MARKER: providerImportMarker,
        },
      });

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`.trim()).toBe(
        "AWS deployment support was not embedded. Install matching '@wharfie/aws@0.0.15' beside '@wharfie/wharfie@0.0.15' in the builder, rebuild the application, and retry.",
      );
      await expect(fsp.access(providerImportMarker)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await fsp.rm(root, { force: true, recursive: true });
    }
  });

  it('rejects invalid and conflicting explicit policies', async () => {
    await expect(
      withEmbeddedAwsProvider(
        {
          stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
        },
        { embeddingPolicy: /** @type {any} */ ('ambient') },
      ),
    ).rejects.toThrow('AWS provider embedding policy is invalid.');

    const providerFree = await withEmbeddedAwsProvider({
      stdin: { contents: GENERATED_ENTRY, resolveDir: process.cwd() },
    });
    await expect(
      withEmbeddedAwsProvider(providerFree, {
        embeddingPolicy: AWS_PROVIDER_EMBEDDING_POLICY.EMBED_IF_AVAILABLE,
      }),
    ).rejects.toThrow(
      'AWS provider boundary was prepared with a conflicting policy.',
    );
  });
});
