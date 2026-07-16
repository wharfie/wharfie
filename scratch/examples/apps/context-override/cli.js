import { invokeActivity } from '../../../../src/app.js';

/**
 * Run the packaged context inspection CLI.
 * @returns {Promise<void>}
 */
export async function main() {
  const result = await invokeActivity('inspect-context');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
