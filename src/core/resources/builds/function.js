import { getAsset } from '../../lib/node-sea.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync } from 'node:zlib';

import worker from '../../lib/code-execution/worker.js';
import {
  ActivityAttemptProtocolError,
  getActivityAttemptProtocolSymbol,
  runNodeActivityAttempt,
} from '../../runtime/activity-attempt.js';
import {
  ActivityProtocolTranscriptValidator,
  validateActivityProtocolComponentFrame,
  validateActivityProtocolHostFrame,
} from '../../runtime/activity-protocol.js';
import { createActorSystemResources } from '../../runtime/resources.js';
import { assertNoActivityEnvironmentVariables } from './lib/activity-environment.js';
import { parseFunctionAssetDescription } from './lib/function-asset.js';
import { validateSha256Digest } from '../../runtime/application-revision.js';
import { cloneJsonObject } from '../../runtime/json-value.js';
import { assertLogicalId } from '../../runtime/logical-id.js';
import { normalizeExternalDependencies } from './lib/resolve-externals.js';

/**
 * @typedef ExternalDependencyDescription
 * @property {string} name - name.
 * @property {string} version - version.
 */

/**
 * @typedef ExternalDependencyInput
 * @property {string} name - name.
 * @property {string} version - Exact canonical semantic version.
 */

/**
 * @typedef FunctionProperties
 * @property {(string | ExternalDependencyInput)[]} [external] - external.
 * @property {Record<string, any>} [resources] - Function-scoped runtime resources or specs.
 */

/**
 * @typedef FunctionEntrypoint
 * @property {string} path - path.
 * @property {string} [export] - export.
 */

/**
 * @typedef FunctionOptions
 * @property {string} name - name.
 * @property {FunctionEntrypoint} entrypoint - entrypoint.
 * @property {FunctionProperties} [properties] - properties.
 */

/**
 * @typedef FunctionRunOptions
 * @property {Record<string, any>} [resources] - In-process resource instances to expose to the sandbox via RPC.
 */

/**
 * @typedef PreparedFunctionBundle
 * @property {string} codeString - Exact bundled activity source.
 * @property {Buffer | Uint8Array | null} [externalsTar] - Exact frozen external archive bytes.
 * @property {import('../../runtime/application-revision.js').Sha256Digest} [externalArchiveDigest] - Expected raw archive digest.
 * @property {Record<string, any>} [resourceSpecs] - Function-scoped resource declarations.
 */

/**
 * @typedef FunctionInvokeOptions
 * @property {Record<string, any>} [baseResources] - Base resources to merge beneath function-scoped resources.
 */

/**
 * @param {any} v - v.
 * @returns {boolean} - Result.
 */
function isObject(v) {
  return !!v && typeof v === 'object';
}

/**
 * @param {Record<string, any> | null | undefined} resources - resources.
 * @returns {boolean} - Result.
 */
function hasAnyResources(resources) {
  return !!resources && Object.keys(resources).length > 0;
}

/**
 * Split a context object into:
 * - a clone-safe context (no resource client instances)
 * - an RPC resource map to be hosted in the parent process
 *
 * We conservatively treat `context.resources.{db,queue,objectStorage}` as RPC candidates
 * when the value looks like a client instance (has at least one function property).
 * @param {any} context - context.
 * @returns {{ safeContext: any, rpcResources: Record<string, any> | null }} - Result.
 */
function splitContextForWorker(context) {
  if (!isObject(context)) return { safeContext: context, rpcResources: null };

  const res = context.resources;
  if (!isObject(res)) return { safeContext: context, rpcResources: null };

  /** @type {Record<string, any>} */
  const rpcResources = {};
  const safeResources = { ...res };

  for (const key of ['db', 'queue', 'objectStorage']) {
    const v = res[key];
    if (!isObject(v)) continue;

    // Heuristic: client instances have at least one function property.
    const hasFn = Object.values(v).some((x) => typeof x === 'function');
    if (!hasFn) continue;

    rpcResources[key] = v;
    delete safeResources[key];
  }

  if (Object.keys(rpcResources).length === 0) {
    return { safeContext: context, rpcResources: null };
  }

  return {
    safeContext: { ...context, resources: safeResources },
    rpcResources,
  };
}

