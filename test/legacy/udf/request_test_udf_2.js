import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const handler = async (param_1, param_2, param_3) => {
  return `multi param input: ${param_1}, ${param_2}, ${param_3}`;
};
module.exports = { handler };
