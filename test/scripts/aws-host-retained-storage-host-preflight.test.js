/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import {
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_DOMAIN,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_KIND,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RECEIPT_MAX_BYTES,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SAFETY_CLASS,
  AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SCHEMA_VERSION,
  AwsRetainedStorageHostPreflightUnknownError,
  createAwsRetainedStorageHostPreflightCollector,
  createAwsRetainedStorageHostPreflightCollectorForTest,
  validateAwsRetainedStorageHostPreflightReceipt,
} from '../../scripts/aws-host-retained-storage-host-preflight.js';
import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../src/core/runtime/content-id.js';
import { assertManifestIsSecretFree } from '../../src/core/runtime/manifest-security.js';

const SOURCE_COMMIT = 'a'.repeat(40);
const BOOT_ID = '11111111-2222-3333-8444-555555555555';
const KERNEL_RELEASE = '6.1.150-177.286.amzn2023.x86_64';

const HOST = Object.freeze({
  platform: 'linux',
  realUserId: 0,
  effectiveUserId: 0,
  nodeArchitecture: 'x64',
  nodeVersion: '24.13.1',
  kernelRelease: KERNEL_RELEASE,
});

const INPUT = Object.freeze({
  sourceCommit: SOURCE_COMMIT,
  expectedArchitecture: 'x86_64',
});

const FILE_SPECS = Object.freeze([
  Object.freeze({
    name: 'os-release',
    path: '/etc/os-release',
    maxBytes: 16 * 1024,
    required: true,
    publicText: true,
  }),
  Object.freeze({
    name: 'boot-id',
    path: '/proc/sys/kernel/random/boot_id',
    maxBytes: 128,
    required: true,
    publicText: true,
  }),
  Object.freeze({
    name: 'mke2fs-config',
    path: '/etc/mke2fs.conf',
    maxBytes: 64 * 1024,
    required: false,
    publicText: true,
  }),
  ...[
    ['systemctl', '/usr/bin/systemctl'],
    ['udevadm', '/usr/bin/udevadm'],
    ['mke2fs', '/usr/sbin/mke2fs'],
    ['mkfs-ext4', '/usr/sbin/mkfs.ext4'],
    ['dumpe2fs', '/usr/sbin/dumpe2fs'],
    ['tune2fs', '/usr/sbin/tune2fs'],
    ['debugfs', '/usr/sbin/debugfs'],
    ['e2fsck', '/usr/sbin/e2fsck'],
    ['blockdev', '/usr/sbin/blockdev'],
  ].map(([name, filePath]) =>
    Object.freeze({
      name,
      path: filePath,
      maxBytes: 16 * 1024 * 1024,
      required: false,
      publicText: false,
    }),
  ),
]);

const FILES_BY_PATH = new Map(FILE_SPECS.map((spec) => [spec.path, spec]));

const DEFAULT_PUBLIC_TEXT = Object.freeze({
  'os-release':
    '# Amazon Linux\nID=amzn\nVERSION_ID="2023"\nNAME="Amazon Linux"\n',
  'boot-id': `${BOOT_ID}\n`,
  'mke2fs-config':
    '[defaults]\nbase_features = sparse_super,large_file,filetype\n',
});

/** @param {string} name */
function binaryBytes(name) {
  return `fixture executable bytes for ${name}\n`;
}

/** @param {Record<string, any>} spec @param {string} contents */
function presentInspection(spec, contents) {
  return {
    path: spec.path,
    state: 'present',
    resolvedPath: spec.path,
    chain: [
      {
        path: spec.path,
        type: 'regular',
        uid: 0,
        gid: 0,
        mode: spec.publicText ? 0o644 : 0o755,
        size: Buffer.byteLength(contents, 'utf8'),
        linkTarget: null,
      },
    ],
    sha256: sha256Base64Url(contents),
  };
}

/** @param {Record<string, any>} spec */
function absentInspection(spec) {
  return {
    path: spec.path,
    state: 'absent',
    chain: [],
  };
}

/**
 * @typedef {{
 *   host?: Record<string, any>,
 *   presentNames?: Iterable<string>,
 *   publicText?: Record<string, any>,
 *   binaryText?: Record<string, string>,
 *   inspectResult?: (context: Record<string, any>) => any,
 *   readResult?: (context: Record<string, any>) => any
 * }} FixtureOptions
 */

