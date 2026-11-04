/* eslint-env jest */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';

const source = readFileSync(
  new URL('../../docs/site/edge-router.js', import.meta.url),
  'utf8',
);
const contentSha256 = '0123456789abcdef'.repeat(4);
const marker = '__WHARFIE_DOCS_SHA256__';
const guides = 'https://github.com/wharfie/wharfie/blob/master/docs/guides/';

/** @param {string} [hash] */
function loadHandler(hash = contentSha256) {
  return runInNewContext(
    source.replace(marker, hash) + '\nhandler;',
    {},
    {
      timeout: 100,
      filename: 'docs-site-edge-router.js',
    },
  );
}

/**
 * A CloudFront Functions 1.0 event, including duplicate query/header values.
 * https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/functions-event-structure.html
 *
 * @param {unknown} uri
 * @param {string} [method]
 */
function createEvent(uri, method = 'GET') {
  return {
    version: '1.0',
    context: {
      eventType: 'viewer-request',
      distributionDomainName: 'd111111abcdef8.cloudfront.net',
      distributionId: 'EDFDVBD6EXAMPLE',
      requestId: 'example-request-id',
    },
    viewer: { ip: '192.0.2.10' },
    request: {
      method,
      uri,
      querystring: {
        token: {
          value: 'private-query-value',
          multiValue: [
            { value: 'private-query-value' },
            { value: 'https://evil.example/?credential=private-query-value' },
          ],
        },
      },
      headers: {
        host: { value: 'docs.wharfie.dev' },
        authorization: { value: 'Bearer private-header-value' },
        accept: {
          value: 'text/html',
          multiValue: [{ value: 'text/html' }, { value: '*/*' }],
        },
      },
      cookies: { session: { value: 'private-cookie-value' } },
    },
  };
}

const redirectRoutes = [
  ['/install', 'installation.md'],
  ['/install/', 'installation.md'],
  ['/install.html', 'installation.md'],
  ['/quickstart', 'recipient-preview.md'],
  ['/quickstart/', 'recipient-preview.md'],
  ['/quickstart.html', 'recipient-preview.md'],
  ['/project-structure', 'application-structure.md'],
  ['/project-structure/', 'application-structure.md'],
  ['/project-structure.html', 'application-structure.md'],
];