/**
 * An untrusted sandbox return value was not a valid restricted attempt
 * transcript. Its local cause stays in-process; callers only receive a stable
 * protocol-shaped diagnostic.
 */
export class ActivityAttemptEvidenceError extends ActivityAttemptProtocolError {
  /**
   * @param {string} message - Safe diagnostic message.
   * @param {Record<string, any>} [details] - Safe structured details.
   * @param {{cause?: unknown}} [options] - Local-only cause.
   */
  constructor(message, details = {}, options = {}) {
    super('activity-attempt-evidence-invalid', message, details, options);
    this.name = 'ActivityAttemptEvidenceError';
  }
}

/**
 * The transitional worker boundary could not produce evidence for an attempt.
 * This intentionally has no fabricated component terminal: a failed worker
 * transport does not prove what component code did or did not execute.
 */
export class ActivityAttemptTransportError extends Error {
  /**
   * @param {Readonly<Record<string, any>>} start - Accepted start frame.
   * @param {unknown} cause - Local worker/transport failure.
   */
  constructor(start, cause) {
    super('The activity attempt transport did not return verifiable evidence.');
    this.name = 'ActivityAttemptTransportError';
    this.code = 'activity-attempt-transport-failed';
    this.start = start;
    this.attemptId = start.attemptId;
    this.cause = cause;
  }
}

/**
 * @param {any} value - Value to freeze recursively.
 * @returns {any} - Same frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Compare two already strict JSON values without relying on object insertion
 * order. Protocol evidence from a worker may legitimately have a different
 * property order after structured cloning.
 * @param {any} left - First JSON value.
 * @param {any} right - Second JSON value.
 * @returns {boolean} - Whether values are structurally identical.
 */
function hasSameJsonValue(left, right) {
  if (Object.is(left, right)) return true;
  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return (
      left.length === right.length &&
      left.every((item, index) => hasSameJsonValue(item, right[index]))
    );
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && hasSameJsonValue(left[key], right[key]),
    )
  );
}

/**
 * @param {Record<string, any>} value - Candidate object.
 * @param {string[]} keys - Exact supported keys.
 * @param {string} label - Human-readable value name.
 * @returns {void}
 */
function assertExactKeys(value, keys, label) {
  const allowed = new Set(keys);
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new TypeError(`${label} has unsupported or missing fields.`);
  }
}

/**
 * Validate one host-owned start before it is passed into an in-process handler
 * or the worker. This binds a bundle selection to its declared activity ID.
 * @param {string} name - Declared activity ID.
 * @param {unknown} value - Candidate start frame.
 * @returns {Readonly<Record<string, any>>} - Validated immutable start.
 */
function validateActivityAttemptStart(name, value) {
  assertLogicalId(name, 'activity name');
  let start;
  try {
    start = validateActivityProtocolHostFrame(value, 'activity attempt start');
  } catch (cause) {
    throw new ActivityAttemptProtocolError(
      'activity-start-invalid',
      'The activity host supplied an invalid attempt start frame.',
      {},
      { cause },
    );
  }
  if (start.type !== 'start') {
    throw new ActivityAttemptProtocolError(
      'activity-start-invalid',
      'The activity host must begin an attempt with a start frame.',
    );
  }
  if (start.activityId !== name) {
    throw new ActivityAttemptProtocolError(
      'activity-id-mismatch',
      'The activity attempt start does not select this activity bundle.',
      { expectedActivityId: name, receivedActivityId: start.activityId },
    );
  }
  return start;
}

