/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This closed delivery boundary keeps its compact immutable schemas beside their decoders. */

import process from 'node:process';

import {
  getAsset as nodeGetAsset,
  isSea as nodeIsSea,
} from '../src/core/lib/node-sea.js';
import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
} from '../src/core/runtime/content-id.js';
import {
  cloneBoundedJsonObject,
  cloneBoundedJsonValue,
} from '../src/core/runtime/json-value.js';
import { assertManifestIsSecretFree } from '../src/core/runtime/manifest-security.js';
import { main as runHostPreflightCollector } from './collect-aws-host-retained-storage-preflight-linux.js';

export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_SCHEMA_VERSION = 1;
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_KIND =
  'awsSingleNodeRetainedStorageHostPreflightSeaDelivery';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_DOMAIN =
  'wharfie:aws-single-node:retained-storage-host-preflight-sea-delivery:v1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_PREFIX =
  'whd1';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME =
  '<WHARFIE_HOST_PREFLIGHT>/delivery.json';
export const AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES =
  32 * 1024;

const NODE_VERSION = '24.13.1';
const SOURCE_MODE = 'git-archive-exact-commit';
const ENTRYPOINT =
  'scripts/collect-aws-host-retained-storage-preflight-linux.js';
const INVOCATION = 'zero-argument';
const SOURCE_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const ARCHITECTURES = new Set(['x86_64', 'arm64']);
const INPUT_KEYS = new Set(['sourceCommit', 'expectedArchitecture']);
const PAYLOAD_KEYS = new Set([
  'schemaVersion',
  'kind',
  'source',
  'collector',
  'target',
  'authority',
  'authoritative',
]);
const DOCUMENT_KEYS = new Set(['deliveryId', ...PAYLOAD_KEYS]);
const SOURCE_KEYS = new Set(['mode', 'commit', 'entrypoint']);
const COLLECTOR_KEYS = new Set(['expectedArchitecture', 'invocation']);
const TARGET_KEYS = new Set([
  'nodeVersion',
  'platform',
  'architecture',
  'libc',
]);
const READER_OPTION_KEYS = new Set(['assetProvider']);
const ASSET_PROVIDER_KEYS = new Set(['getAsset']);
const RUNTIME_TEST_OPTION_KEYS = new Set(['expected', 'host', 'ports']);
const RUNTIME_PORT_KEYS = new Set(['readEmbeddedManifest', 'runCollector']);
const HOST_KEYS = new Set([
  'nodeVersion',
  'platform',
  'architecture',
  'glibcVersionRuntime',
]);
const BASE_ARGV_MAX_BYTES = 4 * 1024;

