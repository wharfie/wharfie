/* eslint-env jest */

import { describe, expect, it, jest } from '@jest/globals';
import worker from '../../docs/site/_worker.js';

const guides = 'https://github.com/wharfie/wharfie/blob/master/docs/guides/';
const index = '<!doctype html><title>Reviewed landing</title>';
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

/** @param {string} pathname @param {string} [method] */
function request(pathname, method = 'GET') {
  return new Request('https://wharfie-docs.pages.dev' + pathname, {
    method,
    headers: {
      authorization: 'Bearer private-header',
      cookie: 'session=private-cookie',
    },
  });
}

function assets() {
  return {
    ASSETS: {
      fetch: jest.fn(
        async (/** @type {Request} */ incoming) =>
          new Response(incoming.method === 'HEAD' ? null : index, {
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'max-age=300',
            },
          }),
      ),
    },
  };
}

/** @param {Headers} headers @returns {Record<string, string>} */
function headerValues(headers) {
  const values = /** @type {Record<string, string>} */ ({});
  headers.forEach((value, name) => {
    values[name] = value;
  });
  return values;
}

describe('Cloudflare Pages documentation routing', () => {
  it.each([
    ['/', 'GET'],
    ['/index.html', 'GET'],
    ['/', 'HEAD'],
    ['/index.html', 'HEAD'],
  ])(
    'serves exact landing bytes for %s %s without passing query or credentials to assets',
    async (pathname, method) => {
      const env = assets();
      const response = await worker.fetch(
        request(pathname + '?token=private-query', method),
        env,
      );

      expect(response.status).toBe(200);
      expect(await response.text()).toBe(method === 'HEAD' ? '' : index);
      expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1);
      const forwarded = env.ASSETS.fetch.mock.calls[0][0];
      expect(forwarded.url).toBe('https://wharfie-docs.pages.dev/');
      expect(forwarded.method).toBe(method);
      expect(headerValues(forwarded.headers)).toEqual({});
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toBe(
        'text/html; charset=utf-8',
      );
    },
  );

  it.each(redirectRoutes)(
    'redirects %s to its exact current guide %s',
    async (pathname, guide) => {
      const env = assets();
      const response = await worker.fetch(
        request(pathname + '?next=https://evil.example/private-query'),
        env,
      );

      expect(response.status).toBe(302);
      expect(response.headers.get('location')).toBe(guides + guide);
      expect(await response.text()).toBe(
        'Current guide: ' + guides + guide + '\n',
      );
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    },
  );

  it.each(['/install.sh', '/install.ps1'])(
    'retires %s with the reviewed non-executable plain-text body',
    async (pathname) => {
      const env = assets();
      const response = await worker.fetch(
        request(pathname + '?token=private-query'),
        env,
      );

      expect(response.status).toBe(410);
      expect(response.headers.get('content-type')).toBe(
        'text/plain; charset=utf-8',
      );
      expect(response.headers.get('location')).toBeNull();
      expect(await response.text()).toBe(
        'This installer has been retired.\nCurrent installation guide: ' +
          guides +
          'installation.md\n',
      );
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
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
    '//install',
    '/%69ndex.html',
    '/%2finstall',
    '/%zz',
    '/install%00',
    '/install%0d%0alocation:evil',
    '/%3Cscript%3Eprivate-path%3C/script%3E',
    '/_worker.js',
    '/_routes.json',
    '/manifest.json',
    '/releases/old/index.html',
  ])('keeps unrecognized path %s away from static assets', async (pathname) => {
    const env = assets();
    const response = await worker.fetch(
      request(pathname + '?token=private-query'),
      env,
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe(
      'Page not found.\nCurrent documentation: https://docs.wharfie.dev/\n',
    );
    expect(response.headers.get('location')).toBeNull();
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it('handles Fetch URL dot-segment normalization with only the fixed legacy redirect', async () => {
    const env = assets();
    const incoming = request('/%2e%2e/install?token=private-query');
    const response = await worker.fetch(incoming, env);

    expect(new URL(incoming.url).pathname).toBe('/install');
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(guides + 'installation.md');
    expect(await response.text()).not.toContain('private-query');
    expect(env.ASSETS.fetch).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
    'refuses %s before any handler route reaches assets',
    async (method) => {
      const env = assets();
      for (const pathname of [
        '/',
        '/index.html',
        '/install',
        '/install.sh',
        '/unknown',
      ]) {
        const response = await worker.fetch(request(pathname, method), env);
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('GET, HEAD');
        expect(await response.text()).toBe('Use GET or HEAD.\n');
      }
      expect(env.ASSETS.fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ...redirectRoutes.map(([pathname]) => pathname),
    '/install.sh',
    '/install.ps1',
    '/unknown',
  ])('keeps GET headers but no body for HEAD %s', async (pathname) => {
    const env = assets();
    const get = await worker.fetch(request(pathname), env);
    const head = await worker.fetch(request(pathname, 'HEAD'), env);

    expect(head.status).toBe(get.status);
    expect(headerValues(head.headers)).toEqual(headerValues(get.headers));
    expect(await head.text()).toBe('');
  });

  it('sets matching no-store/security headers on every handler response', async () => {
    for (const pathname of [
      '/',
      '/index.html',
      '/install',
      '/install.sh',
      '/unknown',
    ]) {
      const response = await worker.fetch(request(pathname), assets());
      expect(headerValues(response.headers)).toMatchObject({
        'cache-control': 'no-store',
        'content-security-policy':
          "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer',
        'x-frame-options': 'DENY',
      });
    }
  });
});
