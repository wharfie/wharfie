import { setTimeout as delay } from 'node:timers/promises';

import { startGrpcServer, LambdaServiceDefinition } from './rpc-grpc.js';

/**
 * @typedef LambdaInvokeRequest
 * @property {string} functionName
 * @property {any} [event]
 * @property {any} [context]
 */

/**
 * @typedef LambdaPollOptions
 * @property {any} queue - Queue client (SQS-like) used for polling.
 * @property {string[]} queueUrls - Queue URLs to poll.
 * @property {number} [waitTimeSeconds] - Long poll seconds (0-20).
 * @property {number} [maxNumberOfMessages] - 1-10.
 * @property {number} [visibilityTimeout] - seconds
 * @property {(msg: string, extra?: any) => void} [log]
 */

/**
 * @typedef LambdaServiceOptions
 * @property {string} [host]
 * @property {number} [port]
 * @property {(req: LambdaInvokeRequest) => Promise<void>} execute - Executes a function invocation.
 * @property {LambdaPollOptions} [poll] - Optional queue poll loop configuration.
 * @property {(msg: string, extra?: any) => void} [log]
 */

/**
 * Start the Lambda service (execution plane).
 *
 * - Exposes a gRPC `Invoke` API for explicit invocations.
 * - Optionally runs one or more queue poll loops that decode messages into invocations.
 *
 * Message format (Queue Message Body):
 *   { "functionName": "my-function", "event": { ... }, "context": { ... } }
 *
 * @param {LambdaServiceOptions} options
 * @returns {Promise<{ address: string, host: string, port: number, close: () => Promise<void> }>}
 */
export async function startLambdaService({
  host = '127.0.0.1',
  port = 0,
  execute,
  poll,
  log,
}) {
  if (typeof execute !== 'function') {
    throw new TypeError('Lambda service: execute must be a function');
  }

  const abort = new AbortController();

  /** @type {Promise<any>[]} */
  const pollTasks = [];

  if (
    poll &&
    poll.queue &&
    Array.isArray(poll.queueUrls) &&
    poll.queueUrls.length
  ) {
    const queue = poll.queue;
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
     * @param {string} queueUrl
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

              const functionName = payload?.functionName;
              if (!functionName || typeof functionName !== 'string') {
                pollLog &&
                  pollLog('lambda poll: missing functionName', {
                    queueUrl,
                    payload,
                  });
                continue;
              }

              try {
                await execute({
                  functionName,
                  event: payload?.event,
                  context: payload?.context,
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
                      functionName,
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
       * @param {any} call
       * @param {(err: any, resp: any) => void} callback
       */
      Invoke: async (call, callback) => {
        try {
          const req = call?.request || {};
          const functionName = req.functionName;

          if (!functionName || typeof functionName !== 'string') {
            callback(null, { ok: false, error: 'Missing functionName' });
            return;
          }

          await execute({
            functionName,
            event: req.event,
            context: req.context,
          });

          callback(null, { ok: true });
        } catch (err) {
          const msgStr =
            err && typeof err === 'object' && 'stack' in err
              ? // @ts-ignore
                String(err.stack)
              : String(err);
          callback(null, { ok: false, error: msgStr });
        }
      },

      /**
       * @param {any} _call
       * @param {(err: any, resp: any) => void} callback
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
 * @param {any} v
 * @param {number} min
 * @param {number} max
 * @param {number} def
 * @returns {number}
 */
function clampNumber(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(Math.max(n, min), max);
}
