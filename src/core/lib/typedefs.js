/**
 * Shared provider-neutral typedefs used by the S3 deployment helper and
 * referenced via JSDoc `import()` types.
 *
 * This repo is mid-refactor; keep this file lightweight and dependency-free.
 */

/**
 * @typedef {Object} S3Location
 * @property {string} uri - uri.
 * @property {string} arn - arn.
 * @property {string} bucket - bucket.
 * @property {string} prefix - prefix.
 */

// Export concrete values so `import("./typedefs.js").S3Location` works in JSDoc
// type positions under `checkJs`.
//
// These exports are not intended for runtime use.
/** @type {S3Location} */
export const S3Location = /** @type {any} */ (null);

export default {};
