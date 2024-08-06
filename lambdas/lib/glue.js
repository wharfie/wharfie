'use strict';
const AWS = require('@aws-sdk/client-glue');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');

const BaseAWS = require('./base');

class Glue {
  /**
   * @param {import("@aws-sdk/client-glue").GlueClientConfig} options - Glue client configuration
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.glue = new AWS.Glue({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetPartitionRequest} params - params for getPartition request
   * @returns {Promise<import("@aws-sdk/client-glue").GetPartitionResponse>} - getPartition response
   */
  async getPartition(params) {
    try {
      return await this.glue.send(new AWS.GetPartitionCommand(params));
    } catch (e) {
      // @ts-ignore
      if (e.name === 'EntityNotFoundException') {
        return {};
      }
      throw e;
    }
  }

  /**
   * @param {import("@aws-sdk/client-glue").CreatePartitionRequest} params - params for createPartition request
   * @returns {Promise<import("@aws-sdk/client-glue").CreatePartitionResponse>} - createPartition response
   */
  async createPartition(params) {
    return await this.glue.send(new AWS.CreatePartitionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").BatchCreatePartitionRequest} params - params for batchCreatePartition request
   */
  async batchCreatePartition(params) {
    if (!params.PartitionInputList) {
      throw new Error('PartitionInputList is required');
    }
    while (params.PartitionInputList.length > 0) {
      const chunk = params.PartitionInputList.splice(0, 100);
      const { Errors } = await this.glue.send(
        new AWS.BatchCreatePartitionCommand({
          ...params,
          PartitionInputList: chunk,
        })
      );
      if (Errors && Errors.length > 0) {
        const reruns = [];
        let backoff = false;
        while (Errors.length > 0) {
          const error = Errors.pop() ?? {};
          if (error.ErrorDetail?.ErrorCode === 'AlreadyExistsException') {
            continue;
          }
          const rerun = chunk.find(
            (p) => p.Values?.join('/') === error.PartitionValues?.join('/')
          );
          const retryableErrors = [
            'InternalServiceException',
            'OperationTimeoutException',
            'InternalFailure',
            'ServiceUnavailable',
            'ThrottlingException',
          ];
          if (error.ErrorDetail?.ErrorCode === 'ThrottlingException')
            backoff = true;
          if (
            rerun &&
            retryableErrors.includes(error.ErrorDetail?.ErrorCode || '')
          )
            reruns.push(rerun);
        }
        if (backoff) await new Promise((resolve) => setTimeout(resolve, 5000));
        await this.batchCreatePartition({
          ...params,
          PartitionInputList: reruns,
        });
      }
    }
  }

  /**
   * @param {import("@aws-sdk/client-glue").UpdatePartitionRequest} params - params for updatePartition request
   * @returns {Promise<import("@aws-sdk/client-glue").UpdatePartitionResponse>} - updatePartition response
   */
  async updatePartition(params) {
    return await this.glue.send(new AWS.UpdatePartitionCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").BatchUpdatePartitionRequest} params - params for batchUpdatePartition request
   */
  async batchUpdatePartition(params) {
    if (!params.Entries) {
      throw new Error('Entries is required');
    }
    while (params.Entries.length > 0) {
      const chunk = params.Entries.splice(0, 100);
      const { Errors } = await this.glue.batchUpdatePartition({
        ...params,
        Entries: chunk,
      });
      if (Errors && Errors.length > 0) {
        const reruns = [];
        let backoff = false;
        while (Errors.length > 0) {
          const error = Errors.pop() ?? {};
          const rerun = chunk.find(
            (p) =>
              p.PartitionValueList?.join('/') ===
              error.PartitionValueList?.join('/')
          );
          const retryableErrors = [
            'InternalServiceException',
            'OperationTimeoutException',
            'InternalFailure',
            'ServiceUnavailable',
            'ThrottlingException',
          ];
          if (error.ErrorDetail?.ErrorCode === 'ThrottlingException')
            backoff = true;
          if (
            rerun &&
            retryableErrors.includes(error.ErrorDetail?.ErrorCode || '')
          )
            reruns.push(rerun);
        }
        if (backoff) await new Promise((resolve) => setTimeout(resolve, 5000));
        await this.batchUpdatePartition({
          ...params,
          Entries: reruns,
        });
      }
    }
  }

  /**
   * @param {import("@aws-sdk/client-glue").DeleteTableCommandInput} params - params for deleteTable request
   * @returns {Promise<import("@aws-sdk/client-glue").DeleteTableCommandOutput>} - deleteTable response
   */
  async deleteTable(params) {
    return await this.glue.send(new AWS.DeleteTableCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").BatchDeletePartitionRequest} params - params for batchDeletePartition request
   */
  async batchDeletePartition(params) {
    if (!params.PartitionsToDelete) {
      throw new Error('PartitionsToDelete is required');
    }
    while (params.PartitionsToDelete.length > 0) {
      const chunk = params.PartitionsToDelete.splice(0, 25);
      const { Errors } = await this.glue.send(
        new AWS.BatchDeletePartitionCommand({
          ...params,
          PartitionsToDelete: chunk,
        })
      );
      if (Errors && Errors.length > 0) {
        const reruns = [];
        let backoff = false;
        while (Errors.length > 0) {
          const error = Errors.pop() ?? {};
          const rerun = chunk.find(
            (p) => p.Values?.join('/') === error.PartitionValues?.join('/')
          );
          const retryableErrors = [
            'InternalServiceException',
            'OperationTimeoutException',
            'InternalFailure',
            'ServiceUnavailable',
            'ThrottlingException',
          ];
          if (error.ErrorDetail?.ErrorCode === 'ThrottlingException')
            backoff = true;
          if (
            rerun &&
            retryableErrors.includes(error.ErrorDetail?.ErrorCode || '')
          )
            reruns.push(rerun);
        }
        if (backoff) await new Promise((resolve) => setTimeout(resolve, 5000));
        await this.batchDeletePartition({
          ...params,
          PartitionsToDelete: reruns,
        });
      }
    }
  }

  /**
   * @param {import("@aws-sdk/client-glue").CreateTableCommandInput} params - params for createTable request
   * @returns {Promise<import("@aws-sdk/client-glue").CreateTableCommandOutput>} - createTable response
   */
  async createTable(params) {
    return await this.glue.send(new AWS.CreateTableCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").UpdateTableCommandInput} params - params for updateTable request
   * @returns {Promise<import("@aws-sdk/client-glue").UpdateTableCommandOutput>} - updateTable response
   */
  async updateTable(params) {
    return await this.glue.send(new AWS.UpdateTableCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetTableCommandInput} params - params for getTable request
   * @returns {Promise<import("@aws-sdk/client-glue").GetTableCommandOutput>} - getTable response
   */
  async getTable(params) {
    return await this.glue.send(new AWS.GetTableCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetDatabaseCommandInput} params - params for getDatabase request
   * @returns {Promise<import("@aws-sdk/client-glue").GetDatabaseCommandOutput>} - getDatabase response
   */
  async getDatabase(params) {
    return await this.glue.send(new AWS.GetDatabaseCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").CreateDatabaseCommandInput} params - params for createDatabase request
   * @returns {Promise<import("@aws-sdk/client-glue").CreateDatabaseCommandOutput>} - createDatabase response
   */
  async createDatabase(params) {
    return await this.glue.send(new AWS.CreateDatabaseCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").DeleteDatabaseCommandInput} params - params for deleteDatabase request
   * @returns {Promise<import("@aws-sdk/client-glue").DeleteDatabaseCommandOutput>} - deleteDatabase response
   */
  async deleteDatabase(params) {
    return await this.glue.send(new AWS.DeleteDatabaseCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetTagsCommandInput} params - params for getTags request
   * @returns {Promise<import("@aws-sdk/client-glue").GetTagsCommandOutput>} - getTags response
   */
  async getTags(params) {
    return await this.glue.send(new AWS.GetTagsCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").TagResourceCommandInput} params - params for tagResource request
   * @returns {Promise<import("@aws-sdk/client-glue").TagResourceCommandOutput>} - tagResource response
   */
  async tagResource(params) {
    return await this.glue.send(new AWS.TagResourceCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").UntagResourceCommandInput} params - params for untagResource request
   * @returns {Promise<import("@aws-sdk/client-glue").UntagResourceCommandOutput>} - untagResource response
   */
  async untagResource(params) {
    return await this.glue.send(new AWS.UntagResourceCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetTablesRequest} params - params for getTables request
   * @returns {Promise<import("@aws-sdk/client-glue").GetTablesResponse>} - getTables response
   */
  async getTables(params) {
    let response = await this.glue.send(new AWS.GetTablesCommand(params));
    const TableList = response.TableList || [];
    while (response.NextToken) {
      params.NextToken = response.NextToken;
      response = await this.glue.send(new AWS.GetTablesCommand(params));
      TableList.push(...(response.TableList || []));
    }
    return {
      TableList,
    };
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetPartitionsRequest} params - params for getPartitions request
   * @param {Array<import('../typedefs').Partition>} partitions - accumulator for Partition objects
   * @param {Array<import("@aws-sdk/client-glue").Column>} PartitionKeys - Partition keys that will exist in s3 paths
   */
  async getPartitionsSegment(params, partitions, PartitionKeys) {
    let response = await this.glue.send(new AWS.GetPartitionsCommand(params));
    (response.Partitions || []).forEach((partition) => {
      if (
        !partition.Values ||
        !partition.StorageDescriptor ||
        !partition.StorageDescriptor.Location
      )
        return;
      partitions.push({
        partitionValues: partition.Values.reduce(
          (acc, value, i) => ({
            [PartitionKeys[i].Name || 'undefined']: value,
            ...acc,
          }),
          {}
        ),
        location: partition.StorageDescriptor.Location,
      });
    });

    while (response.NextToken) {
      params.NextToken = response.NextToken;
      response = await this.glue.send(new AWS.GetPartitionsCommand(params));
      (response.Partitions || []).forEach((partition) => {
        if (
          !partition.Values ||
          !partition.StorageDescriptor ||
          !partition.StorageDescriptor.Location
        )
          return;
        partitions.push({
          partitionValues: partition.Values.reduce(
            (acc, value, i) => ({
              [PartitionKeys[i].Name || 'undefined']: value,
              ...acc,
            }),
            {}
          ),
          location: partition.StorageDescriptor.Location,
        });
      });
    }
  }

  /**
   * @param {import("@aws-sdk/client-glue").GetPartitionsRequest} params - params for getPartitions request
   * @returns {Promise<Array<import('../typedefs').Partition>>} - partitions in glue table
   */
  async getPartitions(params) {
    const TotalSegments = 10;
    /** @type {Array<import('../typedefs').Partition>} */
    const partitions = [];
    const { Table } = await this.getTable({
      DatabaseName: params.DatabaseName,
      Name: params.TableName,
    });
    if (!Table || !Table.PartitionKeys)
      throw new Error('Failed to fetch Table Partitions');
    const { PartitionKeys } = Table;
    const promises = [...Array(TotalSegments).keys()].map((segment) =>
      this.getPartitionsSegment(
        {
          ...params,
          Segment: {
            TotalSegments,
            SegmentNumber: segment,
          },
        },
        partitions,
        PartitionKeys
      )
    );
    await Promise.all(promises);
    return partitions;
  }

  /**
   * @param {import('../typedefs').ResourceRecord} resource - database to clone table into
   * @param {import("@aws-sdk/client-glue").GetTableRequest} params - params for getTable request
   * @param {string} databaseName - database to clone table into
   * @param {string} tableName - name of cloned table
   * @param {string} storage_id - unique suffix to use for the cloned storage path
   */
  async cloneDestinationTable(
    resource,
    params,
    databaseName,
    tableName,
    storage_id
  ) {
    const { Table } = await this.getTable(params);
    if (!Table) throw Error(`Table does not exist`);
    try {
      const { Table: alreadyExists } = await this.getTable({
        Name: tableName,
        DatabaseName: databaseName,
      });
      if (alreadyExists) {
        await this.deleteTable({
          Name: tableName,
          DatabaseName: databaseName,
        });
      }
      // eslint-disable-next-line no-empty
    } catch (e) {}
    const base_location = (resource.destination_properties.location || '')
      .replace('/references/', '/')
      .replace('/migrate-references/', '/');
    await this.createTable({
      DatabaseName: databaseName,
      TableInput: {
        Name: tableName,
        ...(Table.Description && { Description: Table.Description }),
        ...(Table.Owner && { Owner: Table.Owner }),
        ...(Table.Retention && { Retention: Table.Retention }),
        ...(Table.PartitionKeys && { PartitionKeys: Table.PartitionKeys }),
        ...(Table.ViewOriginalText && {
          ViewOriginalText: Table.ViewOriginalText,
        }),
        ...(Table.ViewExpandedText && {
          ViewExpandedText: Table.ViewExpandedText,
        }),
        ...(Table.TableType && { TableType: Table.TableType }),
        ...(Table.Parameters && { Parameters: Table.Parameters }),
        ...(Table.TargetTable && { TargetTable: Table.TargetTable }),
        StorageDescriptor: {
          ...(Table.StorageDescriptor || {}),
          InputFormat:
            'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
          OutputFormat:
            'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
          Location: `${base_location}data/${storage_id}/`,
        },
      },
    });
  }
}

Glue.EntityNotFoundException = AWS.EntityNotFoundException;

module.exports = Glue;
