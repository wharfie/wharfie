/**
 * @typedef MacOSSigningCredentials
 * @property {string} certificateBase64 - Base64-encoded PKCS #12 certificate.
 * @property {string} certificatePassword - PKCS #12 password.
 * @property {string} keychainPassword - Temporary keychain password.
 */

/**
 * @typedef {() => Partial<MacOSSigningCredentials> | null | undefined} MacOSSigningCredentialsProvider
 */

const MACOS_SIGNING_CREDENTIALS = Symbol('macosSigningCredentials');

/** @type {Readonly<MacOSSigningCredentials>} */
const EMPTY_MACOS_SIGNING_CREDENTIALS = Object.freeze({
  certificateBase64: '',
  certificatePassword: '',
  keychainPassword: '',
});

/**
 * @param {Partial<MacOSSigningCredentials> | null | undefined} credentials - credentials.
 * @returns {Readonly<MacOSSigningCredentials>} - Normalized credentials.
 */
function normalizeMacOSSigningCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    return EMPTY_MACOS_SIGNING_CREDENTIALS;
  }

  return Object.freeze({
    certificateBase64:
      typeof credentials.certificateBase64 === 'string'
        ? credentials.certificateBase64
        : '',
    certificatePassword:
      typeof credentials.certificatePassword === 'string'
        ? credentials.certificatePassword
        : '',
    keychainPassword:
      typeof credentials.keychainPassword === 'string'
        ? credentials.keychainPassword
        : '',
  });
}

/**
 * Attach signing credentials without making them part of enumerable or
 * serializable resource configuration.
 * @param {object} target - In-memory credential owner.
 * @param {Partial<MacOSSigningCredentials> | MacOSSigningCredentialsProvider | null | undefined} credentials - credentials.
 * @returns {Readonly<MacOSSigningCredentials>} - Stored credentials.
 */
export function setMacOSSigningCredentials(target, credentials) {
  const provider =
    typeof credentials === 'function'
      ? credentials
      : (() => {
          const normalized = normalizeMacOSSigningCredentials(credentials);
          return () => normalized;
        })();

  if (Object.prototype.hasOwnProperty.call(target, MACOS_SIGNING_CREDENTIALS)) {
    // @ts-ignore - symbol-indexed private channel.
    target[MACOS_SIGNING_CREDENTIALS] = provider;
  } else {
    Object.defineProperty(target, MACOS_SIGNING_CREDENTIALS, {
      configurable: true,
      enumerable: false,
      value: provider,
      writable: true,
    });
  }

  return normalizeMacOSSigningCredentials(provider());
}

/**
 * @param {object} target - In-memory credential owner.
 * @returns {Readonly<MacOSSigningCredentials>} - Stored credentials.
 */
export function getMacOSSigningCredentials(target) {
  // @ts-ignore - symbol-indexed private channel.
  const provider = target[MACOS_SIGNING_CREDENTIALS];
  return typeof provider === 'function'
    ? normalizeMacOSSigningCredentials(provider())
    : EMPTY_MACOS_SIGNING_CREDENTIALS;
}

export default {
  getMacOSSigningCredentials,
  setMacOSSigningCredentials,
};
