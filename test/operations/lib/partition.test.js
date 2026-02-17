/* eslint-disable jest/no-hooks */
import { afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const AWSGlue = require('@aws-sdk/client-glue');
const AWSAthena = require('@aws-sdk/client-athena');
const AWSS3 = require('@aws-sdk/client-s3');
const Partition = require('../../../lambdas/operations/actions/lib/partition');
const Glue = require('../../../lambdas/lib/glue');
const S3 = require('../../../lambdas/lib/s3');

describe('partition', () => {
  beforeAll(() => {
    require('aws-sdk-client-mock-jest');
  });

  afterEach(() => {
    AWSGlue.GlueMock.reset();
    AWSAthena.AthenaMock.reset();
    AWSS3.S3Mock.reset();
  });

  it('registerPartition', async () => {
    expect.assertions(6);

    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
        StorageDescriptor: {
          Location: 's3://bucket/prefix/references/',
        },
        Parameters: {},
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.CreatePartitionCommand).rejects({
      name: 'AlreadyExistsException',
    });
    AWSGlue.GlueMock.on(AWSGlue.UpdatePartitionCommand).resolves({});

    const glue = new Glue({ region: 'us-east-1' });
    const s3 = new S3({ region: 'us-east-1' });
    const partition = new Partition({
      glue,
      s3,
    });
    await partition.registerPartition({
      partition: {
        location: 's3://somebucket/prefix/a=10/b=20/',
        partitionValues: {
          b: '20',
          a: '10',
        },
      },
      databaseName: 'test_db',
      tableName: 'test_table',
    });

    expect(AWSGlue.GlueMock).toHaveReceivedCommandTimes(
      AWSGlue.GetTableCommand,
      1,
    );
    expect(
      AWSGlue.GlueMock.commandCalls(AWSGlue.GetTableCommand)[0].args[0].input,
    ).toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "Name": "test_table",
      }
    `);

    expect(AWSGlue.GlueMock).toHaveReceivedCommandTimes(
      AWSGlue.CreatePartitionCommand,
      1,
    );
    expect(
      AWSGlue.GlueMock.commandCalls(AWSGlue.CreatePartitionCommand)[0].args[0]
        .input,
    ).toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "PartitionInput": {
          "Parameters": {},
          "StorageDescriptor": {
            "Location": "s3://somebucket/prefix/a=10/b=20/",
          },
          "Values": [
            "10",
            "20",
          ],
        },
        "TableName": "test_table",
      }
    `);

    expect(AWSGlue.GlueMock).toHaveReceivedCommandTimes(
      AWSGlue.UpdatePartitionCommand,
      1,
    );
    expect(
      AWSGlue.GlueMock.commandCalls(AWSGlue.UpdatePartitionCommand)[0].args[0]
        .input,
    ).toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "PartitionInput": {
          "Parameters": {},
          "StorageDescriptor": {
            "Location": "s3://somebucket/prefix/a=10/b=20/",
          },
          "Values": [
            "10",
            "20",
          ],
        },
        "PartitionValueList": [
          "10",
          "20",
        ],
        "TableName": "test_table",
      }
    `);
  });

  it('registerAll', async () => {
    expect.assertions(2);

    AWSS3.S3Mock.on(AWSS3.ListObjectsV2Command)
      .resolvesOnce({
        CommonPrefixes: [{ Prefix: 'prefix/references/a=1/' }],
      })
      .resolvesOnce({
        CommonPrefixes: [
          { Prefix: 'prefix/references/a=1/b=1/' },
          { Prefix: 'prefix/references/a=1/b=2/' },
          { Prefix: 'prefix/references/a=1/b=3/' },
        ],
        NextContinuationToken: 'token',
      })
      .resolvesOnce({
        CommonPrefixes: [{ Prefix: 'prefix/references/a=1/b=4/' }],
      });

    AWSS3.S3Mock.on(AWSS3.GetObjectCommand).callsFake((params) => {
      if (params.Key === 'prefix/references/a=1/b=1/files') {
        return {
          Body: 's3://bucket/prefix/data/someprefix1/a=1/b=1/aasdfasma.sasd',
        };
      }
      if (params.Key === 'prefix/references/a=1/b=2/files') {
        return {
          Body: 's3://bucket/prefix/data/someprefix2/a=1/b=2/asdfa.asdf',
        };
      }
      if (params.Key === 'prefix/references/a=1/b=3/files') {
        return {
          Body: 's3://bucket/prefix/data/someprefix2/a=1/b=3/asadfa.asdf',
        };
      }
      if (params.Key === 'prefix/references/a=1/b=4/files') {
        return {
          Body: 's3://bucket/prefix/data/someprefix2/a=1/b=4/asdfasd.asdf',
        };
      }
    });

    AWSGlue.GlueMock.on(AWSGlue.GetTableCommand).resolves({
      Table: {
        PartitionKeys: [
          {
            Name: 'a',
          },
          {
            Name: 'b',
          },
        ],
        StorageDescriptor: {
          Location: 's3://bucket/prefix/references/',
        },
        Parameters: {},
      },
    });
    AWSGlue.GlueMock.on(AWSGlue.GetPartitionsCommand)
      .resolvesOnce({
        Partitions: [
          {
            Values: ['1', '1'],
            StorageDescriptor: {
              Location: 's3://bucket/prefix/data/someprefix4/a=1/b=1/',
            },
          },
          {
            Values: ['1', '7'],
            StorageDescriptor: {
              Location: 's3://bucket/prefix/data/someprefix5/a=1/b=7/',
            },
          },
        ],
      })
      .resolves({
        Partitions: [],
      });

    AWSGlue.GlueMock.on(AWSGlue.BatchDeletePartitionCommand).resolves({});
    AWSGlue.GlueMock.on(AWSGlue.BatchCreatePartitionCommand).resolves({});

    const glue = new Glue({ region: 'us-east-1' });
    const s3 = new S3({ region: 'us-east-1' });
    const partition = new Partition({
      glue,
      s3,
    });
    await partition.registerMissing({
      uri: 's3://bucket/prefix/references/',
      partitionKeys: [
        {
          Name: 'a',
        },
        {
          Name: 'b',
        },
      ],
      databaseName: 'test_db',
      tableName: 'test_table',
    });

    expect(
      AWSGlue.GlueMock.commandCalls(AWSGlue.BatchDeletePartitionCommand)[0]
        .args[0].input,
    ).toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "PartitionsToDelete": [
          {
            "Values": [
              "undefined",
              "undefined",
            ],
          },
          {
            "Values": [
              "undefined",
              "undefined",
            ],
          },
        ],
        "TableName": "test_table",
      }
    `);
    expect(
      AWSGlue.GlueMock.commandCalls(AWSGlue.BatchCreatePartitionCommand)[0]
        .args[0].input,
    ).toMatchInlineSnapshot(`
      {
        "DatabaseName": "test_db",
        "PartitionInputList": [
          {
            "Parameters": {},
            "StorageDescriptor": {
              "Location": "s3://bucket/prefix/data/someprefix1/a=1/b=1",
            },
            "Values": [
              "a=1",
              "a=1",
            ],
          },
          {
            "Parameters": {},
            "StorageDescriptor": {
              "Location": "s3://bucket/prefix/data/someprefix2/a=1/b=2",
            },
            "Values": [
              "a=1",
              "a=1",
            ],
          },
          {
            "Parameters": {},
            "StorageDescriptor": {
              "Location": "s3://bucket/prefix/data/someprefix2/a=1/b=3",
            },
            "Values": [
              "a=1",
              "a=1",
            ],
          },
          {
            "Parameters": {},
            "StorageDescriptor": {
              "Location": "s3://bucket/prefix/data/someprefix2/a=1/b=4",
            },
            "Values": [
              "a=1",
              "a=1",
            ],
          },
        ],
        "TableName": "test_table",
      }
    `);
  });
});
