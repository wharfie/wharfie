/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createApplicationRevision } from '../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../src/core/runtime/content-id.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../../src/core/runtime/deployment-profile.js';
import { createAwsProviderScope } from '../../../src/core/runtime/deployment-provider-scope.js';
import { createDeploymentRevisionFromArtifactObservation } from '../../../src/core/runtime/deployment-revision.js';

const LOCAL_APP_IMPORT = '../../../src/cli/app/local-app.js';
const SELECTED_SEA_IMPORT = '../../../src/cli/app/selected-sea-artifact.js';
const APP_ID = 'selected-sea-demo';
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});
const OTHER_TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'darwin',
  architecture: 'arm64',
});

/** @type {string[]} */
const roots = [];
/** @type {jest.Mock<(...args: any[]) => any>} */
const packageLocalApp = jest.fn();

jest.unstable_mockModule(LOCAL_APP_IMPORT, () => ({ packageLocalApp }));

const {
  claimSelectedSeaArtifactSource,
  createSelectedSeaDeploymentRevision,
  discardSelectedSeaArtifact,
  inspectSelectedSeaArtifact,
  packageSelectedSeaArtifact,
} = await import(SELECTED_SEA_IMPORT);

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function deferred() {
  /** @type {() => void} */
  let settle = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise((resolve) => {
    settle = () => resolve(undefined);
  });
  return { promise, resolve: settle };
}

/** @param {string|Buffer} value */
function digest(value) {
  return { algorithm: 'sha256', value: sha256Base64Url(value) };
}

/** @param {string} [salt] */
function makeRevision(salt = 'primary') {
  return createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: APP_ID },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        serve: {
          entrypoint: {
            kind: 'node',
            path: 'src/serve.js',
            export: 'serve',
          },
        },
      },
    },
    inputs: {
      source: {
        format: 'wharfie-source-tree-v1',
        digest: digest(`source-${salt}`),
      },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: {
        format: 'wharfie-runtime-v1',
        digest: digest('runtime'),
      },
    },
  });
}

/**
 * @param {ReturnType<typeof makeRevision>} revision
 * @param {Readonly<Record<string, any>>} [target]
 */
function makeProvenance(revision, target = TARGET) {
  return {
    schemaVersion: 1,
    builder: {
      name: '@wharfie/wharfie',
      version: '0.0.15',
      runtimeDigest: clone(revision.inputs.runtime.digest),
      toolchainDigest: digest('toolchain'),
    },
    node: {
      version: target.nodeVersion,
      archive: {
        fileName: `node-v${target.nodeVersion}-${target.platform}-${target.architecture}.tar.gz`,
        digest: digest('node-archive'),
      },
      binary: { digest: digest('node-binary') },
    },
    dependencies: {
      lock: clone(revision.inputs.dependencies),
      digest: digest('target-dependency-closure'),
    },
    signing: { mode: 'unsigned' },
  };
}

/**
 * @param {string} [region]
 * @param {Readonly<Record<string, any>>} [target]
 */
function makeProfile(region = 'us-east-1', target = TARGET) {
  return createDeploymentProfile({
    profile: { id: 'production' },
    appId: APP_ID,
    target,
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider(region),
  });
}

/** @param {string} [region] */
function makeProviderScope(region = 'us-east-1') {
  return createAwsProviderScope({
    partition: 'aws',
    accountId: '123456789012',
    region,
  });
}

/** @param {Buffer} [bytes] */
async function makeFixture(
  bytes = Buffer.from('exact selected SEA artifact bytes'),
) {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-selected-sea-'));
  roots.push(root);
  const fileName = 'selected-sea';
  const artifactPath = path.join(root, fileName);
  await fsp.writeFile(artifactPath, bytes);

  const revision = makeRevision();
  const record = createArtifactRecord({
    bytes,
    revision,
    target: TARGET,
    provenance: makeProvenance(revision),
  });
  const observation = Object.freeze({
    artifactId: record.artifactId,
    byteDigest: record.byteDigest,
    size: record.size,
  });
  const runtime = Object.freeze({
    schemaVersion: 1,
    kind: 'artifactRuntime',
    appId: record.appId,
    revisionId: record.revisionId,
    target: record.target,
  });
  const profile = makeProfile();
  const providerScope = makeProviderScope();
  const result = {
    app: { id: APP_ID },
    revision,
    targets: [{ ...TARGET }],
    outputDir: root,
    artifacts: [
      {
        fileName,
        path: artifactPath,
        recordPath: `${artifactPath}.artifact.json`,
        target: { ...TARGET },
        artifactId: record.artifactId,
        revisionId: record.revisionId,
        byteDigest: clone(record.byteDigest),
        size: record.size,
        record,
      },
    ],
  };
  return {
    artifactPath,
    bytes,
    observation,
    profile,
    providerScope,
    record,
    result,
    revision,
    root,
    runtime,
  };
}

