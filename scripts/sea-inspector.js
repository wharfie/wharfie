import { spawn } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const INSPECTOR_URL_PATTERN = /Debugger listening on (ws:\/\/[^\s]+)/;
const BASE64_VLQ_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VLQ_VALUES = new Map(
  [...BASE64_VLQ_ALPHABET].map((character, index) => [character, index]),
);
const DECODED_SOURCE_MAPS = new WeakMap();

/** @typedef {{code: number | null, signal: string | null}} InspectedProcessExit */

/**
 * Bound one asynchronous operation without leaving its timer live.
 * @template T
 * @param {Promise<T>} promise - Operation to await.
 * @param {number} timeoutMs - Maximum wait.
 * @param {string} label - Stable failure label.
 * @returns {Promise<T>} - Settled operation.
 */
async function withTimeout(promise, timeoutMs, label) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Preserve bounded process diagnostics.
 * @param {string} retained - Prior text.
 * @param {unknown} chunk - New stream chunk.
 * @returns {string} - Bounded trailing text.
 */
function appendDiagnostic(retained, chunk) {
  return `${retained}${String(chunk)}`.slice(-256 * 1024);
}

/**
 * Launch an executable under Node's loopback inspector and stop before its
 * first application statement. This uses the Node runtime already embedded in
 * a SEA; PATH is not consulted. The inspector changes no artifact bytes and
 * exposes no Wharfie runtime hook.
 * @param {string} command - Executable path.
 * @param {string[]} args - Application argv.
 * @param {{cwd: string, env: Record<string, string>, timeoutMs?: number}} options - Process inputs.
 * @returns {{child: import('node:child_process').ChildProcess, inspectorUrl: Promise<string>, exited: Promise<InspectedProcessExit>, getExit: () => InspectedProcessExit | null, getOutput: () => {stdout: string, stderr: string}}} - Paused process handle.
 */
