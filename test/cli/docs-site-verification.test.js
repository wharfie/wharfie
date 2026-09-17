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
import { gzipSync } from 'node:zlib';
import { verifyDocsSite } from '../../scripts/verify-docs-site.js';

const PUBLIC_URL = 'https://docs.wharfie.dev/';
const ORIGIN_URL =
  'http://wharfie-docs-411430101559-us-east-1.s3-website-us-east-1.amazonaws.com/';
const index = Buffer.from(
  '<!doctype html><title>Reviewed Wharfie docs</title>',
);
const errorPage = Buffer.from(
  '<!doctype html><title>Unavailable</title><a href="https://docs.wharfie.dev/">Current docs</a>',
);
const contentSha256 = createHash('sha256').update(index).digest('hex');
const errorSha256 = createHash('sha256').update(errorPage).digest('hex');
const releaseKey = 'releases/' + contentSha256 + '/index.html';
const QUERY = '?wharfie-docs-check=wharfie-private-query-probe';
/** @typedef {{statusCode: number, headers: Record<string, string>, body: Buffer}} Response */
/** @typedef {{mutate?: (options: any, response: Response) => void, throwSynchronously?: boolean, stall?: boolean}} Fault */

describe('S3 static docs verification transport and evidence', () => {
  let bundleDir = '';

  beforeEach(async () => {
    bundleDir = await mkdtemp(path.join(os.tmpdir(), 'wharfie-docs-verifier-'));
    await writeFile(path.join(bundleDir, 'index.html'), index);
    await writeFile(path.join(bundleDir, '404.html'), errorPage);
    await writeFile(
      path.join(bundleDir, 'manifest.json'),
      JSON.stringify({
        format: 'wharfie-docs-site',
        version: 2,
        provider: 's3-website',
        contentSha256,
        releaseKey,
        files: [
          { name: 'index.html', sha256: contentSha256, size: index.length },
          { name: '404.html', sha256: errorSha256, size: errorPage.length },
        ],
      }),
    );
  });

  afterEach(async () => {
    jest.useRealTimers();
    await rm(bundleDir, { recursive: true, force: true });
  });

  /** @param {Fault} [fault] */
  function transport(fault = {}) {
    let active = 0;
    let peak = 0;
    let markFirstBatchStarted = () => {};
    const firstBatchStarted = new Promise((resolve) => {
      markFirstBatchStarted = () => resolve(undefined);
    });
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
          if (active === 4) markFirstBatchStarted();
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
            const pathname = options.path.split('?')[0];
            const landing = pathname === '/' || pathname === '/index.html';
            const allowed = landing || pathname === '/404.html';
            const document = landing ? index : errorPage;
            const head = options.method === 'HEAD';
            // Exact public objects have upload metadata. S3 errors may omit it.
            const model = /** @type {Response} */ ({
              statusCode: allowed ? 200 : 403,
              headers: allowed
                ? {
                    'content-type': 'text/html; charset=utf-8',
                    'content-length': String(document.length),
                    'cache-control': 'no-store',
                  }
                : head
                  ? {}
                  : { 'content-type': 'text/html' },
              body: head ? Buffer.alloc(0) : document,
            });
            fault.mutate?.(options, model);
            const response = Object.assign(new PassThrough(), {
              statusCode: model.statusCode,
              headers: model.headers,
            });
            responses.push(response);
            response.once('close', () => {
              active--;
            });
            callback(response);
            response.end(model.body);
          });
        },
      });
    };
    return {
      request: /** @type {typeof import('node:https').request} */ (fakeRequest),
      calls,
      responses,
      firstBatchStarted,
      peak: () => peak,
    };
  }

  it.each([PUBLIC_URL, ORIGIN_URL])(
    'binds both HTML documents at the exact endpoint %s',
    async (url) => {
      const mock = transport();
      const report = await verifyDocsSite({ url, bundleDir }, mock.request);
      const endpoint = new URL(url);

      expect(report.success).toBe(true);
      expect(report.provider).toBe('s3-website');
      expect(report.contentSha256).toBe(contentSha256);
      expect(report.errorSha256).toBe(errorSha256);
      expect(report.checks).toHaveLength(28);
      expect(mock.calls).toHaveLength(28);
      expect(mock.peak()).toBeLessThanOrEqual(4);
      expect(mock.peak()).toBeGreaterThan(1);
      for (const options of mock.calls) {
        expect(options.hostname).toBe(endpoint.hostname);
        expect(options.protocol).toBe(endpoint.protocol);
        expect(options.port).toBe(endpoint.protocol === 'https:' ? 443 : 80);
        expect(options.headers).toEqual({
          host: endpoint.hostname,
          'accept-encoding': 'identity',
        });
        expect(options.agent).toBe(false);
        if (endpoint.protocol === 'https:') {
          expect(options.servername).toBe(endpoint.hostname);
          expect(options.rejectUnauthorized).toBe(true);
        } else {
          expect(options.servername).toBeUndefined();
          expect(options.rejectUnauthorized).toBeUndefined();
        }
      }
      expect(
        report.checks.filter((check) => check.kind === 'private-release'),
      ).toHaveLength(2);
      expect(
        report.checks
          .filter((check) => check.kind === 'private-release')
          .every((check) => check.statusCode === 403),
      ).toBe(true);
      expect(
        report.checks
          .filter((check) => check.path === '/404.html')
          .every((check) => check.statusCode === 200),
      ).toBe(true);
      expect(
        report.checks.filter((check) => check.sha256 === contentSha256),
      ).toHaveLength(4);
      expect(
        report.checks.filter((check) => check.sha256 === errorSha256),
      ).toHaveLength(16);
      expect(JSON.stringify(report)).not.toContain('<!doctype html>');
    },
  );

  it('does not follow redirects or retain remote targets', async () => {
    const mock = transport({
      mutate(options, response) {
        if (options.path === '/' && options.method === 'GET') {
          response.statusCode = 302;
          response.headers.location = 'https://evil.example/private-redirect';
        }
      },
    });
    const report = await verifyDocsSite(
      { url: PUBLIC_URL, bundleDir },
      mock.request,
    );
    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(1);
    expect(report.checks.find((check) => !check.success).failure).toBe(
      'unexpected-status',
    );
    expect(mock.calls).toHaveLength(28);
    expect(JSON.stringify(report)).not.toMatch(/evil.example|private-redirect/);
  });

  /** @type {Array<[string, (response: Response) => void, string]>} */
  const unsafeResponses = [
    [
      'an installer served successfully',
      (response) => {
        response.statusCode = 200;
      },
      'unexpected-status',
    ],
    [
      'an executable installer body',
      (response) => {
        response.body = Buffer.from('#!/bin/sh\necho unsafe-installer');
      },
      'document-hash-mismatch',
    ],
    [
      'a reflected query body',
      (response) => {
        response.body = Buffer.from('wharfie-private-query-probe');
      },
      'reflected-query',
    ],
    [
      'reflected query headers',
      (response) => {
        response.headers['x-probe'] = 'wharfie-private-query-probe';
      },
      'reflected-query',
    ],
    [
      'compressed query reflection',
      (response) => {
        response.headers['content-encoding'] = 'gzip';
        response.body = gzipSync('wharfie-private-query-probe');
      },
      'unexpected-content-encoding',
    ],
    [
      'an error redirect',
      (response) => {
        response.headers.location = 'https://evil.example/';
      },
      'unexpected-redirect',
    ],
    [
      'an error refresh',
      (response) => {
        response.headers.refresh = '0; url=https://evil.example/';
      },
      'unexpected-redirect',
    ],
  ];
  it.each(unsafeResponses)('rejects %s', async (_name, mutate, failure) => {
    const mock = transport({
      mutate(options, response) {
        if (options.path === '/install.sh' + QUERY && options.method === 'GET')
          mutate(response);
      },
    });
    const report = await verifyDocsSite(
      { url: PUBLIC_URL, bundleDir },
      mock.request,
    );
    expect(report.success).toBe(false);
    expect(report.checks.filter((check) => !check.success)).toHaveLength(1);
    expect(report.checks.find((check) => !check.success).failure).toBe(failure);
    expect(JSON.stringify(report)).not.toMatch(/unsafe-installer|evil.example/);
  });

  it.each([200, 404])(
    'rejects private release status %s instead of the access-denied contract',
    async (statusCode) => {
      const mock = transport({
        mutate(options, response) {
          if (options.path.startsWith('/releases/'))
            response.statusCode = statusCode;
        },
      });
      const report = await verifyDocsSite(
        { url: PUBLIC_URL, bundleDir },
        mock.request,
      );
      expect(report.success).toBe(false);
      expect(report.checks.filter((check) => !check.success)).toHaveLength(2);
      expect(
        report.checks
          .filter((check) => !check.success)
          .every(
            (check) =>
              check.kind === 'private-release' &&
              check.failure === 'unexpected-status',
          ),
      ).toBe(true);
    },
  );

  /** @type {Array<[string, (response: Response) => void, string]>} */
  const invalidObjects = [
    [
      'changed landing bytes',
      (response) => {
        response.body = Buffer.from('unreviewed');
      },
      'document-hash-mismatch',
    ],
    [
      'cacheable objects',
      (response) => {
        response.headers['cache-control'] = 'max-age=300';
      },
      'unexpected-cache-control',
    ],
    [
      'missing no-store metadata',
      (response) => {
        delete response.headers['cache-control'];
      },
      'unexpected-cache-control',
    ],
    [
      'a non-HTML type',
      (response) => {
        response.headers['content-type'] = 'application/javascript';
      },
      'unexpected-content-type',
    ],
  ];
  it.each(invalidObjects)(
    'rejects %s on successful objects',
    async (_name, mutate, failure) => {
      const mock = transport({
        mutate(options, response) {
          if (options.path === '/' && options.method === 'GET')
            mutate(response);
        },
      });
      const report = await verifyDocsSite(
        { url: PUBLIC_URL, bundleDir },
        mock.request,
      );
      expect(report.checks.filter((check) => !check.success)).toHaveLength(1);
      expect(report.checks.find((check) => !check.success).failure).toBe(
        failure,
      );
    },
  );

  it('requires successful HEAD lengths but tolerates absent error metadata', async () => {
    const mock = transport({
      mutate(options, response) {
        if (options.path === '/' && options.method === 'HEAD')
          response.headers['content-length'] = '99999';
      },
    });
    const report = await verifyDocsSite(
      { url: ORIGIN_URL, bundleDir },
      mock.request,
    );
    expect(report.checks.filter((check) => !check.success)).toHaveLength(1);
    expect(report.checks.find((check) => !check.success).failure).toBe(
      'document-length-mismatch',
    );
    expect(
      report.checks
        .filter((check) => check.method === 'HEAD' && check.statusCode === 403)
        .every((check) => check.success),
    ).toBe(true);
  });

  it('rejects unexpected bodies on HEAD error responses', async () => {
    const mock = transport({
      mutate(options, response) {
        if (options.method === 'HEAD' && response.statusCode === 403)
          response.body = errorPage;
      },
    });
    const report = await verifyDocsSite(
      { url: PUBLIC_URL, bundleDir },
      mock.request,
    );
    expect(report.checks.filter((check) => !check.success)).toHaveLength(3);
    expect(
      report.checks
        .filter((check) => !check.success)
        .every((check) => check.failure === 'unexpected-head-body'),
    ).toBe(true);
  });

  it('destroys oversized responses and retains a bounded failure while completing other checks', async () => {
    const mock = transport({
      mutate(options, response) {
        if (options.path === '/' && options.method === 'GET')
          response.body = Buffer.alloc(256 * 1024 + 1, 65);
      },
    });
    const report = await verifyDocsSite(
      { url: PUBLIC_URL, bundleDir },
      mock.request,
    );
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
    expect(mock.calls).toHaveLength(28);
    expect(Buffer.byteLength(JSON.stringify(report))).toBeLessThan(16 * 1024);
  });

  it('bounds stalled requests with an explicit first-batch readiness signal', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const mock = transport({ stall: true });
    const pending = verifyDocsSite(
      { url: PUBLIC_URL, bundleDir },
      mock.request,
    );
    await Promise.race([mock.firstBatchStarted, pending]);
    expect(mock.calls).toHaveLength(4);
    await jest.advanceTimersByTimeAsync(70_000);
    const report = await pending;
    expect(report.success).toBe(false);
    expect(
      report.checks.every((check) => check.failure === 'request-timeout'),
    ).toBe(true);
    expect(mock.peak()).toBe(4);
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(report)).not.toContain('private-abort-detail');
  });

  it('cleans deadlines after synchronous errors without exposing messages', async () => {
    jest.useFakeTimers();
    const mock = transport({ throwSynchronously: true });
    const report = await verifyDocsSite(
      { url: PUBLIC_URL, bundleDir },
      mock.request,
    );
    expect(
      report.checks.every((check) => check.failure === 'request-failed'),
    ).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(report)).not.toContain('private-transport-detail');
  });

  it('rejects other origins, credentials, and route input before network requests', async () => {
    const mock = transport();
    for (const url of [
      'http://docs.wharfie.dev/',
      'https://user:secret@docs.wharfie.dev/',
      'https://docs.wharfie.dev/path',
      'https://docs.wharfie.dev/?token=secret',
      'https://docs.wharfie.dev.evil.example/',
      'https://docs.wharfie.dev:444/',
      'https://d123.cloudfront.net/',
      'https://wharfie-docs.pages.dev/',
      ORIGIN_URL.replace('http:', 'https:'),
      ORIGIN_URL.replace('411430101559', '111111111111'),
      ORIGIN_URL.replace('us-east-1.amazonaws', 'us-west-2.amazonaws'),
      ORIGIN_URL + '?secret=value',
      PUBLIC_URL + '#fragment',
      ' ' + PUBLIC_URL,
    ])
      await expect(
        verifyDocsSite({ url, bundleDir }, mock.request),
      ).rejects.toThrow();
    await expect(
      verifyDocsSite(
        /** @type {any} */ ({
          url: PUBLIC_URL,
          bundleDir,
          connectHost: 'd123.cloudfront.net',
        }),
        mock.request,
      ),
    ).rejects.toThrow();
    expect(mock.calls).toHaveLength(0);
  });

  it.each(['index.html', '404.html'])(
    'rejects unbound local %s before network requests',
    async (name) => {
      const mock = transport();
      await writeFile(path.join(bundleDir, name), 'unreviewed bytes');
      await expect(
        verifyDocsSite({ url: PUBLIC_URL, bundleDir }, mock.request),
      ).rejects.toThrow('Prepared manifest and HTML documents do not agree.');
      expect(mock.calls).toHaveLength(0);
    },
  );

  it('rejects duplicate document entries and arbitrary private probe keys', async () => {
    const manifestPath = path.join(bundleDir, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const mock = transport();
    manifest.files.push(manifest.files[1]);
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(
      verifyDocsSite({ url: PUBLIC_URL, bundleDir }, mock.request),
    ).rejects.toThrow('Prepared manifest and HTML documents do not agree.');
    manifest.files.pop();
    manifest.releaseKey = 'private-credential?token=secret';
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(
      verifyDocsSite({ url: PUBLIC_URL, bundleDir }, mock.request),
    ).rejects.toThrow('Prepared private release key does not agree.');
    expect(mock.calls).toHaveLength(0);
  });
});