/** @param {FixtureOptions} [options] */
function createFixture(options = {}) {
  const presentNames = new Set(
    options.presentNames ?? FILE_SPECS.map((spec) => spec.name),
  );
  const publicText = {
    ...DEFAULT_PUBLIC_TEXT,
    ...(options.publicText ?? {}),
  };
  const binaryText = options.binaryText ?? {};
  /** @type {Array<{operation: string, input: Record<string, any>}>} */
  const calls = [];
  /** @type {any[]} */
  const receivers = [];
  let inspectionCount = 0;
  let readCount = 0;

  const ports = {
    /** @param {Record<string, any>} input */
    async inspectPath(input) {
      const callIndex = inspectionCount;
      inspectionCount += 1;
      calls.push({ operation: 'inspectPath', input });
      receivers.push(this);
      const spec = FILES_BY_PATH.get(input.path);
      if (!spec) {
        throw new Error(`Unexpected fixture inspection ${input.path}.`);
      }
      const contents = spec.publicText
        ? publicText[spec.name]
        : (binaryText[spec.name] ?? binaryBytes(spec.name));
      const defaultResult = presentNames.has(spec.name)
        ? presentInspection(spec, contents)
        : absentInspection(spec);
      return options.inspectResult
        ? options.inspectResult({
            input,
            spec,
            defaultResult,
            callIndex,
          })
        : defaultResult;
    },

    /** @param {Record<string, any>} input */
    async readText(input) {
      const callIndex = readCount;
      readCount += 1;
      calls.push({ operation: 'readText', input });
      receivers.push(this);
      const spec = FILES_BY_PATH.get(input.path);
      if (!spec?.publicText) {
        throw new Error(`Unexpected fixture text read ${input.path}.`);
      }
      const defaultResult = publicText[spec.name];
      return options.readResult
        ? options.readResult({
            input,
            spec,
            defaultResult,
            callIndex,
          })
        : defaultResult;
    },
  };

  const collector = createAwsRetainedStorageHostPreflightCollectorForTest({
    host: options.host ?? HOST,
    ports,
  });
  return { collector, ports, calls, receivers, publicText, presentNames };
}

/** @param {{operation: string, input: Record<string, any>}} call */
function callSignature(call) {
  return `${call.operation}:${call.input.path}`;
}

/** @param {ReadonlySet<string>} presentNames */
function expectedCallSignatures(presentNames) {
  const oneObservation = [];
  for (const spec of FILE_SPECS) {
    oneObservation.push(`inspectPath:${spec.path}`);
    if (spec.publicText && presentNames.has(spec.name)) {
      oneObservation.push(`readText:${spec.path}`);
    }
  }
  return [...oneObservation, ...oneObservation];
}

/** @param {any} value */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const key of Reflect.ownKeys(value)) {
    expectDeepFrozen(value[key]);
  }
}

/** @param {Record<string, any>} receipt */
function payloadWithoutEvidenceId(receipt) {
  const payload = { ...receipt };
  delete payload.evidenceId;
  return payload;
}

/** @param {Record<string, any>} receipt @param {Record<string, any>} override */
function withRecomputedEvidenceId(receipt, override) {
  const payload = { ...receipt, ...override };
  delete payload.evidenceId;
  return {
    ...payload,
    evidenceId: createCanonicalJsonSha256Id({
      domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_DOMAIN,
      prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX,
      value: payload,
      valuePath: 'host preflight evidence',
    }),
  };
}