/**
 * Revalidate the only transcript shape the initial private worker wrapper can
 * honestly produce. There is no worker frame transport, cancellation channel,
 * or managed-effect host yet, so accepting fabricated effects/cancel frames
 * would incorrectly claim capabilities that do not exist.
 * @param {unknown} value - Candidate worker result.
 * @param {Readonly<Record<string, any>>} expectedStart - Host-accepted start.
 * @returns {Readonly<import('../../runtime/activity-attempt.js').ActivityAttemptEvidence>} - Fresh frozen evidence.
 */
function revalidateWorkerActivityAttemptEvidence(value, expectedStart) {
  try {
    const evidence = cloneJsonObject(value, 'worker activity attempt evidence');
    assertExactKeys(
      evidence,
      ['status', 'start', 'terminal', 'frames', 'transcript'],
      'worker activity attempt evidence',
    );
    if (!Array.isArray(evidence.frames) || evidence.frames.length < 2) {
      throw new TypeError(
        'worker activity attempt evidence.frames must contain a start and terminal frame.',
      );
    }
    const workerStart = validateActivityProtocolHostFrame(
      evidence.start,
      'worker activity attempt evidence.start',
    );
    if (
      workerStart.type !== 'start' ||
      !hasSameJsonValue(workerStart, expectedStart)
    ) {
      throw new TypeError(
        'worker activity attempt evidence.start does not match the host start frame.',
      );
    }

    const transcript = new ActivityProtocolTranscriptValidator();
    /** @type {Readonly<Record<string, any>>[]} */
    const frames = [];
    let terminal = /** @type {Readonly<Record<string, any>> | null} */ (null);
    for (const [index, frame] of evidence.frames.entries()) {
      if (index === 0) {
        const accepted = transcript.acceptHostFrame(frame);
        if (
          accepted.type !== 'start' ||
          !hasSameJsonValue(accepted, expectedStart)
        ) {
          throw new TypeError(
            'worker activity attempt evidence.frames[0] does not match the host start frame.',
          );
        }
        frames.push(accepted);
        continue;
      }

      const accepted = validateActivityProtocolComponentFrame(
        frame,
        `worker activity attempt evidence.frames[${index}]`,
      );
      const isTerminal = [
        'completed',
        'failed',
        'deadline-exceeded',
        'protocol-failed',
      ].includes(accepted.type);
      if (accepted.type !== 'log' && !isTerminal) {
        throw new TypeError(
          'The private activity wrapper cannot return cancellation or managed-effect frames.',
        );
      }
      if (isTerminal && index !== evidence.frames.length - 1) {
        throw new TypeError(
          'The activity terminal must be the final worker evidence frame.',
        );
      }
      const acceptedByTranscript = transcript.acceptComponentFrame(accepted);
      frames.push(acceptedByTranscript);
      if (isTerminal) terminal = acceptedByTranscript;
    }

    if (!terminal) {
      throw new TypeError(
        'worker activity attempt evidence has no terminal frame.',
      );
    }
    if (!hasSameJsonValue(evidence.terminal, terminal)) {
      throw new TypeError(
        'worker activity attempt evidence.terminal does not match its final frame.',
      );
    }
    if (evidence.status !== terminal.type) {
      throw new TypeError(
        'worker activity attempt evidence.status does not match its terminal type.',
      );
    }
    const snapshot = transcript.snapshot();
    if (!hasSameJsonValue(evidence.transcript, snapshot)) {
      throw new TypeError(
        'worker activity attempt evidence.transcript does not match its frames.',
      );
    }
    return /** @type {Readonly<import('../../runtime/activity-attempt.js').ActivityAttemptEvidence>} */ (
      deepFreeze({
        status: terminal.type,
        start: frames[0],
        terminal,
        frames,
        transcript: snapshot,
      })
    );
  } catch (cause) {
    if (cause instanceof ActivityAttemptEvidenceError) throw cause;
    throw new ActivityAttemptEvidenceError(
      'The activity worker returned invalid attempt evidence.',
      {},
      { cause },
    );
  }
}

