import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

/**
 * @param {import('esbuild').BuildOptions} args - args.
 * @returns {Promise<import('esbuild').BuildResult>} - Result.
 */
function build(args) {
  const esbuild = require('esbuild');
  // Your build logic here
  return esbuild.build(args);
}

export { build };
