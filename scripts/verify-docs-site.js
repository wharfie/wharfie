import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 256 * 1024;
const QUERY = '?wharfie-docs-check=wharfie-private-query-probe';
const PUBLIC_URL = 'https://docs.wharfie.dev/';
const ORIGIN_URL =
  'http://wharfie-docs-411430101559-us-east-1.s3-website-us-east-1.amazonaws.com/';

/** @typedef {{method: string, path: string, status: number, document: 'index.html' | '404.html', privateRelease?: boolean}} Check */
/** @typedef {{statusCode: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer}} Response */
/** @typedef {{url: string, bundleDir: string}} Options */
/** @typedef {{sha256: string, size: number}} Reference */

/**
 * Read a bounded reference file before making any network requests.
 * @param {string} file - Exact local reference path.
 * @param {number} limit - Maximum bytes.
 * @returns {Promise<Buffer>} Reference bytes.
 */
async function readBounded(file, limit) {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size <= limit) {
      const { bytesRead } = await handle.read(
        buffer,
        size,
        buffer.length - size,
        null,
      );
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    assert.ok(size <= limit, 'Reference file exceeds limit.');
    return buffer.subarray(0, size);
  } finally {
    await handle.close();
  }
}

/**
 * Request a fixed public route without redirects, decompression, or credentials.
 * @param {URL} url - Validated docs HTTPS or public S3 website HTTP endpoint.
 * @param {Check} check - Fixed request route.
 * @param {typeof https.request} request - Injectable transport.
 * @returns {Promise<Response>} Bounded response.
 */
