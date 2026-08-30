import { assertLedgerOpaqueId } from '../lib/ledger/record-key.js';
import { assertLogicalId } from './logical-id.js';

export const EXECUTION_LEDGER_HISTORY_INVENTORY_PAGE_SIZE = 100;

/** @param {AbortSignal | undefined} signal - Optional cancellation signal. */
function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw (
    signal.reason ?? new Error('Execution-ledger history inventory aborted.')
  );
}

/**
 * Visit every verified run in one application's durable history. This is a
 * history inventory, not a scheduling query: terminal, blocked, old-revision,
 * and framework-owned runs are all included. The directory remains only a
 * locator, so every item is rebuilt before it reaches the visitor.
 * @param {{ledger: Pick<import('../lib/db/tables/execution-ledger.js').ExecutionLedgerStore, 'listRuns'|'rebuildRun'>, appId: string, signal?: AbortSignal, visit: (entry: Readonly<{directory: Record<string, any>, view: Record<string, any>}>) => Promise<void> | void}} options - Exact inventory scope and visitor.
 * @returns {Promise<Readonly<{visitedRuns: number}>>} - Bounded inventory summary.
 */
export async function visitExecutionLedgerHistory(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Execution-ledger history inventory requires options.');
  }
  const allowedOptions = new Set(['ledger', 'appId', 'signal', 'visit']);
  if (Object.keys(options).some((key) => !allowedOptions.has(key))) {
    throw new TypeError(
      'Execution-ledger history inventory options contain unsupported fields.',
    );
  }
  const appId = options.appId;
  const ledger = options.ledger;
  const signal = options.signal;
  const visit = options.visit;
  assertLogicalId(appId, 'execution-ledger history appId');
  if (
    typeof ledger?.listRuns !== 'function' ||
    typeof ledger?.rebuildRun !== 'function'
  ) {
    throw new TypeError(
      'Execution-ledger history inventory requires listRuns and rebuildRun.',
    );
  }
  if (typeof visit !== 'function') {
    throw new TypeError(
      'Execution-ledger history inventory requires a visitor function.',
    );
  }

  const listRuns = ledger.listRuns.bind(ledger);
  const rebuildRun = ledger.rebuildRun.bind(ledger);
  const seenRuns = new Set();
  const seenCursors = new Set();
  let visitedRuns = 0;
  /** @type {string | undefined} */
  let cursor;

  do {
    throwIfAborted(signal);
    const page = await listRuns({
      appId,
      limit: EXECUTION_LEDGER_HISTORY_INVENTORY_PAGE_SIZE,
      ...(cursor === undefined ? {} : { cursor }),
    });
    throwIfAborted(signal);
    if (
      !page ||
      typeof page !== 'object' ||
      !Array.isArray(page.items) ||
      page.items.length > EXECUTION_LEDGER_HISTORY_INVENTORY_PAGE_SIZE
    ) {
      throw new TypeError(
        'Execution-ledger history inventory page is invalid.',
      );
    }

    for (const directory of page.items) {
      throwIfAborted(signal);
      const runId = assertLedgerOpaqueId(
        directory?.runId,
        'execution-ledger history runId',
      );
      if (directory.appId !== appId || seenRuns.has(runId)) {
        throw new TypeError(
          'Execution-ledger history crossed application scope or repeated a run.',
        );
      }
      seenRuns.add(runId);
      const view = await rebuildRun(runId);
      throwIfAborted(signal);
      if (
        !view ||
        typeof view !== 'object' ||
        Array.isArray(view) ||
        view.run?.runId !== runId ||
        view.run.appId !== appId
      ) {
        throw new TypeError(
          'Execution-ledger history could not be rebuilt in the requested scope.',
        );
      }
      await visit(Object.freeze({ directory, view }));
      throwIfAborted(signal);
      visitedRuns += 1;
    }

    cursor = page.nextCursor;
    if (cursor !== undefined) {
      if (
        typeof cursor !== 'string' ||
        !cursor ||
        page.items.length === 0 ||
        seenCursors.has(cursor)
      ) {
        throw new TypeError(
          'Execution-ledger history inventory cursor did not advance.',
        );
      }
      seenCursors.add(cursor);
    }
  } while (cursor !== undefined);

  throwIfAborted(signal);
  return Object.freeze({ visitedRuns });
}
