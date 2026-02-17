#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const mime = require('mime-types');

// Read version from package.json and use it as the S3 prefix.
const { version } = require('../../package.json');

const bucket = 'docs.wharfie.dev';
// Ensure prefix ends with a trailing slash.
const prefix = '';
// const prefix = version.endsWith('/') ? version : `${version}/`;

async function main() {
  const [{ default: S3 }, { map }] = await Promise.all([
    import('../../lambdas/lib/s3.js'),
    import('../../lambdas/lib/promises.js'),
  ]);

  const s3 = new S3();

  console.log(`Deploying version ${version} to s3://${bucket}/${prefix}`);

  // 1. Delete any existing objects under the version prefix.
  console.log(`Deleting objects under s3://${bucket}/${prefix}`);
  await s3.deletePath({
    Bucket: bucket,
    Prefix: prefix,
  });

  // 2. Upload the build/ directory under the version prefix.
  console.log(`Uploading build/ to s3://${bucket}/${prefix}`);
  const buildDir = path.join(__dirname, '..', 'build');
  await uploadDirectory(s3, map, bucket, prefix, buildDir);
}

async function scanDirectory(localDir, baseDir = localDir) {
  const fileList = [];
  const dirEntries = await fs.promises.readdir(localDir, {
    withFileTypes: true,
  });

  for (const entry of dirEntries) {
    const fullPath = path.join(localDir, entry.name);
    if (entry.isDirectory()) {
      // Recursively scan subdirectories
      const subDirFiles = await scanDirectory(fullPath, baseDir);
      fileList.push(...subDirFiles);
    } else if (entry.isFile()) {
      // Compute the relative path for S3 key
      let relativePath = path.relative(baseDir, fullPath);
      // Check if the file is "index.html" and handle renaming if necessary
      const contentType = mime.lookup(fullPath) || 'application/octet-stream';
      const s3Key = path.posix.join(
        prefix,
        relativePath.split(path.sep).join('/'),
      );
      fileList.push({ fullPath, s3Key, contentType });
    }
  }

  return fileList;
}

// Upload files in batches to S3
async function uploadBatches(s3, map, bucket, prefix, files) {
  const putObjectParams = await Promise.all(
    files.map(async ({ fullPath, s3Key, contentType }) => {
      const fileContent = await fs.promises.readFile(fullPath);
      return {
        Bucket: bucket,
        Key: path.posix.join(prefix, s3Key),
        Body: fileContent,
        ContentType: contentType,
      };
    }),
  );

  await map(
    putObjectParams,
    (params) => {
      return s3.putObject(params);
    },
    { concurrency: 10 },
  );
}

// Main function to scan and upload the directory
async function uploadDirectory(s3, map, bucket, prefix, localDir) {
  const files = await scanDirectory(localDir);
  await uploadBatches(s3, map, bucket, prefix, files);
}

main().catch((error) => {
  console.error('Deployment error:', error);
  process.exit(1);
});
