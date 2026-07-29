import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { createBoundedProcessRunner } from '../../src/core/runtime/bounded-process.js';
import { createDeploymentSshIdentityStore } from '../../src/core/runtime/deployment-ssh-identity.js';
import {
  createSingleNodeDeploymentIncarnationId,
  getSingleNodeDeploymentInstanceId,
} from '../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../src/core/runtime/single-node-deployment-intent.js';
/** @type {string[]} */
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function makeSelection() {
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: 'hello-production' },
    appId: 'hello-app',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'hetzner', location: 'fsn1' },
  });
  return {
    deploymentInstanceId: getSingleNodeDeploymentInstanceId(intent),
    incarnationId: createSingleNodeDeploymentIncarnationId(Buffer.alloc(32, 8)),
  };
}

async function makeStore(runProcess = createBoundedProcessRunner()) {
  const parent = await mkdtemp(join(tmpdir(), 'wharfie-ssh-identity-test-'));
  roots.push(parent);
  const root = join(parent, 'identities');
  return {
    parent,
    root,
    store: createDeploymentSshIdentityStore({ root, runProcess }),
  };
}

describe('deployment SSH identity store', () => {
  it('generates one private Ed25519 identity with exact modes', async () => {
    const { store } = await makeStore();
    const identity = await store.ensureIdentity(makeSelection());

    expect(identity.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+={0,2}$/);
    expect(identity.publicKeyFingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/);
    expect((await lstat(identity.privateKeyPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(identity.knownHostsPath)).mode & 0o777).toBe(0o600);
    expect((await lstat(`${identity.privateKeyPath}.pub`)).mode & 0o777).toBe(
      0o644,
    );
    expect(await readFile(identity.knownHostsPath, 'utf8')).toBe('');
    expect(await readFile(`${identity.privateKeyPath}.pub`, 'utf8')).toBe(
      `${identity.publicKey}\n`,
    );
  });

  it('adopts and re-verifies without rotating an existing incarnation', async () => {
    const { store } = await makeStore();
    const selection = makeSelection();
    const first = await store.ensureIdentity(selection);
    const privateBytes = await readFile(first.privateKeyPath);
    const second = await store.ensureIdentity(selection);

    expect(second).toEqual(first);
    expect(await readFile(second.privateKeyPath)).toEqual(privateBytes);
  });

  it('converges concurrent generation to one published keypair', async () => {
    const { store } = await makeStore();
    const selection = makeSelection();
    const [first, second] = await Promise.all([
      store.ensureIdentity(selection),
      store.ensureIdentity(selection),
    ]);

    expect(second).toEqual(first);
    expect(await readFile(first.privateKeyPath)).toEqual(
      await readFile(second.privateKeyPath),
    );
  });

  it('refuses unexpected files and symlinked identity state', async () => {
    const selection = makeSelection();
    const firstFixture = await makeStore();
    const identity = await firstFixture.store.ensureIdentity(selection);
    await writeFile(join(identity.privateKeyPath, '..', 'foreign'), 'foreign');
    await expect(firstFixture.store.ensureIdentity(selection)).rejects.toThrow(
      /unexpected entries/i,
    );

    const secondFixture = await makeStore();
    const instanceDirectory = join(
      secondFixture.root,
      selection.deploymentInstanceId,
    );
    await chmod(secondFixture.parent, 0o700);
    const safeStore = secondFixture.store;
    await safeStore.ensureIdentity({
      ...selection,
      incarnationId: createSingleNodeDeploymentIncarnationId(
        Buffer.alloc(32, 9),
      ),
    });
    await symlink(
      firstFixture.parent,
      join(instanceDirectory, selection.incarnationId),
    );
    await expect(safeStore.ensureIdentity(selection)).rejects.toThrow(
      /not an exact private directory/i,
    );
  });

  it('removes only a fully validated exact identity and is idempotent', async () => {
    const { store } = await makeStore();
    const selection = makeSelection();
    const identity = await store.ensureIdentity(selection);

    await store.removeIdentity(selection);
    await expect(lstat(identity.privateKeyPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(store.removeIdentity(selection)).resolves.toBeUndefined();
  });

  it('never includes subprocess stderr in generation failures', async () => {
    const sentinel = 'secret-private-key-sentinel';
    const runProcess = {
      async run() {
        return {
          status: /** @type {const} */ ('exited'),
          exitCode: 1,
          signal: null,
          timedOut: false,
          stdout: Buffer.alloc(0),
          stderr: Buffer.from(sentinel),
        };
      },
    };
    const { store } = await makeStore(runProcess);
    let thrown;
    try {
      await store.ensureIdentity(makeSelection());
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });
});
