export const DURABLE_DELAY_MS = 15_000;

const DEFAULT_NAME = 'world';
const USAGE = 'Usage: resumable-hello [name]';

function normalizeName(value = DEFAULT_NAME) {
  if (typeof value !== 'string') throw new TypeError(USAGE);
  const name = value.trim();
  if (!name || name.length > 80) throw new TypeError(USAGE);
  return name;
}

export function hello(name = DEFAULT_NAME) {
  return `Hello, ${normalizeName(name)}!`;
}

/**
 * @param {string[]} args - Application-owned arguments.
 * @returns {{name: string}} - Durable workflow input.
 */
export function toDurableInput(args) {
  if (!Array.isArray(args) || args.length > 1) throw new TypeError(USAGE);
  return { name: normalizeName(args[0]) };
}

export function main(argv = process.argv) {
  const message = hello(toDurableInput(argv.slice(2)).name);
  process.stdout.write(`${message}\n`);
  return message;
}

/**
 * @param {{name?: string}} input - Workflow input.
 * @param {{logger: {info: (message: string, fields: Record<string, string>) => void}}} runtime - Activity runtime.
 * @returns {{name: string, message: string}} - Prepared greeting.
 */
export function prepareGreeting(input, runtime) {
  const name = normalizeName(input?.name);
  runtime.logger.info('Prepared greeting', { name });
  return { name, message: hello(name) };
}

/**
 * @param {{name?: string, message?: string}} input - Prepared greeting.
 * @param {{logger: {info: (message: string, fields: Record<string, string>) => void}}} runtime - Activity runtime.
 * @returns {string} - Completed greeting.
 */
export function sayHello(input, runtime) {
  const name = normalizeName(input?.name);
  const message = hello(name);
  if (input?.message !== message) {
    throw new TypeError('The prepared greeting is invalid.');
  }
  runtime.logger.info('Completed greeting', { name });
  return message;
}
