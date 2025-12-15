import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = async (input) => {
  return `HELLO WORLD, input ${input}`;
};
module.exports = { handler };
