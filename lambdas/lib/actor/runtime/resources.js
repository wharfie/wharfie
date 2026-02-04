import createVanillaDB from '../../db/adapters/vanilla.js';
import createDynamoDB from '../../db/adapters/dynamodb.js';
import createLmdbDB from '../../db/adapters/lmdb.js';
import createVanillaQueue from '../../queue/adapters/vanilla.js';
import createSqsQueue from '../../queue/adapters/sqs.js';
import createLmdbQueue from '../../queue/adapters/lmdb.js';
import createVanillaObjectStorage from '../../object-storage/adapters/vanilla.js';
import createS3ObjectStorage from '../../object-storage/adapters/s3.js';
import createR2ObjectStorage from '../../object-storage/adapters/r2.js';
import createB2ObjectStorage from '../../object-storage/adapters/b2.js';

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
 */

/**
 * @typedef {'auto'|'vanilla'|'sqs'|'lmdb'} QueueAdapter
 */

/**
 * @typedef {'auto'|'vanilla'|'s3'|'r2'|'b2'} ObjectStorageAdapter
 */

/**
 * @typedef ResourceSpecObject
 * @property {string} adapter - Adapter name.
 * @property {Record<string, any>} [options] - Adapter options.
 */

/**
 * @typedef ActorSystemResourceSpecs
 * @property {string | ResourceSpecObject | any} [db] - DB adapter spec or instance.
 * @property {string | ResourceSpecObject | any} [queue] - Queue adapter spec or instance.
 * @property {string | ResourceSpecObject | any} [objectStorage] - Object storage spec or instance.
 */

/**
 * @typedef ActorSystemResources
 * @property {import('../../db/base.js').DBClient} [db] - DB client instance.
 * @property {import('../../queue/base.js').QueueClient} [queue] - Queue client instance.
 * @property {import('../../object-storage/base.js').ObjectStorageClient} [objectStorage] - Object storage client instance.
 */

/**
 * @param {any} v - v.
 * @returns {v is Record<string, any>} - Result.
 */
function isPlainObject(v) {
  if (!v || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * @param {any} v - v.
 * @returns {v is ResourceSpecObject} - Result.
 */
function looksLikeSpecObject(v) {
  return (
    isPlainObject(v) && typeof v.adapter === 'string' && v.adapter.length > 0
  );
}

/**
 * @param {any} v - v.
 * @returns {v is { close: () => any }} - Result.
 */
function looksClosable(v) {
  return !!v && typeof v === 'object' && typeof v.close === 'function';
}

/**
 * @returns {boolean} - Result.
 */
function inAWS() {
  return !!(process.env.AWS_REGION || process.env.AWS_EXECUTION_ENV);
}

/**
 * @param {'db'|'queue'|'objectStorage'} kind - kind.
 * @returns {string} - Result.
 */
function defaultAdapter(kind) {
  if (kind === 'db') return inAWS() ? 'dynamodb' : 'vanilla';
  if (kind === 'queue') return inAWS() ? 'sqs' : 'vanilla';
  if (kind === 'objectStorage') return inAWS() ? 's3' : 'vanilla';
  return 'vanilla';
}

/**
 * Normalize a resource spec into `{ adapter, options }` or return an instance unchanged.
 * @param {any} spec - spec.
 * @param {'db'|'queue'|'objectStorage'} kind - kind.
 * @returns {{ adapter: string, options: Record<string, any> } | { instance: any } | undefined} - Result.
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

const DB_FACTORIES = {
  vanilla: createVanillaDB,
  dynamodb: createDynamoDB,
  lmdb: createLmdbDB,
};

const QUEUE_FACTORIES = {
  vanilla: createVanillaQueue,
  sqs: createSqsQueue,
  lmdb: createLmdbQueue,
};

const OBJECT_STORAGE_FACTORIES = {
  vanilla: createVanillaObjectStorage,
  s3: createS3ObjectStorage,
  r2: createR2ObjectStorage,
  b2: createB2ObjectStorage,
};

/**
 * @param {string} adapter - adapter.
 * @returns {Promise<(options?: any) => import('../../db/base.js').DBClient>} - Result.
 */
async function loadDBFactory(adapter) {
  const factory = DB_FACTORIES[adapter];
  if (!factory) {
    throw new Error(`Unsupported db adapter: ${adapter}`);
  }
  return factory;
}

/**
 * @param {string} adapter - adapter.
 * @returns {Promise<(options?: any) => import('../../queue/base.js').QueueClient>} - Result.
 */
async function loadQueueFactory(adapter) {
  const factory = QUEUE_FACTORIES[adapter];
  if (!factory) {
    throw new Error(`Unsupported queue adapter: ${adapter}`);
  }
  return factory;
}

/**
 * @param {string} adapter - adapter.
 * @returns {Promise<(options?: any) => import('../../object-storage/base.js').ObjectStorageClient>} - Result.
 */
async function loadObjectStorageFactory(adapter) {
  const factory = OBJECT_STORAGE_FACTORIES[adapter];
  if (!factory) {
    throw new Error(`Unsupported objectStorage adapter: ${adapter}`);
  }
  return factory;
}

/**
 * Create resources for an actor-system.
 * @param {ActorSystemResourceSpecs} [specs] - specs.
 * @returns {Promise<{ resources: ActorSystemResources, close: () => Promise<void> }>} - Result.
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
