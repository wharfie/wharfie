/* eslint-disable jest/no-hooks */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ConsoleLogTransport = require('../../../lambdas/lib/logging/console-log-transport');

let log;

describe('tests for console log transport', () => {
  beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    log.mockReset();
  });

  it('log test', async () => {
    expect.assertions(2);

    const transport = new ConsoleLogTransport();

    await transport.write('test1');

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenNthCalledWith(1, 'test1');
  });
});
