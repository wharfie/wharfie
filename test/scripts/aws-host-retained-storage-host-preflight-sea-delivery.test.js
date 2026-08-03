import { describe, expect, it, jest } from '@jest/globals';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
  AwsRetainedStorageHostPreflightSeaDeliveryError,
  createAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  createAwsRetainedStorageHostPreflightSeaRuntimeForTest,
  getAwsRetainedStorageHostPreflightSeaTarget,
  readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest,
  validateAwsRetainedStorageHostPreflightSeaDeliveryManifest,
} from '../../scripts/aws-host-retained-storage-host-preflight-sea-delivery.js';

const SOURCE_COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {'x86_64'|'arm64'} [expectedArchitecture] */
function createManifest(expectedArchitecture = 'x86_64') {
  return createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
    sourceCommit: SOURCE_COMMIT,
    expectedArchitecture,
  });
}

/** @param {'x64'|'arm64'} [architecture] */
function createHost(architecture = 'x64') {
  return {
    nodeVersion: '24.13.1',
    platform: 'linux',
    architecture,
    glibcVersionRuntime: '2.34',
  };
}

/** @param {{embedded?: unknown, expectedArchitecture?: 'x86_64'|'arm64', host?: Record<string, any>, readError?: Error, runError?: Error}} [options] */
function createRuntimeHarness(options = {}) {
  const expectedArchitecture = options.expectedArchitecture || 'x86_64';
  const readEmbeddedManifest = jest.fn(async function () {
    if (options.readError) throw options.readError;
    return options.embedded === undefined
      ? createManifest(expectedArchitecture)
      : options.embedded;
  });
  const runCollector = jest.fn(async function (_argv) {
    if (options.runError) throw options.runError;
  });
  const ports = { readEmbeddedManifest, runCollector };
  const expected = {
    sourceCommit: SOURCE_COMMIT,
    expectedArchitecture,
  };
  const host =
    options.host ||
    createHost(expectedArchitecture === 'x86_64' ? 'x64' : 'arm64');
  const runtime = createAwsRetainedStorageHostPreflightSeaRuntimeForTest({
    expected,
    host,
    ports,
  });
  return {
    runtime,
    expected,
    host,
    ports,
    readEmbeddedManifest,
    runCollector,
  };
}

