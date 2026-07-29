import { createHmac } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import {
  HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
  HETZNER_CREDENTIAL_BINDING_FILE_NAME,
  HETZNER_CREDENTIAL_BINDING_KIND,
  HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
  HETZNER_CREDENTIAL_TOKEN_MAX_BYTES,
  HetznerCredentialBindingInvalidError,
  HetznerCredentialBindingMismatchError,
  createHetznerCredentialBindingStore,
  validateHetznerCredentialBindingEvidence,
} from '../../../../src/core/runtime/providers/hetzner/credential-binding.js';
import {
  createDomainSeparatedSha256Id,
  sha256Base64Url,
} from '../../../../src/core/runtime/content-id.js';

const TOKEN = 'hcloud-preview-token-abcdefghijklmnopqrstuvwxyz012345';
/** @type {string[]} */
const temporaryRoots = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** @param {string} [name] */
function deploymentInstanceId(name = 'hello-production') {
  return createDomainSeparatedSha256Id({
    domain: 'wharfie:test-single-node-deployment:v1',
    prefix: 'wsnd1',
    payload: name,
  });
}

/** @param {number} first */
function deterministicRandomBytes(first) {
  let value = first;
  /** @param {number} size */
  return (size) => {
    if (size !== 32) throw new Error('unexpected entropy request');
    const bytes = Buffer.alloc(32, value);
    value = (value + 1) & 0xff;
    return bytes;
  };
}

/**
 * @param {{randomBytes?: (size: number) => Uint8Array}} [options]
 */
async function makeFixture(options = {}) {
  const parent = await mkdtemp(
    join(tmpdir(), 'wharfie-hetzner-credential-binding-'),
  );
  temporaryRoots.push(parent);
  await chmod(parent, 0o700);
  const root = join(parent, 'bindings');
  const store = createHetznerCredentialBindingStore({
    root,
    ...(options.randomBytes ? { randomBytes: options.randomBytes } : {}),
  });
  return { parent, root, store };
}

/** @param {string} root @param {string} instanceId */
function bindingPaths(root, instanceId) {
  const directory = join(root, instanceId);
  return {
    directory,
    bindingPath: join(directory, HETZNER_CREDENTIAL_BINDING_FILE_NAME),
  };
}

/** @param {string} instanceId @param {string} [token] */
function ensureRequest(instanceId, token = TOKEN) {
  return { deploymentInstanceId: instanceId, token };
}

