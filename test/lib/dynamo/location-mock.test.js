/* eslint-disable jest/no-hooks */
'use strict';

jest.mock('../../../lambdas/lib/dynamo/location');

const location = require('../../../lambdas/lib/dynamo/location');

describe('dynamo location db', () => {
  afterEach(() => {
    location.__setMockState();
  });

  it('putLocation', async () => {
    expect.assertions(1);
    await location.putLocation({
      resource_id: 'resource_id',
      location: 's3://somebucket/prefix/',
    });
    expect(location.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "s3://somebucket/prefix/": Object {
          "resource_id": Object {
            "location": "s3://somebucket/prefix/",
            "resource_id": "resource_id",
          },
        },
      }
    `);
  });

  it('findLocations', async () => {
    expect.assertions(1);
    await location.putLocation({
      resource_id: 'resource_id',
      location: 's3://somebucket/prefix/',
    });
    await location.putLocation({
      resource_id: 'resource_id_1',
      location: 's3://somebucket/prefix/',
    });
    await location.putLocation({
      resource_id: 'resource_id_1',
      location: 's3://somebucket/prefix/foo/',
    });
    const result = await location.findLocations(
      's3://some_bucket/prefix/partion=a/a_key.json'
    );
    expect(result).toMatchInlineSnapshot(`Array []`);
  });

  it('deleteLocation', async () => {
    expect.assertions(1);
    await location.putLocation({
      resource_id: 'resource_id',
      location: 's3://somebucket/prefix/',
    });
    await location.deleteLocation({
      resource_id: 'resource_id',
      location: 's3://somebucket/prefix/',
    });
    expect(location.__getMockState()).toMatchInlineSnapshot(`
      Object {
        "s3://somebucket/prefix/": Object {},
      }
    `);
  });
});