describe('AWS retained-storage host-preflight SEA delivery', () => {
  it.each([
    ['x86_64', 'x64'],
    ['arm64', 'arm64'],
  ])(
    'creates one strict frozen %s manifest for the exact Linux target',
    (expectedArchitecture, nodeArchitecture) => {
      const manifest = createManifest(
        /** @type {'x86_64'|'arm64'} */ (expectedArchitecture),
      );

      expect(manifest).toEqual({
        schemaVersion: 1,
        kind: 'awsSingleNodeRetainedStorageHostPreflightSeaDelivery',
        deliveryId: expect.stringMatching(/^whd1_[A-Za-z0-9_-]{43}$/),
        source: {
          mode: 'git-archive-exact-commit',
          commit: SOURCE_COMMIT,
          entrypoint:
            'scripts/collect-aws-host-retained-storage-preflight-linux.js',
        },
        collector: {
          expectedArchitecture,
          invocation: 'zero-argument',
        },
        target: {
          nodeVersion: '24.13.1',
          platform: 'linux',
          architecture: nodeArchitecture,
          libc: 'glibc',
        },
        authority: 'none',
        authoritative: false,
      });
      expectDeepFrozen(manifest);
      expect(
        getAwsRetainedStorageHostPreflightSeaTarget(expectedArchitecture),
      ).toEqual(manifest.target);
    },
  );

  it('validates, canonicalizes, and serializes a detached manifest', () => {
    const manifest = createManifest();
    const deserialized = JSON.parse(JSON.stringify(manifest));
    const validated =
      validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(deserialized);

    expect(validated).toEqual(manifest);
    expect(validated).not.toBe(deserialized);
    expectDeepFrozen(validated);
    const serialized =
      stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(manifest);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized.indexOf('\n')).toBe(serialized.length - 1);
    expect(JSON.parse(serialized)).toEqual(manifest);
  });

  it('rejects semantic tampering, expanded surfaces, accessors, and oversized input', () => {
    const manifest = createManifest();
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        ...manifest,
        source: { ...manifest.source, commit: OTHER_COMMIT },
      }),
    ).toThrow(/ID does not match/i);
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        ...manifest,
        extra: true,
      }),
    ).toThrow(/exact required keys/i);
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        extra: 'x',
      }),
    ).toThrow(/exact required keys/i);

    let invoked = false;
    const accessor = JSON.parse(JSON.stringify(manifest));
    Object.defineProperty(accessor, 'source', {
      enumerable: true,
      get() {
        invoked = true;
        return manifest.source;
      },
    });
    expect(() =>
      validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(accessor),
    ).toThrow(/plain JSON property/i);
    expect(invoked).toBe(false);

    expect(() =>
      createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
        padding: 'x'.repeat(
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
        ),
      }),
    ).toThrow(/must not exceed/i);
  });

  it('reads only the fixed bounded asset through a captured provider', async () => {
    const manifest = createManifest();
    const bytes = Buffer.from(
      stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(manifest),
      'utf8',
    );
    let calls = 0;
    const provider = {
      /** @param {string} name */
      getAsset(name) {
        expect(this).toBe(provider);
        expect(name).toBe(
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
        );
        calls += 1;
        return bytes;
      },
    };

    const read =
      await readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        assetProvider: provider,
      });
    expect(read).toEqual(manifest);
    expect(calls).toBe(1);
    expectDeepFrozen(read);
  });

  it('accepts copied Uint8Array and ArrayBuffer asset views', async () => {
    const manifest = createManifest();
    const source = Buffer.from(
      stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(manifest),
      'utf8',
    );
    const assets = [
      new Uint8Array(source),
      source.buffer.slice(
        source.byteOffset,
        source.byteOffset + source.byteLength,
      ),
    ];
    for (const asset of assets) {
      await expect(
        readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest({
          assetProvider: { getAsset: () => asset },
        }),
      ).resolves.toEqual(manifest);
    }
  });

  it('rejects malformed, oversized, and accessor-backed asset boundaries without leaking values', async () => {
    for (const bytes of [
      Buffer.from('credential-secret-value', 'utf8'),
      Buffer.from([0xc3, 0x28]),
      Buffer.alloc(
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES + 1,
      ),
    ]) {
      const failure =
        await readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest({
          assetProvider: { getAsset: () => bytes },
        }).then(
          () => null,
          (error) => error,
        );
      expect(failure).toBeInstanceOf(
        AwsRetainedStorageHostPreflightSeaDeliveryError,
      );
      expect(failure.message).not.toContain('credential-secret-value');
    }

    let invoked = false;
    const provider = {};
    Object.defineProperty(provider, 'getAsset', {
      enumerable: true,
      get() {
        invoked = true;
        return () => Buffer.from('{}');
      },
    });
    await expect(
      readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        assetProvider: provider,
      }),
    ).rejects.toThrow(AwsRetainedStorageHostPreflightSeaDeliveryError);
    expect(invoked).toBe(false);
  });

  it('accepts no user arguments and invokes the collector with only baked values', async () => {
    const harness = createRuntimeHarness();

    await harness.runtime.run(['/opt/wharfie-preflight', 'embedded-entry.js']);

    expect(harness.readEmbeddedManifest).toHaveBeenCalledTimes(1);
    expect(harness.runCollector).toHaveBeenCalledTimes(1);
    expect(harness.runCollector.mock.calls[0][0]).toEqual([
      '/opt/wharfie-preflight',
      'embedded-entry.js',
      SOURCE_COMMIT,
      'x86_64',
    ]);
    expectDeepFrozen(harness.runCollector.mock.calls[0][0]);
    expect(Reflect.ownKeys(harness.runtime)).toEqual(['run']);
    expect(Object.isFrozen(harness.runtime)).toBe(true);
  });

  it('maps an arm64 target back to the collector provider spelling', async () => {
    const harness = createRuntimeHarness({ expectedArchitecture: 'arm64' });

    await harness.runtime.run(['binary', 'entry']);

    expect(harness.runCollector.mock.calls[0][0]).toEqual([
      'binary',
      'entry',
      SOURCE_COMMIT,
      'arm64',
    ]);
  });

  it.each([
    [[]],
    [['binary']],
    [['binary', 'entry', 'extra']],
    [['binary', 1]],
  ])(
    'rejects malformed base argv before asset or collector access',
    async (argv) => {
      const harness = createRuntimeHarness();

      await expect(
        harness.runtime.run(/** @type {any} */ (argv)),
      ).rejects.toThrow(/accepts no user arguments/i);
      expect(harness.readEmbeddedManifest).not.toHaveBeenCalled();
      expect(harness.runCollector).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'source commit',
      createAwsRetainedStorageHostPreflightSeaDeliveryManifest({
        sourceCommit: OTHER_COMMIT,
        expectedArchitecture: 'x86_64',
      }),
    ],
    ['provider architecture', createManifest('arm64')],
  ])(
    'requires complete equality with the baked %s',
    async (_label, mismatched) => {
      const harness = createRuntimeHarness({ embedded: mismatched });

      await expect(harness.runtime.run(['binary', 'entry'])).rejects.toThrow(
        AwsRetainedStorageHostPreflightSeaDeliveryError,
      );
      expect(harness.runCollector).not.toHaveBeenCalled();
    },
  );

  it('rejects an accessor-backed argv without invoking it or opening assets', async () => {
    const harness = createRuntimeHarness();
    let invoked = false;
    const argv = ['binary', 'entry'];
    Object.defineProperty(argv, '1', {
      enumerable: true,
      get() {
        invoked = true;
        return 'entry';
      },
    });

    await expect(harness.runtime.run(argv)).rejects.toThrow();
    expect(invoked).toBe(false);
    expect(harness.readEmbeddedManifest).not.toHaveBeenCalled();
    expect(harness.runCollector).not.toHaveBeenCalled();
  });

  it('rejects sparse, symbol-expanded, and oversized argv before opening assets', async () => {
    const sparse = new Array(2);
    const symbolExpanded = ['binary', 'entry'];
    /** @type {any} */ (symbolExpanded)[Symbol('extra')] = true;
    for (const argv of [
      sparse,
      symbolExpanded,
      ['binary', 'x'.repeat(4 * 1024)],
    ]) {
      const harness = createRuntimeHarness();
      await expect(harness.runtime.run(argv)).rejects.toThrow();
      expect(harness.readEmbeddedManifest).not.toHaveBeenCalled();
      expect(harness.runCollector).not.toHaveBeenCalled();
    }
  });

  it.each([
    ['node version', { nodeVersion: '24.13.0' }],
    ['platform', { platform: 'darwin' }],
    ['architecture', { architecture: 'arm64' }],
    ['glibc observation', { glibcVersionRuntime: null }],
  ])('rejects a mismatched runtime %s', async (_label, override) => {
    const harness = createRuntimeHarness({
      host: { ...createHost(), ...override },
    });

    await expect(harness.runtime.run(['binary', 'entry'])).rejects.toThrow(
      AwsRetainedStorageHostPreflightSeaDeliveryError,
    );
    expect(harness.runCollector).not.toHaveBeenCalled();
  });

  it('rejects a blank glibc observation at the host boundary', () => {
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaRuntimeForTest({
        expected: {
          sourceCommit: SOURCE_COMMIT,
          expectedArchitecture: 'x86_64',
        },
        host: { ...createHost(), glibcVersionRuntime: ' ' },
        ports: {
          readEmbeddedManifest() {},
          runCollector() {},
        },
      }),
    ).toThrow(/runtime host is invalid/i);
  });

  it('captures inputs and ports once and redacts port failures', async () => {
    const harness = createRuntimeHarness();
    harness.expected.sourceCommit = OTHER_COMMIT;
    harness.host.nodeVersion = '0.0.0';
    const mutablePorts = /** @type {Record<string, any>} */ (harness.ports);
    mutablePorts.readEmbeddedManifest = async () => {
      throw new Error('replacement-secret');
    };
    mutablePorts.runCollector = async () => {
      throw new Error('replacement-secret');
    };

    await expect(
      harness.runtime.run(['binary', 'entry']),
    ).resolves.toBeUndefined();
    expect(harness.readEmbeddedManifest).toHaveBeenCalledTimes(1);
    expect(harness.runCollector).toHaveBeenCalledTimes(1);

    for (const options of [
      { readError: new Error('read-secret') },
      { runError: new Error('run-secret') },
    ]) {
      const failing = createRuntimeHarness(options);
      const error = await failing.runtime.run(['binary', 'entry']).then(
        () => null,
        (failure) => failure,
      );
      expect(error).toBeInstanceOf(
        AwsRetainedStorageHostPreflightSeaDeliveryError,
      );
      expect(error.message).not.toMatch(/read-secret|run-secret/u);
    }
  });

  it('preserves both runtime port receivers', async () => {
    /** @type {Record<string, any>} */
    const ports = {
      async readEmbeddedManifest() {
        expect(this).toBe(ports);
        return createManifest();
      },
      async runCollector() {
        expect(this).toBe(ports);
      },
    };
    const runtime = createAwsRetainedStorageHostPreflightSeaRuntimeForTest({
      expected: {
        sourceCommit: SOURCE_COMMIT,
        expectedArchitecture: 'x86_64',
      },
      host: createHost(),
      ports,
    });

    await expect(runtime.run(['binary', 'entry'])).resolves.toBeUndefined();
  });

  it('rejects expanded factory and port authority surfaces', () => {
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaRuntimeForTest({
        expected: {
          sourceCommit: SOURCE_COMMIT,
          expectedArchitecture: 'x86_64',
        },
        host: createHost(),
        ports: {
          readEmbeddedManifest() {},
          runCollector() {},
          writeFile() {},
        },
      }),
    ).toThrow(/exact required keys/i);
    expect(() =>
      createAwsRetainedStorageHostPreflightSeaRuntimeForTest({
        expected: {
          sourceCommit: SOURCE_COMMIT,
          expectedArchitecture: 'x86_64',
        },
        host: createHost(),
        ports: {
          readEmbeddedManifest() {},
          runCollector() {},
        },
        outputPath: '/tmp/receipt',
      }),
    ).toThrow(/exact required keys/i);
  });
});
