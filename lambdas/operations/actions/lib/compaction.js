'use strict';

const cron = require('../../../resources/wharfie/lib/cron');

class Compaction {
  /**
   * @typedef CompactionOptions
   * @property {import('../../../lib/glue')} glue -
   * @property {import('../../../lib/athena')} athena -
   * @param {CompactionOptions} options - options for Compaction instance
   */
  constructor({ glue, athena }) {
    this.glue = glue;
    this.athena = athena;
    this.TEMPORARY_GLUE_DATABASE = process.env.TEMPORARY_GLUE_DATABASE || '';
  }

  /**
   *
   * @typedef getCompactionQueryParams
   * @property {string?} PrimaryKey -
   * @property {import('../../../typedefs').Partition[]} partitions - partitions to be compacted
   * @property {string} sourceDatabaseName - raw data to be compacted
   * @property {string} sourceTableName - raw data to be compacted
   * @property {string} destinationDatabaseName - output location for compacted data
   * @property {string} destinationTableName - output location for compacted data
   * @param {getCompactionQueryParams} params -
   * @returns {string} - compaction statement for the given event + partition
   */
  getCompactionQuery({
    PrimaryKey,
    partitions,
    sourceDatabaseName,
    sourceTableName,
    destinationDatabaseName,
    destinationTableName,
  }) {
    const keyStatements = partitions
      .map((partition) => {
        const statements = Object.entries(partition.partitionValues)
          .reverse()
          .map(([partitionKey, partitionValue]) => {
            if (typeof partitionValue === 'number') {
              return `${partitionKey}=${partitionValue}`;
            }
            return `${partitionKey}='${partitionValue}'`;
          })
          .join(' and ');
        return statements ? `(${statements})` : '';
      })
      .join(' or ');
    let compactionStatement = keyStatements ? `(${keyStatements})` : '';
    if (PrimaryKey) {
      const deduplicationStatement = `
     ${PrimaryKey} NOT IN (SELECT coalesce(${PrimaryKey},'') FROM "${destinationDatabaseName}"."${destinationTableName}" WHERE ${compactionStatement})
    `;
      compactionStatement += compactionStatement
        ? ` and ${deduplicationStatement}`
        : deduplicationStatement;
    }
    return `
  INSERT INTO "${destinationDatabaseName}"."${destinationTableName}"
  SELECT *
  FROM "${sourceDatabaseName}"."${sourceTableName}"
  ${compactionStatement ? `WHERE ${compactionStatement}` : ''}`;
  }

  /**
   * @param {Array<any>} xs -
   * @param {Function} fn -
   * @returns {Object<string, any[]>} -
   */
  _groupBy(xs, fn) {
    return xs.reduce((rv, x) => {
      (rv[fn(x)] = rv[fn(x)] || []).push(x);
      return rv;
    }, {});
  }

