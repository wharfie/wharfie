import S3 from '../../aws/s3.js';

/**
 * @typedef CreateR2ObjectStorageOptions
 * @property {string} [accountId] - Cloudflare account id. If provided, endpoint defaults to `https://{accountId}.r2.cloudflarestorage.com`.
 * @property {string} [endpoint] - Custom R2 endpoint (S3-compatible).
 * @property {string} [region] - R2 region (usually `auto`).
 * @property {{ accessKeyId: string, secretAccessKey: string }} [credentials] - R2 access keys.
 * @property {boolean} [forcePathStyle] - Force path-style requests.
 */

/**
 * Cloudflare R2 adapter.
 *
 * This is a thin wrapper around the existing `lambdas/lib/s3.js` helper class,
 * pinned to the `r2` provider.
 * @param {CreateR2ObjectStorageOptions & any} [options] - Options forwarded to `new S3(options)`.
 * @returns {import('../base.js').ObjectStorageClient} - Result.
 */
export default function createR2ObjectStorage(options = {}) {
  const { accountId, endpoint, region, credentials, forcePathStyle, ...rest } =
    options;

  return new S3({
    ...rest,
    provider: 'r2',
    providerOptions: {
      ...(accountId ? { accountId } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(region ? { region } : {}),
      ...(credentials ? { credentials } : {}),
      ...(typeof forcePathStyle === 'boolean' ? { forcePathStyle } : {}),
    },
  });
}