export function spawnInspectorPausedProcess(command, args, options) {
  if (typeof command !== 'string' || command.length === 0) {
    throw new TypeError('Inspector process command must be nonempty.');
  }
  if (!Array.isArray(args) || args.some((value) => typeof value !== 'string')) {
    throw new TypeError('Inspector process args must be strings.');
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('Inspector process options must be an object.');
  }
  if (
    typeof options.env?.NODE_OPTIONS === 'string' &&
    options.env.NODE_OPTIONS
  ) {
    throw new Error(
      'Inspector process refuses to replace an existing NODE_OPTIONS value.',
    );
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: {
      ...options.env,
      NODE_OPTIONS: '--inspect-brk=127.0.0.1:0 --inspect-publish-uid=stderr',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let exitResult = /** @type {InspectedProcessExit | null} */ (null);
  let inspectorUrl = '';
  let settleInspectorUrl = /** @type {(value: string) => void} */ (() => {});
  let rejectInspectorUrl = /** @type {(error: Error) => void} */ (() => {});
  const inspectorUrlResult = new Promise((resolve, reject) => {
    settleInspectorUrl = resolve;
    rejectInspectorUrl = reject;
  });
  const inspectorTimer = setTimeout(() => {
    if (inspectorUrl) return;
    rejectInspectorUrl(
      new Error(
        `SEA inspector URL was not published within ${timeoutMs}ms. stderr:\n${stderr}`,
      ),
    );
  }, timeoutMs);
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => {
    stdout = appendDiagnostic(stdout, chunk);
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk) => {
    stderr = appendDiagnostic(stderr, chunk);
    if (inspectorUrl) return;
    const match = stderr.match(INSPECTOR_URL_PATTERN);
    if (!match) return;
    inspectorUrl = match[1];
    clearTimeout(inspectorTimer);
    settleInspectorUrl(inspectorUrl);
  });
  const exited = new Promise((resolve) => {
    child.once('error', (error) => {
      stderr = appendDiagnostic(
        stderr,
        error instanceof Error ? error.stack || error.message : String(error),
      );
      exitResult = { code: null, signal: null };
      if (!inspectorUrl) {
        clearTimeout(inspectorTimer);
        rejectInspectorUrl(
          new Error(`SEA inspector process failed before attach: ${stderr}`),
        );
      }
    });
    child.once('exit', (code, signal) => {
      exitResult = { code, signal: signal || null };
      if (!inspectorUrl) {
        clearTimeout(inspectorTimer);
        rejectInspectorUrl(
          new Error(
            `SEA inspector process exited before attach (${JSON.stringify(exitResult)}). stderr:\n${stderr}`,
          ),
        );
      }
    });
    child.once('close', (code, signal) => {
      exitResult = { code, signal: signal || null };
      resolve(exitResult);
    });
  });
  return {
    child,
    inspectorUrl: withTimeout(
      inspectorUrlResult,
      timeoutMs,
      'SEA inspector URL',
    ),
    exited,
    getExit: () => exitResult,
    getOutput: () => ({ stdout, stderr }),
  };
}

/**
 * Decode one base64-VLQ source-map segment.
 * @param {string} segment - Encoded segment.
 * @returns {number[]} - Signed fields.
 */
function decodeVlqSegment(segment) {
  /** @type {number[]} */
  const values = [];
  let value = 0;
  let shift = 0;
  for (const character of segment) {
    const digit = BASE64_VLQ_VALUES.get(character);
    if (digit === undefined) {
      throw new Error(
        `Source map contains invalid VLQ character ${character}.`,
      );
    }
    const continuation = digit >= 32;
    value += (digit % 32) * 2 ** shift;
    if (!Number.isSafeInteger(value)) {
      throw new Error('Source map contains an unsafe VLQ value.');
    }
    if (continuation) {
      shift += 5;
      continue;
    }
    const negative = value % 2 === 1;
    const magnitude = Math.floor(value / 2);
    values.push(negative ? -magnitude : magnitude);
    value = 0;
    shift = 0;
  }
  if (shift !== 0) {
    throw new Error('Source map ended inside a VLQ value.');
  }
  return values;
}

/**
 * Decode only the generated/original positions required by this verifier.
 * @param {Record<string, any>} sourceMap - Source Map v3 document.
 * @returns {Array<{generatedLine: number, generatedColumn: number, sourceIndex: number | null, originalLine: number | null, originalColumn: number | null}>} - Generated mapping boundaries, including unmapped segments.
 */
function decodeSourceMapMappings(sourceMap) {
  if (sourceMap?.version !== 3 || typeof sourceMap.mappings !== 'string') {
    throw new TypeError('SEA bundle must expose a Source Map v3 mapping.');
  }
  /** @type {Array<{generatedLine: number, generatedColumn: number, sourceIndex: number | null, originalLine: number | null, originalColumn: number | null}>} */
  const positions = [];
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (const [generatedLine, line] of sourceMap.mappings.split(';').entries()) {
    let generatedColumn = 0;
    if (!line) continue;
    for (const encoded of line.split(',')) {
      const fields = decodeVlqSegment(encoded);
      if (fields.length === 0) continue;
      generatedColumn += fields[0];
      if (fields.length === 1) {
        positions.push({
          generatedLine,
          generatedColumn,
          sourceIndex: null,
          originalLine: null,
          originalColumn: null,
        });
        continue;
      }
      if (fields.length !== 4 && fields.length !== 5) {
        throw new Error('SEA source map contains an unsupported segment.');
      }
      sourceIndex += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      positions.push({
        generatedLine,
        generatedColumn,
        sourceIndex,
        originalLine,
        originalColumn,
      });
    }
  }
  return positions;
}

/**
 * Decode each parsed source map only once. The generated SEA map is large and
 * every crash case resolves both a target boundary and the adapter guard.
 * @param {Record<string, any>} sourceMap - Source Map v3 document.
 * @returns {ReturnType<typeof decodeSourceMapMappings>} - Cached boundaries.
 */
function getDecodedSourceMapMappings(sourceMap) {
  let decoded = DECODED_SOURCE_MAPS.get(sourceMap);
  if (!decoded) {
    decoded = decodeSourceMapMappings(sourceMap);
    DECODED_SOURCE_MAPS.set(sourceMap, decoded);
  }
  return decoded;
}

/**
 * Parse one inline application/json source map URL.
 * @param {string} value - scriptParsed sourceMapURL.
 * @returns {Record<string, any> | null} - Parsed map or null for another URL.
 */
function parseInlineSourceMap(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) return null;
  const comma = value.indexOf(',');
  if (comma < 0) throw new Error('Inline SEA source map has no data payload.');
  const header = value.slice(0, comma);
  if (!/^data:application\/json(?:;[^,]*)?$/.test(header)) return null;
  const encoded = value.slice(comma + 1);
  const text = /;base64(?:;|$)/.test(header)
    ? Buffer.from(encoded, 'base64').toString('utf8')
    : decodeURIComponent(encoded);
  return JSON.parse(text);
}