describe('documentation CloudFront viewer-request routing', () => {
  const handler = loadHandler();

  it('fits the CloudFront Functions 10 KB source limit after hash substitution', () => {
    expect(source.split(marker)).toHaveLength(2);
    expect(source).not.toContain('${');
    expect(
      Buffer.byteLength(source.replace(marker, contentSha256)),
    ).toBeLessThan(10 * 1024);
  });

  it('uses simple function parameters supported by the CloudFront runtime', () => {
    const program = parse(source, { sourceType: 'script' }).program;
    const functions = program.body.filter(
      (node) => node.type === 'FunctionDeclaration',
    );

    expect(functions).toHaveLength(2);
    for (const declaration of functions) {
      expect(
        declaration.params.every(
          (parameter) => parameter.type === 'Identifier',
        ),
      ).toBe(true);
    }
  });

  it.each([
    ['/', 'GET'],
    ['/index.html', 'GET'],
    ['/', 'HEAD'],
    ['/index.html', 'HEAD'],
  ])(
    'rewrites %s %s to the pinned HTML object and strips query values',
    (uri, method) => {
      const event = createEvent(uri, method);
      const originalHeaders = structuredClone(event.request.headers);
      const result = handler(event);

      expect(result).toBe(event.request);
      expect(result.uri).toBe('/releases/' + contentSha256 + '/index.html');
      expect(result.querystring).toEqual({});
      expect(result.method).toBe(method);
      expect(result.headers).toEqual(originalHeaders);
      expect(result).not.toHaveProperty('statusCode');
      expect(result).not.toHaveProperty('body');
    },
  );

  it.each(redirectRoutes)(
    'redirects only exact legacy route %s to %s',
    (uri, guide) => {
      const result = handler(createEvent(uri));

      expect(result.statusCode).toBe(302);
      expect(result.statusDescription).toBe('Found');
      expect(result.headers.location).toEqual({ value: guides + guide });
      expect(result.body).toEqual({
        encoding: 'text',
        data: 'Current guide: ' + guides + guide + '\n',
      });
      expect(JSON.stringify(result)).not.toMatch(/private-|evil\.example/);
      expect(result).not.toHaveProperty('uri');
      expect(result).not.toHaveProperty('querystring');
    },
  );

  it.each(['/install.sh', '/install.ps1'])(
    'retires %s with a non-executable plain-text 410',
    (uri) => {
      const result = handler(createEvent(uri));

      expect(result.statusCode).toBe(410);
      expect(result.statusDescription).toBe('Gone');
      expect(result.headers['content-type']).toEqual({
        value: 'text/plain; charset=utf-8',
      });
      expect(result.body).toEqual({
        encoding: 'text',
        data:
          'This installer has been retired.\nCurrent installation guide: ' +
          guides +
          'installation.md\n',
      });
      expect(result.body.data).not.toMatch(/#!|curl|wget|Invoke-|\$|<script/i);
      expect(result.headers).not.toHaveProperty('location');
      expect(JSON.stringify(result)).not.toContain('private-');
    },
  );

  it.each([
    '/unknown',
    '/favicon.ico',
    '/INSTALL',
    '/install//',
    '/install.html/',
    '/quickstart/child',
    '/project-structure.json',
    '/install.sh/extra',
    '/install.ps1?download=1',
    '/index.html?token=private-query-value',
    '//index.html',
    '/./index.html',
    '/private/../index.html',
    '/%69ndex.html',
    '/%2e%2e/install',
    '/%2finstall',
    '/%zz',
    '/install\u0000',
    '/install\r\nlocation: https://evil.example/',
    '/<script>alert("private-path-value")</script>',
    '//evil.example/',
    'https://evil.example/',
    '/releases/' + contentSha256 + '/index.html',
    '',
    null,
    undefined,
    42,
    { toString: () => '/install' },
  ])(
    'refuses an unrecognized or malformed path without reflecting it: %p',
    (uri) => {
      const result = handler(createEvent(uri));

      expect(result.statusCode).toBe(404);
      expect(result.body).toEqual({
        encoding: 'text',
        data: 'Page not found.\nCurrent documentation: https://docs.wharfie.dev/\n',
      });
      expect(result).not.toHaveProperty('uri');
      expect(result.headers).not.toHaveProperty('location');
      expect(JSON.stringify(result)).not.toMatch(
        /private-|evil\.example|<script/,
      );
    },
  );

  it.each([
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
    'OPTIONS',
    'TRACE',
    'CONNECT',
    'get',
    '',
  ])(
    'refuses unsupported method %s before any route reaches the origin',
    (method) => {
      for (const uri of ['/', '/install', '/install.sh', '/unknown']) {
        const result = handler(createEvent(uri, method));

        expect(result.statusCode).toBe(405);
        expect(result.headers.allow).toEqual({ value: 'GET, HEAD' });
        expect(result.body).toEqual({
          encoding: 'text',
          data: 'Use GET or HEAD.\n',
        });
        expect(result).not.toHaveProperty('uri');
        expect(result.headers).not.toHaveProperty('location');
        expect(JSON.stringify(result)).not.toContain('private-');
      }
    },
  );

  it.each([
    ...redirectRoutes.map(([uri]) => uri),
    '/install.sh',
    '/install.ps1',
    '/unknown',
  ])('returns the same headers and no generated body for HEAD %s', (uri) => {
    const getResult = handler(createEvent(uri));
    const headResult = handler(createEvent(uri, 'HEAD'));

    expect(headResult.statusCode).toBe(getResult.statusCode);
    expect(headResult.statusDescription).toBe(getResult.statusDescription);
    expect(headResult.headers).toEqual(getResult.headers);
    expect(headResult).not.toHaveProperty('body');
  });

  it.each([
    marker,
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    '../index.html',
  ])(
    'keeps a missing or invalid content hash away from the origin: %s',
    (hash) => {
      const invalidHandler = loadHandler(hash);

      for (const uri of ['/', '/index.html']) {
        const result = invalidHandler(createEvent(uri));
        expect(result.statusCode).toBe(503);
        expect(result.body.data).toContain(guides + 'recipient-preview.md');
        expect(result).not.toHaveProperty('uri');
        expect(JSON.stringify(result)).not.toContain('private-');
        expect(invalidHandler(createEvent(uri, 'HEAD'))).not.toHaveProperty(
          'body',
        );
      }
    },
  );

  it('sends fixed security and no-store headers on every generated response', () => {
    const results = [
      handler(createEvent('/install')),
      handler(createEvent('/install.sh')),
      handler(createEvent('/unknown')),
      handler(createEvent('/', 'POST')),
      loadHandler(marker)(createEvent('/')),
    ];

    for (const result of results) {
      expect(result.headers).toMatchObject({
        'content-type': { value: 'text/plain; charset=utf-8' },
        'cache-control': { value: 'no-store' },
        'content-security-policy': {
          value:
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
        'x-content-type-options': { value: 'nosniff' },
        'referrer-policy': { value: 'no-referrer' },
        'x-frame-options': { value: 'DENY' },
      });
      expect(
        Object.keys(result.headers).every(
          (name) => name === name.toLowerCase(),
        ),
      ).toBe(true);
      expect(result).not.toHaveProperty('cookies');
    }
  });
});
