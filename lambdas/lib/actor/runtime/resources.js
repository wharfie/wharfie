/**
 * Actor-system runtime resources.
 *
 * The long-term goal is that an ActorSystem host process runs on N nodes and
 * exposes "resource interfaces" (DB, queue, object storage) to actors.
 *
 * Today, resources are instantiated in-process from adapter-based factories
 * and injected into the `context` passed to actor functions as `context.resources`.
 *
 * Resource specs are defined on the ActorSystem as `properties.resources`.
 *
 * A resource spec can be:
 *  - a string adapter name (e.g. 'vanilla', 'dynamodb', 'sqs', 's3', 'auto')
 *  - an object `{ adapter: string, options?: Record<string, any> }`
 *  - an already-created client instance (useful for tests / custom wiring)
 */

/**
 * @typedef {'auto'|'vanilla'|'dynamodb'|'lmdb'} DBAdapter
 * @typedef {'auto'|'vanilla'|'sqs'|'lmdb'} QueueAdapter
 * @typedef {'auto'|'vanilla'|'s3'|'r2'|'b2'} ObjectStorageAdapter
 * @typedef ResourceSpecObject
 * @property {string} adapter
 * @property {Record<string, any>} [options]
 * @typedef ActorSystemResourceSpecs
 * @property {string | ResourceSpecObject | any} [db]
 * @property {string | ResourceSpecObject | any} [queue]
 * @property {string | ResourceSpecObject | any} [objectStorage]
 * @typedef ActorSystemResources
 * @property {import('../../db/base.js').DBClient} [db]
 * @property {import('../../queue/base.js').QueueClient} [queue]
 * @property {import('../../object-storage/base.js').ObjectStorageClient} [objectStorage]
 */

/**
 * @param {any} v
 * @returns {v is Record<string, any>}
 */
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {any} v
 * @returns {v is ResourceSpecObject}
 */
function looksLikeSpecObject(v) {
  return (
    isPlainObject(v) && typeof v.adapter === 'string' && v.adapter.length > 0
  );
}

/**
 * @param {any} v
 * @returns {v is { close: () => any }}
 */
function looksClosable(v) {
  return !!v && typeof v === 'object' && typeof v.close === 'function';
}

/**
 * @returns {boolean}
 */
function inAWS() {
  return !!(process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV);
}

/**
 * @param {'db'|'queue'|'objectStorage'} kind
 * @returns {string}
 */
function defaultAdapter(kind) {
  if (kind === 'db') return inAWS() ? 'dynamodb' : 'vanilla';
  if (kind === 'queue') return inAWS() ? 'sqs' : 'vanilla';
  if (kind === 'objectStorage') return inAWS() ? 's3' : 'vanilla';
  return 'vanilla';
}

/**
 * Normalize a resource spec into `{ adapter, options }` or return an instance unchanged.
 * @param {any} spec
 * @param {'db'|'queue'|'objectStorage'} kind
 * @returns {{ adapter: string, options: Record<string, any> } | { instance: any } | undefined}
 */
function normalizeSpec(spec, kind) {
  if (spec === undefined || spec === null) return undefined;

  // string shorthand: 'vanilla' | 'auto' | ...
  if (typeof spec === 'string') {
    const adapter = spec.toLowerCase().trim();
    return {
      adapter: adapter === 'auto' ? defaultAdapter(kind) : adapter,
      options: {},
    };
  }

  // { adapter, options }
  if (looksLikeSpecObject(spec)) {
    const adapter = spec.adapter.toLowerCase().trim();
    return {
      adapter: adapter === 'auto' ? defaultAdapter(kind) : adapter,
      options: isPlainObject(spec.options) ? spec.options : {},
    };
  }

  // Anything else is treated as an already-instantiated client instance.
  return { instance: spec };
}

/** Adapter module caches (avoid repeated dynamic imports). */
const _adapterModuleCache = new Map();

/**
 * @param {string} key
 * @param {() => Promise<any>} loader
 * @returns {Promise<any>}
 */
async function cachedImport(key, loader) {
  const existing = _adapterModuleCache.get(key);
  if (existing) return existing;
  const p = loader();
  _adapterModuleCache.set(key, p);
  return p;
}