  /**
   * @typedef getCompactionQueriesParams
   * @property {import('../../../typedefs').ResourceRecord} resource -
   * @property {Array<import('../../../typedefs').Partition>} partitions - partitions to be compacted
   * @property {string} sourceDatabaseName - raw data to be compacted
   * @property {string} sourceTableName - raw data to be compacted
   * @property {string} temporaryDatabaseName - output location for compacted data
   * @property {string} temporaryTableName - output location for compacted data
   * @param {getCompactionQueriesParams} params -
   * @returns {Promise<import('../../../typedefs').QueryEnqueueInput[]>} -
   */
  async getCompactionQueries({
    resource,
    partitions,
    sourceDatabaseName,
    sourceTableName,
    temporaryDatabaseName,
    temporaryTableName,
  }) {
    /** @type {string?} */
    const PrimaryKey = null;
    const isView =
      resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW';
    if (isView && partitions.length > 0) {
      const viewOriginalText =
        resource.source_properties.TableInput.ViewOriginalText;
      const view_sql = JSON.parse(
        Buffer.from(
          viewOriginalText.substring(16, viewOriginalText.length - 3),
          'base64'
        ).toString()
      ).originalSql;

      const { sources: queryTableReferences, selectAsColumns } =
        this.athena.extractSources(view_sql);

      const referencePartitions = new Set();
      while (queryTableReferences.length > 0) {
        const ref = queryTableReferences.pop();
        if (!ref || !ref.DatabaseName || !ref.TableName) continue;
        const { Table } = await this.glue.getTable({
          Name: ref.TableName,
          DatabaseName: ref.DatabaseName,
        });
        if (Table && Table.PartitionKeys)
          Table.PartitionKeys.forEach((column) => {
            selectAsColumns.forEach((s) => {
              if (s.columns.has(column.Name || ''))
                referencePartitions.add(s.identifier);
            });
            referencePartitions.add(column.Name);
          });
      }

      const partitionGroups = this._groupBy(
        partitions,
        (/** @type {import('../../../typedefs').Partition} */ partition) => {
          return [...referencePartitions]
            .map(
              (key) =>
                partition.partitionValues[key] &&
                `${key}=${partition.partitionValues[key]}`
            )
            .filter((x) => !!x)
            .join('_');
        }
      );

      /** @type {import('../../../typedefs').QueryEnqueueInput[]} */
      const queries = [];
      Object.values(partitionGroups).forEach((partitionGroup) => {
        while (partitionGroup.length > 0) {
          const partitionsChunk = partitionGroup.splice(0, 100);
          queries.push({
            query_string: this.getCompactionQuery({
              PrimaryKey,
              partitions: partitionsChunk,
              sourceDatabaseName,
              sourceTableName,
              destinationDatabaseName: temporaryDatabaseName,
              destinationTableName: temporaryTableName,
            }),
            query_data: {
              partitions: partitionsChunk,
            },
          });
        }
      });
      return queries;
    }

    return [
      ...partitions.map((partition) => {
        const query_string = this.getCompactionQuery({
          PrimaryKey,
          partitions: [partition],
          sourceDatabaseName,
          sourceTableName,
          destinationDatabaseName: temporaryDatabaseName,
          destinationTableName: temporaryTableName,
        });
        return {
          query_string,
          query_data: {
            partitions: [partition],
          },
        };
      }),
      ...(partitions.length === 0
        ? [
            {
              query_string: this.getCompactionQuery({
                PrimaryKey,
                partitions: [
                  {
                    location: '',
                    partitionValues: {},
                  },
                ],
                sourceDatabaseName,
                sourceTableName,
                destinationDatabaseName: temporaryDatabaseName,
                destinationTableName: temporaryTableName,
              }),
              query_data: {},
            },
          ]
        : []),
    ];
  }

