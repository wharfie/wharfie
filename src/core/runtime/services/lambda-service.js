import { setTimeout as delay } from 'node:timers/promises';

import { getQueueOperationId, runPersistedActivity } from '../app-runs.js';
import { assertApplicationRevisionId } from '../application-revision.js';
import {
  ActivityAttemptProtocolError,
  serializeActivityAttemptError,
} from '../activity-attempt.js';
import { cloneJsonValue } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';
import { startGrpcServer, LambdaServiceDefinition } from './rpc-grpc.js';

/**
 * @typedef LambdaInvokeRequest
 * @property {string} functionName - functionName.
 * @property {string} [activity] - activity.
 * @property {string} [revisionId] - Immutable application revision identity.
 * @property {any} [event] - event.
 * @property {any} [context] - context.
 */

/**
 * @typedef LambdaPollOptions
 * @property {any} queue - Queue client (SQS-like) used for polling.
 * @property {string[]} queueUrls - Queue URLs to poll.
 * @property {number} [waitTimeSeconds] - Long poll seconds (0-20).
 * @property {number} [maxNumberOfMessages] - 1-10.
 * @property {number} [visibilityTimeout] - seconds
 * @property {import('../../lib/db/tables/operations.js').OperationsTableClient} operationsStore - Durable operations store.
 * @property {string} appId - Canonical application ID.
 * @property {string} revisionId - Immutable application revision identity.
 * @property {(msg: string, extra?: any) => void} [log] - log.
 */

/**
 * @typedef LambdaServiceOptions
 * @property {string} [host] - host.
 * @property {number} [port] - port.
 * @property {string} revisionId - Immutable revision served by every invocation.
 * @property {(req: LambdaInvokeRequest) => Promise<any>} execute - Executes a function invocation.
 * @property {LambdaPollOptions} [poll] - Optional queue poll loop configuration.
 * @property {(msg: string, extra?: any) => void} [log] - log.
 */

/**
 * @param {unknown} value - value.
 * @returns {string | undefined} - Result.
 */
function getNonemptyString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * @param {any} value - value.
 * @returns {Record<string, any> | undefined} - Result.
 */