/**
 * @param {string} adapter
 * @returns {Promise<(options?: any) => import('../../db/base.js').DBClient>}
 */
async function loadDBFactory(adapter) {
  const allowed = new Set(['vanilla', 'dynamodb', 'lmdb']);
  if (!allowed.has(adapter)) {
    throw new Error(`Unsupported db adapter: ${adapter}`);
  }

  // NOTE: Build the specifier at runtime so TypeScript doesn't eagerly
  // typecheck adapter implementations while this refactor is in-flight.
  const specifier = ['..', '..', 'db', 'adapters', `${adapter}.js`].join('/');
  return cachedImport(
    `db:${adapter}`,
    async () => (await import(specifier)).default,
  );
}

/**
 * @param {string} adapter
 * @returns {Promise<(options?: any) => import('../../queue/base.js').QueueClient>}
 */
async function loadQueueFactory(adapter) {
  const allowed = new Set(['vanilla', 'sqs', 'lmdb']);
  if (!allowed.has(adapter)) {
    throw new Error(`Unsupported queue adapter: ${adapter}`);
  }

  const specifier = ['..', '..', 'queue', 'adapters', `${adapter}.js`].join(
    '/',
  );
  return cachedImport(
    `queue:${adapter}`,
    async () => (await import(specifier)).default,
  );
}

/**
 * @param {string} adapter
 * @returns {Promise<(options?: any) => import('../../object-storage/base.js').ObjectStorageClient>}
 */
async function loadObjectStorageFactory(adapter) {
  const allowed = new Set(['vanilla', 's3', 'r2', 'b2']);
  if (!allowed.has(adapter)) {
    throw new Error(`Unsupported objectStorage adapter: ${adapter}`);
  }

  const specifier = [
    '..',
    '..',
    'object-storage',
    'adapters',
    `${adapter}.js`,
  ].join('/');
  return cachedImport(
    `objectStorage:${adapter}`,
    async () => (await import(specifier)).default,
  );
}

/**
 * Create resources for an actor-system.
 * @param {ActorSystemResourceSpecs} [specs]
 * @returns {Promise<{ resources: ActorSystemResources, close: () => Promise<void> }>}
 */
export async function createActorSystemResources(specs = {}) {
  /** @type {ActorSystemResources} */
  const resources = {};

  /** @type {Array<() => Promise<void> | void>} */
  const closers = [];

  const dbSpec = normalizeSpec(specs.db, 'db');
  if (dbSpec) {
    if ('instance' in dbSpec) {
      resources.db = dbSpec.instance;
      if (looksClosable(dbSpec.instance))
        closers.push(() => dbSpec.instance.close());
    } else {
      const factory = await loadDBFactory(dbSpec.adapter);
      const client = factory(dbSpec.options);
      resources.db = client;
      if (looksClosable(client)) closers.push(() => client.close());
    }
  }

  const queueSpec = normalizeSpec(specs.queue, 'queue');
  if (queueSpec) {
    if ('instance' in queueSpec) {
      resources.queue = queueSpec.instance;
      if (looksClosable(queueSpec.instance))
        closers.push(() => queueSpec.instance.close());
    } else {
      const factory = await loadQueueFactory(queueSpec.adapter);
      const client = factory(queueSpec.options);
      resources.queue = client;
      if (looksClosable(client)) closers.push(() => client.close());
    }
  }

  const objectStorageSpec = normalizeSpec(specs.objectStorage, 'objectStorage');
  if (objectStorageSpec) {
    if ('instance' in objectStorageSpec) {
      resources.objectStorage = objectStorageSpec.instance;
      if (looksClosable(objectStorageSpec.instance))
        closers.push(() => objectStorageSpec.instance.close());
    } else {
      const factory = await loadObjectStorageFactory(objectStorageSpec.adapter);
      const client = factory(objectStorageSpec.options);
      resources.objectStorage = client;
      if (looksClosable(client)) closers.push(() => client.close());
    }
  }

  /**
   *
   */
  async function close() {
    // Close in reverse creation order (best-effort dependency safety)
    for (const fn of closers.slice().reverse()) {
      // eslint-disable-next-line no-await-in-loop
      await fn();
    }
  }

  return { resources, close };
}

export default {
  createActorSystemResources,
};