/**
 * Validate a prepared code/archive pair without creating resources, RPC
 * sessions, or a worker. The new Activity Protocol path deliberately reuses
 * only this frozen-bundle integrity boundary from legacy Function.run.
 * @param {PreparedFunctionBundle} bundle - Exact in-memory runtime bundle.
 * @returns {{ functionCodeString: string, externalsTar: Buffer | null, externalBundleDigest: string }} - Validated prepared bytes.
 */
function validatePreparedBundle(bundle) {
  if (
    !bundle ||
    typeof bundle !== 'object' ||
    Array.isArray(bundle) ||
    typeof bundle.codeString !== 'string' ||
    bundle.codeString.length === 0
  ) {
    throw new TypeError(
      'Prepared function bundle requires a nonempty codeString.',
    );
  }
  const functionCodeString = bundle.codeString;
  const externalsTar =
    bundle.externalsTar === undefined || bundle.externalsTar === null
      ? null
      : Buffer.from(bundle.externalsTar);
  if (externalsTar && externalsTar.length === 0) {
    throw new TypeError(
      'Prepared function bundle externalsTar must not be empty when provided.',
    );
  }
  if (externalsTar) {
    const expectedArchiveDigest = validateSha256Digest(
      bundle.externalArchiveDigest,
      'prepared function bundle externalArchiveDigest',
    );
    const actualArchiveDigest = {
      algorithm: 'sha256',
      value: createHash('sha256').update(externalsTar).digest('base64url'),
    };
    if (
      actualArchiveDigest.algorithm !== expectedArchiveDigest.algorithm ||
      actualArchiveDigest.value !== expectedArchiveDigest.value
    ) {
      throw new Error(
        'Bundled external archive does not match its embedded build digest.',
      );
    }
  } else if (
    Object.prototype.hasOwnProperty.call(bundle, 'externalArchiveDigest')
  ) {
    throw new Error(
      'Prepared function bundle declares an external archive digest without archive bytes.',
    );
  }
  return {
    functionCodeString,
    externalsTar,
    externalBundleDigest: worker.getExternalBundleDigest(externalsTar),
  };
}

class Function {
  /**
   * @param {FunctionOptions} options - options.
   */
  constructor({ name, entrypoint, properties = {} }) {
    if (!name) {
      throw new Error('Function expects a name as an argument');
    }
    const untypedProperties = /** @type {Record<string, any>} */ (properties);
    assertNoActivityEnvironmentVariables(
      untypedProperties.environmentVariables,
      name,
    );
    const { external, resources } = properties;
    const normalizedExternal = normalizeExternalDependencies(
      external,
      entrypoint?.path,
    );
    this.name = name;
    this.entrypoint = entrypoint;
    this.properties = {
      ...(normalizedExternal ? { external: normalizedExternal } : {}),
      ...(resources ? { resources } : {}),
    };
    /** @type {Promise<{ resources: Record<string, any>, close: () => Promise<void> }> | null} */
    this._runtimeResourcesPromise = null;
  }

  /**
   * Lazily create and cache runtime resources from `properties.resources`.
   * @returns {Promise<{ resources: Record<string, any>, close: () => Promise<void> }>} - Result.
   */
  async _ensureRuntimeResources() {
    if (this._runtimeResourcesPromise) return this._runtimeResourcesPromise;

    const specs = isObject(this.properties?.resources)
      ? this.properties.resources
      : {};

    if (!hasAnyResources(specs)) {
      this._runtimeResourcesPromise = Promise.resolve({
        resources: {},
        close: async () => {},
      });
      return this._runtimeResourcesPromise;
    }

    this._runtimeResourcesPromise = createActorSystemResources(specs);
    return this._runtimeResourcesPromise;
  }

  /**
   * Get the instantiated runtime resources for this Function.
   * @returns {Promise<Record<string, any>>} - Result.
   */
  async getRuntimeResources() {
    const { resources } = await this._ensureRuntimeResources();
    return resources;
  }

