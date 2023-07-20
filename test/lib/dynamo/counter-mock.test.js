/* eslint-disable jest/no-hooks */
'use strict';
jest.mock('../../../lambdas/lib/dynamo/counter');

const counter = require('../../../lambdas/lib/dynamo/counter');

describe('dynamo counter db', () => {
  afterEach(() => {
    counter.__setMockState();
  });

  it('increment', async () => {
    expect.assertions(1);
    await counter.increment('counter_name', 1);
    expect(counter.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "counter_name": 1,
      }
    `);
  });

  it('incrementReturnUpdated', async () => {
    expect.assertions(1);
    const result = await counter.incrementReturnUpdated('counter_name', 1);
    expect(result).toMatchInlineSnapshot(`1`);
  });

  it('deleteCountersByPrefix', async () => {
    expect.assertions(1);

    await counter.increment('semaphore_foo', 100);
    await counter.increment('semaphore_bar', 2);
    await counter.increment('foo_bar', 10);
    await counter.deleteCountersByPrefix('semaphore_');

    expect(counter.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "foo_bar": 10,
      }
    `);
  });
});
