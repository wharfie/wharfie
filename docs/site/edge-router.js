// CloudFront Functions JavaScript runtime 2.0, viewer-request association.
// The reviewed deployment renderer substitutes this marker with one content hash.
const contentSha256 = '__WHARFIE_DOCS_SHA256__';
const guides = 'https://github.com/wharfie/wharfie/blob/master/docs/guides/';

/**
 * Create a bounded response without copying any viewer-controlled text.
 * @param {{method?: string}} request - CloudFront viewer request.
 * @param {number} statusCode - HTTP status.
 * @param {string} statusDescription - Fixed HTTP status description.
 * @param {string} message - Fixed plain-text response.
 * @param {Record<string, {value: string}>} [extraHeaders] - Fixed response headers.
 * @returns {{statusCode: number, statusDescription: string, headers: Record<string, {value: string}>, body?: {encoding: string, data: string}}} CloudFront response.
 */
function respond(
  request,
  statusCode,
  statusDescription,
  message,
  extraHeaders,
) {
  const response = {
    statusCode,
    statusDescription,
    headers: Object.assign(
      {
        'content-type': { value: 'text/plain; charset=utf-8' },
        'cache-control': { value: 'no-store' },
        'content-security-policy': {
          value:
            "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        },
        'x-content-type-options': { value: 'nosniff' },
        'referrer-policy': { value: 'no-referrer' },
        'x-frame-options': { value: 'DENY' },
      },
      extraHeaders || {},
    ),
  };
  if (request.method !== 'HEAD') {
    response.body = { encoding: 'text', data: message };
  }
  return response;
}

/**
 * Route only the current landing page to the private content-addressed origin.
 * URI matching is exact: do not decode or normalize unrecognized legacy paths.
 * @param {{request: {method: string, uri: string, querystring: object}}} event - CloudFront event.
 * @returns {object} Origin request or a complete viewer response.
 */
// eslint-disable-next-line no-unused-vars -- CloudFront invokes the global handler.
function handler(event) {
  const request = event.request;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return respond(request, 405, 'Method Not Allowed', 'Use GET or HEAD.\n', {
      allow: { value: 'GET, HEAD' },
    });
  }

  const uri = request.uri;
  if (uri === '/' || uri === '/index.html') {
    if (contentSha256.length !== 64 || !/^[a-f0-9]{64}$/.test(contentSha256)) {
      return respond(
        request,
        503,
        'Service Unavailable',
        'Documentation is temporarily unavailable.\n' +
          guides +
          'recipient-preview.md\n',
      );
    }
    request.uri = '/releases/' + contentSha256 + '/index.html';
    request.querystring = {};
    return request;
  }

  let guide;
  if (uri === '/install' || uri === '/install/' || uri === '/install.html') {
    guide = 'installation.md';
  } else if (
    uri === '/quickstart' ||
    uri === '/quickstart/' ||
    uri === '/quickstart.html'
  ) {
    guide = 'recipient-preview.md';
  } else if (
    uri === '/project-structure' ||
    uri === '/project-structure/' ||
    uri === '/project-structure.html'
  ) {
    guide = 'application-structure.md';
  }
  if (guide) {
    const destination = guides + guide;
    return respond(
      request,
      302,
      'Found',
      'Current guide: ' + destination + '\n',
      {
        location: { value: destination },
      },
    );
  }

  if (uri === '/install.sh' || uri === '/install.ps1') {
    return respond(
      request,
      410,
      'Gone',
      'This installer has been retired.\nCurrent installation guide: ' +
        guides +
        'installation.md\n',
    );
  }
  return respond(
    request,
    404,
    'Not Found',
    'Page not found.\nCurrent documentation: https://docs.wharfie.dev/\n',
  );
}
