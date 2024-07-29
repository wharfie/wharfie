const crypto = require('crypto');
/**
 * Create an 8-character stable hash of a string.
 * @param {string} input - The input string to hash.
 * @returns {string} - The 8-character hash.
 */
function createStableHash(input) {
  // Create a SHA-256 hash of the input
  const hash = crypto.createHash('sha256').update(input).digest('base64');

  // Convert to URL-safe base64 by replacing characters and removing padding
  const base64urlHash = hash
    .replace(/\+/g, '-')
    .replace(/\//g, '-')
    .replace(/=+$/, '');

  // Truncate the base64 hash to 8 characters and lowercase them
  return base64urlHash.substring(0, 8).toLowerCase();
}

module.exports = {
  createStableHash,
};
