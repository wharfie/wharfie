// Pages advanced mode. _routes.json leaves '/' on the free static asset path.
const guides = 'https://github.com/wharfie/wharfie/blob/master/docs/guides/';
const securityHeaders = {
  'cache-control': 'no-store',
  'content-security-policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
};

/**
 * Return fixed text without reflecting the viewer's URL, query, or credentials.
 * @param {Request} request - Pages request.
 * @param {number} status - Response status.
 * @param {string} body - Fixed plain-text response.
 * @param {Record<string, string>} [headers] - Fixed response headers.
 * @returns {Response} Complete GET or HEAD response.
 */
function respond(request, status, body, headers = {}) {
  return new Response(request.method === 'HEAD' ? null : body, {
    status,
    headers: {
      ...securityHeaders,
      'content-type': 'text/plain; charset=utf-8',
      ...headers,
    },
  });
}

export default {
  /**
   * Only exact landing paths may use ASSETS; unknown routes never fall through.
   * Fetch Request URLs already normalize dot segments, including encoded dots.
   * @param {Request} request - Incoming Pages request.
   * @param {{ASSETS: {fetch: (request: Request) => Promise<Response>}}} env - Static asset binding.
   * @returns {Promise<Response>} Current landing, fixed redirect, or bounded error.
   */
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return respond(request, 405, 'Use GET or HEAD.\n', {
        allow: 'GET, HEAD',
      });
    }

    const pathname = new URL(request.url).pathname;
    if (pathname === '/' || pathname === '/index.html') {
      // Fetch '/' because Pages otherwise redirects /index.html with its query.
      const asset = await env.ASSETS.fetch(
        new Request(new URL('/', request.url), { method: request.method }),
      );
      const headers = new Headers(asset.headers);
      for (const [name, value] of Object.entries(securityHeaders)) {
        headers.set(name, value);
      }
      return new Response(request.method === 'HEAD' ? null : asset.body, {
        status: asset.status,
        headers,
      });
    }

    let guide;
    if (
      pathname === '/install' ||
      pathname === '/install/' ||
      pathname === '/install.html'
    ) {
      guide = 'installation.md';
    } else if (
      pathname === '/quickstart' ||
      pathname === '/quickstart/' ||
      pathname === '/quickstart.html'
    ) {
      guide = 'recipient-preview.md';
    } else if (
      pathname === '/project-structure' ||
      pathname === '/project-structure/' ||
      pathname === '/project-structure.html'
    ) {
      guide = 'application-structure.md';
    }
    if (guide) {
      const destination = guides + guide;
      return respond(request, 302, 'Current guide: ' + destination + '\n', {
        location: destination,
      });
    }

    if (pathname === '/install.sh' || pathname === '/install.ps1') {
      return respond(
        request,
        410,
        'This installer has been retired.\nCurrent installation guide: ' +
          guides +
          'installation.md\n',
      );
    }
    return respond(
      request,
      404,
      'Page not found.\nCurrent documentation: https://docs.wharfie.dev/\n',
    );
  },
};
