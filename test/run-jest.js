import { spawnSync } from 'node:child_process';

/**
 * @param {string[]} argv - argv.
 * @returns {boolean} - Result.
 */
function hasWorkerFlag(argv) {
  return argv.some(
    (arg) =>
      arg === '--runInBand' ||
      arg === '--maxWorkers' ||
      arg === '-w' ||
      arg.startsWith('--maxWorkers=') ||
      arg.startsWith('-w='),
  );
}

const forwardedArgs = process.argv.slice(2);
const args = [
  '--experimental-vm-modules',
  'node_modules/jest/bin/jest.js',
  ...forwardedArgs,
];

if (!hasWorkerFlag(forwardedArgs)) {
  args.push('--maxWorkers=4');
}

const result = spawnSync(process.execPath, args, {
  env: process.env,
  stdio: 'inherit',
});

if (result.error) {
  throw result.error;
}

if (result.signal) {
  process.kill(process.pid, result.signal);
}

process.exit(result.status ?? 1);