/** One fixed, value-free delivery failure. */
export class AwsRetainedStorageHostPreflightSeaDeliveryError extends Error {
  constructor() {
    super('AWS retained-storage host preflight SEA delivery is invalid.');
    this.name = 'AwsRetainedStorageHostPreflightSeaDeliveryError';
    this.code = 'AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_INVALID';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(`${path} must contain only its exact required keys.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {Record<string, any>} value @param {string} key @param {string} path @returns {any} */
function ownData(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
    throw new TypeError(`${path}.${key} must be an own data property.`);
  }
  return descriptor.value;
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return (
    JSON.stringify(sortCanonicalJsonValue(left)) ===
    JSON.stringify(sortCanonicalJsonValue(right))
  );
}

/** @param {unknown} value @param {string} path @returns {'x86_64'|'arm64'} */
function validateProviderArchitecture(value, path) {
  if (typeof value !== 'string' || !ARCHITECTURES.has(value)) {
    throw new TypeError(`${path} must be 'x86_64' or 'arm64'.`);
  }
  return /** @type {'x86_64'|'arm64'} */ (value);
}

/**
 * Derive the one exact official Node target for a provider architecture.
 * `libc` is a build-target declaration; runtime code separately proves a
 * nonempty glibc runtime observation.
 * @param {unknown} expectedArchitecture - Provider architecture spelling.
 * @returns {Readonly<Record<string, any>>}
 */
export function getAwsRetainedStorageHostPreflightSeaTarget(
  expectedArchitecture,
) {
  const architecture = validateProviderArchitecture(
    expectedArchitecture,
    'AWS retained-storage host preflight provider architecture',
  );
  return deepFreeze({
    nodeVersion: NODE_VERSION,
    platform: 'linux',
    architecture: architecture === 'x86_64' ? 'x64' : 'arm64',
    libc: 'glibc',
  });
}

/** @param {Record<string, any>} value @param {string} path @returns {Readonly<Record<string, any>>} */
function validatePayload(value, path) {
  assertExactKeys(value, PAYLOAD_KEYS, path);
  if (
    value.schemaVersion !==
      AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_SCHEMA_VERSION ||
    value.kind !== AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_KIND ||
    value.authority !== 'none' ||
    value.authoritative !== false
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery header is invalid.',
    );
  }

  if (!isPlainObject(value.source)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery source must be an object.',
    );
  }
  assertExactKeys(value.source, SOURCE_KEYS, `${path}.source`);
  if (
    value.source.mode !== SOURCE_MODE ||
    typeof value.source.commit !== 'string' ||
    !SOURCE_COMMIT_PATTERN.test(value.source.commit) ||
    value.source.entrypoint !== ENTRYPOINT
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery source is invalid.',
    );
  }

  if (!isPlainObject(value.collector)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery collector must be an object.',
    );
  }
  assertExactKeys(value.collector, COLLECTOR_KEYS, `${path}.collector`);
  const expectedArchitecture = validateProviderArchitecture(
    value.collector.expectedArchitecture,
    `${path}.collector.expectedArchitecture`,
  );
  if (value.collector.invocation !== INVOCATION) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery invocation is invalid.',
    );
  }
  if (!isPlainObject(value.target)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery target must be an object.',
    );
  }
  assertExactKeys(value.target, TARGET_KEYS, `${path}.target`);
  const target =
    getAwsRetainedStorageHostPreflightSeaTarget(expectedArchitecture);
  if (!sameJson(value.target, target)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA delivery target is invalid.',
    );
  }

  const payload = deepFreeze(
    sortCanonicalJsonValue({
      schemaVersion:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_SCHEMA_VERSION,
      kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_KIND,
      source: {
        mode: SOURCE_MODE,
        commit: value.source.commit,
        entrypoint: ENTRYPOINT,
      },
      collector: {
        expectedArchitecture,
        invocation: INVOCATION,
      },
      target,
      authority: 'none',
      authoritative: false,
    }),
  );
  assertManifestIsSecretFree(
    payload,
    'AWS retained-storage host preflight SEA delivery',
  );
  return payload;
}

/**
 * Create the exact non-authorizing declaration embedded in one host-preflight
 * SEA. Final executable bytes are intentionally bound later by a post-build
 * record so the embedded document has no digest circularity.
 * @param {unknown} value - Exact commit and provider architecture.
 * @returns {Readonly<Record<string, any>>}
 */
export function createAwsRetainedStorageHostPreflightSeaDeliveryManifest(
  value,
) {
  const input = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
    'AWS retained-storage host preflight SEA delivery input',
  );
  assertExactKeys(
    input,
    INPUT_KEYS,
    'AWS retained-storage host preflight SEA delivery input',
  );
  const payload = validatePayload(
    {
      schemaVersion:
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_SCHEMA_VERSION,
      kind: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_KIND,
      source: {
        mode: SOURCE_MODE,
        commit: input.sourceCommit,
        entrypoint: ENTRYPOINT,
      },
      collector: {
        expectedArchitecture: input.expectedArchitecture,
        invocation: INVOCATION,
      },
      target: getAwsRetainedStorageHostPreflightSeaTarget(
        input.expectedArchitecture,
      ),
      authority: 'none',
      authoritative: false,
    },
    'AWS retained-storage host preflight SEA delivery',
  );
  const deliveryId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_PREFIX,
    value: payload,
    valuePath: 'AWS retained-storage host preflight SEA delivery',
  });
  return deepFreeze(
    sortCanonicalJsonValue({
      ...payload,
      deliveryId,
    }),
  );
}

/**
 * Validate one bounded deserialized delivery declaration and recompute its
 * semantic identity. The ID binds content; it does not authenticate an issuer.
 * @param {unknown} value - Candidate embedded delivery declaration.
 * @returns {Readonly<Record<string, any>>}
 */
export function validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(
  value,
) {
  const document = cloneBoundedJsonObject(
    value,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES,
    'AWS retained-storage host preflight SEA delivery',
  );
  assertExactKeys(
    document,
    DOCUMENT_KEYS,
    'AWS retained-storage host preflight SEA delivery',
  );
  assertDomainSeparatedSha256Id(
    document.deliveryId,
    AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_PREFIX,
    'AWS retained-storage host preflight SEA delivery.deliveryId',
  );
  /** @type {Record<string, any>} */
  const payloadInput = {};
  for (const key of PAYLOAD_KEYS) payloadInput[key] = document[key];
  const payload = validatePayload(
    payloadInput,
    'AWS retained-storage host preflight SEA delivery',
  );
  const deliveryId = createCanonicalJsonSha256Id({
    domain: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_DOMAIN,
    prefix: AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ID_PREFIX,
    value: payload,
    valuePath: 'AWS retained-storage host preflight SEA delivery',
  });
  if (document.deliveryId !== deliveryId) {
    throw new Error(
      'AWS retained-storage host preflight SEA delivery ID does not match its exact content.',
    );
  }
  return deepFreeze(
    sortCanonicalJsonValue({
      ...payload,
      deliveryId,
    }),
  );
}

/**
 * Serialize the canonical embedded asset with one terminal newline.
 * @param {unknown} value - Candidate delivery declaration.
 * @returns {string}
 */
export function stringifyAwsRetainedStorageHostPreflightSeaDeliveryManifest(
  value,
) {
  const manifest =
    validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(value);
  return `${JSON.stringify(sortCanonicalJsonValue(manifest))}\n`;
}

/** @param {unknown} value @param {Set<string>} keys @param {string} path @returns {Readonly<Record<string, Function>>} */
function captureMethods(value, keys, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  assertExactKeys(value, keys, path);
  /** @type {Record<string, Function>} */
  const methods = {};
  for (const key of keys) {
    const method = ownData(value, key, path);
    if (typeof method !== 'function') {
      throw new TypeError(`${path}.${key} must be a function.`);
    }
    methods[key] = method.bind(value);
  }
  return Object.freeze(methods);
}

/** @param {unknown} value @returns {Buffer} */
function snapshotAssetBytes(value) {
  let byteLength;
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    byteLength = value.byteLength;
  } else if (value instanceof ArrayBuffer) {
    byteLength = value.byteLength;
  } else {
    throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
  }
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < 1 ||
    byteLength > AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_MAX_BYTES
  ) {
    throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value.slice(0));
  return Buffer.from(/** @type {Uint8Array} */ (value));
}

/**
 * Read the one fixed delivery asset. Explicit asset injection exists only for
 * controlled tests; ordinary calls require a real SEA runtime.
 * @param {unknown} [optionsValue] - Optional controlled asset provider.
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
export async function readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest(
  optionsValue,
) {
  try {
    let getAsset;
    if (optionsValue === undefined) {
      if (!nodeIsSea()) {
        throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
      }
      getAsset = nodeGetAsset;
    } else {
      if (!isPlainObject(optionsValue)) {
        throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
      }
      assertExactKeys(
        optionsValue,
        READER_OPTION_KEYS,
        'AWS retained-storage host preflight SEA delivery reader options',
      );
      const provider = captureMethods(
        ownData(
          optionsValue,
          'assetProvider',
          'AWS retained-storage host preflight SEA delivery reader options',
        ),
        ASSET_PROVIDER_KEYS,
        'AWS retained-storage host preflight SEA delivery asset provider',
      );
      getAsset = provider.getAsset;
    }
    const bytes = snapshotAssetBytes(
      await getAsset(
        AWS_RETAINED_STORAGE_HOST_PREFLIGHT_SEA_DELIVERY_ASSET_NAME,
      ),
    );
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
    }
    return validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(parsed);
  } catch {
    throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
  }
}

/** @param {unknown} value @returns {Readonly<Record<string, any>>} */
function validateHost(value) {
  const host = cloneBoundedJsonObject(
    value,
    4 * 1024,
    'AWS retained-storage host preflight SEA runtime host',
  );
  assertExactKeys(
    host,
    HOST_KEYS,
    'AWS retained-storage host preflight SEA runtime host',
  );
  if (
    typeof host.nodeVersion !== 'string' ||
    typeof host.platform !== 'string' ||
    typeof host.architecture !== 'string' ||
    (host.glibcVersionRuntime !== null &&
      (typeof host.glibcVersionRuntime !== 'string' ||
        host.glibcVersionRuntime.trim().length === 0))
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA runtime host is invalid.',
    );
  }
  return deepFreeze(host);
}

/** @returns {Readonly<Record<string, any>>} */
function currentHost() {
  let glibcVersionRuntime = null;
  try {
    const report = /** @type {any} */ (process.report?.getReport?.());
    if (
      typeof report?.header?.glibcVersionRuntime === 'string' &&
      report.header.glibcVersionRuntime.trim().length > 0
    ) {
      glibcVersionRuntime = report.header.glibcVersionRuntime;
    }
  } catch {
    glibcVersionRuntime = null;
  }
  return validateHost({
    nodeVersion: process.versions.node,
    platform: process.platform,
    architecture: process.arch,
    glibcVersionRuntime,
  });
}

/** @param {unknown} value @returns {Readonly<string[]>} */
function validateBaseArgv(value) {
  const argv = cloneBoundedJsonValue(
    value,
    BASE_ARGV_MAX_BYTES,
    'AWS retained-storage host preflight SEA argv',
  );
  if (
    !Array.isArray(argv) ||
    argv.length !== 2 ||
    argv.some((argument) => typeof argument !== 'string')
  ) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA accepts no user arguments.',
    );
  }
  return Object.freeze(argv);
}

/** @param {unknown} expected @param {Readonly<Record<string, any>>} host @param {Readonly<Record<string, Function>>} ports @returns {Readonly<{run: (argv: unknown) => Promise<void>}>} */
function createRuntime(expected, host, ports) {
  const expectedManifest =
    createAwsRetainedStorageHostPreflightSeaDeliveryManifest(expected);
  return Object.freeze({
    async run(value) {
      const argv = validateBaseArgv(value);
      let embedded;
      try {
        embedded = validateAwsRetainedStorageHostPreflightSeaDeliveryManifest(
          await ports.readEmbeddedManifest(),
        );
      } catch {
        throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
      }
      if (!sameJson(embedded, expectedManifest)) {
        throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
      }
      const target = expectedManifest.target;
      if (
        host.nodeVersion !== target.nodeVersion ||
        host.platform !== target.platform ||
        host.architecture !== target.architecture ||
        (target.libc === 'glibc' &&
          (typeof host.glibcVersionRuntime !== 'string' ||
            host.glibcVersionRuntime.trim().length === 0))
      ) {
        throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
      }
      const collectorArgv = Object.freeze([
        argv[0],
        argv[1],
        expectedManifest.source.commit,
        expectedManifest.collector.expectedArchitecture,
      ]);
      try {
        await ports.runCollector(collectorArgv);
      } catch {
        throw new AwsRetainedStorageHostPreflightSeaDeliveryError();
      }
    },
  });
}

/**
 * Create the production zero-argument SEA runtime from constants baked by the
 * packager into its generated entrypoint.
 * @param {unknown} expected - Constants baked into the generated entrypoint.
 * @returns {Readonly<{run: (argv: unknown) => Promise<void>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaRuntime(expected) {
  if (arguments.length !== 1) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA runtime requires one baked expectation.',
    );
  }
  return createRuntime(
    expected,
    currentHost(),
    Object.freeze({
      readEmbeddedManifest:
        readEmbeddedAwsRetainedStorageHostPreflightSeaDeliveryManifest,
      runCollector: runHostPreflightCollector,
    }),
  );
}

/**
 * Test-only closed runtime factory with captured host and ports.
 * @param {unknown} optionsValue - Exact expected values, host, and ports.
 * @returns {Readonly<{run: (argv: unknown) => Promise<void>}>}
 */
export function createAwsRetainedStorageHostPreflightSeaRuntimeForTest(
  optionsValue,
) {
  if (!isPlainObject(optionsValue)) {
    throw new TypeError(
      'AWS retained-storage host preflight SEA runtime test options must be an object.',
    );
  }
  assertExactKeys(
    optionsValue,
    RUNTIME_TEST_OPTION_KEYS,
    'AWS retained-storage host preflight SEA runtime test options',
  );
  return createRuntime(
    ownData(
      optionsValue,
      'expected',
      'AWS retained-storage host preflight SEA runtime test options',
    ),
    validateHost(
      ownData(
        optionsValue,
        'host',
        'AWS retained-storage host preflight SEA runtime test options',
      ),
    ),
    captureMethods(
      ownData(
        optionsValue,
        'ports',
        'AWS retained-storage host preflight SEA runtime test options',
      ),
      RUNTIME_PORT_KEYS,
      'AWS retained-storage host preflight SEA runtime test ports',
    ),
  );
}

export default createAwsRetainedStorageHostPreflightSeaRuntime;
