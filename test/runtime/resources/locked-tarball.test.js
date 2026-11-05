/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';

import { downloadLockedTarball } from '../../../src/core/resources/builds/lib/locked-tarball.js';

const resolved = 'https://registry.example.test/alpha/-/alpha-1.0.0.tgz';
const bytes = Buffer.from('exact locked archive bytes');
const integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

/** @param {Response} response */
function fetchResponse(response) {
  return jest.fn(/** @type {typeof fetch} */ (async () => response));
}

/** @param {number} [length] */
function streamedResponse(length) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 7));
      controller.enqueue(bytes.subarray(7));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: length === undefined ? {} : { 'content-length': String(length) },
  });
}

describe('downloadLockedTarball', () => {
  it.each([undefined, bytes.length])(
    'verifies complete streamed bytes with Content-Length %s and no redirects or credentials',
    async (length) => {
      const fetchImplementation = fetchResponse(streamedResponse(length));
      await expect(
        downloadLockedTarball(resolved, { integrity }, { fetchImplementation }),
      ).resolves.toEqual(bytes);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      expect(fetchImplementation).toHaveBeenCalledWith(
        resolved,
        expect.objectContaining({
          redirect: 'error',
          credentials: 'omit',
          headers: {
            accept: 'application/octet-stream',
            'accept-encoding': 'identity',
          },
        }),
      );
    },
  );

  it.each([
    'http://registry.example.test/alpha.tgz',
    'https://user:secret@registry.example.test/alpha.tgz',
    `${resolved}?token=value`,
    `${resolved}#fragment`,
    ` ${resolved}`,
    'https://registry.example.test/a/../alpha.tgz',
    'file:///tmp/alpha.tgz',
  ])('rejects unsupported URL %s before requesting it', async (url) => {
    const fetchImplementation = fetchResponse(new Response(bytes));
    await expect(
      downloadLockedTarball(url, { integrity }, { fetchImplementation }),
    ).rejects.toThrow(/canonical HTTPS/);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    `sha256-${createHash('sha256').update(bytes).digest('base64')}`,
    'sha512-Zm9v',
    integrity.replace(/=+$/, ''),
    `${integrity} ${integrity}`,
    'not-integrity',
    { toString: () => integrity },
  ])(
    'rejects unsupported integrity %s before requesting bytes',
    async (value) => {
      const fetchImplementation = fetchResponse(new Response(bytes));
      await expect(
        downloadLockedTarball(
          resolved,
          { integrity: /** @type {any} */ (value) },
          { fetchImplementation },
        ),
      ).rejects.toThrow(/canonical SHA-512/);
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it.each([301, 302, 404, 500])(
    'rejects HTTP %s without resolving another URL',
    async (status) => {
      const fetchImplementation = fetchResponse(
        new Response(null, {
          status,
          headers: { location: 'https://different.example.test/alpha.tgz' },
        }),
      );
      await expect(
        downloadLockedTarball(resolved, { integrity }, { fetchImplementation }),
      ).rejects.toThrow(`rejected HTTP ${status}`);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it('rejects a fetch response that followed a redirect', async () => {
    const response = new Response(bytes);
    Object.defineProperty(response, 'redirected', { value: true });
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          fetchImplementation: fetchResponse(response),
        },
      ),
    ).rejects.toThrow('rejected HTTP');
  });

  it('rejects an unrequested response URL', async () => {
    const response = new Response(bytes);
    Object.defineProperty(response, 'url', {
      value: 'https://other.example.test/alpha.tgz',
    });
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          fetchImplementation: fetchResponse(response),
        },
      ),
    ).rejects.toThrow('rejected HTTP');
  });

  it('rejects a content-encoded transfer instead of hashing transformed bytes', async () => {
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          fetchImplementation: fetchResponse(
            new Response(bytes, {
              headers: { 'content-encoding': 'gzip' },
            }),
          ),
        },
      ),
    ).rejects.toThrow('unencoded archive bytes');
  });

  it.each([
    '0',
    '-1',
    '10x',
    '1.5',
    '9007199254740992',
    String(bytes.length + 1),
  ])('rejects invalid or over-budget Content-Length %s', async (length) => {
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          maxBytes: bytes.length,
          fetchImplementation: fetchResponse(
            new Response(bytes, {
              headers: { 'content-length': length },
            }),
          ),
        },
      ),
    ).rejects.toThrow('invalid or excessive Content-Length');
  });

  it('bounds unknown-length bodies and cancels the stream on overflow', async () => {
    const cancel = jest.fn(() => {});
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
        },
        cancel,
      }),
    );
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          maxBytes: bytes.length - 1,
          fetchImplementation: fetchResponse(response),
        },
      ),
    ).rejects.toThrow('archive byte limit');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, bytes.length - 1, bytes.length + 1])(
    'rejects empty or truncated bodies with expected length %s',
    async (length) => {
      await expect(
        downloadLockedTarball(
          resolved,
          { integrity },
          {
            fetchImplementation: fetchResponse(
              length === undefined
                ? new Response(Buffer.alloc(0))
                : streamedResponse(length),
            ),
          },
        ),
      ).rejects.toThrow('empty or truncated');
    },
  );

  it('rejects bytes with the wrong SHA-512 digest', async () => {
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          fetchImplementation: fetchResponse(new Response('different archive')),
        },
      ),
    ).rejects.toThrow('SHA-512 integrity mismatch');
  });

  it('propagates a body stream failure without returning partial bytes', async () => {
    const failure = new Error('connection lost');
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        {
          fetchImplementation: fetchResponse(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(failure);
                },
              }),
            ),
          ),
        },
      ),
    ).rejects.toBe(failure);
  });

  it('does not begin a request after caller cancellation', async () => {
    const controller = new AbortController();
    const failure = new Error('caller stopped');
    controller.abort(failure);
    const fetchImplementation = fetchResponse(new Response(bytes));
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity, signal: controller.signal },
        {
          fetchImplementation,
        },
      ),
    ).rejects.toBe(failure);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each(['timeout', 'caller'])(
    'cancels a stalled body on %s',
    async (kind) => {
      const controller = new AbortController();
      const failure = new Error('caller stopped');
      const cancel = jest.fn(() => {});
      let started = () => {};
      const ready = new Promise((resolve) => {
        started = () => resolve(undefined);
      });
      const fetchImplementation = fetchResponse(
        new Response(
          new ReadableStream({
            pull() {
              started();
            },
            cancel,
          }),
        ),
      );
      const pending = downloadLockedTarball(
        resolved,
        {
          integrity,
          signal: controller.signal,
        },
        { fetchImplementation, timeoutMs: 20 },
      );
      const rejected = pending.catch((error) => error);
      await ready;
      if (kind === 'caller') controller.abort(failure);
      expect(await rejected).toEqual(
        expect.objectContaining({
          message:
            kind === 'timeout'
              ? 'Locked package download timed out.'
              : 'caller stopped',
        }),
      );
      expect(cancel).toHaveBeenCalledTimes(1);
    },
  );

  it('times out while waiting for response headers', async () => {
    const fetchImplementation = jest.fn(
      /** @type {typeof fetch} */ (
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options?.signal?.addEventListener(
              'abort',
              () => reject(options.signal?.reason),
              { once: true },
            );
          })
      ),
    );
    await expect(
      downloadLockedTarball(
        resolved,
        { integrity },
        { fetchImplementation, timeoutMs: 20 },
      ),
    ).rejects.toThrow('timed out');
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});