  /**
   *
   * @typedef getCalculateViewPartitionQueriesParams
   * @property {import('../../../typedefs').ResourceRecord} resource -
   * @property {import('../../../typedefs').DaemonConfigSLA} SLA -
   * @property {number} operationTime -
   * @property {string} sourceDatabaseName -
   * @property {string} sourceTableName -
   * @property {string} athenaWorkgroup -
   * @param {getCalculateViewPartitionQueriesParams} params -
   * @returns {Promise<string>} -
   */
  async getCalculatePartitionQueries({
    resource,
    SLA,
    operationTime,
    sourceDatabaseName,
    sourceTableName,
    athenaWorkgroup,
  }) {
    const { Table } = await this.glue.getTable({
      DatabaseName: sourceDatabaseName,
      Name: sourceTableName,
    });
    if (!Table) throw new Error(`No Table returned from glue`);
    if (!Table.PartitionKeys || Table.PartitionKeys.length === 0) return '';

    let partitionsOnly = true;
    const isView =
      resource.source_properties.TableInput.TableType === 'VIRTUAL_VIEW';

    if (isView) {
      const viewOriginalText =
        resource.source_properties.TableInput.ViewOriginalText;
      const view_sql = JSON.parse(
        Buffer.from(
          viewOriginalText.substring(16, viewOriginalText.length - 3),
          'base64'
        ).toString()
      ).originalSql;

      const queryTableReferences = this.athena.extractSources(view_sql);

      const referencePartitionKeys = new Set();
      while (queryTableReferences.sources.length > 0) {
        const ref = queryTableReferences.sources.pop();
        if (!ref || !ref.DatabaseName || !ref.TableName) continue;
        const { Table } = await this.glue.getTable({
          Name: ref.TableName,
          DatabaseName: ref.DatabaseName,
        });
        if (Table && Table.PartitionKeys) {
          Table.PartitionKeys.forEach((column) => {
            referencePartitionKeys.add(column.Name);
          });
        }
      }

      partitionsOnly = !queryTableReferences.columns.some(
        (column) => !referencePartitionKeys.has(column)
      );
    }

    if (SLA && SLA.ColumnExpression && SLA.MaxDelay) {
      this.athena
        .extractSources(
          `SELECT ${SLA.ColumnExpression} FROM ${sourceDatabaseName}.${sourceTableName}`
        )
        .columns.forEach((slaColumn) => {
          if (
            !Table.PartitionKeys?.map((key) => key.Name).includes(slaColumn)
          ) {
            partitionsOnly = false;
          }
        });
    }

    const partitionKeys = Table.PartitionKeys;
    let QueryString = `SELECT distinct ${partitionKeys
      .map(({ Name }) => Name)
      .join(' ,')} FROM ${sourceDatabaseName}.${sourceTableName}`;

    if (partitionsOnly) {
      const workGroupConfiguration = await this.athena.getWorkGroup({
        WorkGroup: athenaWorkgroup,
      });
      try {
        const engineVersion =
          // @ts-ignore
          workGroupConfiguration.WorkGroup.Configuration.EngineVersion
            .EffectiveEngineVersion;

        if (engineVersion === 'Athena engine version 1') {
          const partitionNames = partitionKeys.map(({ Name }) => Name);

          QueryString = `
            WITH
              base as (
                SELECT partition_number as pn, partition_key as key, partition_value as val
                FROM   information_schema.__internal_partitions__
                WHERE  table_schema = '${sourceDatabaseName}'
                   AND table_name   = '${sourceTableName}'
              )
            SELECT
              ${partitionNames.join(' ,')}
          `;

          const alphabet = [...Array(26).keys()].map((i) =>
            String.fromCharCode(i + 97)
          );
          partitionNames.forEach((partitionKey) => {
            const partitionKeyIndex = partitionNames.indexOf(partitionKey);
            const subqueryKey = alphabet[partitionKeyIndex];
            if (partitionKeyIndex === 0) {
              QueryString += `\n
                FROM (
                  SELECT val as ${partitionKey}, pn FROM base WHERE key = '${partitionKey}'
                ) ${subqueryKey}
              `;
            } else {
              QueryString += `\n
                JOIN (
                  SELECT val as ${partitionKey}, pn FROM base WHERE key = '${partitionKey}'
                ) ${subqueryKey} ON ${subqueryKey}.pn = ${alphabet[0]}.pn
              `;
            }
          });
        } else if (engineVersion === 'Athena engine version 2') {
          QueryString = `
            SELECT ${partitionKeys.map(({ Name }) => Name).join(' ,')}
            FROM ${sourceDatabaseName}."${sourceTableName}$partitions"
          `;
        } else {
          throw new Error(
            `partition query not implemented for ${JSON.stringify(
              workGroupConfiguration
            )}!`
          );
        }
      } catch (err) {
        console.warn(`{err} Using default query: ${QueryString}`);
      }
    }

    if (SLA && SLA.ColumnExpression && SLA.MaxDelay) {
      const ScheduleOffset = cron.getScheduleOffset(
        operationTime,
        Number(resource?.daemon_config?.Schedule || 0)
      );
      QueryString += `\n WHERE date_diff('minute', ${SLA.ColumnExpression}, from_unixtime(${operationTime})) <= ${SLA.MaxDelay} + ${ScheduleOffset}`;
      QueryString += `\n AND date_diff('minute', ${SLA.ColumnExpression}, from_unixtime(${operationTime})) >= 0`;
    }

    return QueryString;
  }
}

module.exports = Compaction;
