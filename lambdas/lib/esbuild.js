const { isSea, getAsset } = require('node:sea');
const fs = require('fs');
const os = require('os');
const path = require('path');
if (isSea()) {
  // Retrieve the esbuild asset as an ArrayBuffer.
  const assetBuffer = getAsset('esbuildBin');
  // Write the asset to a temporary file.
  const tmpEsbuildPath = path.join(
    os.tmpdir(),
    'esbuild-bin' + (process.platform === 'win32' ? '.exe' : '')
  );
  fs.writeFileSync(tmpEsbuildPath, Buffer.from(assetBuffer));
  fs.chmodSync(tmpEsbuildPath, 0o755);
  // Set the environment variable so that the esbuild JS wrapper knows which binary to use.
  process.env.ESBUILD_BINARY_PATH = tmpEsbuildPath;
}
const esbuild = require('esbuild');

module.exports = esbuild;