/** @param {Awaited<ReturnType<typeof makeFixture>>} fixture */
function makeMintRequest(fixture) {
  return {
    dir: path.join(fixture.root, 'source-app'),
    outputDir: fixture.root,
    target: { ...TARGET },
  };
}

/** @param {Awaited<ReturnType<typeof makeFixture>>} fixture */
async function mintFixture(fixture) {
  packageLocalApp.mockResolvedValueOnce(fixture.result);
  return await packageSelectedSeaArtifact(makeMintRequest(fixture));
}

/**
 * @param {Awaited<ReturnType<typeof makeFixture>>} fixture
 * @param {Readonly<Record<string, any>>} authority
 */
function bindFixture(fixture, authority) {
  const input = {
    deployment: { id: 'production' },
    profile: fixture.profile,
  };
  return {
    deploymentRevision: createSelectedSeaDeploymentRevision(authority, input),
    input,
  };
}

/**
 * @param {Awaited<ReturnType<typeof makeFixture>>} fixture
 * @param {Readonly<Record<string, any>>} deploymentRevision
 */
function makeClaim(fixture, deploymentRevision) {
  return {
    deploymentRevision,
    profile: fixture.profile,
    providerScope: fixture.providerScope,
  };
}

beforeEach(() => {
  packageLocalApp.mockReset();
});

afterEach(async () => {
  jest.restoreAllMocks();
  await Promise.all(
    roots
      .splice(0)
      .map((root) => fsp.rm(root, { recursive: true, force: true })),
  );
});

