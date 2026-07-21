/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal recovery contracts are clearer than parser-specific expansions. */

const FACTORY_KEYS = new Set([
  'baseTags',
  'discoveryMaxResults',
  'idKey',
  'idPattern',
  'maxDiscoveryPages',
  'maxTags',
  'readDiscoveryPage',
  'readExact',
]);
const BASE_TAG_KEYS = new Set([
  'wharfie:managed-by',
  'wharfie:resource-kind',
  'wharfie:retention',
  'wharfie:schema-version',
]);
const LOCATOR_TAG_KEYS = Object.freeze([
  'wharfie:managed-by',
  'wharfie:resource-kind',
  'wharfie:capability',
  'wharfie:role',
  'wharfie:provider-scope-id',
  'wharfie:deployment-instance-id',
  'wharfie:incarnation-id',
  'wharfie:resource-key',
]);
const IDENTITY_EVIDENCE_KEYS = new Set(['useDiscoveredId']);

/** Provider evidence contradicts one exact tagged-resource identity. */
export class AwsTaggedEc2RecoveryConflictError extends Error {
  constructor() {
    super(
      'AWS tagged EC2 recovery evidence conflicts with its exact contract.',
    );
    this.name = 'AwsTaggedEc2RecoveryConflictError';
    this.code = 'AWS_TAGGED_EC2_RECOVERY_CONFLICT';
  }
}

/** Provider evidence is well formed but may still be propagating. */
export class AwsTaggedEc2RecoveryTransientError extends Error {
  constructor() {
    super('AWS tagged EC2 recovery evidence is still propagating.');
    this.name = 'AwsTaggedEc2RecoveryTransientError';
    this.code = 'AWS_TAGGED_EC2_RECOVERY_TRANSIENT';
  }
}

