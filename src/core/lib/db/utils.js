import { CONDITION_TYPE, KEY_TYPE } from './base.js';

const PORTABLE_PAGE_ASCII_PATTERN = /^[\x20-\x7e]+$/;

/**
 * Require the deliberately small string alphabet whose lexical ordering is
 * identical in JavaScript, LMDB, and DynamoDB's UTF-8 string keys. Page
 * cursors must never depend on locale collation or a provider-specific
 * Unicode comparison.
 * @param {unknown} value - Candidate portable page string.
 * @param {string} label - Human-readable value path.
 * @returns {string} - Validated printable-ASCII string.
 */
export function assertPortablePageAscii(value, label) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    !PORTABLE_PAGE_ASCII_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} must be a nonempty printable ASCII string.`);
  }
  return value;
}

/**
 * Compare already-portable page keys exactly as DynamoDB compares UTF-8
 * string sort keys. Printable ASCII has the same byte and code-unit order,
 * but spelling this as a byte comparison prevents a future locale sort from
 * reintroducing cursor skips.
 * @param {string} left - First portable page key.
 * @param {string} right - Second portable page key.
 * @returns {number} - Negative, zero, or positive byte-order comparison.
 */
export function comparePortablePageKeys(left, right) {
  const leftKey = assertPortablePageAscii(left, 'left page key');
  const rightKey = assertPortablePageAscii(right, 'right page key');
  return Buffer.compare(
    Buffer.from(leftKey, 'ascii'),
    Buffer.from(rightKey, 'ascii'),
  );
}

/**
 * Parse and validate query conditions.
 *
 * Rules:
 * - Exactly one PRIMARY condition is required
 * - PRIMARY must be EQUALS
 * - Optional SORT condition (at most one), must be EQUALS or BEGINS_WITH
 * - Any condition with no keyType is treated as a non-key filter (EQUALS or BEGINS_WITH)
 * @param {import('./base.js').QueryParams | { keyConditions: import('./base.js').KeyCondition[] }} params -
 * @returns {{
 *   pk: import('./base.js').KeyCondition,
 *   sk: import('./base.js').KeyCondition | undefined,
 *   filters: import('./base.js').KeyCondition[],
 * }} -
 */
export function assertTightQuery(params) {
  const keyConditions = params?.keyConditions ?? [];
  if (!Array.isArray(keyConditions)) {
    throw new Error('query requires keyConditions to be an array');
  }

  /** @type {import('./base.js').KeyCondition[]} */
  const filters = [];
  /** @type {import('./base.js').KeyCondition[]} */
  const typed = [];

  for (const c of keyConditions) {
    if (!c || typeof c !== 'object')
      throw new Error('query keyConditions entries must be objects');
    if (!c.propertyName)
      throw new Error('query keyConditions[].propertyName is required');

    if (
      c.conditionType !== CONDITION_TYPE.EQUALS &&
      c.conditionType !== CONDITION_TYPE.BEGINS_WITH
    ) {
      throw new Error(`invalid condition type: ${c.conditionType}`);
    }

    // No keyType => treat as filter
    if (c.keyType === undefined) {
      filters.push(c);
      continue;
    }

    if (c.keyType !== KEY_TYPE.PRIMARY && c.keyType !== KEY_TYPE.SORT) {
      throw new Error(`invalid keyType: ${c.keyType}`);
    }

    typed.push(c);
  }

  const primary = typed.filter((c) => c.keyType === KEY_TYPE.PRIMARY);
  const sort = typed.filter((c) => c.keyType === KEY_TYPE.SORT);

  if (primary.length !== 1) {
    throw new Error('query requires exactly one PRIMARY key condition');
  }
  if (sort.length > 1) {
    throw new Error('query supports at most one SORT key condition');
  }

  const pk = primary[0];
  if (pk.conditionType !== CONDITION_TYPE.EQUALS) {
    throw new Error('PRIMARY key condition must use EQUALS');
  }

  const sk = sort[0];
  if (sk) {
    if (
      sk.conditionType !== CONDITION_TYPE.EQUALS &&
      sk.conditionType !== CONDITION_TYPE.BEGINS_WITH
    ) {
      throw new Error('SORT key condition must use EQUALS or BEGINS_WITH');
    }
  }

  // Guardrail: don’t repeat the same keyType/propertyName
  const seen = new Set();
  for (const c of typed) {
    const k = `${c.keyType}:${c.propertyName}`;
    if (seen.has(k))
      throw new Error(
        'query keyConditions must not repeat the same keyType/propertyName',
      );
    seen.add(k);
  }

  return { pk, sk, filters };
}

/**
 * Parse the deliberately narrow, portable paginated-query contract. A page
 * is only available for one lexically ordered sort-key prefix. Supporting
 * filters here would make provider page boundaries semantically different and
 * invite a hidden scan-based history API.
 * @param {import('./base.js').QueryPageParams} params - Candidate page request.
 * @returns {{pk: import('./base.js').KeyCondition, sk: import('./base.js').KeyCondition, limit: number, startAfter?: string}} - Normalized page request.
 */
export function assertTightQueryPage(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new TypeError('queryPage params must be an object');
  }
  if (
    typeof params.tableName !== 'string' ||
    params.tableName.trim().length === 0
  ) {
    throw new TypeError('queryPage.tableName must be a nonempty string');
  }
  if (typeof params.consistentRead !== 'boolean') {
    throw new TypeError('queryPage.consistentRead must be a boolean');
  }
  const { pk, sk, filters } = assertTightQuery(params);
  if (filters.length !== 0) {
    throw new Error('queryPage does not support non-key filters');
  }
  if (!sk || sk.conditionType !== CONDITION_TYPE.BEGINS_WITH) {
    throw new Error('queryPage requires one SORT BEGINS_WITH condition');
  }
  assertPortablePageAscii(pk.propertyName, 'queryPage PRIMARY property name');
  assertPortablePageAscii(pk.propertyValue, 'queryPage PRIMARY value');
  assertPortablePageAscii(sk.propertyName, 'queryPage SORT property name');
  const sortPrefix = assertPortablePageAscii(
    sk.propertyValue,
    'queryPage SORT prefix',
  );
  if (
    !Number.isSafeInteger(params?.limit) ||
    params.limit < 1 ||
    params.limit > 100
  ) {
    throw new Error(
      'queryPage.limit must be a safe integer from 1 through 100',
    );
  }
  if (params.startAfter !== undefined) {
    const startAfter = assertPortablePageAscii(
      params.startAfter,
      'queryPage.startAfter',
    );
    if (!startAfter.startsWith(sortPrefix)) {
      throw new TypeError(
        'queryPage.startAfter must begin with the requested SORT prefix',
      );
    }
  }
  return {
    pk,
    sk,
    limit: params.limit,
    ...(params.startAfter === undefined
      ? {}
      : { startAfter: params.startAfter }),
  };
}
