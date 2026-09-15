/* eslint-env jest */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { runInNewContext } from 'node:vm';
import { gzipSync } from 'node:zlib';
import { verifyDocsSite } from '../../scripts/verify-docs-site.js';

const index = Buffer.from(
  '<!doctype html><title>Reviewed Wharfie docs</title>',
);
const contentSha256 = createHash('sha256').update(index).digest('hex');

describe('live docs verification transport and evidence', () => {
  let bundleDir = '';
  /** @type {(event: object) => any} */
  let route;

  beforeEach(async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), 'wharfie-docs-verifier-'));
    await writeFile(path.join(bundleDir, 'index.html'), index);
    await writeFile(
      path.join(bundleDir, 'manifest.json'),
      JSON.stringify({
        format: 'wharfie-docs-site',
        version: 1,
        contentSha256,
        files: [
          { name: 'index.html', sha256: contentSha256, size: index.length },
        ],
      }),
    );
    const source = await readFile(
      new URL('../../docs/site/edge-router.js', import.meta.url),
      'utf8',
    );
    route = runInNewContext(
      source.replace('__WHARFIE_DOCS_SHA256__', contentSha256) + '\nhandler;',
      {},
      { timeout: 100 },
    );
  });

  afterEach(async () => {
    jest.useRealTimers();
    await rm(bundleDir, { recursive: true, force: true });
  });

  /** @param {{oversize?: boolean, redirect?: boolean, cacheable?: boolean, compressedProvider?: boolean, throwSynchronously?: boolean, stall?: boolean}} [fault] */
  function transport(fault = {}) {
    let active = 0;
    let peak = 0;
    /** @type {any[]} */
    const calls = [];
    /** @type {PassThrough[]} */
    const responses = [];
    const fakeRequest = (
      /** @type {any} */ options,
      /** @type {(response: any) => void} */ callback,
    ) => {
      calls.push(options);
      if (fault.throwSynchronously) throw new Error('private-transport-detail');
      const client = new EventEmitter();
      return Object.assign(client, {
        end() {
          active++;
          peak = Math.max(peak, active);
          if (fault.stall) {
            options.signal.addEventListener(
              'abort',
              () => {
                active--;
                client.emit('error', new Error('private-abort-detail'));
              },
              { once: true },
            );
            return;
          }
          setImmediate(() => {
            const routed = route({
              request: {
                method: options.method,
                uri: options.path.split('?')[0],
                querystring: {},
              },
            });
            const providerRejection =
              options.path.startsWith('/%2e%2e/install?');
            const landing = Boolean(routed.uri);
            const response = Object.assign(new PassThrough(), {
              statusCode: providerRejection
                ? 400
                : landing
                  ? 200
                  : routed.statusCode,
              headers: providerRejection
                ? {
                    'content-type': 'text/html',
                    ...(fault.compressedProvider
                      ? { 'content-encoding': 'gzip' }
                      : {}),
                  }
                : landing
                  ? {
                      'content-type': 'text/html; charset=utf-8',
                      'content-length': String(index.length),
                      'cache-control': fault.cacheable
                        ? 'max-age=300'
                        : 'no-store',
                      'content-security-policy':
                        "default-src 'none'; frame-ancestors 'none'",
                      'x-content-type-options': 'nosniff',
                    }
                  : Object.fromEntries(
                      Object.entries(routed.headers).map(([name, value]) => [
                        name,
                        /** @type {{value: string}} */ (value).value,
                      ]),
                    ),
            });
            responses.push(response);
            response.once('close', () => {
              active--;
            });
            if (fault.redirect && calls.length === 4) {
              response.statusCode = 302;
              response.headers.location =
                'https://evil.example/private-location-detail';
            }
            callback(response);
            response.end(
              fault.oversize && options.path === '/' && options.method === 'GET'
                ? Buffer.alloc(256 * 1024 + 1, 65)
                : options.method === 'HEAD'
                  ? undefined
                  : providerRejection
                    ? fault.compressedProvider
                      ? gzipSync('wharfie-private-query-probe')
                      : '<html>Bad request</html>'
                    : landing
                      ? index
                      : routed.body?.data,
            );
          });
        },
      });
    };
    return {
      request: /** @type {typeof import('node:https').request} */ (fakeRequest),
      calls,
      responses,
      peak: () => peak,
    };
  }

  it('binds the prepared bytes while keeping TLS authority separate from the pre-cutover TCP destination', async () => {
    const mock = transport();
    const report = await verifyDocsSite(
      {
        url: 'https://docs.wharfie.dev/',
        connectHost: 'd123.cloudfront.net',
        bundleDir,
      },
      mock.request,
    );

    expect(report.success).toBe(true);
    expect(report.checks).toHaveLength(37);
    expect(mock.calls).toHaveLength(37);
    expect(mock.peak()).toBeLessThanOrEqual(4);
    expect(mock.peak()).toBeGreaterThan(1);
    expect(
      mock.calls.every(
        (options) =>
          options.hostname === 'd123.cloudfront.net' &&
          options.servername === 'docs.wharfie.dev' &&
          options.headers.host === 'docs.wharfie.dev' &&
          options.rejectUnauthorized === true &&
          options.headers['accept-encoding'] === 'identity' &&
          options.agent === false,
      ),
    ).toBe(true);
    expect(report.contentSha256).toBe(contentSha256);
    expect(
      report.checks.filter((check) => check.kind === 'provider-rejection'),
    ).toEqual([
      {
        method: 'GET',
        path: '/%2e%2e/install?wharfie-docs-check=wharfie-private-query-probe',
        statusCode: 400,
        success: true,
        kind: 'provider-rejection',
      },
    ]);
    expect(report.checks.filter((check) => check.sha256)).toHaveLength(4);
    expect(JSON.stringify(report)).not.toContain(index.toString('utf8'));
  });

  it('does not follow an unexpected redirect or retain its target', async () => {
    const mock = transport({ redirect: true });
    const report = await verifyDocsSite(
      { url: 'https://d123.cloudfront.net/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(
      report.checks.some((check) => check.failure === 'unexpected-status'),
    ).toBe(true);
    expect(mock.calls).toHaveLength(37);
    expect(JSON.stringify(report)).not.toMatch(
      /evil\.example|private-location-detail/,
    );
  });

  it('requires the cutover no-store policy on HTML GET and HEAD responses', async () => {
    const mock = transport({ cacheable: true });
    const report = await verifyDocsSite(
      { url: 'https://docs.wharfie.dev/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(8);
    expect(
      report.checks
        .filter((check) => !check.success)
        .every((check) => check.failure === 'unexpected-cache-control'),
    ).toBe(true);
  });

  it('rejects compressed provider errors before checking for query reflection', async () => {
    const mock = transport({ compressedProvider: true });
    const report = await verifyDocsSite(
      { url: 'https://docs.wharfie.dev/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toEqual([
      {
        method: 'GET',
        path: '/%2e%2e/install?wharfie-docs-check=wharfie-private-query-probe',
        statusCode: 400,
        success: false,
        kind: 'provider-rejection',
        failure: 'unexpected-content-encoding',
      },
    ]);
  });

  it('destroys an oversized response, retains a bounded failure, and completes the other checks', async () => {
    const mock = transport({ oversize: true });
    const report = await verifyDocsSite(
      { url: 'https://d123.cloudfront.net/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toEqual([
      {
        method: 'GET',
        path: '/',
        statusCode: null,
        success: false,
        failure: 'response-too-large',
      },
    ]);
    expect(mock.responses.every((response) => response.destroyed)).toBe(true);
    expect(mock.calls).toHaveLength(37);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(16 * 1024);
  });

  it('bounds stalled requests by elapsed time and continues at most four at once', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const mock = transport({ stall: true });
    const pending = verifyDocsSite(
      { url: 'https://docs.wharfie.dev/', bundleDir },
      mock.request,
    );
    for (let i = 0; i < 100 && mock.calls.length === 0; i++)
      await new Promise(setImmediate);
    expect(mock.calls).toHaveLength(4);
    await jest.advanceTimersByTimeAsync(100_000);
    const report = await pending;

    expect(report.success).toBe(false);
    expect(
      report.checks.every((check) => check.failure === 'request-timeout'),
    ).toBe(true);
    expect(mock.peak()).toBe(4);
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(report)).not.toContain('private-abort-detail');
  });

  it('cleans deadlines after synchronous transport errors without exposing messages', async () => {
    jest.useFakeTimers();
    const mock = transport({ throwSynchronously: true });
    const report = await verifyDocsSite(
      { url: 'https://docs.wharfie.dev/', bundleDir },
      mock.request,
    );

    expect(
      report.checks.every((check) => check.failure === 'request-failed'),
    ).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(report)).not.toContain('private-transport-detail');
  });

  it('rejects unbound bytes and untrusted endpoint syntax before making requests', async () => {
    const mock = transport();
    for (const url of [
      'http://docs.wharfie.dev/',
      'https://user:secret@docs.wharfie.dev/',
      'https://docs.wharfie.dev/path',
      'https://docs.wharfie.dev/?token=secret',
      'https://docs.wharfie.dev.evil.example/',
      'https://d123.cloudfront.net:444/',
    ]) {
      await expect(
        verifyDocsSite({ url, bundleDir }, mock.request),
      ).rejects.toThrow();
    }
    await expect(
      verifyDocsSite(
        {
          url: 'https://docs.wharfie.dev/',
          connectHost: 'evil.example',
          bundleDir,
        },
        mock.request,
      ),
    ).rejects.toThrow();
    await expect(
      verifyDocsSite(
        {
          url: 'https://docs.wharfie.dev/',
          connectHost: 'd123.cloudfront.net\n',
          bundleDir,
        },
        mock.request,
      ),
    ).rejects.toThrow();
    await writeFile(path.join(bundleDir, 'index.html'), 'unreviewed content');
    await expect(
      verifyDocsSite(
        { url: 'https://docs.wharfie.dev/', bundleDir },
        mock.request,
      ),
    ).rejects.toThrow('Prepared manifest and landing page do not agree.');
    expect(mock.calls).toHaveLength(0);
  });
});
