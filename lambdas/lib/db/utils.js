import { CONDITION_TYPE, KEY_TYPE } from './base.js';

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