describe('AWS retained-storage host toolchain preflight', () => {
  it('performs exactly two ordered file observations with no command, device, cloud, or mutation arguments', async () => {
    const fixture = createFixture();

    const receipt = await fixture.collector.collect(INPUT);

    expect(fixture.calls.map(callSignature)).toEqual(
      expectedCallSignatures(fixture.presentNames),
    );
    for (const call of fixture.calls) {
      const spec = FILES_BY_PATH.get(call.input.path);
      expect(spec).toBeDefined();
      if (!spec) throw new Error('Expected one fixed file spec.');
      expect(call.input).toEqual({
        path: spec.path,
        maxBytes: spec.maxBytes,
      });
      expect(Reflect.ownKeys(call.input)).toEqual(['path', 'maxBytes']);
      expectDeepFrozen(call.input);
      expect(call.input.path.startsWith('/dev/')).toBe(false);
      expect(
        /(?:169\.254\.169\.254|amazonaws\.com|https?:\/\/)/iu.test(
          call.input.path,
        ),
      ).toBe(false);
    }
    expect(
      fixture.calls.some(
        (call) =>
          Object.hasOwn(call.input, 'file') ||
          Object.hasOwn(call.input, 'args') ||
          Object.hasOwn(call.input, 'environment'),
      ),
    ).toBe(false);
    expect(receipt.safetyClass).toBe('read-only-no-device');
    expect(receipt.authority).toBe('none');
    expect(receipt.conclusion.authoritative).toBe(false);
    expect(receipt.conclusion.limitations).toContain(
      'No child process or tool command was executed; package ownership and version banners were not observed.',
    );
  });

  it('returns deterministic deeply frozen hash-addressed evidence and validates its serialized form', async () => {
    const first = await createFixture().collector.collect(INPUT);
    const second = await createFixture().collector.collect({ ...INPUT });

    expect(first).toEqual(second);
    expectDeepFrozen(first);
    expect(first).toMatchObject({
      schemaVersion: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SCHEMA_VERSION,
      kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_KIND,
      safetyClass: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SAFETY_CLASS,
      authority: 'none',
      source: {
        commit: SOURCE_COMMIT,
        binding: 'caller-provided',
      },
      host: {
        operatingSystem: { id: 'amzn', versionId: '2023' },
        kernel: { release: KERNEL_RELEASE },
        bootId: BOOT_ID,
        identity: { realUserId: 0, effectiveUserId: 0 },
        runtime: {
          name: 'node',
          version: '24.13.1',
          architecture: 'x64',
        },
        providerArchitecture: 'x86_64',
      },
      conclusion: {
        classification: 'host-toolchain-fingerprinted',
        authoritative: false,
      },
    });
    expect(first.evidenceId).toMatch(/^whe1_[A-Za-z0-9_-]{43}$/u);
    expect(first.evidenceId).toBe(
      createCanonicalJsonSha256Id({
        domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_DOMAIN,
        prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_ID_PREFIX,
        value: payloadWithoutEvidenceId(first),
        valuePath: 'host preflight evidence',
      }),
    );

    const serialized = JSON.parse(JSON.stringify(first));
    const validated =
      validateAwsRetainedStorageHostPreflightReceipt(serialized);
    expect(validated).toEqual(first);
    expectDeepFrozen(validated);
    expect(() =>
      assertManifestIsSecretFree(validated, 'host preflight receipt'),
    ).not.toThrow();

    serialized.host.kernel.release = 'tampered';
    expect(() =>
      validateAwsRetainedStorageHostPreflightReceipt(serialized),
    ).toThrow(/evidenceId does not match/u);
    expect(() =>
      validateAwsRetainedStorageHostPreflightReceipt({
        ...first,
        unexpected: true,
      }),
    ).toThrow(/unexpected is not supported/u);
  });

  it('publishes binary, OS, and mke2fs configuration contents only as hashes', async () => {
    const osCanary = 'os-release-raw-content-must-not-leak';
    const binaryCanary = 'binary-content-must-not-leak';
    const configText =
      '[defaults]\nbase_features = sparse_super,filetype\ninode_size = 256\n';
    const osRelease = `ID=amzn\nVERSION_ID=2023\nUNUSED_FIELD=${osCanary}\n`;
    const fixture = createFixture({
      publicText: {
        'os-release': osRelease,
        'mke2fs-config': configText,
      },
      binaryText: {
        systemctl: binaryCanary,
      },
    });

    const receipt = await fixture.collector.collect(INPUT);
    const encoded = JSON.stringify(receipt);

    expect(encoded).not.toContain(osCanary);
    expect(encoded).not.toContain(binaryCanary);
    expect(encoded).not.toContain('sparse_super,filetype');
    expect(receipt.host.operatingSystem).toEqual({
      id: 'amzn',
      versionId: '2023',
    });
    expect(
      receipt.files.find(
        (/** @type {Record<string, any>} */ file) => file.name === 'os-release',
      ).observation.sha256,
    ).toBe(sha256Base64Url(osRelease));
    expect(
      receipt.files.find(
        (/** @type {Record<string, any>} */ file) => file.name === 'systemctl',
      ).observation.sha256,
    ).toBe(sha256Base64Url(binaryCanary));
    expect(receipt.configuration.mke2fs).toEqual({
      state: 'present',
      content: {
        byteLength: Buffer.byteLength(configText, 'utf8'),
        sha256: sha256Base64Url(configText),
      },
    });
    expect(() =>
      assertManifestIsSecretFree(receipt, 'host preflight receipt'),
    ).not.toThrow();
  });

  it('does not publish recognizable inline secret material from configuration bytes', async () => {
    const fixture = createFixture({
      publicText: {
        'mke2fs-config': 'Bearer configuration-secret-must-not-leak',
      },
    });

    const receipt = await fixture.collector.collect(INPUT);

    expect(JSON.stringify(receipt)).not.toContain(
      'configuration-secret-must-not-leak',
    );
    expect(receipt.configuration.mke2fs.content.sha256).toBe(
      sha256Base64Url('Bearer configuration-secret-must-not-leak'),
    );
  });

  it('accepts absent optional tools and configuration without reading them', async () => {
    const requiredNames = new Set(['os-release', 'boot-id']);
    const fixture = createFixture({ presentNames: requiredNames });

    const receipt = await fixture.collector.collect(INPUT);

    expect(fixture.calls.map(callSignature)).toEqual(
      expectedCallSignatures(requiredNames),
    );
    expect(
      fixture.calls.some(
        (call) =>
          call.operation === 'readText' &&
          call.input.path === '/etc/mke2fs.conf',
      ),
    ).toBe(false);
    expect(receipt.configuration.mke2fs).toEqual({
      state: 'absent',
      content: null,
    });
    expect(
      receipt.files
        .filter(
          (/** @type {Record<string, any>} */ file) =>
            !requiredNames.has(file.name),
        )
        .every(
          (/** @type {Record<string, any>} */ file) =>
            file.observation.state === 'absent',
        ),
    ).toBe(true);
  });

  it('preserves each captured port receiver and ignores later method replacement', async () => {
    const fixture = createFixture();
    fixture.ports.inspectPath = () => {
      throw new Error('replacement inspectPath must not run');
    };
    fixture.ports.readText = () => {
      throw new Error('replacement readText must not run');
    };

    await fixture.collector.collect(INPUT);

    expect(fixture.calls.length).toBeGreaterThan(0);
    expect(
      fixture.receivers.every((receiver) => receiver === fixture.ports),
    ).toBe(true);
  });

  it('rejects malformed factory, host, and port surfaces synchronously', () => {
    const validPorts = {
      inspectPath() {},
      readText() {},
    };
    expect(() =>
      /** @type {any} */ (createAwsRetainedStorageHostPreflightCollector)({}),
    ).toThrow(/accepts no options/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest(null),
    ).toThrow(/test options must be an object/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: HOST,
        ports: validPorts,
        extra: true,
      }),
    ).toThrow(/extra is not supported/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: { ...HOST, platform: 'darwin' },
        ports: validPorts,
      }),
    ).toThrow(/requires Linux/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: { ...HOST, realUserId: 1000 },
        ports: validPorts,
      }),
    ).toThrow(/requires real and effective root/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: { ...HOST, kernelRelease: 'not a kernel release' },
        ports: validPorts,
      }),
    ).toThrow(/kernelRelease must be a canonical kernel release/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: {
          ...HOST,
          nodeArchitecture: { toString: () => 'x64' },
        },
        ports: validPorts,
      }),
    ).toThrow(/nodeArchitecture must be x64 or arm64/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: { ...HOST, extra: true },
        ports: validPorts,
      }),
    ).toThrow(/extra is not supported/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: HOST,
        ports: { ...validPorts, run: () => {} },
      }),
    ).toThrow(/run is not supported/u);
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest({
        host: HOST,
        ports: { ...validPorts, readText: null },
      }),
    ).toThrow(/ports.readText must be a function/u);

    let accessorRead = false;
    const accessorOptions = { ports: validPorts };
    Object.defineProperty(accessorOptions, 'host', {
      enumerable: true,
      get() {
        accessorRead = true;
        return HOST;
      },
    });
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest(accessorOptions),
    ).toThrow(/host must be an own data property/u);
    expect(accessorRead).toBe(false);

    const symbolOptions = /** @type {Record<PropertyKey, any>} */ ({
      host: HOST,
      ports: validPorts,
    });
    symbolOptions[Symbol('extra')] = true;
    expect(() =>
      createAwsRetainedStorageHostPreflightCollectorForTest(symbolOptions),
    ).toThrow(/is not supported/u);
  });

  it('rejects malformed exact collection input before invoking a port', async () => {
    const fixture = createFixture();
    const invalidInputs = [
      null,
      [],
      { sourceCommit: SOURCE_COMMIT },
      { ...INPUT, extra: true },
      { ...INPUT, sourceCommit: SOURCE_COMMIT.toUpperCase() },
      { ...INPUT, expectedArchitecture: 'ppc64le' },
      {
        ...INPUT,
        expectedArchitecture: { toString: () => 'x86_64' },
      },
    ];

    for (const input of invalidInputs) {
      await expect(fixture.collector.collect(input)).rejects.toThrow();
      expect(fixture.calls).toHaveLength(0);
    }

    let accessorRead = false;
    const accessorInput = { expectedArchitecture: 'x86_64' };
    Object.defineProperty(accessorInput, 'sourceCommit', {
      enumerable: true,
      get() {
        accessorRead = true;
        return SOURCE_COMMIT;
      },
    });
    await expect(fixture.collector.collect(accessorInput)).rejects.toThrow(
      /sourceCommit must be an own data property/u,
    );
    expect(accessorRead).toBe(false);
    expect(fixture.calls).toHaveLength(0);
  });

  it('snapshots valid collection input before the first asynchronous port result', async () => {
    /** @type {(() => void)|undefined} */
    let releaseFirstInspection;
    /** @type {Promise<void>} */
    const firstInspection = new Promise((resolve) => {
      releaseFirstInspection = resolve;
    });
    let waited = false;
    const fixture = createFixture({
      async inspectResult({ defaultResult }) {
        if (!waited) {
          waited = true;
          await firstInspection;
        }
        return defaultResult;
      },
    });
    /** @type {Record<string, any>} */
    const input = { ...INPUT };

    const collecting = fixture.collector.collect(input);
    input.sourceCommit = 'b'.repeat(40);
    input.expectedArchitecture = 'arm64';
    if (!releaseFirstInspection) {
      throw new Error('Expected the first inspection release.');
    }
    releaseFirstInspection();
    const receipt = await collecting;

    expect(receipt.source.commit).toBe(SOURCE_COMMIT);
    expect(receipt.host.providerArchitecture).toBe('x86_64');
  });

  it('rejects Node architecture and Amazon Linux identity mismatches', async () => {
    const architectureMismatch = createFixture({
      host: { ...HOST, nodeArchitecture: 'arm64' },
    });
    await expect(architectureMismatch.collector.collect(INPUT)).rejects.toThrow(
      /architecture does not match the requested architecture/u,
    );
    expect(architectureMismatch.calls).toHaveLength(0);

    const operatingSystemMismatch = createFixture({
      publicText: {
        'os-release': 'ID=ubuntu\nVERSION_ID="24.04"\n',
      },
    });
    await expect(
      operatingSystemMismatch.collector.collect(INPUT),
    ).rejects.toThrow(/requires Amazon Linux 2023/u);
  });

  it('fails closed for absent required files and changing double observations', async () => {
    const absentRequired = createFixture({
      presentNames: FILE_SPECS.map((spec) => spec.name).filter(
        (name) => name !== 'boot-id',
      ),
    });
    await expect(
      absentRequired.collector.collect(INPUT),
    ).rejects.toBeInstanceOf(AwsRetainedStorageHostPreflightUnknownError);
    expect(absentRequired.calls.map(callSignature)).toEqual([
      'inspectPath:/etc/os-release',
      'readText:/etc/os-release',
      'inspectPath:/proc/sys/kernel/random/boot_id',
    ]);

    const changingObservation = createFixture({
      inspectResult({ spec, defaultResult, callIndex }) {
        if (
          spec.name === 'systemctl' &&
          callIndex >= FILE_SPECS.length &&
          defaultResult.state === 'present'
        ) {
          return {
            ...defaultResult,
            sha256: sha256Base64Url('changed executable bytes'),
          };
        }
        return defaultResult;
      },
    });
    await expect(
      changingObservation.collector.collect(INPUT),
    ).rejects.toBeInstanceOf(AwsRetainedStorageHostPreflightUnknownError);
  });

  it('rejects non-exact, unsafe, or inconsistent path result objects', async () => {
    const extraPathField = createFixture({
      inspectResult({ defaultResult, callIndex }) {
        return callIndex === 0
          ? { ...defaultResult, unexpected: true }
          : defaultResult;
      },
    });
    await expect(extraPathField.collector.collect(INPUT)).rejects.toThrow(
      /unexpected is not supported/u,
    );
    expect(extraPathField.calls).toHaveLength(1);

    const wrongObservedPath = createFixture({
      inspectResult({ defaultResult, callIndex }) {
        return callIndex === 0
          ? { ...defaultResult, path: '/etc/not-os-release' }
          : defaultResult;
      },
    });
    await expect(
      wrongObservedPath.collector.collect(INPUT),
    ).rejects.toBeInstanceOf(AwsRetainedStorageHostPreflightUnknownError);
    expect(wrongObservedPath.calls).toHaveLength(1);

    const writableTool = createFixture({
      inspectResult({ spec, defaultResult }) {
        if (spec.name !== 'systemctl' || defaultResult.state !== 'present') {
          return defaultResult;
        }
        return {
          ...defaultResult,
          chain: [{ ...defaultResult.chain[0], mode: 0o775 }],
        };
      },
    });
    await expect(writableTool.collector.collect(INPUT)).rejects.toBeInstanceOf(
      AwsRetainedStorageHostPreflightUnknownError,
    );

    const nonExecutableTool = createFixture({
      inspectResult({ spec, defaultResult }) {
        if (spec.name !== 'systemctl' || defaultResult.state !== 'present') {
          return defaultResult;
        }
        return {
          ...defaultResult,
          chain: [{ ...defaultResult.chain[0], mode: 0o644 }],
        };
      },
    });
    await expect(
      nonExecutableTool.collector.collect(INPUT),
    ).rejects.toBeInstanceOf(AwsRetainedStorageHostPreflightUnknownError);

    const coercibleFileType = createFixture({
      inspectResult({ defaultResult, callIndex }) {
        if (callIndex !== 0 || defaultResult.state !== 'present') {
          return defaultResult;
        }
        return {
          ...defaultResult,
          chain: [
            {
              ...defaultResult.chain[0],
              type: { toString: () => 'regular' },
            },
          ],
        };
      },
    });
    await expect(
      coercibleFileType.collector.collect(INPUT),
    ).rejects.toBeInstanceOf(AwsRetainedStorageHostPreflightUnknownError);
  });

  it('fails closed for a text/hash disagreement', async () => {
    const fixture = createFixture({
      readResult({ spec, defaultResult }) {
        return spec.name === 'boot-id'
          ? `${BOOT_ID.replace(/.$/u, '6')}\n`
          : defaultResult;
      },
    });

    await expect(fixture.collector.collect(INPUT)).rejects.toBeInstanceOf(
      AwsRetainedStorageHostPreflightUnknownError,
    );
  });

  it.each([
    ['byte overflow', 'é'.repeat(8 * 1024 + 1)],
    ['NUL', 'ID=amzn\0VERSION_ID=2023'],
    ['lone surrogate', 'ID=amzn\uD800VERSION_ID=2023'],
    ['Buffer', Buffer.from([0xff])],
    ['Uint8Array', new Uint8Array([0xc3, 0x28])],
  ])(
    'rejects bad readText output representing %s',
    async (_label, invalidValue) => {
      const fixture = createFixture({
        readResult({ spec, defaultResult }) {
          return spec.name === 'os-release' ? invalidValue : defaultResult;
        },
      });

      await expect(fixture.collector.collect(INPUT)).rejects.toBeInstanceOf(
        AwsRetainedStorageHostPreflightUnknownError,
      );
    },
  );

  it('rejects serialized receipt mutation even when the original remains valid', async () => {
    const receipt = await createFixture().collector.collect(INPUT);
    const tampered = withRecomputedEvidenceId(receipt, {
      authority: 'formatter',
    });

    expect(() =>
      validateAwsRetainedStorageHostPreflightReceipt(tampered),
    ).toThrow(/receipt contract is invalid/u);
    expect(() =>
      validateAwsRetainedStorageHostPreflightReceipt(
        withRecomputedEvidenceId(receipt, {
          conclusion: {
            ...receipt.conclusion,
            authoritative: true,
          },
        }),
      ),
    ).toThrow(/conclusion is invalid/u);
    expect(() =>
      validateAwsRetainedStorageHostPreflightReceipt(receipt),
    ).not.toThrow();
    expect(() =>
      validateAwsRetainedStorageHostPreflightReceipt({
        ...receipt,
        padding: 'x'.repeat(
          AWS_RETAINED_STORAGE_HOST_PREFLIGHT_RECEIPT_MAX_BYTES,
        ),
      }),
    ).toThrow(/must not exceed/u);
  });
});
