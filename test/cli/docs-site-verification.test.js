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
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { gzipSync } from 'node:zlib';
import worker from '../../docs/site/_worker.js';
import { verifyDocsSite } from '../../scripts/verify-docs-site.js';

const index = Buffer.from(
  '<!doctype html><title>Reviewed Wharfie docs</title>',
);
const contentSha256 = createHash('sha256').update(index).digest('hex');

/** @param {Headers} headers @returns {Record<string, string>} */
function headerValues(headers) {
  const values = /** @type {Record<string, string>} */ ({});
  headers.forEach((value, name) => {
    values[name] = value;
  });
  return values;
}

describe('live docs verification transport and evidence', () => {
  let bundleDir = '';

  beforeEach(async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), 'wharfie-docs-verifier-'));
    await mkdir(path.join(bundleDir, 'site'));
    await writeFile(path.join(bundleDir, 'site', 'index.html'), index);
    await writeFile(
      path.join(bundleDir, 'manifest.json'),
      JSON.stringify({
        format: 'wharfie-docs-site',
        version: 2,
        provider: 'cloudflare-pages',
        deployDirectory: 'site',
        contentSha256,
        files: [
          {
            name: 'site/index.html',
            sha256: contentSha256,
            size: index.length,
          },
        ],
      }),
    );
  });

  afterEach(async () => {
    jest.useRealTimers();
    await rm(bundleDir, { recursive: true, force: true });
  });

  /** @param {{oversize?: boolean, redirect?: boolean, cacheable?: boolean, compressedNative?: boolean, badHeadLength?: boolean, nativeBody?: boolean, nativeHeaderLeak?: boolean, throwSynchronously?: boolean, stall?: boolean}} [fault] */
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
          setImmediate(async () => {
            try {
              const incoming = new Request(
                'https://wharfie-docs.pages.dev' + options.path,
                { method: options.method },
              );
              const pathname = new URL(incoming.url).pathname;
              const nativeMethod =
                pathname === '/' && !['GET', 'HEAD'].includes(options.method);
              const headers = {
                'content-type': 'text/html; charset=utf-8',
                'cache-control': 'no-store',
                'content-security-policy':
                  "default-src 'none'; frame-ancestors 'none'",
                'x-content-type-options': 'nosniff',
                'referrer-policy': 'no-referrer',
                'x-frame-options': 'DENY',
              };
              const env = {
                ASSETS: {
                  fetch: async (/** @type {Request} */ request) =>
                    new Response(request.method === 'HEAD' ? null : index, {
                      headers,
                    }),
                },
              };
              const routed = nativeMethod
                ? new Response(null, {
                    status: 405,
                    headers: { ...headers, 'content-type': '' },
                  })
                : pathname === '/'
                  ? await env.ASSETS.fetch(incoming)
                  : await worker.fetch(incoming, env);
              const responseHeaders = headerValues(routed.headers);
              if (nativeMethod) delete responseHeaders['content-type'];
              if (fault.cacheable && routed.status === 200)
                responseHeaders['cache-control'] = 'max-age=300';
              if (
                fault.badHeadLength &&
                routed.status === 200 &&
                options.method === 'HEAD'
              )
                responseHeaders['content-length'] = '99999';
              if (fault.compressedNative && nativeMethod)
                responseHeaders['content-encoding'] = 'gzip';
              if (fault.nativeHeaderLeak && nativeMethod)
                responseHeaders['x-probe'] = 'wharfie-private-query-probe';
              const response = Object.assign(new PassThrough(), {
                statusCode: routed.status,
                headers: responseHeaders,
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
              const body = Buffer.from(await routed.arrayBuffer());
              callback(response);
              response.end(
                fault.oversize &&
                  options.path === '/' &&
                  options.method === 'GET'
                  ? Buffer.alloc(256 * 1024 + 1, 65)
                  : nativeMethod && fault.compressedNative
                    ? gzipSync('wharfie-private-query-probe')
                    : nativeMethod && fault.nativeBody
                      ? 'unexpected native response'
                      : body,
              );
            } catch (error) {
              client.emit('error', error);
            }
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
        connectHost: 'wharfie-docs.pages.dev',
        bundleDir,
      },
      mock.request,
    );

    expect(report.success).toBe(true);
    expect(report.checks).toHaveLength(40);
    expect(mock.calls).toHaveLength(40);
    expect(mock.peak()).toBeLessThanOrEqual(4);
    expect(mock.peak()).toBeGreaterThan(1);
    expect(
      mock.calls.every(
        (options) =>
          options.hostname === 'wharfie-docs.pages.dev' &&
          options.servername === 'docs.wharfie.dev' &&
          options.headers.host === 'docs.wharfie.dev' &&
          options.rejectUnauthorized === true &&
          options.headers['accept-encoding'] === 'identity' &&
          options.agent === false,
      ),
    ).toBe(true);
    expect(report.contentSha256).toBe(contentSha256);
    expect(
      report.checks.filter((check) => check.kind === 'normalized-legacy-route'),
    ).toEqual([
      {
        method: 'GET',
        path: '/%2e%2e/install?wharfie-docs-check=wharfie-private-query-probe',
        statusCode: 302,
        success: true,
        kind: 'normalized-legacy-route',
      },
    ]);
    expect(report.checks.filter((check) => check.sha256)).toHaveLength(4);
    expect(JSON.stringify(report)).not.toContain(index.toString('utf8'));
  });

  it('does not follow an unexpected redirect or retain its target', async () => {
    const mock = transport({ redirect: true });
    const report = await verifyDocsSite(
      { url: 'https://wharfie-docs.pages.dev/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(
      report.checks.some((check) => check.failure === 'unexpected-status'),
    ).toBe(true);
    expect(mock.calls).toHaveLength(40);
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

  it('rejects compressed native method errors before accepting their empty-body contract', async () => {
    const mock = transport({ compressedNative: true });
    const report = await verifyDocsSite(
      { url: 'https://docs.wharfie.dev/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(2);
    expect(
      report.checks
        .filter((check) => !check.success)
        .every(
          (check) =>
            check.kind === 'native-static-method' &&
            check.statusCode === 405 &&
            check.failure === 'unexpected-content-encoding',
        ),
    ).toBe(true);
  });

  it('accepts omitted Pages HEAD lengths but rejects a conflicting supplied length', async () => {
    const mock = transport({ badHeadLength: true });
    const report = await verifyDocsSite(
      { url: 'https://abcd1234.wharfie-docs.pages.dev/', bundleDir },
      mock.request,
    );
    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(4);
    expect(
      report.checks
        .filter((check) => !check.success)
        .every((check) => check.failure === 'landing-length-mismatch'),
    ).toBe(true);
  });

  it('requires the native static method rejection body to be empty', async () => {
    const mock = transport({ nativeBody: true });
    const report = await verifyDocsSite(
      { url: 'https://wharfie-docs.pages.dev/', bundleDir },
      mock.request,
    );
    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(2);
    expect(
      report.checks
        .filter((check) => !check.success)
        .every((check) => check.failure === 'unexpected-native-method-body'),
    ).toBe(true);
  });

  it('rejects query reflection in native static response headers', async () => {
    const mock = transport({ nativeHeaderLeak: true });
    const report = await verifyDocsSite(
      { url: 'https://wharfie-docs.pages.dev/', bundleDir },
      mock.request,
    );
    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(2);
    expect(
      report.checks
        .filter((check) => !check.success)
        .every((check) => check.failure === 'reflected-query'),
    ).toBe(true);
  });

  it('destroys an oversized response, retains a bounded failure, and completes the other checks', async () => {
    const mock = transport({ oversize: true });
    const report = await verifyDocsSite(
      { url: 'https://wharfie-docs.pages.dev/', bundleDir },
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
    expect(mock.calls).toHaveLength(40);
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
      'https://wharfie-docs.pages.dev:444/',
      'https://d123.cloudfront.net/',
      'https://wharfie-docs.pages.dev.evil.example/',
      'https://one.two.wharfie-docs.pages.dev/',
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
          connectHost: 'wharfie-docs.pages.dev\n',
          bundleDir,
        },
        mock.request,
      ),
    ).rejects.toThrow();
    await writeFile(
      path.join(bundleDir, 'site', 'index.html'),
      'unreviewed content',
    );
    await expect(
      verifyDocsSite(
        { url: 'https://docs.wharfie.dev/', bundleDir },
        mock.request,
      ),
    ).rejects.toThrow('Prepared manifest and landing page do not agree.');
    expect(mock.calls).toHaveLength(0);
  });
});
