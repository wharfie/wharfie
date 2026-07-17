import { invokeActivity } from '@wharfie/wharfie/app';

/**
 * Run the packaged hello-world developer CLI.
 * @param {string[]} [argv] - Node-style process arguments.
 * @returns {Promise<void>}
 */
export async function main(argv = process.argv) {
  const who = argv[2] || 'world';
  const result = await invokeActivity('echo-event', { input: { who } });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
