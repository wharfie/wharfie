/**
 * Shared non-AWS typedefs used by local implementations (e.g. the object-storage
 * adapters) and referenced via JSDoc `import()` types.
 *
 * This repo is mid-refactor; keep this file lightweight and dependency-free.
 */

/**
 * @typedef {Object} S3Location
 * @property {string} uri
 * @property {string} arn
 * @property {string} bucket
 * @property {string} prefix
 */

/**
 * @typedef {Object} Partition
 * @property {Record<string, string>} partitionValues
 * @property {string} location
 */

// Export concrete values so `import("./typedefs.js").S3Location` works in JSDoc
// type positions under `checkJs`.
//
// These exports are not intended for runtime use.
/** @type {S3Location} */
export const S3Location = /** @type {any} */ (null);

/** @type {Partition} */
export const Partition = /** @type {any} */ (null);

export default {};
