'use strict';

/**
 * @param {import('./').FormatDefinitionParams} params -
 * @returns {import('./').FormatDefinition} -
 */
module.exports = ({
  TableName,
  Description,
  Location,
  Columns,
  PartitionKeys,
}) => ({
  Name: TableName,
  Description,
  TableType: 'EXTERNAL_TABLE',
  PartitionKeys,
  Parameters: {
    EXTERNAL: 'TRUE',
  },
  StorageDescriptor: {
    Location,
    Columns,
    InputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
    OutputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
    SerdeInfo: {
      SerializationLibrary: 'org.apache.hadoop.hive.serde2.RegexSerDe',
      Parameters: {
        'serialization.format': '1',
        'input.regex':
          '^([^ ]*) ([^ ]*) \\[(\\d{2})\\/(\\D{3})\\/(\\d{4})\\:(.*?)\\:(.*?)\\:(.*?) +(.*?)\\] ([^ ]*) ([^ ]*) ([^ ]*) (?<op13>[^ ]*) (?<key14>[^ ]*) (?:(?:\\"([^ ]*) ([^ ]*) (- |[^ ]*)\\")|-) (-|[0-9]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) (?:(\\"[^\\"]*\\")|-) ([^ ]*)(?: ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*))?.*$',
      },
    },
    Compressed: false,
    StoredAsSubDirectories: true,
    NumberOfBuckets: 0,
  },
});
