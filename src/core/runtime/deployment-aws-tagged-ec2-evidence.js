/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- Compact internal evidence contracts are clearer than parser-specific expansions. */

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
const LOCATOR_KEYS = new Set([
  'capabilityKind',
  'roleKind',
  'providerScopeId',
  'deploymentInstanceId',
  'incarnationId',
  'resourceKey',
]);
const OWNERSHIP_KEYS = new Set([
  ...LOCATOR_KEYS,
  'createdByActionId',
  'ownershipNonce',
  'stateDigestValue',
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
const RECEIPT_TAG_KEYS = new Set([
  'wharfie:created-by-action-id',
  'wharfie:ownership-nonce',
  'wharfie:state-digest',
]);

/** Provider evidence contradicts one exact tagged-resource identity. */
export class AwsTaggedEc2EvidenceConflictError extends Error {
  constructor() {
    super('AWS tagged EC2 evidence conflicts with its exact contract.');
    this.name = 'AwsTaggedEc2EvidenceConflictError';
    this.code = 'AWS_TAGGED_EC2_EVIDENCE_CONFLICT';
  }
}

/** Provider evidence is well formed but may still be propagating. */
export class AwsTaggedEc2EvidenceTransientError extends Error {
  constructor() {
    super('AWS tagged EC2 evidence is still propagating.');
    this.name = 'AwsTaggedEc2EvidenceTransientError';
    this.code = 'AWS_TAGGED_EC2_EVIDENCE_TRANSIENT';
  }
}

/** A bounded provider read could not establish safe recovery evidence. */
export class AwsTaggedEc2EvidenceUnknownError extends Error {
  constructor() {
    super('AWS tagged EC2 evidence is unknown.');
    this.name = 'AwsTaggedEc2EvidenceUnknownError';
    this.code = 'AWS_TAGGED_EC2_EVIDENCE_UNKNOWN';
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
function throwSanitizedEvidenceError(error) {
  if (error instanceof AwsTaggedEc2EvidenceConflictError) {
    throw new AwsTaggedEc2EvidenceConflictError();
  }
  if (error instanceof AwsTaggedEc2EvidenceTransientError) {
    throw new AwsTaggedEc2EvidenceTransientError();
  }
  if (error instanceof AwsTaggedEc2EvidenceUnknownError) {
    throw new AwsTaggedEc2EvidenceUnknownError();
  }
  throw new AwsTaggedEc2EvidenceUnknownError();
}

/**
 * Create stateless tag and read evidence mechanics for one directly owned,
 * atomically tagged EC2 resource. AWS envelopes and typed NotFound handling
 * remain in the supplied adapters.
 * @param {unknown} options - Exact evidence mechanics and read adapters.
 * @returns {Readonly<Record<string, any>>} - Pure derivations and bounded reads.
 */
export function createAwsTaggedEc2EvidenceKernel(options) {
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

  /** @param {unknown} value @returns {string} */
  function resourceId(value) {
    if (!isPlainObject(value)) throw new AwsTaggedEc2EvidenceUnknownError();
    const id = value[idKey];
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    return id;
  }

  /** @param {unknown} value @returns {Readonly<Record<string, string>>} */
  function locatorTags(value) {
    if (!isPlainObject(value)) {
      throw new TypeError('awsTaggedEc2Recovery locator must be an object.');
    }
    assertExactKeys(value, LOCATOR_KEYS, 'awsTaggedEc2Recovery locator');
    const locator = {
      capabilityKind: requiredString(
        value.capabilityKind,
        'awsTaggedEc2Recovery locator.capabilityKind',
      ),
      roleKind: requiredString(
        value.roleKind,
        'awsTaggedEc2Recovery locator.roleKind',
      ),
      providerScopeId: requiredString(
        value.providerScopeId,
        'awsTaggedEc2Recovery locator.providerScopeId',
      ),
      deploymentInstanceId: requiredString(
        value.deploymentInstanceId,
        'awsTaggedEc2Recovery locator.deploymentInstanceId',
      ),
      incarnationId: requiredString(
        value.incarnationId,
        'awsTaggedEc2Recovery locator.incarnationId',
      ),
      resourceKey: requiredString(
        value.resourceKey,
        'awsTaggedEc2Recovery locator.resourceKey',
      ),
    };
    return deepFreeze({
      ...baseTags,
      'wharfie:capability': locator.capabilityKind,
      'wharfie:role': locator.roleKind,
      'wharfie:provider-scope-id': locator.providerScopeId,
      'wharfie:deployment-instance-id': locator.deploymentInstanceId,
      'wharfie:incarnation-id': locator.incarnationId,
      'wharfie:resource-key': locator.resourceKey,
    });
  }

  /** @param {unknown} value @returns {Readonly<Record<string, string>>} */
  function ownershipTags(value) {
    if (!isPlainObject(value)) {
      throw new TypeError('awsTaggedEc2Recovery ownership must be an object.');
    }
    assertExactKeys(value, OWNERSHIP_KEYS, 'awsTaggedEc2Recovery ownership');
    const locator = {
      capabilityKind: value.capabilityKind,
      roleKind: value.roleKind,
      providerScopeId: value.providerScopeId,
      deploymentInstanceId: value.deploymentInstanceId,
      incarnationId: value.incarnationId,
      resourceKey: value.resourceKey,
    };
    return deepFreeze({
      ...locatorTags(locator),
      'wharfie:created-by-action-id': requiredString(
        value.createdByActionId,
        'awsTaggedEc2Recovery ownership.createdByActionId',
      ),
      'wharfie:ownership-nonce': requiredString(
        value.ownershipNonce,
        'awsTaggedEc2Recovery ownership.ownershipNonce',
      ),
      'wharfie:state-digest': requiredString(
        value.stateDigestValue,
        'awsTaggedEc2Recovery ownership.stateDigestValue',
      ),
    });
  }

  /** @param {unknown} tags @returns {Readonly<Array<Readonly<{Key: string, Value: string}>>>} */
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

  /** @param {unknown} locator @returns {Readonly<Array<Readonly<{Name: string, Values: readonly string[]}>>>} */
  function discoveryFilters(locator) {
    const tags = locatorTags(locator);
    return deepFreeze(
      LOCATOR_TAG_KEYS.map((key) => ({
        Name: `tag:${key}`,
        Values: [tags[key]],
      })),
    );
  }

  /** @param {unknown} tagsValue @param {unknown} expected @param {boolean} allowPropagation @returns {void} */
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
          throw new AwsTaggedEc2EvidenceTransientError();
        }
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (tagsValue.length > maxTags) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    const observed = new Map();
    for (const tag of tagsValue) {
      if (
        !isPlainObject(tag) ||
        typeof tag.Key !== 'string' ||
        tag.Key.length === 0 ||
        typeof tag.Value !== 'string'
      ) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      if (observed.has(tag.Key)) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      observed.set(tag.Key, tag.Value);
    }
    for (const [key, value] of observed) {
      const reserved = Object.hasOwn(expected, key);
      if (key.startsWith('wharfie:') && !reserved) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      if (reserved && expected[key] !== value) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
    }
    const complete = Object.entries(expected).every(
      ([key, value]) => observed.get(key) === value,
    );
    if (!complete) {
      if (allowPropagation) {
        throw new AwsTaggedEc2EvidenceTransientError();
      }
      throw new AwsTaggedEc2EvidenceConflictError();
    }
  }

  /** @param {unknown} tagsValue @param {unknown} expectedLocatorTags @returns {void} */
  function validateCollisionTags(tagsValue, expectedLocatorTags) {
    if (!isPlainObject(expectedLocatorTags)) {
      throw new TypeError(
        'awsTaggedEc2Recovery expected locator tags must be an object.',
      );
    }
    for (const [key, value] of Object.entries(expectedLocatorTags)) {
      requiredString(key, 'awsTaggedEc2Recovery expected locator tag key');
      requiredString(
        value,
        `awsTaggedEc2Recovery expected locator tags.${key}`,
      );
    }
    if (!Array.isArray(tagsValue)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    if (tagsValue.length > maxTags) {
      throw new AwsTaggedEc2EvidenceConflictError();
    }
    const observed = new Map();
    for (const tag of tagsValue) {
      if (
        !isPlainObject(tag) ||
        typeof tag.Key !== 'string' ||
        tag.Key.length === 0 ||
        typeof tag.Value !== 'string'
      ) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      if (observed.has(tag.Key)) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      observed.set(tag.Key, tag.Value);
    }
    for (const [key, value] of observed) {
      const locatorKey = Object.hasOwn(expectedLocatorTags, key);
      if (locatorKey && expectedLocatorTags[key] !== value) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
      if (
        key.startsWith('wharfie:') &&
        !locatorKey &&
        !RECEIPT_TAG_KEYS.has(key)
      ) {
        throw new AwsTaggedEc2EvidenceConflictError();
      }
    }
    const complete = Object.entries(expectedLocatorTags).every(
      ([key, value]) => observed.get(key) === value,
    );
    if (!complete) throw new AwsTaggedEc2EvidenceUnknownError();
  }

  /** @param {unknown} value @returns {{records: Readonly<Record<string, any>>[], nextToken: string|null}} */
  function normalizedDiscoveryPage(value) {
    if (!isPlainObject(value) || !Array.isArray(value.records)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    let nextToken = null;
    if (value.nextToken !== undefined && value.nextToken !== null) {
      if (typeof value.nextToken !== 'string' || value.nextToken.length === 0) {
        throw new AwsTaggedEc2EvidenceUnknownError();
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

  /** @param {unknown} locator @returns {Promise<Readonly<Readonly<Record<string, any>>[]>>} */
  async function discoverMany(locator) {
    const filters = discoveryFilters(locator);
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
        throwSanitizedEvidenceError(error);
      }
      const observed = normalizedDiscoveryPage(response);
      for (const record of observed.records) {
        const id = resourceId(record);
        if (records.has(id)) {
          throw new AwsTaggedEc2EvidenceConflictError();
        }
        records.set(id, record);
        if (records.size > 1) {
          return Object.freeze([...records.values()]);
        }
      }
      if (observed.nextToken === null) break;
      if (page === maxDiscoveryPages || seenTokens.has(observed.nextToken)) {
        throw new AwsTaggedEc2EvidenceUnknownError();
      }
      seenTokens.add(observed.nextToken);
      nextToken = observed.nextToken;
    }
    return Object.freeze([...records.values()]);
  }

  /** @param {string} id @returns {Promise<Readonly<Record<string, any>>|null>} */
  async function readExactSafely(id) {
    if (typeof id !== 'string' || !idPattern.test(id)) {
      throw new AwsTaggedEc2EvidenceUnknownError();
    }
    let record;
    try {
      record = await readExact(id);
    } catch (error) {
      throwSanitizedEvidenceError(error);
    }
    if (record === null) return null;
    const observedId = resourceId(record);
    if (observedId !== id) throw new AwsTaggedEc2EvidenceConflictError();
    return record;
  }

  return Object.freeze({
    resourceId,
    locatorTags,
    ownershipTags,
    sortedTags,
    discoveryFilters,
    validateTags,
    validateCollisionTags,
    discoverMany,
    readExactSafely,
  });
}

export default {
  AwsTaggedEc2EvidenceConflictError,
  AwsTaggedEc2EvidenceTransientError,
  AwsTaggedEc2EvidenceUnknownError,
  createAwsTaggedEc2EvidenceKernel,
};