describe('Hetzner credential binding store', () => {
  it('constructs without reading an environment token or writing local state', async () => {
    const { root, store } = await makeFixture();

    expect(Object.isFrozen(store)).toBe(true);
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('persists only a canonical salted HMAC verifier with private modes', async () => {
    const { root, store } = await makeFixture({
      randomBytes: deterministicRandomBytes(7),
    });
    const instanceId = deploymentInstanceId();
    const evidence = await store.ensureBinding(ensureRequest(instanceId));
    const paths = bindingPaths(root, instanceId);
    const text = await readFile(paths.bindingPath, 'utf8');
    const document = JSON.parse(text);

    expect(evidence).toEqual({
      schemaVersion: HETZNER_CREDENTIAL_BINDING_SCHEMA_VERSION,
      kind: HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
      deploymentInstanceId: instanceId,
      bindingId: expect.stringMatching(/^whcb1_[A-Za-z0-9_-]{43}$/u),
    });
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(evidence).not.toHaveProperty('salt');
    expect(evidence).not.toHaveProperty('verifier');
    expect(evidence).not.toHaveProperty('token');
    expect(text).not.toContain(TOKEN);
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(document)).toEqual([
      'bindingId',
      'deploymentInstanceId',
      'kind',
      'salt',
      'schemaVersion',
      'verifier',
    ]);
    expect(document.kind).toBe(HETZNER_CREDENTIAL_BINDING_KIND);
    expect(document.salt).toBe(Buffer.alloc(32, 7).toString('base64url'));
    expect(document.verifier).toBe(
      createHmac('sha256', Buffer.alloc(32, 7))
        .update(TOKEN, 'utf8')
        .digest('base64url'),
    );
    expect((await lstat(root)).mode & 0o777).toBe(0o700);
    expect((await lstat(paths.directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(paths.bindingPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(root)).isSymbolicLink()).toBe(false);
    expect((await lstat(paths.directory)).isSymbolicLink()).toBe(false);
    expect((await lstat(paths.bindingPath)).isSymbolicLink()).toBe(false);
    expect(await readdir(paths.directory)).toEqual([
      HETZNER_CREDENTIAL_BINDING_FILE_NAME,
    ]);
  });

  it('reuses one stable binding for the same token without rewriting it', async () => {
    const { root, store } = await makeFixture({
      randomBytes: deterministicRandomBytes(11),
    });
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    const first = await store.ensureBinding(ensureRequest(instanceId));
    const firstText = await readFile(paths.bindingPath, 'utf8');
    const firstStats = await lstat(paths.bindingPath);
    const second = await store.ensureBinding(ensureRequest(instanceId));
    const secondStats = await lstat(paths.bindingPath);

    expect(second).toEqual(first);
    expect(await readFile(paths.bindingPath, 'utf8')).toBe(firstText);
    expect(secondStats.dev).toBe(firstStats.dev);
    expect(secondStats.ino).toBe(firstStats.ino);
    expect(secondStats.mtimeMs).toBe(firstStats.mtimeMs);
  });

  it('rejects a changed token without leaking it or mutating the winner', async () => {
    const { root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    const evidence = await store.ensureBinding(ensureRequest(instanceId));
    const before = await readFile(paths.bindingPath, 'utf8');
    const changed = 'hcloud-changed-token-sentinel-that-must-never-leak';
    let thrown;
    try {
      await store.ensureBinding(ensureRequest(instanceId, changed));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(HetznerCredentialBindingMismatchError);
    expect(String(thrown)).not.toContain(changed);
    expect(await readFile(paths.bindingPath, 'utf8')).toBe(before);
    expect(await store.ensureBinding(ensureRequest(instanceId))).toEqual(
      evidence,
    );
    expect(before).not.toContain(changed);
  });

  it.each([
    ['empty', ''],
    ['leading whitespace', ' token'],
    ['trailing whitespace', 'token '],
    ['newline', 'token\n'],
    ['NUL', 'token\0value'],
    ['C1 control', `token${String.fromCharCode(0x85)}value`],
    ['lone surrogate', `token${String.fromCharCode(0xd800)}value`],
    ['oversize UTF-8', 'é'.repeat(2049)],
  ])('rejects a %s token without writing a binding', async (_name, token) => {
    const { root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    let thrown;
    try {
      await store.ensureBinding(ensureRequest(instanceId, token));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    if (token.length > 0) expect(String(thrown)).not.toContain(token);
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts an exact 4096-byte trimmed token', async () => {
    const { store } = await makeFixture();
    const token = 'a'.repeat(HETZNER_CREDENTIAL_TOKEN_MAX_BYTES);

    await expect(
      store.ensureBinding(ensureRequest(deploymentInstanceId(), token)),
    ).resolves.toMatchObject({
      kind: HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
    });
  });

  it.each([
    ['relative root', 'relative/bindings'],
    ['noncanonical root', '/tmp/../tmp/wharfie-bindings'],
    ['root with newline', '/tmp/wharfie\nbindings'],
  ])('rejects a %s', (_name, root) => {
    expect(() => createHetznerCredentialBindingStore({ root })).toThrow(
      /canonical absolute path/u,
    );
  });

  it('requires exact data-only options and a valid entropy source', async () => {
    const { parent } = await makeFixture();
    const root = join(parent, 'another-binding-root');

    expect(() =>
      createHetznerCredentialBindingStore({ root, extra: true }),
    ).toThrow(/exact fields/u);
    expect(() =>
      createHetznerCredentialBindingStore({
        root,
        randomBytes: /** @type {any} */ (null),
      }),
    ).toThrow(/must be a function/u);
    const accessor = {};
    Object.defineProperty(accessor, 'root', {
      enumerable: true,
      get() {
        return root;
      },
    });
    expect(() => createHetznerCredentialBindingStore(accessor)).toThrow(
      /enumerable value/u,
    );

    const badEntropyStore = createHetznerCredentialBindingStore({
      root,
      randomBytes: () => Buffer.alloc(31),
    });
    await expect(
      badEntropyStore.ensureBinding(ensureRequest(deploymentInstanceId())),
    ).rejects.toThrow(/exactly 32 bytes/u);
  });

  it('requires an exact wsnd1 selection and rejects secret-bearing extras', async () => {
    const { store } = await makeFixture();
    const sentinel = 'secret-request-extra-that-must-not-appear';
    let thrown;
    try {
      await store.ensureBinding({
        ...ensureRequest(deploymentInstanceId()),
        credentials: sentinel,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).not.toContain(sentinel);
    await expect(
      store.ensureBinding({
        deploymentInstanceId: `wic1_${'A'.repeat(43)}`,
        token: TOKEN,
      }),
    ).rejects.toThrow(/wsnd1_/u);
  });
});

describe('Hetzner credential binding corruption boundaries', () => {
  it.each([
    ['malformed JSON', () => '{\n'],
    [
      'unexpected document field',
      /** @param {Record<string, any>} document */
      (document) =>
        `${JSON.stringify({ ...document, tokenHint: 'not-allowed' })}\n`,
    ],
    [
      'noncanonical whitespace',
      /** @param {Record<string, any>} document */
      (document) => `${JSON.stringify(document, null, 2)}\n`,
    ],
    [
      'changed verifier',
      /** @param {Record<string, any>} document */
      (document) =>
        `${JSON.stringify({
          ...document,
          verifier: sha256Base64Url('changed-verifier'),
        })}\n`,
    ],
    [
      'changed deployment identity',
      /** @param {Record<string, any>} document */
      (document) =>
        `${JSON.stringify({
          ...document,
          deploymentInstanceId: deploymentInstanceId('another-deployment'),
        })}\n`,
    ],
  ])('rejects %s', async (_name, mutate) => {
    const { root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    await store.ensureBinding(ensureRequest(instanceId));
    const document = JSON.parse(await readFile(paths.bindingPath, 'utf8'));
    await writeFile(paths.bindingPath, mutate(document), { mode: 0o600 });

    await expect(
      store.ensureBinding(ensureRequest(instanceId)),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingInvalidError);
  });

  it.each([
    [
      'root',
      /** @param {{root: string}} value */
      async ({ root }) => chmod(root, 0o755),
    ],
    [
      'deployment directory',
      /** @param {{paths: ReturnType<typeof bindingPaths>}} value */
      async ({ paths }) => chmod(paths.directory, 0o755),
    ],
    [
      'binding file',
      /** @param {{paths: ReturnType<typeof bindingPaths>}} value */
      async ({ paths }) => chmod(paths.bindingPath, 0o644),
    ],
  ])('rejects an unsafe %s mode', async (_name, corrupt) => {
    const { root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    await store.ensureBinding(ensureRequest(instanceId));
    await corrupt({ root, paths });

    await expect(
      store.ensureBinding(ensureRequest(instanceId)),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingInvalidError);
  });

  it('refuses a symlinked binding file without following its target', async () => {
    const { parent, root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    await store.ensureBinding(ensureRequest(instanceId));
    const external = join(parent, 'external-binding.json');
    await rename(paths.bindingPath, external);
    await symlink(external, paths.bindingPath);

    await expect(
      store.ensureBinding(ensureRequest(instanceId)),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingInvalidError);
    expect((await lstat(paths.bindingPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(external, 'utf8')).not.toContain(TOKEN);
  });

  it('refuses symlinked managed directories', async () => {
    const first = await makeFixture();
    const rootTarget = join(first.parent, 'root-target');
    await mkdir(rootTarget, { mode: 0o700 });
    await symlink(rootTarget, first.root);
    await expect(
      first.store.ensureBinding(ensureRequest(deploymentInstanceId())),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingInvalidError);

    const second = await makeFixture();
    const existingId = deploymentInstanceId('existing');
    await second.store.ensureBinding(ensureRequest(existingId));
    const target = join(second.parent, 'instance-target');
    await mkdir(target, { mode: 0o700 });
    const symlinkedId = deploymentInstanceId('symlinked');
    await symlink(target, join(second.root, symlinkedId));
    await expect(
      second.store.ensureBinding(ensureRequest(symlinkedId)),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingInvalidError);
  });
});

describe('Hetzner credential binding concurrency and removal', () => {
  it('converges concurrent same-token first binds to one durable winner', async () => {
    const fixture = await makeFixture({
      randomBytes: deterministicRandomBytes(21),
    });
    const competing = createHetznerCredentialBindingStore({
      root: fixture.root,
      randomBytes: deterministicRandomBytes(22),
    });
    const instanceId = deploymentInstanceId();
    const [first, second] = await Promise.all([
      fixture.store.ensureBinding(ensureRequest(instanceId)),
      competing.ensureBinding(ensureRequest(instanceId)),
    ]);

    expect(second).toEqual(first);
    expect(
      await readdir(bindingPaths(fixture.root, instanceId).directory),
    ).toEqual([HETZNER_CREDENTIAL_BINDING_FILE_NAME]);
    expect(
      (await lstat(bindingPaths(fixture.root, instanceId).bindingPath)).nlink,
    ).toBe(1);
  });

  it('lets exactly one concurrent different-token bind win without leakage', async () => {
    const fixture = await makeFixture({
      randomBytes: deterministicRandomBytes(31),
    });
    const competing = createHetznerCredentialBindingStore({
      root: fixture.root,
      randomBytes: deterministicRandomBytes(32),
    });
    const instanceId = deploymentInstanceId();
    const firstToken = 'hcloud-first-concurrent-token-sentinel';
    const secondToken = 'hcloud-second-concurrent-token-sentinel';
    const outcomes = await Promise.allSettled([
      fixture.store.ensureBinding(ensureRequest(instanceId, firstToken)),
      competing.ensureBinding(ensureRequest(instanceId, secondToken)),
    ]);
    const winnerIndex = outcomes.findIndex(
      (outcome) => outcome.status === 'fulfilled',
    );
    const winner = outcomes[winnerIndex];
    const rejected = outcomes.filter(
      (outcome) => outcome.status === 'rejected',
    );

    expect(
      outcomes.filter((outcome) => outcome.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBeInstanceOf(
      HetznerCredentialBindingMismatchError,
    );
    expect(String(rejected[0].reason)).not.toContain(firstToken);
    expect(String(rejected[0].reason)).not.toContain(secondToken);
    if (!winner || winner.status !== 'fulfilled') {
      throw new Error('expected one concurrent winner');
    }
    const winnerToken = winnerIndex === 0 ? firstToken : secondToken;
    const loserToken = winnerIndex === 0 ? secondToken : firstToken;
    await expect(
      fixture.store.ensureBinding(ensureRequest(instanceId, winnerToken)),
    ).resolves.toEqual(winner.value);
    await expect(
      fixture.store.ensureBinding(ensureRequest(instanceId, loserToken)),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingMismatchError);
  });

  it('removes only exact evidence, leaves the root private, and is idempotent', async () => {
    const fixture = await makeFixture({
      randomBytes: deterministicRandomBytes(41),
    });
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(fixture.root, instanceId);
    const evidence = await fixture.store.ensureBinding(
      ensureRequest(instanceId),
    );
    const wrongEvidence = {
      ...evidence,
      bindingId: createDomainSeparatedSha256Id({
        domain: 'wharfie:test-wrong-credential-binding:v1',
        prefix: 'whcb1',
        payload: 'wrong',
      }),
    };

    await expect(
      fixture.store.removeBinding(wrongEvidence),
    ).rejects.toBeInstanceOf(HetznerCredentialBindingMismatchError);
    await expect(lstat(paths.bindingPath)).resolves.toBeDefined();

    await expect(
      fixture.store.removeBinding(evidence),
    ).resolves.toBeUndefined();
    await expect(lstat(paths.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await lstat(fixture.root)).mode & 0o777).toBe(0o700);
    await expect(
      fixture.store.removeBinding(evidence),
    ).resolves.toBeUndefined();

    const rebound = await fixture.store.ensureBinding(
      ensureRequest(instanceId),
    );
    expect(rebound.bindingId).not.toBe(evidence.bindingId);
  });

  it('does not create state when idempotently removing an absent binding', async () => {
    const { root, store } = await makeFixture();
    const evidence = Object.freeze({
      schemaVersion: 1,
      kind: HETZNER_CREDENTIAL_BINDING_EVIDENCE_KIND,
      deploymentInstanceId: deploymentInstanceId(),
      bindingId: createDomainSeparatedSha256Id({
        domain: 'wharfie:test-absent-credential-binding:v1',
        prefix: 'whcb1',
        payload: 'absent',
      }),
    });

    await expect(store.removeBinding(evidence)).resolves.toBeUndefined();
    await expect(lstat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('finishes an interrupted removal from an empty private directory', async () => {
    const { root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    const evidence = await store.ensureBinding(ensureRequest(instanceId));
    await unlink(paths.bindingPath);

    await expect(store.removeBinding(evidence)).resolves.toBeUndefined();
    await expect(lstat(paths.directory)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('refuses unexpected directory entries before removing anything', async () => {
    const { root, store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const paths = bindingPaths(root, instanceId);
    const evidence = await store.ensureBinding(ensureRequest(instanceId));
    await writeFile(join(paths.directory, 'unexpected'), 'unrelated', {
      mode: 0o600,
    });

    await expect(store.removeBinding(evidence)).rejects.toBeInstanceOf(
      HetznerCredentialBindingInvalidError,
    );
    await expect(lstat(paths.bindingPath)).resolves.toBeDefined();
  });

  it('strictly validates removal evidence without exposing extra data', async () => {
    const { store } = await makeFixture();
    const instanceId = deploymentInstanceId();
    const evidence = await store.ensureBinding(ensureRequest(instanceId));
    const sentinel = 'secret-removal-extra-that-must-not-appear';
    let thrown;
    try {
      await store.removeBinding({ ...evidence, token: sentinel });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TypeError);
    expect(String(thrown)).not.toContain(sentinel);
    expect(validateHetznerCredentialBindingEvidence(evidence)).toEqual(
      evidence,
    );
  });
});
