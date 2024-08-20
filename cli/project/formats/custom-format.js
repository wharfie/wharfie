'use strict';

module.exports = ({
  TableName,
  Description,
  Location,
  Columns,
  PartitionKeys,
  CustomFormat,
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
    InputFormat: CustomFormat.InputFormat,
    OutputFormat: CustomFormat.OutputFormat,
    Compressed: CustomFormat.Compressed,
    SerdeInfo: CustomFormat.SerdeInfo,
    StoredAsSubDirectories: CustomFormat.StoredAsSubDirectories,
    NumberOfBuckets: CustomFormat.NumberOfBuckets,
  },
});
