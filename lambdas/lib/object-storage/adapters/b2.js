import S3 from '../../s3.js';

/**
 * @typedef CreateB2ObjectStorageOptions
 * @property {string} [region] - B2 S3 region (e.g. `us-east-005`). Defaults to `us-west-004` (Backblaze default).
 * @property {string} [endpoint] - Custom B2 S3 endpoint.
 * @property {{ accessKeyId: string, secretAccessKey: string }} [credentials] - B2 application key id + application key.
 * @property {boolean} [forcePathStyle] - Force path-style requests.
 */

/**
 * Backblaze B2 adapter.
 *
 * This is a thin wrapper around the existing `lambdas/lib/s3.js` helper class,
 * pinned to the `b2` provider.
 *
 * @param {CreateB2ObjectStorageOptions & any} [options] - Options forwarded to `new S3(options)`.
 * @returns {import('../base.js').ObjectStorageClient} -
 */
export default function createB2ObjectStorage(options = {}) {
  const { region, endpoint, credentials, forcePathStyle, ...rest } = options;

  return new S3({
    ...rest,
    provider: 'b2',
    providerOptions: {
      ...(region ? { region } : {}),
      ...(endpoint ? { endpoint } : {}),
      ...(credentials ? { credentials } : {}),
      ...(typeof forcePathStyle === 'boolean' ? { forcePathStyle } : {}),
    },
  });
}
