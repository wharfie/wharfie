import S3 from '../../s3.js';

/**
 * AWS S3 adapter.
 *
 * This is a thin wrapper around the existing `lambdas/lib/s3.js` helper class,
 * pinned to the `aws` provider.
 * @param {any} [options] - Options forwarded to `new S3(options)`.
 * @returns {import('../base.js').ObjectStorageClient} -
 */
export default function createS3ObjectStorage(options = {}) {
  const region = options.region || process.env.AWS_REGION;
  return new S3({
    ...options,
    provider: 'aws',
    ...(region ? { region } : {}),
  });
}
