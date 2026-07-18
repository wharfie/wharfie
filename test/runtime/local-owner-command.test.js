/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { promises as fsp } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, jest } from '@jest/globals';

import { encodeCanonicalJsonPayload } from '../../src/core/runtime/execution-payload.js';
import {
  getLocalServiceSessionOwnerCommandEndpoint,
  acquireLocalServiceSession,
  probeLocalServiceSession,
} from '../../src/core/runtime/local-service-session.js';
import {
  LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES,
  LocalOwnerCommandError,
  createLocalOwnerCommandServer,
  sendLocalOwnerCommand,
} from '../../src/core/runtime/operator/local-owner-command.js';

/**
 * @param {(root: string) => Promise<void>} body - Test body.
 * @returns {Promise<void>} - Resolves after private test cleanup.
 */
async function withSessionRoot(body) {
  const root = await fsp.mkdtemp(join(tmpdir(), 'wloc-'));
  try {
    await body(root);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
}

/**
 * @param {(session: Awaited<ReturnType<typeof acquireLocalServiceSession>>) => Promise<void>} body - Test body.
 * @returns {Promise<void>} - Resolves after the liveness session is released.
 */
async function withLiveSession(body) {
  await withSessionRoot(async (sessionRoot) => {
    const session = await acquireLocalServiceSession({
      serviceId: 'wls_owner-command-test',
      sessionId: 'session-owner-command-test',
      sessionRoot,
    });
    try {
      await body(session);
    } finally {
      await session.release();
    }
  });
}

/**
 * @param {string} endpoint - Exact local endpoint.
 * @param {Buffer} bytes - Exact request bytes.
 * @returns {Promise<Buffer>} - Exact one-response bytes.
 */
function exchangeRaw(endpoint, bytes) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let length = 0;
    const socket = net.createConnection(endpoint);
    socket.once('connect', () => socket.end(bytes));
    socket.on('data', (chunk) => {
      chunks.push(Buffer.from(chunk));
      length += chunk.byteLength;
    });
    socket.once('end', () => resolve(Buffer.concat(chunks, length)));
    socket.once('error', reject);
    socket.setTimeout(1_000, () => {
      socket.destroy();
      reject(new Error('Timed out waiting for a raw owner-command response.'));
    });
  });
}

