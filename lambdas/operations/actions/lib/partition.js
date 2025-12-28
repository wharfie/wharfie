class Partition {
  /**
   * @typedef PartitionOptions
   * @property {import('../../../lib/s3.js').default} s3 - wharfie s3 resource
   * @property {import('../../../lib/glue.js').default} glue - wharfie glue resource
   * @param {PartitionOptions} options - options for Partition instance
   */
  constructor({ s3, glue }) {
    this.s3 = s3;
    this.glue = glue;
  }

  /**
   *
   * @typedef registerPartitionsParams
   * @property {Array<import('../../../typedefs.js').Partition>} partitions -
   * @property {string} databaseName -
   * @property {string} tableName -
   * @param {registerPartitionsParams} params -
   * @returns {string[]} -
   */
  getRegisterPartitionQueries({ partitions, databaseName, tableName }) {
    const partitionStatements = partitions.map((partition) => {
      const keyStatements = Object.entries(partition.partitionValues)
        .reverse()
        .map(
          ([partitionKey, partitionValue]) =>
            `${partitionKey}='${partitionValue}'`,
        )
        .join(', ');
      return `PARTITION (${keyStatements}) LOCATION '${partition.location}'`;
    });

    const queries = [];
    while (partitionStatements.length > 0)
      queries.push(
        `ALTER TABLE ${databaseName}.${tableName} ADD IF NOT EXISTS
          ${partitionStatements.splice(0, 100).join('\n')}`,
      );

    return queries;
  }

  /**
   *
   * @param {import('../../../typedefs.js').Partition} partition -
   * @returns {Promise<import('../../../typedefs.js').Partition>} -
   */
  async followSymlinks(partition) {
    const { bucket, prefix } = this.s3.parseS3Uri(partition.location);
    try {
      const body = await this.s3.getObject({
        Bucket: bucket,
        Key: `${prefix}files`,
      });
      const references = (body || '').toString().split('\n');
      if (references.length === 0) throw new Error('empty reference file');
      const { bucket: refBucket, prefix: refPrefix } = this.s3.parseS3Uri(
        references[0],
      );
      return {
        partitionValues: partition.partitionValues,
        location: `s3://${refBucket}/${refPrefix.substring(
          0,
          refPrefix.lastIndexOf('/'),
        )}`,
      };
    } catch (error) {
      // @ts-ignore
      if (error.name === 'NoSuchKey') {
        return partition;
      }
      throw error;
    }
  }

  /**
   * @typedef registerParams
   * @property {string} uri - uri for target table's s3 root
   * @property {Array<{name: string}>} partitionKeys - partition keys for target table
   * @property {string} databaseName - target database name
   * @property {string} tableName - target table name
   * @param {registerParams} params -
   */
  async followTableSymlink({ uri, databaseName, tableName }) {
    const { location: tableLocation } = await this.followSymlinks({
      partitionValues: {},
      location: uri,
    });
    if (uri === tableLocation) return;
    const { Table: table } = await this.glue.getTable({
      DatabaseName: databaseName,
      Name: tableName,
    });
    if (!table)
      throw new Error(`Table ${databaseName}.${tableName} does not exist`);
    await this.glue.updateTable({
      DatabaseName: databaseName,
      TableInput: {
        Name: tableName,
        ...(table.Description && { Description: table.Description }),
        ...(table.Owner && { Owner: table.Owner }),
        ...(table.Retention && { Retention: table.Retention }),
        ...(table.PartitionKeys && { PartitionKeys: table.PartitionKeys }),
        ...(table.ViewOriginalText && {
          ViewOriginalText: table.ViewOriginalText,
        }),
        ...(table.ViewExpandedText && {
          ViewExpandedText: table.ViewExpandedText,
        }),
        ...(table.TableType && { TableType: table.TableType }),
        ...(table.Parameters && { Parameters: table.Parameters }),
        ...(table.TargetTable && { TargetTable: table.TargetTable }),
        StorageDescriptor: {
          ...table.StorageDescriptor,
          Location: tableLocation,
        },
      },
    });
  }

  /**
   * @param {registerParams} params -
   */
  async registerAll({ uri, partitionKeys, databaseName, tableName }) {
    const { bucket, prefix } = this.s3.parseS3Uri(uri);
    const partitions = await this.s3.findPartitions(
      bucket,
      prefix,
      partitionKeys,
    );

    const { Table } = await this.glue.getTable({
      DatabaseName: databaseName,
      Name: tableName,
    });
    if (!Table) {
      throw new Error('Table does not exist');
    }
    const symlinkedPartitions = await Promise.all(
      partitions.map(this.followSymlinks, this),
    );

    await this.glue.batchCreatePartition({
      DatabaseName: databaseName,
      TableName: tableName,
      PartitionInputList: symlinkedPartitions.map((p) => ({
        Values: partitionKeys.map((key) => `${p.partitionValues[key.name]}`),
        StorageDescriptor: {
          ...Table.StorageDescriptor,
          Location: p.location,
        },
        Parameters: Table.Parameters,
      })),
    });
  }

  /**
   * @param {registerParams} params -
   */
  async registerMissing({ uri, partitionKeys, databaseName, tableName }) {
    const { bucket, prefix } = this.s3.parseS3Uri(uri);
    const logicalPartitions = await this.s3.findPartitions(
      bucket,
      prefix,
      partitionKeys,
    );
    const registeredPartitions = await this.glue.getPartitions({
      DatabaseName: databaseName,
      TableName: tableName,
    });
    const { Table } = await this.glue.getTable({
      DatabaseName: databaseName,
      Name: tableName,
    });
    if (!Table) {
      throw new Error('Table does not exist');
    }
    const registeredPartitionsSet = new Set(
      registeredPartitions.map((partition) =>
        partitionKeys
          .map((key) => partition.partitionValues[key.name])
          .join('/'),
      ),
    );
    const logicalPartitionsSet = new Set(
      logicalPartitions.map((partition) =>
        partitionKeys
          .map((key) => partition.partitionValues[key.name])
          .join('/'),
      ),
    );
    const missingPartitions = logicalPartitions.filter(
      (partition) =>
        !registeredPartitionsSet.has(
          partitionKeys
            .map((key) => partition.partitionValues[key.name])
            .join('/'),
        ),
    );
    const expiredPartitions = registeredPartitions.filter(
      (partition) =>
        !logicalPartitionsSet.has(
          partitionKeys
            .map((key) => partition.partitionValues[key.name])
            .join('/'),
        ),
    );

    const symlinkedPartitions = await Promise.all(
      missingPartitions.map(this.followSymlinks, this),
    );

    await Promise.all([
      this.glue.batchCreatePartition({
        DatabaseName: databaseName,
        TableName: tableName,
        PartitionInputList: symlinkedPartitions.map((p) => ({
          Values: partitionKeys.map((key) => `${p.partitionValues[key.name]}`),
          StorageDescriptor: {
            ...Table.StorageDescriptor,
            Location: p.location,
          },
          Parameters: Table.Parameters,
        })),
      }),
      this.glue.batchDeletePartition({
        DatabaseName: databaseName,
        TableName: tableName,
        PartitionsToDelete: expiredPartitions.map((p) => ({
          Values: partitionKeys.map((key) => `${p.partitionValues[key.name]}`),
        })),
      }),
    ]);
  }

  /**
   *
   * @typedef registerPartitionParams
   * @property {import('../../../typedefs.js').Partition} partition -
   * @property {string} databaseName -
   * @property {string} tableName -
   * @param {registerPartitionParams} params -
   */
  async registerPartition({ partition, databaseName, tableName }) {
    const { Table } = await this.glue.getTable({
      DatabaseName: databaseName,
      Name: tableName,
    });
    if (!Table) {
      throw new Error('Table does not exist');
    }
    if ((Table.PartitionKeys || []).length === 0) {
      // unpartitioned tables
      return;
    }
    const partitionValues = (Table.PartitionKeys || []).map(
      (key) => `${partition.partitionValues[key.Name || '']}`,
    );
    try {
      await this.glue.createPartition({
        DatabaseName: databaseName,
        TableName: tableName,
        PartitionInput: {
          Values: partitionValues,
          StorageDescriptor: {
            ...Table.StorageDescriptor,
            Location: partition.location,
          },
          Parameters: Table.Parameters,
        },
      });
    } catch (err) {
      // @ts-ignore
      if (err.name === 'AlreadyExistsException') {
        await this.glue.updatePartition({
          DatabaseName: databaseName,
          TableName: tableName,
          PartitionValueList: partitionValues,
          PartitionInput: {
            Values: partitionValues,
            StorageDescriptor: {
              ...Table.StorageDescriptor,
              Location: partition.location,
            },
            Parameters: Table.Parameters,
          },
        });
      } else {
        throw err;
      }
    }
  }
}

export default Partition;
