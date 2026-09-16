import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, writeFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BODY = 256 * 1024;
const QUERY = '?wharfie-docs-check=wharfie-private-query-probe';
const GUIDES = 'https://github.com/wharfie/wharfie/blob/master/docs/guides/';
const PAGES = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,2}pages\.dev$/u;

/** @typedef {{method: string, path: string, status: number, guide?: string, nativeMethod?: boolean, normalizedLegacy?: boolean}} Check */
/** @typedef {{statusCode: number, headers: import('node:http').IncomingHttpHeaders, body: Buffer}} Response */
/** @typedef {{url: string, bundleDir: string, connectHost?: string}} Options */

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
 * Perform one HTTPS request without redirects, decompression, or credential input.
 * @param {URL} url - Validated public URL.
 * @param {string} connectHost - Validated TCP destination.
 * @param {Check} check - Fixed request route.
 * @param {typeof https.request} request - Injectable HTTPS transport.
 * @returns {Promise<Response>} Bounded response.
 */
async function fetchResponse(url, connectHost, check, request) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 10_000);
  try {
    const response = await new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: connectHost,
          servername: url.hostname,
          port: 443,
          method: check.method,
          path: check.path,
          headers: { host: url.hostname, 'accept-encoding': 'identity' },
          rejectUnauthorized: true,
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
 * Construct a fixed, finite public route acceptance set.
 * @returns {Check[]} GET/HEAD and method-control checks.
 */
function routes() {
  const checks = [];
  for (const uri of ['/', '/index.html']) {
    for (const method of ['GET', 'HEAD']) {
      for (const query of ['', QUERY])
        checks.push({ method, path: uri + query, status: 200 });
    }
  }
  for (const [uri, guide] of [
    ['/install', 'installation.md'],
    ['/quickstart', 'recipient-preview.md'],
    ['/project-structure', 'application-structure.md'],
  ]) {
    for (const suffix of ['', '/', '.html']) {
      for (const query of ['', QUERY])
        checks.push({
          method: 'GET',
          path: uri + suffix + query,
          status: 302,
          guide,
        });
    }
  }
  for (const uri of ['/install.sh', '/install.ps1']) {
    for (const method of ['GET', 'HEAD'])
      checks.push({ method, path: uri + QUERY, status: 410 });
  }
  for (const uri of [
    '/unknown',
    '/quickstart/child',
    '/install.sh/extra',
    '/%69ndex.html',
    '/unknown' + QUERY,
  ]) {
    checks.push({ method: 'GET', path: uri, status: 404 });
  }
  checks.push({
    method: 'GET',
    path: '/%2e%2e/install' + QUERY,
    status: 302,
    guide: 'installation.md',
    normalizedLegacy: true,
  });
  for (const method of ['POST', 'OPTIONS']) {
    checks.push({ method, path: '/' + QUERY, status: 405, nativeMethod: true });
  }
  for (const uri of ['/index.html', '/install']) {
    checks.push({ method: 'POST', path: uri + QUERY, status: 405 });
  }
  return checks;
}

/**
 * Check public response semantics without retaining response bodies.
 * @param {Check} check - Expected route contract.
 * @param {Response} response - Bounded HTTPS response.
 * @param {string} expectedHash - Prepared landing page SHA-256.
 * @param {number} expectedSize - Prepared landing page byte length.
 * @returns {string | undefined} Fixed failure code, if any.
 */
function failureCode(check, response, expectedHash, expectedSize) {
  const { statusCode, headers, body } = response;
  if (statusCode !== check.status) return 'unexpected-status';
  if (headers['content-encoding'] && headers['content-encoding'] !== 'identity')
    return 'unexpected-content-encoding';
  if (
    (body.toString('utf8') + JSON.stringify(headers)).includes(
      'wharfie-private-query-probe',
    )
  )
    return 'reflected-query';
  if (headers['x-content-type-options'] !== 'nosniff') return 'missing-nosniff';
  if (headers['cache-control'] !== 'no-store')
    return 'unexpected-cache-control';
  const csp = headers['content-security-policy'];
  if (
    typeof csp !== 'string' ||
    !csp.includes("default-src 'none'") ||
    !csp.includes("frame-ancestors 'none'")
  )
    return 'missing-content-security-policy';
  if (
    headers['referrer-policy'] !== 'no-referrer' ||
    headers['x-frame-options'] !== 'DENY'
  )
    return 'missing-security-headers';
  if (check.nativeMethod) {
    if (headers.location !== undefined) return 'unexpected-redirect';
    if (body.length !== 0) return 'unexpected-native-method-body';
    if (headers.allow !== undefined && headers.allow !== 'GET, HEAD')
      return 'unexpected-allow';
    return;
  }
  const contentType =
    check.status === 200
      ? 'text/html; charset=utf-8'
      : 'text/plain; charset=utf-8';
  if (headers['content-type']?.toLowerCase() !== contentType)
    return 'unexpected-content-type';
  if (check.method === 'HEAD' && body.length !== 0)
    return 'unexpected-head-body';
  if (check.status === 200) {
    if (
      check.method === 'GET' &&
      createHash('sha256').update(body).digest('hex') !== expectedHash
    )
      return 'landing-hash-mismatch';
    if (
      check.method === 'HEAD' &&
      headers['content-length'] !== undefined &&
      headers['content-length'] !== String(expectedSize)
    )
      return 'landing-length-mismatch';
  } else {
    const text = body.toString('utf8');
    if (check.status === 302 && headers.location !== GUIDES + check.guide)
      return 'unexpected-redirect';
    if (check.status !== 302 && headers.location !== undefined)
      return 'unexpected-redirect';
    if (
      check.status === 410 &&
      check.method === 'GET' &&
      text !==
        'This installer has been retired.\nCurrent installation guide: ' +
          GUIDES +
          'installation.md\n'
    )
      return 'unsafe-installer-response';
    if (check.status === 404 && !text.includes('https://docs.wharfie.dev/'))
      return 'missing-current-docs-link';
    if (check.status === 405 && headers.allow !== 'GET, HEAD')
      return 'unexpected-allow';
  }
}

/**
 * Verify the prepared artifact against a live HTTPS endpoint with four workers.
 * @param {Options} options - Fixed serving endpoint and prepared bundle.
 * @param {typeof https.request} [request] - HTTPS transport for focused tests.
 * @returns {Promise<{success: boolean, checks: any[], [key: string]: unknown}>} Bounded, body-free acceptance report.
 */
export async function verifyDocsSite(options, request = https.request) {
  const url = new URL(options.url);
  assert.ok(
    url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      (url.hostname === 'docs.wharfie.dev' || PAGES.test(url.hostname)),
    'Use the exact HTTPS docs or Pages root URL.',
  );
  assert.ok(
    !options.connectHost ||
      (PAGES.test(options.connectHost) &&
        options.connectHost === options.connectHost.trim()),
    'Connect host must be a Pages deployment hostname.',
  );
  const manifest = JSON.parse(
    (
      await readBounded(
        path.join(options.bundleDir, 'manifest.json'),
        64 * 1024,
      )
    ).toString('utf8'),
  );
  const index = await readBounded(
    path.join(options.bundleDir, 'site', 'index.html'),
    MAX_BODY,
  );
  const contentSha256 = createHash('sha256').update(index).digest('hex');
  const indexEntries = manifest.files?.filter(
    (/** @type {{name?: string}} */ file) => file.name === 'site/index.html',
  );
  assert.ok(
    manifest.format === 'wharfie-docs-site' &&
      manifest.version === 2 &&
      manifest.provider === 'cloudflare-pages' &&
      manifest.deployDirectory === 'site' &&
      manifest.contentSha256 === contentSha256 &&
      indexEntries?.length === 1 &&
      indexEntries[0].sha256 === contentSha256 &&
      indexEntries[0].size === index.length,
    'Prepared manifest and landing page do not agree.',
  );
  const startedAt = new Date().toISOString();
  const checks = routes();
  const results = new Array(checks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < checks.length) {
        const position = next++;
        const check = checks[position];
        let response;
        let failure;
        try {
          response = await fetchResponse(
            url,
            options.connectHost ?? url.hostname,
            check,
            request,
          );
          failure = failureCode(check, response, contentSha256, index.length);
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
          ...(check.nativeMethod ? { kind: 'native-static-method' } : {}),
          ...(check.normalizedLegacy
            ? { kind: 'normalized-legacy-route' }
            : {}),
          ...(failure ? { failure } : {}),
          ...(response && check.method === 'GET' && check.status === 200
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
    provider: 'cloudflare-pages',
    url: url.href,
    connectHost: options.connectHost ?? null,
    contentSha256,
    startedAt,
    finishedAt: new Date().toISOString(),
    success: results.every((result) => result.success),
    checks: results,
  };
}

/**
 * Parse a finite CLI argument set and retain an optional exclusive report.
 * @returns {Promise<void>} Completion after reporting every route outcome.
 */
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(
      'Usage: node scripts/verify-docs-site.js --url https://docs.wharfie.dev --bundle-dir <prepared-directory> [--connect-host <project>.pages.dev] [--output <new-report.json>]\n',
    );
    return;
  }
  const values = /** @type {Record<string, string>} */ ({});
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    assert.ok(
      ['--url', '--bundle-dir', '--connect-host', '--output'].includes(flag) &&
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
    connectHost: values['--connect-host'],
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