describe('selected SEA artifact authority', () => {
  it('mints, inspects, binds, claims, streams, verifies, and closes one exact artifact', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);

    expect(Object.isFrozen(authority)).toBe(true);
    expect(Reflect.ownKeys(authority)).toEqual([]);
    expect(Object.getPrototypeOf(authority)).toBeNull();
    expect(packageLocalApp).toHaveBeenCalledTimes(1);
    const packageRequest = packageLocalApp.mock.calls[0][0];
    expect(packageRequest).toEqual({
      dir: path.join(fixture.root, 'source-app'),
      outputDir: fixture.root,
      targetFilters: ['node24.13.1-linux-x64-glibc'],
    });
    expect(Object.isFrozen(packageRequest)).toBe(true);
    expect(Object.isFrozen(packageRequest.targetFilters)).toBe(true);

    const inspection = inspectSelectedSeaArtifact(authority);
    expect(inspection).toEqual({
      appId: APP_ID,
      revisionId: fixture.revision.revisionId,
      artifactId: fixture.record.artifactId,
      byteDigest: fixture.record.byteDigest,
      size: fixture.bytes.byteLength,
      target: TARGET,
    });
    expect(Object.isFrozen(inspection)).toBe(true);

    const { deploymentRevision } = bindFixture(fixture, authority);
    expect(deploymentRevision).toMatchObject({
      deployment: { id: 'production' },
      appId: APP_ID,
      revisionId: fixture.revision.revisionId,
      artifactId: fixture.record.artifactId,
      profileRevisionId: fixture.profile.profileRevisionId,
    });

    const claimed = claimSelectedSeaArtifactSource(
      authority,
      makeClaim(fixture, deploymentRevision),
    );
    expect(Object.isFrozen(claimed)).toBe(true);
    expect(claimed.deploymentRevision).toBe(deploymentRevision);
    expect(claimed.profile).toEqual(fixture.profile);
    expect(claimed.providerScope).toEqual(fixture.providerScope);
    expect(Object.isFrozen(claimed.profile)).toBe(true);
    expect(Object.isFrozen(claimed.providerScope)).toBe(true);
    expect(claimed.revision).toEqual(fixture.revision);
    expect(claimed.runtime).toEqual(fixture.runtime);
    expect(claimed.record).toEqual(fixture.record);
    expect(claimed.source.observation).toEqual(fixture.observation);

    const chunks = [];
    for await (const chunk of claimed.source.createReadStream()) {
      chunks.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(fixture.bytes);
    await expect(claimed.source.verifyUnchanged()).resolves.toEqual(
      fixture.observation,
    );
    const firstClose = claimed.source.close();
    expect(claimed.source.close()).toBe(firstClose);
    await firstClose;
  });

  it('snapshots nested build configuration before asynchronous packaging', async () => {
    const fixture = await makeFixture();
    const packageGate = deferred();
    const build = {
      assets: { prompt: 'original prompt' },
      signing: {
        macos: {
          certificateBase64: 'original certificate',
          certificatePassword: 'original certificate password',
          keychainPassword: 'original keychain password',
        },
      },
    };
    /** @type {Record<string, any>|undefined} */
    let observedRequest;
    packageLocalApp.mockImplementationOnce(async (request) => {
      observedRequest = request;
      await packageGate.promise;
      return fixture.result;
    });

    const minting = packageSelectedSeaArtifact({
      ...makeMintRequest(fixture),
      build,
    });
    build.assets.prompt = 'mutated prompt';
    build.signing.macos.certificateBase64 = 'mutated certificate';
    build.signing.macos.certificatePassword = 'mutated certificate password';
    build.signing.macos.keychainPassword = 'mutated keychain password';

    expect(observedRequest?.build).toEqual({
      assets: { prompt: 'original prompt' },
      signing: {
        macos: {
          certificateBase64: 'original certificate',
          certificatePassword: 'original certificate password',
          keychainPassword: 'original keychain password',
        },
      },
    });
    expect(Object.isFrozen(observedRequest?.build)).toBe(true);
    expect(Object.isFrozen(observedRequest?.build.assets)).toBe(true);
    expect(Object.isFrozen(observedRequest?.build.signing)).toBe(true);
    expect(Object.isFrozen(observedRequest?.build.signing.macos)).toBe(true);

    packageGate.resolve();
    const authority = await minting;
    await discardSelectedSeaArtifact(authority);
  });

  it('retains a deep package-result snapshot while descriptor opening is pending', async () => {
    const fixture = await makeFixture();
    const result = /** @type {Record<string, any>} */ (clone(fixture.result));
    packageLocalApp.mockResolvedValueOnce(result);
    const descriptorOpened = deferred();
    const returnDescriptor = deferred();
    const originalOpen = fsp.open.bind(fsp);
    jest.spyOn(fsp, 'open').mockImplementation(async (...args) => {
      const handle = await originalOpen(...args);
      descriptorOpened.resolve();
      await returnDescriptor.promise;
      return handle;
    });

    const minting = packageSelectedSeaArtifact(makeMintRequest(fixture));
    await descriptorOpened.promise;
    result.artifacts[0].target.architecture = 'arm64';
    result.artifacts[0].byteDigest = digest('mutated summary digest');
    result.artifacts[0].record.appId = 'mutated-app';
    returnDescriptor.resolve();

    const authority = await minting;
    expect(inspectSelectedSeaArtifact(authority)).toMatchObject({
      appId: APP_ID,
      artifactId: fixture.record.artifactId,
      byteDigest: fixture.record.byteDigest,
      target: TARGET,
    });
    await discardSelectedSeaArtifact(authority);
  });

  it('rejects forged, copied, serialized, and proxied authorities without consulting proxy traps', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);
    const trap = jest.fn(() => {
      throw new Error('authority proxy trap must not run');
    });
    const proxy = new Proxy(authority, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      has: trap,
      ownKeys: trap,
    });
    const candidates = [
      {},
      { ...authority },
      JSON.parse(JSON.stringify(authority)),
      proxy,
    ];

    for (const candidate of candidates) {
      expect(() => inspectSelectedSeaArtifact(candidate)).toThrow(
        /authority is invalid/i,
      );
    }
    expect(trap).not.toHaveBeenCalled();
    expect(inspectSelectedSeaArtifact(authority).artifactId).toBe(
      fixture.record.artifactId,
    );

    await discardSelectedSeaArtifact(authority);
  });

  it.each([
    ['null', () => null],
    ['missing target', () => ({ dir: '/app' })],
    ['missing dir', () => ({ target: TARGET })],
    [
      'unknown field',
      () => ({ dir: '/app', target: TARGET, unexpected: true }),
    ],
    ['blank dir', () => ({ dir: ' ', target: TARGET })],
    [
      'blank output directory',
      () => ({ dir: '/app', outputDir: '', target: TARGET }),
    ],
    [
      'invalid target',
      () => ({ dir: '/app', target: { ...TARGET, extra: true } }),
    ],
    [
      'invalid build configuration',
      () => ({ dir: '/app', target: TARGET, build: null }),
    ],
    [
      'accessor field',
      () => {
        const request = { target: TARGET };
        Object.defineProperty(request, 'dir', {
          configurable: true,
          enumerable: true,
          get: () => '/app',
        });
        return request;
      },
    ],
  ])(
    'rejects an invalid %s request before packaging',
    async (_name, makeRequest) => {
      await expect(packageSelectedSeaArtifact(makeRequest())).rejects.toThrow(
        /package request is invalid/i,
      );
      expect(packageLocalApp).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'zero selected targets',
      (/** @type {Record<string, any>} */ result) => {
        result.targets = [];
      },
    ],
    [
      'multiple selected targets',
      (/** @type {Record<string, any>} */ result) => {
        result.targets = [{ ...TARGET }, { ...TARGET }];
      },
    ],
    [
      'zero artifacts',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts = [];
      },
    ],
    [
      'multiple artifacts',
      (/** @type {Record<string, any>} */ result) => {
        result.artifacts = [result.artifacts[0], clone(result.artifacts[0])];
      },
    ],
  ])('rejects package-result cardinality with %s', async (_name, mutate) => {
    const fixture = await makeFixture();
    const result = /** @type {Record<string, any>} */ (clone(fixture.result));
    mutate(result);
    packageLocalApp.mockResolvedValueOnce(result);

    await expect(
      packageSelectedSeaArtifact(makeMintRequest(fixture)),
    ).rejects.toThrow(/package result is invalid/i);
  });

  it('rejects a package result published outside the requested output directory', async () => {
    const fixture = await makeFixture();
    packageLocalApp.mockResolvedValueOnce(fixture.result);

    await expect(
      packageSelectedSeaArtifact({
        ...makeMintRequest(fixture),
        outputDir: path.join(fixture.root, 'requested-output'),
      }),
    ).rejects.toThrow(/package result is invalid/i);
  });

  it.each(
    /** @type {Array<[string, (fixture: Awaited<ReturnType<typeof makeFixture>>, result: Record<string, any>) => void]>} */ ([
      [
        'summary artifact identity',
        (_fixture, result) => {
          result.artifacts[0].artifactId = `waf1_${
            digest('other summary artifact').value
          }`;
        },
      ],
      [
        'record observation',
        (fixture, result) => {
          const otherBytes = Buffer.from('different record bytes');
          result.artifacts[0].record = createArtifactRecord({
            bytes: otherBytes,
            revision: fixture.revision,
            target: TARGET,
            provenance: makeProvenance(fixture.revision),
          });
        },
      ],
      [
        'application identity',
        (_fixture, result) => {
          result.app.id = 'other-app';
        },
      ],
      [
        'application revision',
        (_fixture, result) => {
          result.revision = makeRevision('other-revision');
        },
      ],
      [
        'selected target',
        (_fixture, result) => {
          result.targets[0] = { ...OTHER_TARGET };
        },
      ],
      [
        'summary target',
        (_fixture, result) => {
          result.artifacts[0].target = { ...OTHER_TARGET };
        },
      ],
      [
        'summary revision',
        (_fixture, result) => {
          result.artifacts[0].revisionId = makeRevision(
            'other-summary-revision',
          ).revisionId;
        },
      ],
      [
        'summary digest',
        (_fixture, result) => {
          result.artifacts[0].byteDigest = digest('other summary digest');
        },
      ],
      [
        'summary size',
        (_fixture, result) => {
          result.artifacts[0].size += 1;
        },
      ],
      [
        'artifact path',
        (_fixture, result) => {
          const otherPath = path.join(result.outputDir, 'other-artifact');
          result.artifacts[0].path = otherPath;
          result.artifacts[0].recordPath = `${otherPath}.artifact.json`;
        },
      ],
      [
        'record path',
        (_fixture, result) => {
          result.artifacts[0].recordPath = path.join(
            result.outputDir,
            'other-record.json',
          );
        },
      ],
    ]),
  )('rejects an independent %s mismatch', async (_name, mutate) => {
    const fixture = await makeFixture();
    const result = /** @type {Record<string, any>} */ (clone(fixture.result));
    mutate(fixture, result);
    packageLocalApp.mockResolvedValueOnce(result);

    await expect(
      packageSelectedSeaArtifact(makeMintRequest(fixture)),
    ).rejects.toThrow(/package result is invalid/i);
  });

  it('rejects bytes replacing the package path before descriptor open', async () => {
    const fixture = await makeFixture();
    const displacedPath = path.join(fixture.root, 'packaged-original');
    const replacement = Buffer.from('replacement before descriptor open');
    packageLocalApp.mockImplementationOnce(async () => {
      await fsp.rename(fixture.artifactPath, displacedPath);
      await fsp.writeFile(fixture.artifactPath, replacement);
      return fixture.result;
    });

    await expect(
      packageSelectedSeaArtifact(makeMintRequest(fixture)),
    ).rejects.toThrow(/package result is invalid/i);
    await expect(fsp.readFile(displacedPath)).resolves.toEqual(fixture.bytes);
  });

  it('streams the held inode after its public package path is replaced', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);
    const { deploymentRevision } = bindFixture(fixture, authority);
    const displacedPath = path.join(fixture.root, 'held-original');
    const replacement = Buffer.from('replacement after descriptor open');

    await fsp.rename(fixture.artifactPath, displacedPath);
    await fsp.writeFile(fixture.artifactPath, replacement);
    const claimed = claimSelectedSeaArtifactSource(
      authority,
      makeClaim(fixture, deploymentRevision),
    );
    try {
      const chunks = [];
      for await (const chunk of claimed.source.createReadStream()) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks)).toEqual(fixture.bytes);
      expect(Buffer.concat(chunks)).not.toEqual(replacement);
    } finally {
      await claimed.source.close();
    }
  });

  it('permits identical rebinding, rejects a conflicting rebind, and preserves the original binding', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);
    const binding = bindFixture(fixture, authority);

    expect(
      createSelectedSeaDeploymentRevision(authority, clone(binding.input)),
    ).toBe(binding.deploymentRevision);
    expect(() =>
      createSelectedSeaDeploymentRevision(authority, {
        deployment: { id: 'staging' },
        profile: fixture.profile,
      }),
    ).toThrow(/already bound to a different deployment revision/i);

    const claimed = claimSelectedSeaArtifactSource(
      authority,
      makeClaim(fixture, binding.deploymentRevision),
    );
    await claimed.source.close();
  });

  it('allows exactly one same-tick claim of a bound source', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);
    const { deploymentRevision } = bindFixture(fixture, authority);
    const claim = makeClaim(fixture, deploymentRevision);

    const attempts = await Promise.allSettled([
      Promise.resolve().then(() =>
        claimSelectedSeaArtifactSource(authority, claim),
      ),
      Promise.resolve().then(() =>
        claimSelectedSeaArtifactSource(authority, claim),
      ),
    ]);
    const fulfilled = attempts.filter(
      (attempt) => attempt.status === 'fulfilled',
    );
    const rejected = attempts.filter(
      (attempt) => attempt.status === 'rejected',
    );
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({
        message: expect.stringMatching(/no longer available/i),
      }),
    });

    const winner = fulfilled[0];
    if (winner.status !== 'fulfilled') {
      throw new Error('Expected one fulfilled selected SEA claim.');
    }
    await winner.value.source.close();
    expect(() => inspectSelectedSeaArtifact(authority)).toThrow(
      /no longer available/i,
    );
    expect(() => discardSelectedSeaArtifact(authority)).toThrow(
      /no longer available/i,
    );
  });

  it('rejects valid but mismatched claim contexts without spending the authority', async () => {
    /** @type {Array<(fixture: Awaited<ReturnType<typeof makeFixture>>, deploymentRevision: Readonly<Record<string, any>>) => Record<string, any>>} */
    const mismatches = [
      (fixture, _deploymentRevision) => ({
        deploymentRevision: createDeploymentRevisionFromArtifactObservation(
          {
            deployment: { id: 'other-deployment' },
            profile: fixture.profile,
          },
          {
            revision: fixture.revision,
            runtime: fixture.runtime,
            artifact: fixture.observation,
          },
        ),
        profile: fixture.profile,
        providerScope: fixture.providerScope,
      }),
      (fixture, deploymentRevision) => ({
        deploymentRevision,
        profile: makeProfile('us-west-2'),
        providerScope: fixture.providerScope,
      }),
      (fixture, deploymentRevision) => ({
        deploymentRevision,
        profile: fixture.profile,
        providerScope: makeProviderScope('us-west-2'),
      }),
    ];

    for (const makeMismatch of mismatches) {
      const fixture = await makeFixture();
      const authority = await mintFixture(fixture);
      const { deploymentRevision } = bindFixture(fixture, authority);

      expect(() =>
        claimSelectedSeaArtifactSource(
          authority,
          makeMismatch(fixture, deploymentRevision),
        ),
      ).toThrow(/claim does not match/i);

      const claimed = claimSelectedSeaArtifactSource(
        authority,
        makeClaim(fixture, deploymentRevision),
      );
      await claimed.source.close();
    }
  });

  it('returns one stable discard promise and lets discard win before claim', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);
    const { deploymentRevision } = bindFixture(fixture, authority);

    const firstDiscard = discardSelectedSeaArtifact(authority);
    expect(discardSelectedSeaArtifact(authority)).toBe(firstDiscard);
    expect(() =>
      claimSelectedSeaArtifactSource(
        authority,
        makeClaim(fixture, deploymentRevision),
      ),
    ).toThrow(/no longer available/i);
    await firstDiscard;
    expect(discardSelectedSeaArtifact(authority)).toBe(firstDiscard);
    expect(() => inspectSelectedSeaArtifact(authority)).toThrow(
      /no longer available/i,
    );
  });

  it('lets claim win before discard and transfers close ownership', async () => {
    const fixture = await makeFixture();
    const authority = await mintFixture(fixture);
    const { deploymentRevision } = bindFixture(fixture, authority);

    const claimed = claimSelectedSeaArtifactSource(
      authority,
      makeClaim(fixture, deploymentRevision),
    );
    expect(() => discardSelectedSeaArtifact(authority)).toThrow(
      /no longer available/i,
    );
    await claimed.source.close();
  });

  it('closes the held descriptor exactly once after post-open package validation fails', async () => {
    const fixture = await makeFixture();
    const result = /** @type {Record<string, any>} */ (clone(fixture.result));
    result.artifacts[0].byteDigest = digest('false package digest');
    packageLocalApp.mockResolvedValueOnce(result);
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

    await expect(
      packageSelectedSeaArtifact(makeMintRequest(fixture)),
    ).rejects.toThrow(/package result is invalid/i);
    expect(closeCounts).toEqual([1]);
  });

  it('preserves both package validation and descriptor cleanup failures', async () => {
    const fixture = await makeFixture();
    const result = /** @type {Record<string, any>} */ (clone(fixture.result));
    result.artifacts[0].size += 1;
    packageLocalApp.mockResolvedValueOnce(result);
    const closeFailure = new Error('descriptor close failed');
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

    const failure = await packageSelectedSeaArtifact(
      makeMintRequest(fixture),
    ).catch(
      /** @param {unknown} error */
      (error) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect(failure).toMatchObject({
      message:
        'Selected SEA artifact minting and descriptor cleanup both failed.',
    });
    expect(failure.errors).toHaveLength(2);
    expect(failure.errors[0]).toBeInstanceOf(TypeError);
    expect(failure.errors[1]).toBe(closeFailure);
  });

  it('returns one stable rejected discard promise after descriptor close fails', async () => {
    const fixture = await makeFixture();
    const closeFailure = new Error('discard close failed');
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
    const authority = await mintFixture(fixture);

    const first = discardSelectedSeaArtifact(authority);
    expect(discardSelectedSeaArtifact(authority)).toBe(first);
    await expect(first).rejects.toBe(closeFailure);
    expect(discardSelectedSeaArtifact(authority)).toBe(first);
  });
});
