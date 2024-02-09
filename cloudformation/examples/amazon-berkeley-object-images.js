'use strict';

const wharfie = require('../../client');

const AmazonBerkeleyObjectImages = new wharfie.Resource({
  LogicalName: 'AmazonBerkeleyObjectImages',
  DatabaseName: wharfie.util.ref('Database'),
  WharfieDeployment: wharfie.util.ref('Deployment'),
  _TableInputOverride: {
    Name: 'amazon_berkeley_object_images',
    Description:
      'Amazon Berkeley Objects Images table https://amazon-berkeley-objects.s3.amazonaws.com/index.html',
    TableType: 'EXTERNAL_TABLE',
    Parameters: { EXTERNAL: 'TRUE', has_encrypted_data: 'false' },
    PartitionKeys: [],
    StorageDescriptor: {
      Location: 's3://amazon-berkeley-objects/images/metadata/',
      Columns: [
        {
          Name: 'image_id',
          Type: 'string',
        },
        {
          Name: 'height',
          Type: 'bigint',
        },
        {
          Name: 'width',
          Type: 'bigint',
        },
        {
          Name: 'path',
          Type: 'string',
        },
      ],
      InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
      OutputFormat:
        'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
      SerdeInfo: {
        SerializationLibrary:
          'org.apache.hadoop.hive.serde2.lazy.LazySimpleSerDe',
        Parameters: {
          'field.delim': ',',
          'serialization.format': ',',
          'skip.header.line.count': '1',
        },
      },
      Compressed: false,
      StoredAsSubDirectories: true,
      NumberOfBuckets: 0,
    },
  },
  CompactedConfig: {
    Location: wharfie.util.sub('s3://${Bucket}/AmazonBerkelyObjectImages/'),
  },
  DaemonConfig: {
    Privileged: true,
    Role: wharfie.util.getAtt('WharfieExamplesRole', 'Arn'),
    Schedule: 60,
  },
});

module.exports = AmazonBerkeleyObjectImages;