  /**
   * Close all cached runtime resources (best-effort).
   * @returns {Promise<void>} - Result.
   */
  async closeRuntimeResources() {
    if (!this._runtimeResourcesPromise) return;
    const { close } = await this._ensureRuntimeResources();
    await close();
    this._runtimeResourcesPromise = null;
  }

  /**
   * Build a context object for function invocation.
   *
   * Precedence is: base resources < function resources < caller-provided resources.
   * @param {any} [context] - context.
   * @param {Record<string, any>} [baseResources] - baseResources.
   * @returns {Promise<any>} - Result.
   */
  async createContext(context = {}, baseResources = {}) {
    const functionResources = await this.getRuntimeResources();
    const overrideResources = isObject(context?.resources)
      ? context.resources
      : {};
    const mergedResources = {
      ...(baseResources || {}),
      ...(functionResources || {}),
      ...(overrideResources || {}),
    };

    const shouldAttachResources =
      hasAnyResources(mergedResources) ||
      (isObject(context) &&
        Object.prototype.hasOwnProperty.call(context, 'resources'));

    if (!shouldAttachResources) {
      return context;
    }

    return {
      ...context,
      resources: mergedResources,
    };
  }

  /**
   * Run a bundled function in the sandbox worker.
   *
   * If `options.resources` (or `context.resources.{db,queue,objectStorage}`) contains
   * in-process resource client instances, they are exposed to the worker via an RPC
   * bridge, and the worker sees them as `context.resources.*` proxies.
   *
   * Bundled functions can also embed `resourceSpecs`; Wharfie will instantiate those
   * resources per invocation and merge them between host resources and caller overrides.
   * @param {string} name - name.
   * @param {PreparedFunctionBundle} bundle - Exact in-memory runtime bundle.
   * @param {any} event - event.
   * @param {any} context - context.
   * @param {FunctionRunOptions} [options] - options.
   * @returns {Promise<any>} - Result.
   */
  static async runPreparedBundle(
    name,
    bundle,
    event,
    context = {},
    options = {},
  ) {
    const { functionCodeString, externalsTar, externalBundleDigest } =
      validatePreparedBundle(bundle);

    const split = splitContextForWorker(context);
    const safeContext = split.safeContext;
    const contextRpcResources = split.rpcResources || {};

    /** @type {{ resources: Record<string, any>, close: () => Promise<void> } | null} */
    let scopedResources = null;
    const bundledResourceSpecs = isObject(bundle.resourceSpecs)
      ? bundle.resourceSpecs
      : null;

    try {
      if (bundledResourceSpecs && hasAnyResources(bundledResourceSpecs)) {
        scopedResources =
          await createActorSystemResources(bundledResourceSpecs);
      }

      const rpcResources = {
        ...((options?.resources && isObject(options.resources)
          ? options.resources
          : {}) || {}),
        ...(scopedResources?.resources || {} || {}),
        ...(contextRpcResources || {}),
      };

      return await worker.runInSandbox(
        name,
        functionCodeString,
        [event, safeContext],
        {
          ...(externalsTar && externalsTar.length > 0 ? { externalsTar } : {}),
          externalBundleDigest,
          rpc: hasAnyResources(rpcResources)
            ? { resources: rpcResources, contextIndex: 1 }
            : undefined,
        },
      );
    } finally {
      try {
        if (scopedResources) {
          await scopedResources.close();
        }
      } finally {
        await worker._destroyWorker(
          name,
          functionCodeString,
          externalBundleDigest,
        );
      }
    }
  }

