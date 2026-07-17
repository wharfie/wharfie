/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import {
  LocalServiceSessionActiveError,
  LocalServiceSessionEndpointError,
  acquireLocalServiceSession,
  getLocalServiceSessionEndpoint,
  getLocalServiceSessionPrincipalId,
  getLocalServiceSessionScopeId,
  probeLocalServiceSession,
} from '../../src/core/runtime/local-service-session.js';

/**
 * @param {(root: string) => Promise<void>} body - Test body.
 * @returns {Promise<void>} - Resolves after private test cleanup.
 */
async function withSessionRoot(body) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'wls-'));
  try {
    await body(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

/**
 * @param {import('node:child_process').ChildProcess} child - Spawned helper process.
 * @returns {Promise<void>} - Resolves when the child bound its socket.
 */
function waitForChildReady(child) {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    return Promise.reject(
      new Error('Stale-socket helper did not expose pipes.'),
    );
  }

  return new Promise((resolvePromise, reject) => {
    let output = '';
    let errors = '';
    const cleanup = () => {
      stdout.removeListener('data', onStdout);
      stderr.removeListener('data', onStderr);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    /** @param {Buffer | string} chunk - Child standard-output chunk. */
    const onStdout = (chunk) => {
      output += String(chunk);
      if (!output.includes('ready\n')) return;
      cleanup();
      resolvePromise();
    };
    /** @param {Buffer | string} chunk - Child standard-error chunk. */
    const onStderr = (chunk) => {
      errors += String(chunk);
    };
    /** @param {Error} error - Child process failure. */
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    /**
     * @param {number | null} code - Process exit code.
     * @param {NodeJS.Signals | null} signal - Process termination signal.
     */
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(
          `Stale-socket helper exited before ready (code ${code}, signal ${signal}): ${errors}`,
        ),
      );
    };

    stdout.on('data', onStdout);
    stderr.on('data', onStderr);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

/**
 * Bind a Unix socket in a child and terminate it without allowing Node to run
 * its normal close cleanup, leaving the kernel's stale socket pathname behind.
 * @param {string} endpoint - Unix-domain socket endpoint.
 * @returns {Promise<void>} - Resolves after the stale pathname exists.
 */
async function createStaleUnixSocket(endpoint) {
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import net from 'node:net'; const server = net.createServer(); server.listen(process.argv[1], () => process.stdout.write('ready\\n'));",
      endpoint,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await waitForChildReady(child);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  }
}

const itOnUnix = process.platform === 'win32' ? it.skip : it;

describe('local service session', () => {
  it('derives stable opaque scope and principal identities for ownership records', async () => {
    await withSessionRoot(async (root) => {
      const scope = getLocalServiceSessionScopeId({ sessionRoot: root });
      const repeatedScope = getLocalServiceSessionScopeId({
        sessionRoot: root,
      });
      const otherScope = getLocalServiceSessionScopeId({
        sessionRoot: `${root}-other`,
      });
      const principal = getLocalServiceSessionPrincipalId();

      expect(scope).toMatch(/^scope-[a-f0-9]{48}$/);
      expect(repeatedScope).toBe(scope);
      expect(otherScope).not.toBe(scope);
      expect(scope).not.toContain(root);
      expect(principal).toMatch(/^(?:uid-[0-9]+|user-[a-f0-9]{48})$/);
      expect(getLocalServiceSessionPrincipalId()).toBe(principal);
    });
  });

  it('derives a deterministic short endpoint from the logical session namespace', async () => {
    await withSessionRoot(async (root) => {
      const first = getLocalServiceSessionEndpoint({
        serviceId: 'wls_example-service',
        sessionId: 'session-example-a',
        sessionRoot: root,
      });
      const repeated = getLocalServiceSessionEndpoint({
        serviceId: 'wls_example-service',
        sessionId: 'session-example-a',
        sessionRoot: root,
      });
      const otherService = getLocalServiceSessionEndpoint({
        serviceId: 'wls_other-service',
        sessionId: 'session-example-a',
        sessionRoot: root,
      });
      const otherSession = getLocalServiceSessionEndpoint({
        serviceId: 'wls_example-service',
        sessionId: 'session-example-b',
        sessionRoot: root,
      });
      const otherNamespace = getLocalServiceSessionEndpoint({
        serviceId: 'wls_example-service',
        sessionId: 'session-example-a',
        sessionRoot: `${root}-other`,
      });
      const namedPipe = getLocalServiceSessionEndpoint({
        serviceId: 'wls_example-service',
        sessionId: 'session-example-a',
        sessionRoot: root,
        platform: 'win32',
      });
      const longNamespaceEndpoint = getLocalServiceSessionEndpoint({
        serviceId: 'wls_example-service',
        sessionId: 'session-example-a',
        sessionRoot: join(root, 'x'.repeat(512)),
      });

      expect(repeated).toBe(first);
      expect(otherService).not.toBe(first);
      expect(otherSession).not.toBe(first);
      expect(otherNamespace).not.toBe(first);
      expect(first.startsWith(resolve(root))).toBe(false);
      expect(first).toMatch(/\/tmp\/wharfie-[^/]+\/s-[a-f0-9]{24}\.sock$/);
      expect(Buffer.byteLength(longNamespaceEndpoint)).toBeLessThan(100);
      expect(namedPipe).toMatch(/^\\\\\.\\pipe\\w-[a-f0-9]{24}$/);
      const missingSessionId = /** @type {any} */ ({
        serviceId: 'wls_example-service',
        sessionRoot: root,
      });
      expect(() => getLocalServiceSessionEndpoint(missingSessionId)).toThrow(
        /sessionId.*required/i,
      );
    });
  });

  itOnUnix(
    'isolates distinct session keys while rejecting an active exact session key',
    async () => {
      await withSessionRoot(async (root) => {
        const firstOptions = {
          serviceId: 'wls_active-service',
          sessionId: 'session-first',
          sessionRoot: root,
        };
        const secondOptions = {
          serviceId: 'wls_active-service',
          sessionId: 'session-second',
          sessionRoot: root,
        };
        const first = await acquireLocalServiceSession(firstOptions);
        const second = await acquireLocalServiceSession(secondOptions);

        expect(first.serviceId).toBe(firstOptions.serviceId);
        expect(first.sessionId).toBe(firstOptions.sessionId);
        expect(first.sessionRoot).toBe(resolve(root));
        expect(second.sessionId).toBe(secondOptions.sessionId);
        expect(second.endpoint).not.toBe(first.endpoint);
        await expect(
          probeLocalServiceSession(firstOptions),
        ).resolves.toMatchObject({
          endpoint: first.endpoint,
          status: 'active',
        });
        await expect(
          probeLocalServiceSession(secondOptions),
        ).resolves.toMatchObject({
          endpoint: second.endpoint,
          status: 'active',
        });
        await expect(
          acquireLocalServiceSession(firstOptions),
        ).rejects.toMatchObject({
          name: 'LocalServiceSessionActiveError',
          code: 'local-service-session-active',
          serviceId: firstOptions.serviceId,
          sessionId: firstOptions.sessionId,
          endpoint: first.endpoint,
        });

        await Promise.all([first.release(), first.release()]);
        await expect(first.release()).resolves.toBeUndefined();
        await second.release();
        await expect(
          probeLocalServiceSession(firstOptions),
        ).resolves.toMatchObject({ status: 'absent' });
      });
    },
  );

  itOnUnix(
    'fails closed on a stale Unix socket rather than deleting it',
    async () => {
      await withSessionRoot(async (root) => {
        const options = {
          serviceId: 'wls_stale-service',
          sessionId: 'session-stale',
          sessionRoot: root,
        };
        const seed = await acquireLocalServiceSession(options);
        const endpoint = seed.endpoint;
        await seed.release();

        await createStaleUnixSocket(endpoint);
        expect((await fsp.lstat(endpoint)).isSocket()).toBe(true);

        await expect(probeLocalServiceSession(options)).resolves.toMatchObject({
          endpoint,
          status: 'absent',
        });
        await expect(
          acquireLocalServiceSession(options),
        ).rejects.toBeInstanceOf(LocalServiceSessionEndpointError);
        expect((await fsp.lstat(endpoint)).isSocket()).toBe(true);
        await fsp.unlink(endpoint);
      });
    },
  );

  itOnUnix(
    'never unlinks a regular file, symlink, or directory at an occupied endpoint',
    async () => {
      await withSessionRoot(async (root) => {
        const fileOptions = {
          serviceId: 'wls-protected-file',
          sessionId: 'session-protected-file',
          sessionRoot: root,
        };
        const fileEndpoint = getLocalServiceSessionEndpoint(fileOptions);
        await fsp.mkdir(dirname(fileEndpoint), {
          recursive: true,
          mode: 0o700,
        });
        await fsp.writeFile(fileEndpoint, 'keep-file', 'utf8');
        await expect(
          acquireLocalServiceSession(fileOptions),
        ).rejects.toBeInstanceOf(LocalServiceSessionEndpointError);
        await expect(fsp.readFile(fileEndpoint, 'utf8')).resolves.toBe(
          'keep-file',
        );
        await fsp.unlink(fileEndpoint);

        const linkOptions = {
          serviceId: 'wls-protected-link',
          sessionId: 'session-protected-link',
          sessionRoot: root,
        };
        const linkEndpoint = getLocalServiceSessionEndpoint(linkOptions);
        const linkTarget = join(root, 'link-target');
        await fsp.writeFile(linkTarget, 'keep-target', 'utf8');
        await fsp.symlink(linkTarget, linkEndpoint);
        await expect(
          acquireLocalServiceSession(linkOptions),
        ).rejects.toBeInstanceOf(LocalServiceSessionEndpointError);
        expect((await fsp.lstat(linkEndpoint)).isSymbolicLink()).toBe(true);
        await expect(fsp.readFile(linkTarget, 'utf8')).resolves.toBe(
          'keep-target',
        );
        await fsp.unlink(linkEndpoint);

        const directoryOptions = {
          serviceId: 'wls-protected-directory',
          sessionId: 'session-protected-directory',
          sessionRoot: root,
        };
        const directoryEndpoint =
          getLocalServiceSessionEndpoint(directoryOptions);
        await fsp.mkdir(directoryEndpoint);
        await expect(
          acquireLocalServiceSession(directoryOptions),
        ).rejects.toBeInstanceOf(LocalServiceSessionEndpointError);
        expect((await fsp.lstat(directoryEndpoint)).isDirectory()).toBe(true);
        await fsp.rmdir(directoryEndpoint);
      });
    },
  );

  it('exposes a distinct active-session error class for operators', () => {
    const error = new LocalServiceSessionActiveError(
      'wls_operator-service',
      'session-operator',
      '/tmp/example.sock',
    );
    expect(error).toBeInstanceOf(LocalServiceSessionActiveError);
    expect(error.code).toBe('local-service-session-active');
  });
});
