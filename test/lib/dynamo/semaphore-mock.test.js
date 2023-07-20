/* eslint-disable jest/no-hooks */
'use strict';

jest.mock('../../../lambdas/lib/dynamo/semaphore');

const semaphore = require('../../../lambdas/lib/dynamo/semaphore');

describe('dynamo semaphore db', () => {
  afterEach(() => {
    semaphore.__setMockState();
  });

  it('increase', async () => {
    expect.assertions(4);
    await semaphore.increase('semaphore_name');
    await semaphore.increase('semaphore_name');
    let result = await semaphore.increase('semaphore_name');
    expect(result).toBe(true);
    await semaphore.increase('semaphore_name', 3);
    await semaphore.increase('semaphore_name', 3);
    result = await semaphore.increase('semaphore_name', 3);
    expect(result).toBe(false);
    result = await semaphore.increase('semaphore_name_2', 3);
    expect(result).toBe(true);
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "semaphore_name": Object {
          "limit": Infinity,
          "value": 3,
        },
        "semaphore_name_2": Object {
          "limit": Infinity,
          "value": 1,
        },
      }
    `);
  });

  it('release', async () => {
    expect.assertions(1);
    await semaphore.increase('semaphore_name');
    await semaphore.increase('semaphore_name');
    await semaphore.increase('semaphore_name');
    await semaphore.increase('semaphore_name', 3);
    await semaphore.increase('semaphore_name_2', 3);
    await semaphore.release('semaphore_name_2');
    await semaphore.release('semaphore_name');
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "semaphore_name": Object {
          "limit": Infinity,
          "value": 2,
        },
        "semaphore_name_2": Object {
          "limit": Infinity,
          "value": 0,
        },
      }
    `);
  });

  it('deleteSemaphore', async () => {
    expect.assertions(1);
    await semaphore.increase('wharfie');
    await semaphore.increase('wharfie');
    await semaphore.increase('wharfie');
    await semaphore.increase('wharfie');
    await semaphore.increase('wharfie');
    await semaphore.increase('wharfie');
    await semaphore.increase('semaphore_name');
    await semaphore.increase('semaphore_name');
    await semaphore.increase('semaphore_name');
    await semaphore.deleteSemaphore('semaphore_name');
    expect(semaphore.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "wharfie": Object {
          "limit": Infinity,
          "value": 3,
        },
      }
    `);
  });
});