  /**
   * Run the private Activity Protocol v1 bundle entrypoint. This is separate
   * from runPreparedBundle on purpose: it never instantiates resource specs,
   * merges caller resources, or creates the legacy arbitrary resource RPC.
   * The worker's old exec message is only a temporary byte transport for an
   * otherwise self-contained protocol attempt wrapper.
   * @param {string} name - Declared activity ID.
   * @param {PreparedFunctionBundle} bundle - Exact in-memory runtime bundle.
   * @param {unknown} startFrame - Host-owned Activity Protocol start frame.
   * @returns {Promise<Readonly<import('../../runtime/activity-attempt.js').ActivityAttemptEvidence>>} - Revalidated attempt evidence.
   */
  static async runPreparedActivityAttempt(name, bundle, startFrame) {
    const start = validateActivityAttemptStart(name, startFrame);
    const { functionCodeString, externalsTar, externalBundleDigest } =
      validatePreparedBundle(bundle);
    let rawEvidence;
    /** @type {unknown} */
    let transportFailure;
    try {
      rawEvidence = await worker.runInSandbox(
        name,
        functionCodeString,
        [{ startFrame: start }],
        {
          ...(externalsTar && externalsTar.length > 0 ? { externalsTar } : {}),
          externalBundleDigest,
          entrypointSymbol: getActivityAttemptProtocolSymbol(name),
        },
      );
    } catch (cause) {
      transportFailure = cause;
    }
    try {
      await worker._destroyWorker(
        name,
        functionCodeString,
        externalBundleDigest,
      );
    } catch (cleanupFailure) {
      transportFailure = transportFailure
        ? new AggregateError(
            [transportFailure, cleanupFailure],
            'The activity worker failed and its cleanup was incomplete.',
          )
        : cleanupFailure;
    }
    if (transportFailure) {
      throw new ActivityAttemptTransportError(start, transportFailure);
    }

    return revalidateWorkerActivityAttemptEvidence(rawEvidence, start);
  }

  /**
   * Read and validate a packaged activity asset into the same prepared-bundle
   * shape used for source execution. The code bytes are still content-bound by
   * the function asset and its frozen external archive receipt.
   * @param {string} name - Declared activity ID.
   * @returns {Promise<PreparedFunctionBundle>} - Exact prepared bundle.
   */
  static async readPackagedBundle(name) {
    const functionAssetBuffer = await getAsset(name);
    const functionDescriptionBuffer = Buffer.from(functionAssetBuffer);
    const {
      description: assetDescription,
      codeBundleBytes,
      externalArchiveBytes,
    } = parseFunctionAssetDescription(
      functionDescriptionBuffer,
      `Packaged activity '${name}' function asset`,
    );
    const functionBuffer = brotliDecompressSync(codeBundleBytes);
    if (assetDescription.activity !== name) {
      throw new Error(
        `Packaged activity '${name}' does not match function asset activity '${assetDescription.activity}'.`,
      );
    }
    const target = assetDescription.target;
    if (
      target.nodeVersion !== process.versions.node ||
      target.platform !== process.platform ||
      target.architecture !== process.arch
    ) {
      throw new Error(
        `Packaged activity '${name}' function asset target does not match the running executable.`,
      );
    }
    const runtimeReport = /** @type {any} */ (process.report?.getReport?.());
    if (
      target.platform === 'linux' &&
      !runtimeReport?.header?.glibcVersionRuntime
    ) {
      throw new Error(
        `Packaged activity '${name}' requires a positively identified glibc runtime.`,
      );
    }
    const externalsTar =
      externalArchiveBytes.length > 0 ? externalArchiveBytes : null;
    const externalDependencyReceipt =
      assetDescription.externalDependencyReceipt;
    return {
      codeString: functionBuffer.toString(),
      ...(externalsTar ? { externalsTar } : {}),
      ...(externalDependencyReceipt
        ? { externalArchiveDigest: externalDependencyReceipt.archiveDigest }
        : {}),
      resourceSpecs: assetDescription.resourceSpecs,
    };
  }

