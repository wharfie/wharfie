/**
 * @param {unknown} appId - Application identity.
 * @returns {string} - File-system-safe application name.
 */
export function getPackageArtifactSafeAppName(appId) {
  return String(appId)
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

/**
 * Derive the shared content-addressed file name used by artifact publication
 * and its public command receipt.
 * @param {{
 *   appId: string,
 *   target: {platform: string},
 *   byteDigest: {value: string}
 * }} value - Validated artifact identity fields.
 * @returns {string} - Canonical artifact file name.
 */
export function getPackageArtifactFileName(value) {
  const safeAppName = getPackageArtifactSafeAppName(value.appId);
  const digestHex = Buffer.from(value.byteDigest.value, 'base64url').toString(
    'hex',
  );
  const extension = value.target.platform === 'win32' ? '.exe' : '';
  return `${safeAppName}-sha256-${digestHex}${extension}`;
}

export default {
  getPackageArtifactFileName,
  getPackageArtifactSafeAppName,
};