/** A bounded provider read could not establish safe recovery evidence. */
export class AwsTaggedEc2RecoveryUnknownError extends Error {
  constructor() {
    super('AWS tagged EC2 recovery evidence is unknown.');
    this.name = 'AwsTaggedEc2RecoveryUnknownError';
    this.code = 'AWS_TAGGED_EC2_RECOVERY_UNKNOWN';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} path @returns {void} */
function assertExactKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new TypeError(`${path}.${key} is not supported.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
}

/** @param {any} value @returns {any} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {unknown} value @param {string} path @returns {string} */
function requiredString(value, path) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

/** @param {unknown} error @returns {never} */
function throwSanitizedRecoveryError(error) {
  if (error instanceof AwsTaggedEc2RecoveryConflictError) {
    throw new AwsTaggedEc2RecoveryConflictError();
  }
  if (error instanceof AwsTaggedEc2RecoveryTransientError) {
    throw new AwsTaggedEc2RecoveryTransientError();
  }
  if (error instanceof AwsTaggedEc2RecoveryUnknownError) {
    throw new AwsTaggedEc2RecoveryUnknownError();
  }
  throw new AwsTaggedEc2RecoveryUnknownError();
}

/**
 * Create the common recovery mechanics for one directly owned, atomically
 * tagged EC2 resource. AWS response envelopes, typed NotFound handling, and
 * resource-specific evidence remain in the supplied adapters and caller.
 * @param {unknown} options - Exact tagged-resource mechanics and read adapters.
 * @returns {Readonly<Record<string, any>>} - Internal recovery operations.
 */
export function createAwsTaggedEc2RecoveryKernel(options) {
  if (!isPlainObject(options)) {
    throw new TypeError('awsTaggedEc2Recovery options must be an object.');
  }
  assertExactKeys(options, FACTORY_KEYS, 'awsTaggedEc2Recovery options');
  if (!isPlainObject(options.baseTags)) {
    throw new TypeError('awsTaggedEc2Recovery baseTags must be an object.');
  }
  assertExactKeys(
    options.baseTags,
    BASE_TAG_KEYS,
    'awsTaggedEc2Recovery baseTags',
  );
  if (
    options.baseTags['wharfie:managed-by'] !== 'wharfie' ||
    options.baseTags['wharfie:retention'] !== 'purge' ||
    options.baseTags['wharfie:schema-version'] !== '2'
  ) {
    throw new TypeError(
      'awsTaggedEc2Recovery baseTags must select Wharfie purge schema version 2.',
    );
  }
  requiredString(
    options.baseTags['wharfie:resource-kind'],
    'awsTaggedEc2Recovery baseTags.wharfie:resource-kind',
  );
  const baseTags = deepFreeze({ ...options.baseTags });
  const idKey = requiredString(
    options.idKey,
    'awsTaggedEc2Recovery options.idKey',
  );
  const idPattern = options.idPattern;
  if (!(idPattern instanceof RegExp) || idPattern.global || idPattern.sticky) {
    throw new TypeError(
      'awsTaggedEc2Recovery idPattern must be a non-stateful RegExp.',
    );
  }
  const maxTags = options.maxTags;
  if (!Number.isSafeInteger(maxTags) || maxTags < 1) {
    throw new TypeError(
      'awsTaggedEc2Recovery maxTags must be a positive integer.',
    );
  }
  const maxDiscoveryPages = options.maxDiscoveryPages;
  if (!Number.isSafeInteger(maxDiscoveryPages) || maxDiscoveryPages < 1) {
    throw new TypeError(
      'awsTaggedEc2Recovery maxDiscoveryPages must be a positive integer.',
    );
  }
  const discoveryMaxResults = options.discoveryMaxResults;
  if (!Number.isSafeInteger(discoveryMaxResults) || discoveryMaxResults < 1) {
    throw new TypeError(
      'awsTaggedEc2Recovery discoveryMaxResults must be a positive integer.',
    );
  }
  const readDiscoveryPage = options.readDiscoveryPage;
  if (typeof readDiscoveryPage !== 'function') {
    throw new TypeError(
      'awsTaggedEc2Recovery readDiscoveryPage must be a function.',
    );
  }
  const readExact = options.readExact;
  if (typeof readExact !== 'function') {
    throw new TypeError('awsTaggedEc2Recovery readExact must be a function.');
  }

  /** Successful create responses are only ephemeral candidate locators. */
  const candidateIds = new Map();
  /** A crossed non-idempotent create boundary cannot be replayed in-process. */
  const attemptedEffects = new Set();

  /** @param {Readonly<Record<string, any>>} authority @returns {string} */
  function effectKey(authority) {
    const actionId = requiredString(
      authority?.action?.actionId,
      'awsTaggedEc2Recovery authority.action.actionId',
    );
    const ownershipNonce = requiredString(
      authority?.ownershipNonce,
      'awsTaggedEc2Recovery authority.ownershipNonce',
    );
    return `${actionId}\0${ownershipNonce}`;
  }

  /** @param {unknown} value @returns {string} */
  function resourceId(value) {
    if (!isPlainObject(value)) throw new AwsTaggedEc2RecoveryUnknownError();
    const id = value[idKey];
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw new AwsTaggedEc2RecoveryUnknownError();
    }
    return id;
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Record<string, string>>} */
  function requiredTags(authority) {
    const values = {
      ...baseTags,
      'wharfie:capability': authority?.action?.capability?.kind,
      'wharfie:role': authority?.action?.role?.kind,
      'wharfie:provider-scope-id':
        authority?.plan?.providerScope?.providerScopeId,
      'wharfie:deployment-instance-id': authority?.plan?.deploymentInstanceId,
      'wharfie:incarnation-id': authority?.plan?.incarnationId,
      'wharfie:resource-key': authority?.action?.resourceKey,
      'wharfie:created-by-action-id':
        authority?.priorBinding?.createdByActionId ??
        authority?.action?.actionId,
      'wharfie:ownership-nonce': authority?.ownershipNonce,
      'wharfie:state-digest': authority?.stateDigest?.value,
    };
    for (const [key, value] of Object.entries(values)) {
      requiredString(value, `awsTaggedEc2Recovery requiredTags.${key}`);
    }
    return deepFreeze(values);
  }

  /** @param {Readonly<Record<string, string>>} tags @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
  function sortedTags(tags) {
    if (!isPlainObject(tags)) {
      throw new TypeError('awsTaggedEc2Recovery tags must be an object.');
    }
    const entries = Object.entries(tags);
    for (const [key, value] of entries) {
      requiredString(key, 'awsTaggedEc2Recovery tag key');
      requiredString(value, `awsTaggedEc2Recovery tags.${key}`);
    }
    return deepFreeze(
      entries
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([Key, Value]) => ({ Key, Value })),
    );
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Readonly<Array<Readonly<{Name: string, Values: readonly string[]}>>>} */
  function discoveryFilters(authority) {
    const tags = requiredTags(authority);
    return deepFreeze(
      LOCATOR_TAG_KEYS.map((key) => ({
        Name: `tag:${key}`,
        Values: [tags[key]],
      })),
    );
  }

  /** @param {unknown} tagsValue @param {Readonly<Record<string, string>>} expected @param {boolean} allowPropagation @returns {void} */
  function validateTags(tagsValue, expected, allowPropagation) {
    if (!isPlainObject(expected)) {
      throw new TypeError(
        'awsTaggedEc2Recovery expected tags must be an object.',
      );
    }
    for (const [key, value] of Object.entries(expected)) {
      requiredString(key, 'awsTaggedEc2Recovery expected tag key');
      requiredString(value, `awsTaggedEc2Recovery expected tags.${key}`);
    }
    if (typeof allowPropagation !== 'boolean') {
      throw new TypeError(
        'awsTaggedEc2Recovery allowPropagation must be a boolean.',
      );
    }
    if (!Array.isArray(tagsValue)) {
      if (tagsValue === undefined || tagsValue === null) {
        if (allowPropagation) {
          throw new AwsTaggedEc2RecoveryTransientError();
        }
        throw new AwsTaggedEc2RecoveryConflictError();
      }
      throw new AwsTaggedEc2RecoveryUnknownError();
    }
    if (tagsValue.length > maxTags) {
      throw new AwsTaggedEc2RecoveryConflictError();
    }
    const observed = new Map();
    for (const tag of tagsValue) {
      if (
        !isPlainObject(tag) ||
        typeof tag.Key !== 'string' ||
        tag.Key.length === 0 ||
        typeof tag.Value !== 'string'
      ) {
        throw new AwsTaggedEc2RecoveryUnknownError();
      }
      if (observed.has(tag.Key)) {
        throw new AwsTaggedEc2RecoveryConflictError();
      }
      observed.set(tag.Key, tag.Value);
    }
    for (const [key, value] of observed) {
      const reserved = Object.hasOwn(expected, key);
      if (key.startsWith('wharfie:') && !reserved) {
        throw new AwsTaggedEc2RecoveryConflictError();
      }
      if (reserved && expected[key] !== value) {
        throw new AwsTaggedEc2RecoveryConflictError();
      }
    }
    const complete = Object.entries(expected).every(
      ([key, value]) => observed.get(key) === value,
    );
    if (!complete) {
      if (allowPropagation) {
        throw new AwsTaggedEc2RecoveryTransientError();
      }
      throw new AwsTaggedEc2RecoveryConflictError();
    }
  }

  /** @param {unknown} value @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
  function normalizedDiscoveryPage(value) {
    if (!isPlainObject(value) || !Array.isArray(value.records)) {
      throw new AwsTaggedEc2RecoveryUnknownError();
    }
    let nextToken = null;
    if (value.nextToken !== undefined && value.nextToken !== null) {
      if (typeof value.nextToken !== 'string' || value.nextToken.length === 0) {
        throw new AwsTaggedEc2RecoveryUnknownError();
      }
      nextToken = value.nextToken;
    }
    const records = [];
    for (const record of value.records) {
      resourceId(record);
      records.push(record);
    }
    return { records, nextToken };
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function discoverOne(authority) {
    const filters = discoveryFilters(authority);
    const records = new Map();
    const seenTokens = new Set();
    let nextToken = null;
    for (let page = 1; page <= maxDiscoveryPages; page += 1) {
      const request = deepFreeze({
        Filters: filters,
        MaxResults: discoveryMaxResults,
        ...(nextToken === null ? {} : { NextToken: nextToken }),
      });
      let response;
      try {
        response = await readDiscoveryPage(request);
      } catch (error) {
        throwSanitizedRecoveryError(error);
      }
      const observed = normalizedDiscoveryPage(response);
      for (const record of observed.records) {
        const id = resourceId(record);
        if (records.has(id)) {
          throw new AwsTaggedEc2RecoveryConflictError();
        }
        records.set(id, record);
        if (records.size > 1) {
          throw new AwsTaggedEc2RecoveryConflictError();
        }
      }
      if (observed.nextToken === null) break;
      if (page === maxDiscoveryPages || seenTokens.has(observed.nextToken)) {
        throw new AwsTaggedEc2RecoveryUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return /** @type {Readonly<Record<string, any>>|null} */ (
      [...records.values()][0] ?? null
    );
  }

  /** @param {string} id @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExactSafely(id) {
    let record;
    try {
      record = await readExact(id);
    } catch (error) {
      throwSanitizedRecoveryError(error);
    }
    if (record === null) return null;
    const observedId = resourceId(record);
    if (observedId !== id) throw new AwsTaggedEc2RecoveryConflictError();
    return record;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {unknown} value @returns {Promise<Readonly<{discovered: Readonly<Record<string, any>>|null, exact: Readonly<Record<string, any>>|null, exactId: string|null}>>} */
  async function readIdentityEvidence(authority, value) {
    if (!isPlainObject(value)) {
      throw new TypeError(
        'awsTaggedEc2Recovery identity evidence options must be an object.',
      );
    }
    assertExactKeys(
      value,
      IDENTITY_EVIDENCE_KEYS,
      'awsTaggedEc2Recovery identity evidence options',
    );
    if (typeof value.useDiscoveredId !== 'boolean') {
      throw new TypeError(
        'awsTaggedEc2Recovery useDiscoveredId must be a boolean.',
      );
    }
    const key = effectKey(authority);
    const discovered = await discoverOne(authority);
    let exactId =
      authority?.priorBinding?.providerResourceId ??
      candidateIds.get(key) ??
      null;
    if (exactId !== null) {
      if (typeof exactId !== 'string' || !idPattern.test(exactId)) {
        throw new AwsTaggedEc2RecoveryConflictError();
      }
    } else if (value.useDiscoveredId && discovered !== null) {
      exactId = resourceId(discovered);
    }
    if (
      discovered !== null &&
      exactId !== null &&
      resourceId(discovered) !== exactId
    ) {
      throw new AwsTaggedEc2RecoveryConflictError();
    }
    const exact = exactId === null ? null : await readExactSafely(exactId);
    return Object.freeze({ discovered, exact, exactId });
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {boolean} */
  function claimCreateAttempt(authority) {
    const key = effectKey(authority);
    if (attemptedEffects.has(key)) return false;
    attemptedEffects.add(key);
    return true;
  }

  /** @param {Readonly<Record<string, any>>} authority @param {string} id @returns {void} */
  function rememberCandidate(authority, id) {
    const key = effectKey(authority);
    if (!attemptedEffects.has(key)) {
      throw new TypeError(
        'awsTaggedEc2Recovery create attempt must be claimed before remembering its candidate.',
      );
    }
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw new AwsTaggedEc2RecoveryUnknownError();
    }
    const priorId = candidateIds.get(key);
    if (priorId !== undefined && priorId !== id) {
      throw new AwsTaggedEc2RecoveryConflictError();
    }
    candidateIds.set(key, id);
  }

  /** @param {Readonly<Record<string, any>>} authority @returns {void} */
  function clearCandidate(authority) {
    candidateIds.delete(effectKey(authority));
  }

  return Object.freeze({
    claimCreateAttempt,
    clearCandidate,
    readIdentityEvidence,
    rememberCandidate,
    requiredTags,
    sortedTags,
    validateTags,
  });
}

export default {
  AwsTaggedEc2RecoveryConflictError,
  AwsTaggedEc2RecoveryTransientError,
  AwsTaggedEc2RecoveryUnknownError,
  createAwsTaggedEc2RecoveryKernel,
};