  /**
   * Run one activity embedded in a packaged SEA asset.
   * @param {string} name - name.
   * @param {any} event - event.
   * @param {any} context - context.
   * @param {FunctionRunOptions} [options] - options.
   * @returns {Promise<any>} - Result.
   */
  static async run(name, event, context = {}, options = {}) {
    const bundle = await Function.readPackagedBundle(name);
    return await Function.runPreparedBundle(
      name,
      bundle,
      event,
      context,
      options,
    );
  }

  /**
   * Run one packaged activity through the private Activity Protocol wrapper.
   * Unlike legacy run(), this does not construct a context or expose resource
   * RPC. It returns physical attempt evidence instead of an application value.
   * @param {string} name - Declared activity ID.
   * @param {unknown} startFrame - Host-owned Activity Protocol start frame.
   * @returns {Promise<Readonly<import('../../runtime/activity-attempt.js').ActivityAttemptEvidence>>} - Revalidated attempt evidence.
   */
  static async runActivityAttempt(name, startFrame) {
    const bundle = await Function.readPackagedBundle(name);
    return await Function.runPreparedActivityAttempt(name, bundle, startFrame);
  }

  /**
   * Resolve the selected source export without constructing a legacy resource
   * context. Both legacy fn() and the protocol attempt path use this exact
   * module/export selection rule.
   * @returns {Promise<(input: any, runtime: any) => any>} - Selected handler.
   */
  async _loadEntrypoint() {
    const entryPath = path.isAbsolute(this.entrypoint.path)
      ? this.entrypoint.path
      : path.resolve(this.entrypoint.path);

    // CJS: require() exists. ESM: use dynamic import().
    const handler =
      typeof require === 'function'
        ? // eslint-disable-next-line import/no-dynamic-require, no-undef
          require(entryPath)
        : await import(pathToFileURL(entryPath).href);

    const candidate = this.entrypoint.export
      ? handler?.[this.entrypoint.export]
      : // for ESM default exports
        (handler?.default ?? handler);

    if (typeof candidate !== 'function') {
      throw new TypeError(
        `Invalid function entrypoint: ${this.entrypoint.path} export ${
          this.entrypoint.export || 'default'
        } is not a function`,
      );
    }
    return candidate;
  }

  /**
   * Run a source activity through the Node Activity Protocol v1 adapter.
   * Source activities with external packages must still use the sealed bundle
   * path; this in-process path intentionally constructs no resource context.
   * @param {unknown} startFrame - Host-owned Activity Protocol start frame.
   * @returns {Promise<Readonly<import('../../runtime/activity-attempt.js').ActivityAttemptEvidence>>} - Physical attempt evidence.
   */
  async runActivityAttempt(startFrame) {
    if (
      Array.isArray(this.properties.external) &&
      this.properties.external.length > 0
    ) {
      throw new Error(
        `Source activity '${this.name}' declares external packages and must run through a prepared application revision.`,
      );
    }
    const start = validateActivityAttemptStart(this.name, startFrame);
    const handler = await this._loadEntrypoint();
    return await runNodeActivityAttempt({ startFrame: start, handler });
  }

  /**
   * Load the function entrypoint and invoke it in-process.
   *
   * This is primarily used by the (single-process) ActorSystem runtime.
   * @param {any} [event] - event.
   * @param {any} [context] - context.
   * @param {FunctionInvokeOptions} [options] - options.
   * @returns {Promise<any>} - Result.
   */
  async fn(event = {}, context = {}, options = {}) {
    if (
      Array.isArray(this.properties.external) &&
      this.properties.external.length > 0
    ) {
      throw new Error(
        `Source activity '${this.name}' declares external packages and must run through a prepared application revision; ambient node_modules are not execution inputs.`,
      );
    }
    const invocationContext = await this.createContext(
      context,
      options.baseResources || {},
    );
    const candidate = await this._loadEntrypoint();

    // Support both sync and async handlers.
    const result = candidate(event, invocationContext);
    if (result && typeof result.then === 'function') {
      return await result;
    }
    return result;
  }
}

export default Function;
