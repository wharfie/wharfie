'use strict';

const { EntityNotFoundException } = jest.requireActual('@aws-sdk/client-glue');

class GlueMock {
  __setMockState(state) {
    if (state) {
      GlueMock.__state = state;
    }
  }

  __getMockState() {
    return GlueMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'GetDatabaseCommand':
        return await this.getDatabase(command.input);
      case 'GetPartitionCommand':
        return await this.getPartition(command.input);
      case 'GetPartitionsCommand':
        return await this.getPartitions(command.input);
      case 'CreatePartitionCommand':
        return await this.createPartition(command.input);
      case 'BatchCreatePartitionCommand':
        return await this.batchCreatePartition(command.input);
      case 'UpdatePartitionCommand':
        return await this.updatePartition(command.input);
      case 'BatchUpdatePartitionCommand':
        return await this.batchUpdatePartition(command.input);
      case 'DeletePartitionCommand':
        return await this.deletePartition(command.input);
      case 'BatchDeletePartitionCommand':
        return await this.batchDeletePartition(command.input);
      case 'CreateDatabaseCommand':
        return await this.createDatabase(command.input);
      case 'CreateTableCommand':
        return await this.createTable(command.input);
      case 'GetTableCommand':
        return await this.getTable(command.input);
      case 'UpdateTableCommand':
        return await this.updateTable(command.input);
      case 'DeleteTableCommand':
        return await this.deleteTable(command.input);
      case 'DeleteDatabaseCommand':
        return await this.deleteDatabase(command.input);
      case 'TagResourceCommand':
        return await this.tagResource(command.input);
      case 'GetTagsCommand':
        return await this.getTags(command.input);
    }
  }

  async getDatabase(params) {
    if (!GlueMock.__state[params.Name])
      throw new EntityNotFoundException({
        message: 'Database not found',
      });

    return { Database: GlueMock.__state[params.Name] };
  }

  async getPartition(params) {
    if (!GlueMock.__state[params.DatabaseName])
      throw new EntityNotFoundException({ message: 'Database not found' });
    if (!GlueMock.__state[params.DatabaseName]._tables[params.TableName])
      throw new EntityNotFoundException({ message: 'Table not found' });
    let _return = null;
    if (
      GlueMock.__state[params.DatabaseName]._tables[params.TableName]
        ._partitions[params.PartitionValues.join('::')]
    )
      _return = {
        ...GlueMock.__state[params.DatabaseName]._tables[params.TableName]
          ._partitions[params.PartitionValues.join('::')],
        DatabaseName: params.DatabaseName,
        TableName: params.TableName,
      };

    return { Partition: _return };
  }

  __chunkArray(array, parts) {
    const result = [];
    for (let i = parts; i > 0; i--) {
      result.push(array.splice(0, Math.ceil(array.length / i)));
    }
    return result;
  }

  async getPartitions(params) {
    const partitions = Object.values(
      GlueMock.__state[params.DatabaseName]._tables[params.TableName]
        ._partitions
    );
    const _return = {
      Partitions: partitions,
    };
    if (params.Segment) {
      const chunks = this.__chunkArray(
        partitions,
        params.Segment.TotalSegments
      );

      _return.Partitions = chunks[params.Segment.SegmentNumber];
    }
    return _return;
  }

  async createPartition(params) {
    GlueMock.__state[params.DatabaseName]._tables[params.TableName]._partitions[
      params.PartitionInput.Values.join('::')
    ] = params.PartitionInput;
  }

  async batchCreatePartition(params) {
    await Promise.all(
      params.PartitionInputList.map(async (input) => {
        await this.createPartition({
          ...params,
          PartitionInput: input,
        });
      })
    );
    return {
      Errors: [],
    };
  }

  async updatePartition(params) {
    GlueMock.__state[params.DatabaseName]._tables[params.TableName]._partitions[
      params.PartitionInput.Values.join('::')
    ] = params.PartitionInput;
  }

  async batchUpdatePartition(params) {
    params.Entries.forEach((input) => {
      this.updatePartition({
        ...params,
        PartitionInput: input,
      });
    });
  }

  async deletePartition(params) {
    delete GlueMock.__state[params.DatabaseName]._tables[params.TableName]
      ._partitions[params.PartitionValues.join('::')];
  }

  async batchDeletePartition(params) {
    await Promise.all(
      params.PartitionsToDelete.map(async (partition) => {
        await this.deletePartition({
          ...params,
          PartitionValues: partition.Values,
        });
      })
    );
    return {
      Errors: [],
    };
  }

  async createDatabase(params) {
    GlueMock.__state[params.DatabaseInput.Name] = {
      _tables: {},
    };
  }

  async createTable(params) {
    if (!GlueMock.__state[params.DatabaseName])
      throw new EntityNotFoundException({ message: 'database not found' });
    GlueMock.__state[params.DatabaseName]._tables[params.TableInput.Name] = {
      ...params.TableInput,
      DatabaseName: params.DatabaseName,
      _partitions: {},
    };
  }

  async getTable(params) {
    if (!GlueMock.__state[params.DatabaseName])
      throw new EntityNotFoundException({ message: 'database not found' });
    if (!GlueMock.__state[params.DatabaseName]._tables[params.Name])
      throw new EntityNotFoundException({ message: 'table not found' });
    return {
      Table: GlueMock.__state[params.DatabaseName]._tables[params.Name],
    };
  }

  async updateTable(params) {
    if (!GlueMock.__state[params.DatabaseName])
      throw new EntityNotFoundException({
        message: 'Database not found',
      });

    if (!GlueMock.__state[params.DatabaseName]._tables[params.TableInput.Name])
      throw new EntityNotFoundException({
        message: 'table not found',
      });
    GlueMock.__state[params.DatabaseName]._tables[params.Name] =
      params.TableInput;
  }

  async deleteTable(params) {
    if (!GlueMock.__state[params.DatabaseName])
      throw new EntityNotFoundException({
        message: 'Database not found',
      });

    if (!GlueMock.__state[params.DatabaseName]._tables[params.Name])
      throw new EntityNotFoundException({
        message: 'table not found',
      });
    delete GlueMock.__state[params.DatabaseName]._tables[params.Name];
  }

  async deleteDatabase(params) {
    if (!GlueMock.__state[params.Name])
      throw new EntityNotFoundException({
        message: 'Database not found',
      });

    delete GlueMock.__state[params.Name];
  }

  async tagResource(params) {
    // TODO
  }

  async getTags(params) {
    // TODO
    return { Tags: {} };
  }
}

GlueMock.__state = {};

module.exports = GlueMock;