function normalizeContext(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

/**
 * @param {any} payload - payload.
 * @returns {string | undefined} - Result.
 */
function resolveActivityName(payload) {
  return getNonemptyString(payload?.activity);
}

/**
 * @param {string} code - Stable logical error code.
 * @param {string} name - Stable error class name.
 * @param {string} message - Safe error message.
 * @param {Record<string, any>} [details] - Strict JSON details.
 * @param {unknown} [cause] - Local-only cause.
 * @returns {ActivityAttemptProtocolError} - Structured service error.
 */
function createInvocationProtocolError(
  code,
  name,
  message,
  details = {},
  cause,
) {
  const error = new ActivityAttemptProtocolError(code, message, details, {
    cause,
  });
  error.name = name;
  return error;
}

/**
 * Clone one direct-invocation value before the generic JSON gRPC codec can
 * silently coerce it.
 * @param {unknown} value - Candidate strict JSON value.
 * @param {string} label - Boundary label.
 * @param {string} code - Stable failure code.
 * @returns {any} - Independent strict JSON clone.
 */
function cloneInvocationValue(value, label, code) {
  try {
    return cloneJsonValue(value, label);
  } catch (cause) {
    throw createInvocationProtocolError(
      code,
      'ActivityInvocationValueError',
      cause instanceof Error ? cause.message : String(cause),
      {},
      cause,
    );
  }
}

/**
 * Start the Lambda service (execution plane).
 *
 * - Exposes a gRPC `Invoke` API for explicit invocations.
 * - Optionally runs one or more queue poll loops that decode messages into invocations.
 *
 * Message format (Queue Message Body):
 * { "activity": "my-activity", "event": { ... }, "context": { ... } }
 * @param {LambdaServiceOptions} options - options.
 * @returns {Promise<{ address: string, host: string, port: number, close: () => Promise<void> }>} - Result.
 */
export async function startLambdaService({
  host = '127.0.0.1',
  port = 0,
  revisionId: configuredRevisionId,
  execute,
  poll,
  log,
}) {
  if (typeof execute !== 'function') {
    throw new TypeError('Lambda service: execute must be a function');
  }

  const abort = new AbortController();
  assertApplicationRevisionId(configuredRevisionId, 'revisionId');
  const serviceRevisionId = configuredRevisionId;

  /** @type {Promise<any>[]} */
  const pollTasks = [];

  if (
    poll &&
    poll.queue &&
    Array.isArray(poll.queueUrls) &&
    poll.queueUrls.length
  ) {
    const queue = poll.queue;
    const operationsStore = poll.operationsStore;
    const appId = poll.appId;
    const revisionId = poll.revisionId;
    if (!operationsStore || !appId || !revisionId) {
      throw new TypeError(
        'Lambda service queue polling requires operationsStore, appId, and revisionId.',
      );
    }
    assertApplicationRevisionId(revisionId, 'poll.revisionId');
    if (serviceRevisionId !== revisionId) {
      throw new Error(
        `Lambda service revision '${serviceRevisionId}' does not match queue polling revision '${revisionId}'.`,
      );
    }
    const waitTimeSeconds = clampNumber(poll.waitTimeSeconds, 0, 20, 20);
    const maxNumberOfMessages = clampNumber(
      poll.maxNumberOfMessages,
      1,
      10,
      10,
    );
    const visibilityTimeout = clampNumber(poll.visibilityTimeout, 0, 43200, 30);
    const pollLog = poll.log || log;

    /**
     * @param {string} queueUrl - queueUrl.
     */
    const startPollLoop = (queueUrl) => {
      const task = (async () => {
        pollLog &&
          pollLog('lambda poll loop started', { queueUrl, waitTimeSeconds });

        while (!abort.signal.aborted) {
          try {
            const res = await queue.receiveMessage({
              QueueUrl: queueUrl,
              MaxNumberOfMessages: maxNumberOfMessages,
              WaitTimeSeconds: waitTimeSeconds,
              VisibilityTimeout: visibilityTimeout,
            });

            const Messages = Array.isArray(res?.Messages) ? res.Messages : [];

            if (!Messages.length) {
              // Avoid a hot loop if WaitTimeSeconds=0.
              if (waitTimeSeconds === 0) {
                await delay(150, undefined, { signal: abort.signal }).catch(
                  () => {},
                );
              }
              continue;
            }

            for (const msg of Messages) {
              if (abort.signal.aborted) break;

              const receipt = msg?.ReceiptHandle;
              const body = msg?.Body;

              if (!receipt || !body) {
                pollLog &&
                  pollLog('lambda poll: skipping malformed message', msg);
                continue;
              }

              let payload = null;
              try {
                payload = JSON.parse(body);
              } catch {
                pollLog &&
                  pollLog('lambda poll: invalid JSON message body', { body });
                // Leave message for DLQ / manual inspection (do not delete).
                continue;
              }

              const activity = resolveActivityName(payload);
              if (!activity) {
                pollLog &&
                  pollLog('lambda poll: missing activity', {
                    queueUrl,
                    payload,
                  });
                continue;
              }

              const messageId = getNonemptyString(msg?.MessageId);
              const receiptHandle = getNonemptyString(receipt);
              const context = normalizeContext(payload?.context) || {};
              const attemptContext = {
                trigger: {
                  source: 'event',
                  queueUrl,
                  ...(messageId ? { messageId } : {}),
                  ...(receiptHandle ? { receiptHandle } : {}),
                },
              };

              try {
                if (!messageId) {
                  throw new Error(
                    'Persisted queue activity requires a message ID.',
                  );
                }
                const operationId = getQueueOperationId({
                  queueUrl,
                  messageId,
                });
                await runPersistedActivity({
                  store: operationsStore,
                  appId,
                  revisionId,
                  activityName: activity,
                  operationId,
                  ...(Object.prototype.hasOwnProperty.call(payload, 'event')
                    ? { event: payload.event }
                    : {}),
                  context,
                  attemptContext,
                  trigger: {
                    source: 'event',
                    queueUrl,
                    messageId,
                  },
                  execute: async ({
                    activityName,
                    revisionId: operationRevisionId,
                    event,
                    context,
                  }) => {
                    return await execute({
                      functionName: activityName,
                      activity: activityName,
                      revisionId: operationRevisionId,
                      event,
                      context,
                    });
                  },
                });

                // Ack/delete only on success.
                await queue.deleteMessage({
                  QueueUrl: queueUrl,
                  ReceiptHandle: receipt,
                });
              } catch (err) {
                const msgStr =
                  err && typeof err === 'object' && 'stack' in err
                    ? // @ts-ignore
                      String(err.stack)
                    : String(err);

                pollLog &&
                  pollLog(
                    'lambda poll: invocation failed (message will retry)',
                    {
                      queueUrl,
                      activity,
                      ...(messageId ? { messageId } : {}),
                      error: msgStr,
                    },
                  );
                // Do not delete; visibility timeout will expire and the message will retry.
              }
            }
          } catch (err) {
            const msgStr =
              err && typeof err === 'object' && 'stack' in err
                ? // @ts-ignore
                  String(err.stack)
                : String(err);
            pollLog &&
              pollLog('lambda poll loop error', { queueUrl, error: msgStr });

            // Basic backoff to avoid tight error loops.
            await delay(500, undefined, { signal: abort.signal }).catch(
              () => {},
            );
          }
        }

        pollLog && pollLog('lambda poll loop stopped', { queueUrl });
      })();

      pollTasks.push(task);
    };

    for (const qUrl of poll.queueUrls) {
      if (typeof qUrl === 'string' && qUrl) startPollLoop(qUrl);
    }
  }

  const server = await startGrpcServer({
    host,
    port,
    serviceDefinition: LambdaServiceDefinition,
    log,
    implementation: {
      /**
       * @param {any} call - call.
       * @param {(err: any, resp: any) => void} callback - callback.
       */
      Invoke: async (call, callback) => {
        try {
          const req = call?.request || {};
          const functionName =
            getNonemptyString(req.functionName) ||
            getNonemptyString(req.activity);

          if (!functionName) {
            throw createInvocationProtocolError(
              'activity-name-required',
              'ActivityNameRequiredError',
              'Lambda invocation requires functionName.',
            );
          }
          try {
            assertLogicalId(functionName, 'request.functionName');
          } catch (cause) {
            throw createInvocationProtocolError(
              'activity-name-invalid',
              'ActivityNameInvalidError',
              cause instanceof Error ? cause.message : String(cause),
              {},
              cause,
            );
          }

          const requestedRevisionId = getNonemptyString(req.revisionId);
          if (!requestedRevisionId) {
            throw createInvocationProtocolError(
              'activity-revision-required',
              'ActivityRevisionRequiredError',
              `Lambda invocation requires revisionId '${serviceRevisionId}'.`,
              { expectedRevisionId: serviceRevisionId },
            );
          }
          try {
            assertApplicationRevisionId(
              requestedRevisionId,
              'request.revisionId',
            );
          } catch (cause) {
            throw createInvocationProtocolError(
              'activity-revision-invalid',
              'ActivityRevisionInvalidError',
              cause instanceof Error ? cause.message : String(cause),
              {},
              cause,
            );
          }
          if (requestedRevisionId !== serviceRevisionId) {
            throw createInvocationProtocolError(
              'activity-revision-mismatch',
              'ActivityRevisionMismatchError',
              `Activity revision '${requestedRevisionId}' does not match the running service revision '${serviceRevisionId}'.`,
              {
                requestedRevisionId,
                serviceRevisionId,
              },
            );
          }

          const value = await execute({
            functionName,
            activity: functionName,
            revisionId: requestedRevisionId,
            ...(Object.prototype.hasOwnProperty.call(req, 'event')
              ? {
                  event: cloneInvocationValue(
                    req.event,
                    'Lambda invocation event',
                    'activity-input-invalid',
                  ),
                }
              : {}),
            ...(Object.prototype.hasOwnProperty.call(req, 'context')
              ? {
                  context: cloneInvocationValue(
                    req.context,
                    'Lambda invocation context',
                    'activity-context-invalid',
                  ),
                }
              : {}),
          });

          const result = cloneInvocationValue(
            value,
            'Lambda invocation result',
            'activity-result-invalid',
          );
          callback(null, { ok: true, result });
        } catch (err) {
          callback(null, {
            ok: false,
            error: serializeActivityAttemptError(
              err,
              'activity-invocation-failed',
            ),
          });
        }
      },

      /**
       * @param {any} _call - _call.
       * @param {(err: any, resp: any) => void} callback - callback.
       */
      Health: async (_call, callback) => {
        callback(null, { ok: true });
      },
    },
  });

  return {
    address: server.address,
    host: server.host,
    port: server.port,
    close: async () => {
      abort.abort();
      await Promise.allSettled(pollTasks);
      await server.close();
    },
  };
}

/**
 * @param {any} v - v.
 * @param {number} min - min.
 * @param {number} max - max.
 * @param {number} def - def.
 * @returns {number} - Result.
 */
function clampNumber(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
