/* eslint-disable jest/no-hooks */
'use strict';
jest.mock('../../../lambdas/lib/dynamo/scheduler');

const scheduler = require('../../../lambdas/lib/dynamo/scheduler');

describe('dynamo event db', () => {
  afterEach(() => {
    scheduler.__setMockState();
  });

  it('query', async () => {
    expect.assertions(1);

    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112311',
    });
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:212312',
    });
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112313',
    });
    const value = await scheduler.query('test', 'dt=10', ['112312', '212312']);
    expect(value).toMatchInlineSnapshot(`
      [
        {
          "resource_id": "test",
          "sort_key": "dt=10:112312",
        },
        {
          "resource_id": "test",
          "sort_key": "dt=10:212312",
        },
        {
          "resource_id": "test",
          "sort_key": "dt=10:112313",
        },
      ]
    `);
  });

  it('schedule', async () => {
    expect.assertions(1);
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:212312',
    });
    expect(scheduler.__getMockState()).toMatchInlineSnapshot(`
      {
        "test": {
          "dt=10:112312": {
            "resource_id": "test",
            "sort_key": "dt=10:112312",
          },
          "dt=10:212312": {
            "resource_id": "test",
            "sort_key": "dt=10:212312",
          },
        },
      }
    `);
  });

  it('update', async () => {
    expect.assertions(1);
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await scheduler.update(
      {
        resource_id: 'test',
        sort_key: 'dt=10:112312',
      },
      'running'
    );
    expect(scheduler.__getMockState()).toMatchInlineSnapshot(`
      {
        "test": {
          "dt=10:112312": {
            "resource_id": "test",
            "sort_key": "dt=10:112312",
            "status": "running",
          },
        },
      }
    `);
  });

  it('delete_records', async () => {
    expect.assertions(1);
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await scheduler.schedule({
      resource_id: 'test',
      sort_key: 'dt=11:112312',
    });
    await scheduler.schedule({
      resource_id: 'test-1',
      sort_key: 'dt=10:112312',
    });
    await scheduler.delete_records('test');
    expect(scheduler.__getMockState()).toMatchInlineSnapshot(`
      {
        "test-1": {
          "dt=10:112312": {
            "resource_id": "test-1",
            "sort_key": "dt=10:112312",
          },
        },
      }
    `);
  });
});