async function fetchResponse(url, check, request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const response = await new Promise((resolve, reject) => {
      const req = request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.protocol === 'https:' ? 443 : 80,
          ...(url.protocol === 'https:'
            ? { servername: url.hostname, rejectUnauthorized: true }
            : {}),
          method: check.method,
          path: check.path,
          headers: { host: url.hostname, 'accept-encoding': 'identity' },
          agent: false,
          signal: abort.signal,
        },
        resolve,
      );
      req.on('error', reject);
      req.end();
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of response) {
      size += chunk.length;
      if (size > MAX_BODY) throw new Error('response-too-large');
      chunks.push(chunk);
    }
    return {
      statusCode: response.statusCode ?? 0,
      headers: response.headers,
      body: Buffer.concat(chunks),
    };
  } catch (error) {
    if (abort.signal.aborted) throw new Error('request-timeout');
    if (error instanceof Error && error.message === 'response-too-large')
      throw error;
    throw new Error('request-failed');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param {string} releaseKey - Bound, private release object.
 * @returns {Check[]} Finite static website acceptance routes.
 */
function routes(releaseKey) {
  const checks = /** @type {Check[]} */ ([]);
  for (const uri of ['/', '/index.html']) {
    for (const method of ['GET', 'HEAD']) {
      for (const query of ['', QUERY])
        checks.push({
          method,
          path: uri + query,
          status: 200,
          document: 'index.html',
        });
    }
  }
  for (const method of ['GET', 'HEAD'])
    checks.push({
      method,
      path: '/404.html',
      status: 200,
      document: '404.html',
    });
  for (const uri of ['/install', '/quickstart', '/project-structure']) {
    for (const suffix of ['', '/', '.html'])
      checks.push({
        method: 'GET',
        path: uri + suffix + QUERY,
        status: 403,
        document: '404.html',
      });
  }
  for (const uri of ['/install.sh', '/install.ps1']) {
    for (const method of ['GET', 'HEAD'])
      checks.push({
        method,
        path: uri + QUERY,
        status: 403,
        document: '404.html',
      });
  }
  for (const uri of ['/unknown', '/quickstart/child', '/install.sh/extra'])
    checks.push({
      method: 'GET',
      path: uri + QUERY,
      status: 403,
      document: '404.html',
    });
  for (const method of ['GET', 'HEAD'])
    checks.push({
      method,
      path: '/' + releaseKey + QUERY,
      status: 403,
      document: '404.html',
      privateRelease: true,
    });
  return checks;
}

/**
 * Validate public semantics without retaining remote bodies or headers.
 * @param {Check} check - Expected static route contract.
 * @param {Response} response - Bounded public response.
 * @param {Reference} reference - Prepared document identity.
 * @returns {string | undefined} Fixed failure code, if any.
 */
function failureCode(check, response, reference) {
  const { statusCode, headers, body } = response;
  if (statusCode !== check.status) return 'unexpected-status';
  if (headers.location !== undefined || headers.refresh !== undefined)
    return 'unexpected-redirect';
  if (headers['content-encoding'] && headers['content-encoding'] !== 'identity')
    return 'unexpected-content-encoding';
  if (
    (body.toString('utf8') + JSON.stringify(headers)).includes(
      'wharfie-private-query-probe',
    )
  )
    return 'reflected-query';
  if (check.method === 'HEAD') {
    if (body.length !== 0) return 'unexpected-head-body';
    // S3 may omit object metadata when rejecting a HEAD request.
    if (check.status !== 200) return;
    if (headers['content-length'] !== String(reference.size))
      return 'document-length-mismatch';
  }
  const contentType = headers['content-type']?.toLowerCase();
  if (
    contentType !== 'text/html; charset=utf-8' &&
    !(check.status !== 200 && contentType === 'text/html')
  )
    return 'unexpected-content-type';
  if (
    (check.status === 200 || headers['cache-control'] !== undefined) &&
    headers['cache-control'] !== 'no-store'
  )
    return 'unexpected-cache-control';
  if (
    check.method === 'GET' &&
    createHash('sha256').update(body).digest('hex') !== reference.sha256
  )
    return 'document-hash-mismatch';
}

/**
 * Verify both prepared HTML documents with at most four concurrent requests.
 * @param {Options} options - Exact public endpoint and prepared bundle.
 * @param {typeof https.request} [request] - Transport for focused tests.
 * @returns {Promise<{success: boolean, checks: any[], [key: string]: unknown}>} Bounded, body-free report.
 */
export async function verifyDocsSite(options, request) {
  const url = new URL(options.url);
  assert.ok(
    options.url === options.url.trim() &&
      [PUBLIC_URL, ORIGIN_URL].includes(url.href) &&
      !Object.hasOwn(options, 'connectHost'),
    'Use only the docs HTTPS root or controlled S3 website HTTP root.',
  );
  const manifest = JSON.parse(
    (
      await readBounded(
        path.join(options.bundleDir, 'manifest.json'),
        64 * 1024,
      )
    ).toString('utf8'),
  );
  assert.ok(
    manifest.format === 'wharfie-docs-site' &&
      manifest.version === 2 &&
      manifest.provider === 's3-website' &&
      Array.isArray(manifest.files),
    'Expected a prepared S3 website manifest.',
  );
  const references = /** @type {Record<string, Reference>} */ ({});
  for (const name of ['index.html', '404.html']) {
    const bytes = await readBounded(
      path.join(options.bundleDir, name),
      MAX_BODY,
    );
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const entries = manifest.files.filter(
      (/** @type {{name?: string}} */ file) => file.name === name,
    );
    assert.ok(
      entries.length === 1 &&
        entries[0].sha256 === sha256 &&
        entries[0].size === bytes.length,
      'Prepared manifest and HTML documents do not agree.',
    );
    references[name] = { sha256, size: bytes.length };
  }
  assert.equal(
    manifest.contentSha256,
    references['index.html'].sha256,
    'Prepared index hash does not agree.',
  );
  assert.equal(
    manifest.releaseKey,
    'releases/' + references['index.html'].sha256 + '/index.html',
    'Prepared private release key does not agree.',
  );
  const startedAt = new Date().toISOString();
  const checks = routes(manifest.releaseKey);
  const results = new Array(checks.length);
  const transport =
    request ?? (url.protocol === 'https:' ? https.request : http.request);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < checks.length) {
        const position = next++;
        const check = checks[position];
        let response;
        let failure;
        try {
          response = await fetchResponse(url, check, transport);
          failure = failureCode(check, response, references[check.document]);
        } catch (error) {
          failure =
            error instanceof Error &&
            ['request-timeout', 'response-too-large'].includes(error.message)
              ? error.message
              : 'request-failed';
        }
        results[position] = {
          method: check.method,
          path: check.path,
          statusCode: response?.statusCode ?? null,
          success: !failure,
          ...(check.privateRelease ? { kind: 'private-release' } : {}),
          ...(failure ? { failure } : {}),
          ...(response && check.method === 'GET'
            ? {
                sha256: createHash('sha256')
                  .update(response.body)
                  .digest('hex'),
              }
            : {}),
        };
      }
    }),
  );
  return {
    format: 'wharfie-docs-site-verification',
    version: 2,
    provider: 's3-website',
    url: url.href,
    contentSha256: references['index.html'].sha256,
    errorSha256: references['404.html'].sha256,
    startedAt,
    finishedAt: new Date().toISOString(),
    success: results.every((result) => result.success),
    checks: results,
  };
}

/** @returns {Promise<void>} Report all outcomes and optionally retain a new private JSON file. */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(
      'Usage: node scripts/verify-docs-site.js --url <docs-https-or-controlled-s3-http-root> --bundle-dir <prepared-directory> [--output <new-report.json>]\n',
    );
    return;
  }
  const values = /** @type {Record<string, string>} */ ({});
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    assert.ok(
      ['--url', '--bundle-dir', '--output'].includes(flag) &&
        !Object.hasOwn(values, flag) &&
        args[i + 1] &&
        !args[i + 1].startsWith('--'),
      'Unknown, repeated, or incomplete verification option.',
    );
    values[flag] = args[i + 1];
  }
  assert.ok(
    values['--url'] && values['--bundle-dir'],
    'URL and prepared bundle are required.',
  );
  const report = await verifyDocsSite({
    url: values['--url'],
    bundleDir: values['--bundle-dir'],
  });
  const json = JSON.stringify(report, null, 2) + '\n';
  if (values['--output'])
    await writeFile(values['--output'], json, { flag: 'wx', mode: 0o600 });
  process.stdout.write(json);
  if (!report.success) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch(() => {
    process.stderr.write(
      'Documentation verification could not complete; check the endpoint, prepared bundle, and report path.\n',
    );
    process.exitCode = 1;
  });
}
