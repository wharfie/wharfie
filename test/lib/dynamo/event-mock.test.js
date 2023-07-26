/* eslint-disable jest/no-hooks */
'use strict';
jest.mock('../../../lambdas/lib/dynamo/event');

const event = require('../../../lambdas/lib/dynamo/event');

describe('dynamo event db', () => {
  afterEach(() => {
    event.__setMockState();
  });

  it('query', async () => {
    expect.assertions(1);

    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112311',
    });
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:212312',
    });
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112313',
    });
    const value = await event.query('test', 'dt=10', ['112312', '212312']);
    expect(value).toMatchInlineSnapshot(`
      Array [
        Object {
          "resource_id": "test",
          "sort_key": "dt=10:112312",
        },
        Object {
          "resource_id": "test",
          "sort_key": "dt=10:212312",
        },
        Object {
          "resource_id": "test",
          "sort_key": "dt=10:112313",
        },
      ]
    `);
  });

  it('schedule', async () => {
    expect.assertions(1);
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:212312',
    });
    expect(event.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "test": Object {
          "dt=10:112312": Object {
            "resource_id": "test",
            "sort_key": "dt=10:112312",
          },
          "dt=10:212312": Object {
            "resource_id": "test",
            "sort_key": "dt=10:212312",
          },
        },
      }
    `);
  });

  it('update', async () => {
    expect.assertions(1);
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await event.update(
      {
        resource_id: 'test',
        sort_key: 'dt=10:112312',
      },
      'running'
    );
    expect(event.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "test": Object {
          "dt=10:112312": Object {
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
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=10:112312',
    });
    await event.schedule({
      resource_id: 'test',
      sort_key: 'dt=11:112312',
    });
    await event.schedule({
      resource_id: 'test-1',
      sort_key: 'dt=10:112312',
    });
    await event.delete_records('test');
    expect(event.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "test-1": Object {
          "dt=10:112312": Object {
            "resource_id": "test-1",
            "sort_key": "dt=10:112312",
          },
        },
      }
    `);
  });
});