/**
 * Resolve an original source anchor to the closest generated mapping.
 * @param {Record<string, any>} sourceMap - Parsed inline map.
 * @param {{sourceSuffix: string, anchor: string, occurrence?: number, expectedSourceContent?: string}} target - Stable source target.
 * @returns {{generatedLine: number, generatedColumn: number, generatedCandidates: Array<{generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number}>, source: string, sourceIndex: number, originalLine: number, originalColumn: number, originalAnchorColumn: number, originalAnchorEndColumn: number}} - Generated breakpoints inside the exact anchor span.
 */
export function resolveSourceMapAnchor(sourceMap, target) {
  if (
    !target ||
    typeof target.sourceSuffix !== 'string' ||
    !target.sourceSuffix ||
    typeof target.anchor !== 'string' ||
    !target.anchor
  ) {
    throw new TypeError('Source breakpoint requires sourceSuffix and anchor.');
  }
  const normalizedSuffix = target.sourceSuffix.replaceAll('\\', '/');
  const matchingSources = (sourceMap.sources || [])
    .map((/** @type {unknown} */ source, /** @type {number} */ index) => ({
      source,
      index,
    }))
    .filter(
      (/** @type {{source: unknown, index: number}} */ { source }) =>
        typeof source === 'string' &&
        source.replaceAll('\\', '/').endsWith(normalizedSuffix),
    );
  if (matchingSources.length !== 1) {
    throw new Error(
      `SEA source map resolved ${matchingSources.length} sources for ${target.sourceSuffix}.`,
    );
  }
  const selected = matchingSources[0];
  if (typeof selected.source !== 'string') {
    throw new Error('SEA source map selected a non-string source.');
  }
  const content = sourceMap.sourcesContent?.[selected.index];
  if (typeof content !== 'string') {
    throw new Error(`SEA source map omitted content for ${selected.source}.`);
  }
  if (
    target.expectedSourceContent !== undefined &&
    content !== target.expectedSourceContent
  ) {
    throw new Error(
      `SEA source-map content does not match the installed source for ${selected.source}.`,
    );
  }
  const lines = content.split(/\r?\n/);
  const occurrences = [];
  for (const [index, line] of lines.entries()) {
    let from = 0;
    for (;;) {
      const column = line.indexOf(target.anchor, from);
      if (column < 0) break;
      occurrences.push({ line: index, column });
      from = column + Math.max(1, target.anchor.length);
    }
  }
  const occurrence = target.occurrence ?? 1;
  if (!Number.isSafeInteger(occurrence) || occurrence < 1) {
    throw new TypeError('Source breakpoint occurrence must be positive.');
  }
  const anchor = occurrences[occurrence - 1];
  if (!anchor) {
    throw new Error(
      `SEA source ${selected.source} has only ${occurrences.length} occurrences of ${JSON.stringify(target.anchor)}.`,
    );
  }
  const originalLine = anchor.line;
  const candidates =
    /** @type {Array<{generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number}>} */ (
      getDecodedSourceMapMappings(sourceMap).filter(
        (position) =>
          position.sourceIndex !== null &&
          position.originalLine !== null &&
          position.originalColumn !== null &&
          position.sourceIndex === selected.index &&
          position.originalLine === originalLine,
      )
    );
  if (candidates.length === 0) {
    throw new Error(
      `SEA source map has no generated mapping for ${selected.source}:${originalLine + 1}.`,
    );
  }
  const anchorEndColumn = anchor.column + target.anchor.length;
  const exact = candidates.filter(
    (position) =>
      position.originalColumn >= anchor.column &&
      position.originalColumn < anchorEndColumn,
  );
  if (exact.length === 0) {
    throw new Error(
      `SEA source map has no generated mapping inside the exact anchor span for ${selected.source}:${originalLine + 1}:${anchor.column}-${anchorEndColumn}.`,
    );
  }
  exact.sort(
    (left, right) =>
      left.generatedLine - right.generatedLine ||
      left.generatedColumn - right.generatedColumn,
  );
  const position = exact[0];
  return {
    generatedLine: position.generatedLine,
    generatedColumn: position.generatedColumn,
    generatedCandidates: exact.map((candidate) => ({ ...candidate })),
    source: selected.source,
    sourceIndex: selected.index,
    originalLine,
    originalColumn: position.originalColumn,
    originalAnchorColumn: anchor.column,
    originalAnchorEndColumn: anchorEndColumn,
  };
}

