const INLINE_SECRET_FIELD_NAMES = new Set([
  'access_key',
  'access_token',
  'api_key',
  'api_key_value',
  'auth',
  'auth_token',
  'authorization',
  'bearer',
  'certificate',
  'certificate_base64',
  'client_secret',
  'client_key',
  'connection_string',
  'cookie',
  'credential',
  'credentials',
  'dsn',
  'keychain_password',
  'password',
  'passwd',
  'private_key',
  'refresh_token',
  'secret',
  'secret_key',
  'token',
]);

const INLINE_SECRET_FIELD_TOKENS = new Set([
  'authorization',
  'certificate',
  'cookie',
  'credential',
  'credentials',
  'passwd',
  'password',
  'secret',
  'token',
]);

/**
 * @param {unknown} value - value.
 * @returns {value is Record<string, unknown>} - Whether value is an object record.
 */
function isObjectRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {string} fieldName - fieldName.
 * @returns {string} - Normalized field name.
 */
function normalizeManifestFieldName(fieldName) {
  return fieldName
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * Catch both exact names such as `api_key` and compound names such as
 * `dbPassword`, `apiTokenValue`, and `secretAccessKey`.
 * @param {string} fieldName - fieldName.
 * @returns {boolean} - Whether the field name is secret-like.
 */
function isSecretLikeFieldName(fieldName) {
  const normalized = normalizeManifestFieldName(fieldName);
  if (INLINE_SECRET_FIELD_NAMES.has(normalized)) return true;

  return normalized
    .split('_')
    .filter(Boolean)
    .some((token) => INLINE_SECRET_FIELD_TOKENS.has(token));
}

/**
 * @param {unknown} value - value.
 * @returns {boolean} - Whether a declared value contains anything meaningful.
 */
function hasDeclaredValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isObjectRecord(value)) return Object.keys(value).length > 0;
  return true;
}

/**
 * @param {string} value - value.
 * @returns {boolean} - Whether a URL carries inline credentials.
 */
function isCredentialBearingUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password) return true;

    for (const name of parsed.searchParams.keys()) {
      if (isSecretLikeFieldName(name)) return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Catch credential material embedded in a generic string field such as a
 * serialized HTTP Authorization header or PEM private key.
 * @param {string} value - Candidate manifest string.
 * @returns {boolean} - Whether the value has an inline credential marker.
 */
function hasInlineCredentialMarker(value) {
  const trimmed = value.trim();
  return (
    /^(?:authorization\s*:\s*)?(?:basic|bearer)\s+\S+/i.test(trimmed) ||
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(trimmed)
  );
}

/**
 * Wharfie manifests and packaged artifacts are inspectable. Reject inline
 * runtime secrets until first-class secret references exist. Errors identify
 * only the field path and never render the value.
 * @param {unknown} value - Manifest value.
 * @param {string} [valuePath] - Human-readable manifest path.
 * @returns {void}
 */
export function assertManifestIsSecretFree(value, valuePath = 'manifest') {
  if (Array.isArray(value)) {
    value.forEach((child, index) =>
      assertManifestIsSecretFree(child, `${valuePath}[${index}]`),
    );
    return;
  }

  if (!isObjectRecord(value)) {
    if (typeof value === 'string') {
      if (isCredentialBearingUrl(value)) {
        throw new Error(
          `Cannot expose ${valuePath}: credential-bearing URLs cannot appear in an inspectable manifest. Use an ambient provider credential chain; first-class secret references are not implemented yet.`,
        );
      }
      if (hasInlineCredentialMarker(value)) {
        throw new Error(
          `Cannot expose ${valuePath}: inline credential material cannot appear in an inspectable manifest. Use an ambient provider credential chain; first-class secret references are not implemented yet.`,
        );
      }
    }
    return;
  }

  for (const [fieldName, child] of Object.entries(value)) {
    const fieldPath = `${valuePath}.${fieldName}`;

    if (isSecretLikeFieldName(fieldName) && hasDeclaredValue(child)) {
      throw new Error(
        `Cannot expose ${fieldPath}: inline secret-like values cannot appear in an inspectable manifest. Use an ambient provider credential chain; first-class secret references are not implemented yet.`,
      );
    }

    assertManifestIsSecretFree(child, fieldPath);
  }
}

export default assertManifestIsSecretFree;
