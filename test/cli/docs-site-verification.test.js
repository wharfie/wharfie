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
const reviewedCsp =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const rejectedPath =
  '/%2e%2e/install?wharfie-docs-check=wharfie-private-query-probe';
const providerBody =
  '<html>\r\n<head><title>400 Bad Request</title></head>\r\n<body>\r\n<center><h1>400 Bad Request</h1></center>\r\n<hr><center>cloudflare</center>\r\n</body>\r\n</html>\r\n';
/** @typedef {{status?: number, body?: string | Buffer, headers?: Record<string, string>}} ProviderFault */

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

  /** @param {{oversize?: boolean, redirect?: boolean, cacheable?: boolean, compressedNative?: boolean, badHeadLength?: boolean, nativeBody?: boolean, nativeHeaderLeak?: boolean, csp?: string, provider?: ProviderFault, throwSynchronously?: boolean, stall?: boolean}} [fault] */
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
              const providerRejection = options.path === rejectedPath;
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
                'content-security-policy': reviewedCsp,
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
              const routed = providerRejection
                ? new Response(providerBody, {
                    status: 400,
                    headers: {
                      server: 'cloudflare',
                      'content-type': 'text/html',
                      'content-length': '155',
                    },
                  })
                : nativeMethod
                  ? new Response(null, {
                      status: 405,
                      headers: { ...headers, 'content-type': '' },
                    })
                  : pathname === '/'
                    ? await env.ASSETS.fetch(incoming)
                    : await worker.fetch(incoming, env);
              const responseHeaders = headerValues(routed.headers);
              if (fault.csp !== undefined && !providerRejection)
                responseHeaders['content-security-policy'] = fault.csp;
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
              if (providerRejection && fault.provider) {
                response.statusCode = fault.provider.status ?? routed.status;
                Object.assign(response.headers, fault.provider.headers);
              }
              responses.push(response);
              response.once('close', () => {
                active--;
              });
              if (fault.redirect && calls.length === 4) {
                response.statusCode = 302;
                response.headers.location =
                  'https://evil.example/private-location-detail';
              }
              const body =
                providerRejection && fault.provider?.body !== undefined
                  ? fault.provider.body
                  : Buffer.from(await routed.arrayBuffer());
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
      report.checks.filter((check) => check.kind === 'provider-path-rejection'),
    ).toEqual([
      {
        method: 'GET',
        path: rejectedPath,
        statusCode: 400,
        success: true,
        kind: 'provider-path-rejection',
      },
    ]);
    expect(report.checks.filter((check) => check.sha256)).toHaveLength(4);
    expect(JSON.stringify(report)).not.toContain(index.toString('utf8'));
  });

  /** @type {Array<[string, ProviderFault, string]>} */
  const providerFailures = [
    [
      'a normalized Worker redirect instead of public edge rejection',
      {
        status: 302,
        headers: {
          location:
            'https://github.com/wharfie/wharfie/blob/master/docs/guides/installation.md',
        },
      },
      'unexpected-status',
    ],
    [
      'a redirect on the rejected request',
      { headers: { location: 'https://evil.example/' } },
      'unexpected-redirect',
    ],
    [
      'a refresh redirect on the rejected request',
      { headers: { refresh: '0; url=https://evil.example/' } },
      'unexpected-redirect',
    ],
    [
      'compression hiding reflected query bytes',
      {
        headers: { 'content-encoding': 'gzip' },
        body: gzipSync('wharfie-private-query-probe'),
      },
      'unexpected-content-encoding',
    ],
    [
      'reflected query bytes in the provider body',
      { body: 'wharfie-private-query-probe' },
      'reflected-query',
    ],
    [
      'reflected query bytes in provider headers',
      { headers: { 'x-probe': 'wharfie-private-query-probe' } },
      'reflected-query',
    ],
    [
      'executable HTML with the same byte length',
      { body: '<script>alert("unsafe-provider-body")</script>'.padEnd(155) },
      'unexpected-provider-body',
    ],
    [
      'an unexpected executable content type',
      { headers: { 'content-type': 'application/javascript' } },
      'unexpected-provider-headers',
    ],
    [
      'an unbounded provider error body',
      { body: Buffer.alloc(256 * 1024 + 1, 65) },
      'response-too-large',
    ],
  ];

  it.each(providerFailures)('rejects %s', async (_name, provider, failure) => {
    const mock = transport({ provider });
    const report = await verifyDocsSite(
      { url: 'https://wharfie-docs.pages.dev/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toEqual([
      {
        method: 'GET',
        path: rejectedPath,
        statusCode:
          failure === 'response-too-large' ? null : (provider.status ?? 400),
        success: false,
        kind: 'provider-path-rejection',
        failure,
      },
    ]);
    expect(mock.calls).toHaveLength(40);
    expect(JSON.stringify(report)).not.toMatch(
      /evil\.example|unsafe-provider-body|<html>/,
    );
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

  it.each([
    "default-src 'none'; frame-ancestors 'none'",
    reviewedCsp + "; script-src * 'unsafe-inline'",
    reviewedCsp.replace(
      "style-src 'unsafe-inline'",
      "style-src 'unsafe-inline' https://evil.example",
    ),
    reviewedCsp + '; style-src *',
    reviewedCsp.replace("base-uri 'none'; ", ''),
    reviewedCsp.replace(
      "style-src 'unsafe-inline'",
      "style-src\u00a0'unsafe-inline'",
    ),
  ])(
    'rejects CSP that changes or weakens the reviewed policy: %s',
    async (csp) => {
      const mock = transport({ csp });
      const report = await verifyDocsSite(
        { url: 'https://wharfie-docs.pages.dev/', bundleDir },
        mock.request,
      );

      expect(report.success).toBe(false);
      expect(report.checks).toHaveLength(40);
      expect(report.checks.filter((check) => !check.success)).toHaveLength(39);
      expect(
        report.checks
          .filter((check) => check.kind !== 'provider-path-rejection')
          .every(
            (check) => check.failure === 'missing-content-security-policy',
          ),
      ).toBe(true);
    },
  );

  it('accepts only directive ordering and ASCII spacing variations of the full reviewed CSP', async () => {
    const mock = transport({
      csp: " frame-ancestors   'none' ;\tform-action 'none'; base-uri 'none'; style-src 'unsafe-inline'; default-src 'none' ; ",
    });
    const report = await verifyDocsSite(
      { url: 'https://wharfie-docs.pages.dev/', bundleDir },
      mock.request,
    );

    expect(report.success).toBe(true);
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
