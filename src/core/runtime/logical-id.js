/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

export const LOGICAL_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
export const LOGICAL_ID_MAX_LENGTH = 63;

/**
 * Assert one canonical, portable logical identity segment.
 *
 * Logical IDs are persisted and reused across filesystems, service managers,
 * URLs, cloud resources, and durable-store keys. They are therefore accepted
 * only in their canonical form: Wharfie never trims or case-folds them.
 * @param {unknown} value - Candidate logical ID.
 * @param {string} [valuePath] - Human-readable schema path.
 * @returns {asserts value is string}
 */
export function assertLogicalId(value, valuePath = 'id') {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > LOGICAL_ID_MAX_LENGTH ||
    !LOGICAL_ID_PATTERN.test(value)
  ) {
    throw new TypeError(
      `${valuePath} must be a canonical logical ID: 1-63 lowercase ASCII characters, beginning with a letter, with words separated only by single hyphens.`,
    );
  }
}

export default {
  LOGICAL_ID_MAX_LENGTH,
  LOGICAL_ID_PATTERN,
  assertLogicalId,
};