/** Chrome DevTools Protocol session over Node's inspector WebSocket. */
class InspectorProtocolSession {
  /** @param {string} url - Inspector WebSocket URL. */
  constructor(url) {
    const WebSocketClient = globalThis.WebSocket;
    if (typeof WebSocketClient !== 'function') {
      throw new Error('This verifier requires the built-in WebSocket client.');
    }
    this.socket = new WebSocketClient(url);
    this.nextId = 1;
    this.closed = false;
    /** @type {Map<number, {resolve: (value: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>}>} */
    this.pending = new Map();
    /** @type {Record<string, any>[]} */
    this.events = [];
    /** @type {Array<{method: string, predicate: (params: Record<string, any>) => boolean, resolve: (params: Record<string, any>) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>}>} */
    this.waiters = [];
    this.opened = new Promise((resolve, reject) => {
      this.socket.addEventListener('open', () => resolve(undefined), {
        once: true,
      });
      this.socket.addEventListener(
        'error',
        () => reject(new Error('Could not connect to the SEA inspector.')),
        { once: true },
      );
    });
    this.socket.addEventListener('message', (event) => {
      this.handleMessage(event.data);
    });
    this.socket.addEventListener('close', () => {
      this.fail(new Error('SEA inspector connection closed.'));
    });
  }