describe('local owner command transport', () => {
  it('uses a distinct endpoint and preserves the liveness endpoint', async () => {
    await withLiveSession(async (session) => {
      expect(session.ownerCommandEndpoint).toBe(
        getLocalServiceSessionOwnerCommandEndpoint({
          serviceId: session.serviceId,
          sessionId: session.sessionId,
          sessionRoot: session.sessionRoot,
        }),
      );
      expect(session.ownerCommandEndpoint).not.toBe(session.endpoint);

      const server = await createLocalOwnerCommandServer({
        session,
        handleCommand: async () => ({ accepted: true }),
      });
      try {
        await expect(
          probeLocalServiceSession({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
          }),
        ).resolves.toMatchObject({
          endpoint: session.endpoint,
          status: 'active',
        });
        await expect(server.close()).resolves.toBeUndefined();
        await expect(
          probeLocalServiceSession({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
          }),
        ).resolves.toMatchObject({ status: 'active' });
      } finally {
        await server.close();
      }
    });
  });

  it('requires the exact in-process acquired-session capability before binding', async () => {
    await withLiveSession(async (session) => {
      await expect(
        createLocalOwnerCommandServer({
          session: { ...session },
          handleCommand: async () => ({ accepted: true }),
        }),
      ).rejects.toThrow('must be the exact locally held acquired session');
    });
  });

  it('authenticates one canonical request and gives the handler separate validated fields', async () => {
    await withLiveSession(async (session) => {
      /** @type {Readonly<Record<string, any>> | undefined} */
      let received;
      const server = await createLocalOwnerCommandServer({
        session,
        isCurrentOwner: async (owner) => {
          expect(Object.isFrozen(owner)).toBe(true);
          expect(owner).toMatchObject({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            endpoint: session.endpoint,
          });
          return true;
        },
        handleCommand: async (command, owner) => {
          received = Object.freeze({ command, owner });
          return {
            outcome: 'cancellation-requested',
            delivery: 'started',
            runStatus: 'RUNNING',
            invocationStatus: 'STARTED',
          };
        },
      });
      try {
        await expect(
          sendLocalOwnerCommand({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
            requestId: 'cancel-request-001',
            command: 'cancel-active-attempt',
            request: { runId: 'wlm_example' },
          }),
        ).resolves.toEqual({
          delivery: 'started',
          invocationStatus: 'STARTED',
          outcome: 'cancellation-requested',
          runStatus: 'RUNNING',
        });
        expect(received).toBeDefined();
        expect(received?.command).toEqual({
          command: 'cancel-active-attempt',
          request: { runId: 'wlm_example' },
          requestId: 'cancel-request-001',
        });
        expect(received?.owner).toEqual(server.session);
      } finally {
        await server.close();
      }
    });
  });

  it('fails closed as stale without invoking a handler when its owner fence no longer holds', async () => {
    await withLiveSession(async (session) => {
      const handleCommand = jest.fn(async () => ({ accepted: true }));
      const server = await createLocalOwnerCommandServer({
        session,
        isCurrentOwner: async () => false,
        handleCommand,
      });
      try {
        await expect(
          sendLocalOwnerCommand({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
            requestId: 'cancel-request-stale',
            command: 'cancel-active-attempt',
            request: { runId: 'wlm_example' },
          }),
        ).rejects.toMatchObject({
          name: 'LocalOwnerCommandError',
          code: 'local-owner-command-stale',
          kind: 'stale',
        });
        expect(handleCommand).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });

  it('keeps the local liveness fence when a durable owner fence is supplied', async () => {
    await withLiveSession(async (session) => {
      const handleCommand = jest.fn(async () => ({ accepted: true }));
      const server = await createLocalOwnerCommandServer({
        session,
        isCurrentOwner: async () => true,
        handleCommand,
      });
      try {
        await session.release();
        await expect(
          sendLocalOwnerCommand({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
            requestId: 'cancel-request-released-session',
            command: 'cancel-active-attempt',
            request: { runId: 'wlm_example' },
          }),
        ).rejects.toMatchObject({
          code: 'local-owner-command-stale',
          kind: 'stale',
        });
        expect(handleCommand).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });

  it('classifies unauthenticated and malformed raw requests without dispatching', async () => {
    await withLiveSession(async (session) => {
      const handleCommand = jest.fn(async () => ({ accepted: true }));
      const server = await createLocalOwnerCommandServer({
        session,
        handleCommand,
      });
      try {
        const badMac = encodeCanonicalJsonPayload({
          version: 1,
          requestId: 'cancel-request-auth',
          command: 'cancel-active-attempt',
          request: { runId: 'wlm_example' },
          mac: 'A'.repeat(43),
        });
        await expect(
          exchangeRaw(server.endpoint, badMac).then((value) =>
            JSON.parse(value.toString('utf8')),
          ),
        ).resolves.toMatchObject({
          requestId: 'cancel-request-auth',
          status: 'auth',
          version: 1,
        });
        await expect(
          exchangeRaw(server.endpoint, Buffer.from('{not json', 'utf8')).then(
            (value) => JSON.parse(value.toString('utf8')),
          ),
        ).resolves.toMatchObject({
          requestId: 'invalid',
          status: 'malformed',
          version: 1,
        });
        expect(handleCommand).not.toHaveBeenCalled();
      } finally {
        await server.close();
      }
    });
  });

  it('classifies an unsigned peer response as an authentication failure', async () => {
    await withLiveSession(async (session) => {
      const server = net.createServer({ allowHalfOpen: true }, (socket) => {
        socket.once('data', () => {
          socket.end(
            encodeCanonicalJsonPayload({
              version: 1,
              requestId: 'cancel-request-fake-peer',
              status: 'ok',
              result: { accepted: true },
              mac: 'A'.repeat(43),
            }),
          );
        });
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(session.ownerCommandEndpoint, () => resolve(undefined));
      });
      try {
        await expect(
          sendLocalOwnerCommand({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
            requestId: 'cancel-request-fake-peer',
            command: 'cancel-active-attempt',
            request: { runId: 'wlm_example' },
          }),
        ).rejects.toMatchObject({
          code: 'local-owner-command-auth',
          kind: 'auth',
        });
      } finally {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve(undefined))),
        );
      }
    });
  });

  it('bounds oversized requests and delayed handlers without treating timeout as a negative acknowledgement', async () => {
    await withLiveSession(async (session) => {
      const server = await createLocalOwnerCommandServer({
        session,
        timeoutMs: 25,
        handleCommand: async () => await new Promise(() => {}),
      });
      try {
        await expect(
          exchangeRaw(
            server.endpoint,
            Buffer.alloc(LOCAL_OWNER_COMMAND_MAX_REQUEST_BYTES + 1, 0x61),
          ).then((value) => JSON.parse(value.toString('utf8'))),
        ).resolves.toMatchObject({ status: 'malformed' });
        await expect(
          sendLocalOwnerCommand({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
            requestId: 'cancel-request-timeout',
            command: 'cancel-active-attempt',
            request: { runId: 'wlm_example' },
            timeoutMs: 250,
          }),
        ).rejects.toMatchObject({
          code: 'local-owner-command-timeout',
          kind: 'timeout',
        });
      } finally {
        await server.close();
      }
    });
  });

  it('classifies a closed endpoint as unreachable', async () => {
    await withLiveSession(async (session) => {
      const server = await createLocalOwnerCommandServer({
        session,
        handleCommand: async () => ({ accepted: true }),
      });
      await server.close();
      await expect(
        sendLocalOwnerCommand({
          serviceId: session.serviceId,
          sessionId: session.sessionId,
          sessionRoot: session.sessionRoot,
          requestId: 'cancel-request-unreachable',
          command: 'cancel-active-attempt',
          request: { runId: 'wlm_example' },
        }),
      ).rejects.toBeInstanceOf(LocalOwnerCommandError);
      await expect(
        sendLocalOwnerCommand({
          serviceId: session.serviceId,
          sessionId: session.sessionId,
          sessionRoot: session.sessionRoot,
          requestId: 'cancel-request-unreachable-second',
          command: 'cancel-active-attempt',
          request: { runId: 'wlm_example' },
        }),
      ).rejects.toMatchObject({
        code: 'local-owner-command-unreachable',
        kind: 'unreachable',
      });
    });
  });

  it('fails closed on Windows until same-principal named-pipe access control exists', async () => {
    await withLiveSession(async (session) => {
      const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
      if (!descriptor?.configurable) {
        throw new Error('Test process.platform must be configurable.');
      }
      Object.defineProperty(process, 'platform', {
        ...descriptor,
        value: 'win32',
      });
      try {
        await expect(
          createLocalOwnerCommandServer({
            session,
            handleCommand: async () => ({ accepted: true }),
          }),
        ).rejects.toMatchObject({
          code: 'local-owner-command-unreachable',
          kind: 'unreachable',
        });
        await expect(
          sendLocalOwnerCommand({
            serviceId: session.serviceId,
            sessionId: session.sessionId,
            sessionRoot: session.sessionRoot,
            requestId: 'cancel-request-windows',
            command: 'cancel-active-attempt',
            request: { runId: 'wlm_example' },
          }),
        ).rejects.toMatchObject({
          code: 'local-owner-command-unreachable',
          kind: 'unreachable',
        });
      } finally {
        Object.defineProperty(process, 'platform', descriptor);
      }
    });
  });
});
