/* eslint-disable jest/no-hooks */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { applyAutoMocks } from '../../mocks/automocks.js';

await applyAutoMocks({
  projectRoot: process.cwd(),
  debug: true,
});

const location = await import('../../../lambdas/lib/dynamo/location.js');

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
      {
        "s3://somebucket/prefix/": {
          "resource_id": {
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
      's3://some_bucket/prefix/partion=a/a_key.json',
    );

    expect(result).toMatchInlineSnapshot(`[]`);
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
      {
        "s3://somebucket/prefix/": {},
      }
    `);
  });
});