  /** @param {unknown} value - WebSocket message bytes. */
  handleMessage(value) {
    let message;
    try {
      const text =
        typeof value === 'string'
          ? value
          : Buffer.from(/** @type {ArrayBuffer} */ (value)).toString('utf8');
      message = JSON.parse(text);
    } catch (error) {
      this.fail(
        new Error(
          `SEA inspector returned an invalid message: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    if (Number.isSafeInteger(message.id)) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new Error(
            `SEA inspector ${message.error.code}: ${message.error.message}`,
          ),
        );
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    if (typeof message.method !== 'string') return;
    const params = message.params || {};
    const waiterIndex = this.waiters.findIndex(
      (waiter) => waiter.method === message.method && waiter.predicate(params),
    );
    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(params);
      return;
    }
    this.events.push({ method: message.method, params });
  }

  /** @param {Error} error - Terminal protocol failure. */
  fail(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  }

  /**
   * @param {string} method - CDP method.
   * @param {Record<string, any>} [params] - Method params.
   * @param {number} [timeoutMs] - Maximum command wait.
   * @returns {Promise<Record<string, any>>} - CDP result.
   */
  async send(method, params = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    await this.opened;
    if (this.closed) throw new Error('SEA inspector is closed.');
    const id = this.nextId++;
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            `SEA inspector command ${method} timed out after ${timeoutMs}ms.`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    try {
      this.socket.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(id);
      }
      throw error;
    }
    return await result;
  }

  /**
   * @param {string} method - CDP event method.
   * @param {(params: Record<string, any>) => boolean} [predicate] - Event filter.
   * @param {number} [timeoutMs] - Maximum wait.
   * @returns {Promise<Record<string, any>>} - Event params.
   */
  async waitForEvent(
    method,
    predicate = () => true,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    const existingIndex = this.events.findIndex(
      (event) => event.method === method && predicate(event.params),
    );
    if (existingIndex >= 0) {
      const [event] = this.events.splice(existingIndex, 1);
      return event.params;
    }
    if (this.closed) throw new Error('SEA inspector is closed.');
    return await new Promise((resolve, reject) => {
      const waiter = {
        method,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(
            new Error(
              `SEA inspector event ${method} timed out after ${timeoutMs}ms.`,
            ),
          );
        }, timeoutMs),
      };
      this.waiters.push(waiter);
    });
  }

  /** Close the client without waiting for the debuggee. */
  close() {
    this.fail(new Error('SEA inspector was closed by the verifier.'));
    try {
      this.socket.close();
    } catch {}
  }
}

/**
 * Attach to a --inspect-brk process and expose source-mapped breakpoints.
 * @param {{inspectorUrl: Promise<string>}} processHandle - Paused process.
 * @param {{timeoutMs?: number}} [options] - Protocol timeout.
 * @returns {Promise<{setSourceBreakpoint: (name: string, target: {sourceSuffix: string, anchor: string, occurrence?: number, expectedSourceContent?: string}) => Promise<{name: string, breakpointId: string, breakpointIds: string[], source: string, originalLine: number, originalColumn: number, generatedLine: number, generatedColumn: number}>, resume: () => Promise<void>, waitForPause: () => Promise<Record<string, any>>, close: () => void}>} - Inspector controller.
 */
export async function attachSeaInspector(processHandle, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = await processHandle.inspectorUrl;
  const session = new InspectorProtocolSession(url);
  /** @type {{scriptId: string, sourceMap: Record<string, any>} | undefined} */
  let bundle;
  try {
    await withTimeout(session.opened, timeoutMs, 'SEA inspector connection');
    await session.send('Runtime.enable', {}, timeoutMs);
    await session.send('Debugger.enable', {}, timeoutMs);
    const catcher = await session.send(
      'Debugger.setBreakpointByUrl',
      {
        lineNumber: 0,
        columnNumber: 0,
        urlRegex: '(?:^|/)esbundle\\.js$',
      },
      timeoutMs,
    );
    if (typeof catcher.breakpointId !== 'string') {
      throw new Error(
        'SEA inspector did not retain its application bootstrap breakpoint.',
      );
    }
    await session.send('Runtime.runIfWaitingForDebugger', {}, timeoutMs);
    await session.waitForEvent('Debugger.paused', () => true, timeoutMs);
    await session.send('Debugger.resume', {}, timeoutMs);
    const applicationPause = await session.waitForEvent(
      'Debugger.paused',
      () => true,
      timeoutMs,
    );
    if (
      !Array.isArray(applicationPause.hitBreakpoints) ||
      applicationPause.hitBreakpoints.length !== 1 ||
      applicationPause.hitBreakpoints[0] !== catcher.breakpointId
    ) {
      throw new Error(
        `SEA inspector did not pause at the application bootstrap breakpoint: ${JSON.stringify(applicationPause.hitBreakpoints || [])}.`,
      );
    }
    const retainedEvents = [];
    const candidates = [];
    for (const event of session.events) {
      if (
        event.method === 'Debugger.scriptParsed' &&
        /(?:^|\/)esbundle\.js$/.test(String(event.params.url || ''))
      ) {
        const sourceMap = parseInlineSourceMap(event.params.sourceMapURL);
        if (sourceMap) {
          candidates.push({
            scriptId: event.params.scriptId,
            sourceMap,
          });
        }
      } else {
        retainedEvents.push(event);
      }
    }
    session.events = retainedEvents;
    if (candidates.length !== 1) {
      throw new Error(
        `SEA inspector resolved ${candidates.length} application bundle source maps.`,
      );
    }
    [bundle] = candidates;
    await session.send(
      'Debugger.removeBreakpoint',
      { breakpointId: catcher.breakpointId },
      timeoutMs,
    );
  } catch (error) {
    session.close();
    throw error;
  }

  return {
    setSourceBreakpoint: async (name, target) => {
      if (!bundle) {
        throw new Error('SEA inspector has no application bundle source map.');
      }
      const location = resolveSourceMapAnchor(bundle.sourceMap, target);
      const retained = [];
      const retainedLocations = new Set();
      for (const candidate of location.generatedCandidates) {
        const result = await session.send(
          'Debugger.setBreakpoint',
          {
            location: {
              scriptId: bundle.scriptId,
              lineNumber: candidate.generatedLine,
              columnNumber: candidate.generatedColumn,
            },
          },
          timeoutMs,
        );
        if (typeof result.breakpointId !== 'string') {
          throw new Error(`SEA inspector did not retain breakpoint ${name}.`);
        }
        const actual = result.actualLocation;
        if (
          !actual ||
          actual.scriptId !== bundle.scriptId ||
          actual.lineNumber !== candidate.generatedLine
        ) {
          await session.send(
            'Debugger.removeBreakpoint',
            { breakpointId: result.breakpointId },
            timeoutMs,
          );
          continue;
        }
        const reverse =
          /** @type {{generatedLine: number, generatedColumn: number, sourceIndex: number, originalLine: number, originalColumn: number} | undefined} */ (
            getDecodedSourceMapMappings(bundle.sourceMap)
              .filter(
                (position) =>
                  position.sourceIndex !== null &&
                  position.originalLine !== null &&
                  position.originalColumn !== null &&
                  position.generatedLine === actual.lineNumber &&
                  position.generatedColumn <= actual.columnNumber,
              )
              .sort(
                (left, right) => right.generatedColumn - left.generatedColumn,
              )[0]
          );
        if (
          !reverse ||
          reverse.sourceIndex !== location.sourceIndex ||
          reverse.originalLine !== location.originalLine ||
          reverse.originalColumn < location.originalAnchorColumn ||
          reverse.originalColumn >= location.originalAnchorEndColumn
        ) {
          await session.send(
            'Debugger.removeBreakpoint',
            { breakpointId: result.breakpointId },
            timeoutMs,
          );
          continue;
        }
        const key = `${actual.lineNumber}:${actual.columnNumber}`;
        if (retainedLocations.has(key)) {
          await session.send(
            'Debugger.removeBreakpoint',
            { breakpointId: result.breakpointId },
            timeoutMs,
          );
          continue;
        }
        retainedLocations.add(key);
        retained.push({
          breakpointId: result.breakpointId,
          generatedLine: actual.lineNumber,
          generatedColumn: actual.columnNumber,
        });
      }
      if (retained.length === 0) {
        throw new Error(`SEA inspector retained no breakpoint for ${name}.`);
      }
      const primary = retained[0];
      return {
        name,
        breakpointId: primary.breakpointId,
        breakpointIds: retained.map((item) => item.breakpointId),
        source: location.source,
        originalLine: location.originalLine,
        originalColumn: location.originalColumn,
        generatedLine: primary.generatedLine,
        generatedColumn: primary.generatedColumn,
      };
    },
    resume: async () => {
      await session.send('Debugger.resume', {}, timeoutMs);
    },
    waitForPause: async () =>
      await session.waitForEvent('Debugger.paused', () => true, timeoutMs),
    close: () => session.close(),
  };
}

export default {
  attachSeaInspector,
  resolveSourceMapAnchor,
  spawnInspectorPausedProcess,
};
