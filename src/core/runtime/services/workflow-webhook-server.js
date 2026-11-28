import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { isIP } from 'node:net';
import { ExecutionLedgerRunConflictError } from '../../lib/ledger/execution-ledger-contract.js';
import { createCanonicalJsonSha256Id } from '../content-id.js';

const BODY_LIMIT = 64 * 1024;

/** @typedef {{workflowId: string, idempotencyKey: string, input: any, actor: {kind: string, id: string}}} WebhookStart */

class RequestError extends Error {
  /** @param {number} status - HTTP status safe to disclose. */
  constructor(status) {
    super('Webhook request rejected.');
    this.status = status;
  }
}

/**
 * Keep parsed data within the resident's recursive JSON contract.
 * @param {any} value - Parsed JSON.
 * @param {number} depth - Current nesting depth.
 */
function validateInput(value, depth) {
  if (
    depth > 64 ||
    (typeof value === 'number' &&
      (!Number.isFinite(value) || Object.is(value, -0)))
  ) {
    throw new RequestError(400);
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) validateInput(child, depth + 1);
  }
}

/**
 * @param {import('node:http').IncomingMessage} request - Authenticated request.
 * @returns {Promise<any>} - Size-bounded JSON input.
 */
async function readInput(request) {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(
      request.headers['content-type'] || '',
    ) ||
    request.headers['content-encoding']
  ) {
    throw new RequestError(415);
  }
  if (Number(request.headers['content-length']) > BODY_LIMIT)
    throw new RequestError(413);
  let size = 0;
  const chunks = [];
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new RequestError(413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
    );
    validateInput(value, 0);
    return value;
  } catch {
    throw new RequestError(400);
  }
}

/**
 * Bind declared routes before resident READY. Secrets and TLS material belong
 * to the host. The only callback is revision-bound workflow admission.
 * @param {{webhooks?: Record<string, {workflow: string, deliveryIdField?: string}>, env?: NodeJS.ProcessEnv, start: (request: WebhookStart) => Promise<{runId: string}>}} options - Resident configuration.
 * @returns {Promise<{port: number, close: () => Promise<void>} | undefined>} - Bound listener, or undefined if disabled.
 */
export async function openWorkflowWebhookServer({
  webhooks,
  env = process.env,
  start,
}) {
  const configuredPort = env.WHARFIE_WEBHOOK_PORT;
  if (!webhooks || configuredPort === undefined) return undefined;
  if (
    !/^[1-9][0-9]{0,4}$/.test(configuredPort) ||
    Number(configuredPort) > 65535
  ) {
    throw new TypeError(
      'WHARFIE_WEBHOOK_PORT must be an integer from 1 to 65535.',
    );
  }
  const host = env.WHARFIE_WEBHOOK_HOST ?? '127.0.0.1';
  const cert = env.WHARFIE_WEBHOOK_TLS_CERT_FILE;
  const key = env.WHARFIE_WEBHOOK_TLS_KEY_FILE;
  if (
    !isIP(host) ||
    Boolean(cert) !== Boolean(key) ||
    (!cert && host !== '127.0.0.1' && host !== '::1')
  ) {
    throw new TypeError(
      'Webhooks require a bind IP and both TLS files for non-loopback listeners.',
    );
  }
  const routes = new Map(
    Object.entries(webhooks).map(([id, definition]) => {
      const name = `WHARFIE_WEBHOOK_TOKEN_${id.toUpperCase().replaceAll('-', '_')}`;
      const token = env[name];
      if (!token || !/^[A-Za-z0-9._~+/-]{32,256}={0,2}$/.test(token)) {
        throw new TypeError(
          `Set ${name} to a bearer token of at least 32 characters.`,
        );
      }
      const digest = createHash('sha256').update(token).digest();
      return [`/hooks/${id}`, { id, definition, digest }];
    }),
  );
  /** @type {import('node:http').RequestListener} */
  const handle = async (request, response) => {
    response.setHeader('Connection', 'close');
    response.setHeader('Cache-Control', 'no-store');
    try {
      const route = routes.get(request.url || '');
      if (!route) throw new RequestError(404);
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new RequestError(405);
      }
      const auth = request.headersDistinct.authorization;
      if (
        auth?.length !== 1 ||
        !/^Bearer /i.test(auth[0]) ||
        !timingSafeEqual(
          route.digest,
          createHash('sha256').update(auth[0].slice(7)).digest(),
        )
      ) {
        response.setHeader('WWW-Authenticate', 'Bearer');
        throw new RequestError(401);
      }
      const input = await readInput(request);
      const field = route.definition.deliveryIdField;
      const keys = request.headersDistinct['idempotency-key'];
      const deliveryId = field
        ? input && typeof input === 'object' && Object.hasOwn(input, field)
          ? input[field]
          : undefined
        : keys?.length === 1
          ? keys[0]
          : undefined;
      if (
        typeof deliveryId !== 'string' ||
        !/^[\x21-\x7e]{1,256}$/.test(deliveryId)
      )
        throw new RequestError(400);
      const result = await start({
        workflowId: route.definition.workflow,
        idempotencyKey: createCanonicalJsonSha256Id({
          domain: 'wharfie:webhook-delivery:v1',
          prefix: 'whd1',
          value: [route.id, deliveryId],
        }),
        input,
        actor: { kind: 'webhook', id: route.id },
      });
      response.writeHead(202, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ runId: result.runId }));
    } catch (error) {
      response.statusCode =
        error instanceof RequestError
          ? error.status
          : error instanceof ExecutionLedgerRunConflictError
            ? 409
            : 503;
      response.end();
    }
  };
  const limits = {
    requestTimeout: 15000,
    headersTimeout: 10000,
    maxHeaderSize: 8192,
    connectionsCheckingInterval: 1000,
  };
  const server =
    cert && key
      ? createHttpsServer(
          { ...limits, cert: await readFile(cert), key: await readFile(key) },
          handle,
        )
      : createHttpServer(limits, handle);
  server.maxConnections = 64;
  server.maxRequestsPerSocket = 1;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(configuredPort), host, () => {
      server.off('error', reject);
      resolve(undefined);
    });
  });
  return {
    port: Number(configuredPort),
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
