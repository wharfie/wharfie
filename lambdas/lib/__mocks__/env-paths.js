// eslint-disable-next-line node/no-unpublished-import
import { jest } from '@jest/globals';
const envPaths = jest.fn(() => ({
  data: 'mock',
  config: 'mock',
  cache: 'mock',
  log: 'mock',
  temp: 'mock',
}));

export default envPaths;
