import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  DEPLOYMENT_SSH_KEYSCAN_PATH,
  ensureDeploymentSshHostKey,
  readDeploymentSshHostKey,
} from '../../src/core/runtime/deployment-ssh-host-key.js';

/** @type {string[]} */
const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** @param {string|Buffer} value */
function wireString(value) {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function publicKey(seed = 7) {
  const blob = Buffer.concat([
    wireString('ssh-ed25519'),
    wireString(Buffer.alloc(32, seed)),
  ]);
  return `ssh-ed25519 ${blob.toString('base64')}`;
}

async function makeKnownHosts(contents = '') {
  const root = await mkdtemp(join(tmpdir(), 'wharfie-host-key-test-'));
  roots.push(root);
  const knownHostsPath = join(root, 'known_hosts');
  await writeFile(knownHostsPath, contents, { mode: 0o600 });
  await chmod(knownHostsPath, 0o600);
  return knownHostsPath;
}

/** @param {string} stdout - Scanner standard output. */
function finiteOutcome(stdout) {
  return {
    status: /** @type {const} */ ('exited'),
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: Buffer.from(stdout),
    stderr: Buffer.alloc(0),
  };
}

describe('deployment SSH host-key enrollment', () => {
  it('reads only previously enrolled exact host-key evidence', async () => {
    const address = '203.0.113.10';
    const knownHostsPath = await makeKnownHosts(`${address} ${publicKey()}\n`);
    const before = await readFile(knownHostsPath);

    const evidence = await readDeploymentSshHostKey({
      address,
      knownHostsPath,
    });

    expect(evidence).toEqual({
      address,
      algorithm: 'ssh-ed25519',
      fingerprint: expect.stringMatching(/^SHA256:[A-Za-z0-9+/]{43}$/u),
    });
    expect(await readFile(knownHostsPath)).toEqual(before);
  });

  it('does not enroll an empty known-hosts file while reading', async () => {
    const knownHostsPath = await makeKnownHosts();

    await expect(
      readDeploymentSshHostKey({
        address: '203.0.113.10',
        knownHostsPath,
      }),
    ).rejects.toThrow(/not exact enrolled evidence/iu);
    expect(await readFile(knownHostsPath, 'utf8')).toBe('');
  });

  it('records one exact provider-cross-checked Ed25519 host key', async () => {
    const address = '203.0.113.10';
    const knownHostsPath = await makeKnownHosts();
    const run = jest.fn(async (/** @type {unknown} */ _request) =>
      finiteOutcome(
        `# ${address}:22 SSH-2.0-OpenSSH\n${address} ${publicKey()}\n`,
      ),
    );

    const evidence = await ensureDeploymentSshHostKey({
      address,
      knownHostsPath,
      runProcess: { run },
    });

    expect(evidence).toEqual({
      address,
      algorithm: 'ssh-ed25519',
      fingerprint: expect.stringMatching(/^SHA256:[A-Za-z0-9+/]{43}$/u),
    });
    expect(await readFile(knownHostsPath, 'utf8')).toBe(
      `${address} ${publicKey()}\n`,
    );
    expect(run).toHaveBeenCalledWith({
      file: DEPLOYMENT_SSH_KEYSCAN_PATH,
      args: ['-4', '-T', '10', '-t', 'ed25519', address],
      stdin: null,
      environment: {
        LANG: 'C',
        LC_ALL: 'C',
        PATH: '/usr/bin:/bin',
      },
      timeoutMilliseconds: 20_000,
      maximumStdoutBytes: 16 * 1024,
      maximumStderrBytes: 16 * 1024,
    });
  });

  it('reverifies durable first-use evidence without rescanning', async () => {
    const address = '203.0.113.10';
    const knownHostsPath = await makeKnownHosts(`${address} ${publicKey()}\n`);
    const run = jest.fn(async () => {
      throw new Error('must not rescan');
    });

    const first = await ensureDeploymentSshHostKey({
      address,
      knownHostsPath,
      runProcess: { run },
    });
    const second = await ensureDeploymentSshHostKey({
      address,
      knownHostsPath,
      runProcess: { run },
    });

    expect(second).toEqual(first);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a changed provider address or host-key state', async () => {
    const knownHostsPath = await makeKnownHosts(
      `203.0.113.10 ${publicKey()}\n`,
    );
    const run = jest.fn(async () => finiteOutcome(''));

    await expect(
      ensureDeploymentSshHostKey({
        address: '203.0.113.11',
        knownHostsPath,
        runProcess: { run },
      }),
    ).rejects.toThrow(/exact provider address/iu);
    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed on ambiguous scan output', async () => {
    const address = '203.0.113.10';
    const knownHostsPath = await makeKnownHosts();

    await expect(
      ensureDeploymentSshHostKey({
        address,
        knownHostsPath,
        runProcess: {
          async run() {
            return finiteOutcome(
              `${address} ${publicKey(7)}\n${address} ${publicKey(8)}\n`,
            );
          },
        },
      }),
    ).rejects.toThrow(/exactly one unique/iu);
    expect(await readFile(knownHostsPath, 'utf8')).toBe('');
  });

  it('never includes scanner stderr in a failure', async () => {
    const sentinel = 'secret-scanner-stderr-sentinel';
    const knownHostsPath = await makeKnownHosts();
    let thrown;
    try {
      await ensureDeploymentSshHostKey({
        address: '203.0.113.10',
        knownHostsPath,
        runProcess: {
          async run() {
            return {
              ...finiteOutcome(''),
              exitCode: 1,
              stderr: Buffer.from(sentinel),
            };
          },
        },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(String(thrown)).not.toContain(sentinel);
  });

  it('requires an exact owner-private ordinary known-hosts file', async () => {
    const knownHostsPath = await makeKnownHosts();
    await chmod(knownHostsPath, 0o644);

    await expect(
      ensureDeploymentSshHostKey({
        address: '203.0.113.10',
        knownHostsPath,
        runProcess: { run: async () => finiteOutcome('') },
      }),
    ).rejects.toThrow(/exact private file/iu);
  });
});
