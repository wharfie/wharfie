const AthenaWorkGroup = require('./aws/athena-workgroup');
const GlueTable = require('./aws/glue-table');
const EventsRule = require('./aws/events-rule');
const TableRecord = require('./aws/table-record');
const BaseResourceGroup = require('./base-resource-group');
const { generateSchedule } = require('../../cron');
const Athena = require('../../athena');
const S3 = require('../../s3');
const SQS = require('../../sqs');
const { Resource } = require('../../graph/');
const { version } = require('../../../../package.json');
const WharfieScheduleOperation = require('../../../scheduler/events/wharfie-schedule-operation');
const Operation = require('../../../lib/graph/operation');
const Reconcilable = require('./reconcilable');

const _athena = new Athena({});
const s3 = new S3({});
const sqs = new SQS({});

/**
 * @typedef WharfieResourceProperties
 * @property {string} resourceName -
 * @property {string} [resourceId] -
 * @property {string} projectName -
 * @property {string} databaseName -
 * @property {string | function(): string} catalogId -
 * @property {string} [schedule] -
 * @property {string} description -
 * @property {string} tableType -
 * @property {any} parameters -
 * @property {import('../typedefs').WharfieTableColumn[]} partitionKeys -
 * @property {import('../typedefs').WharfieTableColumn[]} columns -
 * @property {string} [inputFormat] -
 * @property {string} [outputFormat] -
 * @property {string} [inputLocation] -
 * @property {string} outputLocation -
 * @property {number} [numberOfBuckets] -
 * @property {boolean} [storedAsSubDirectories] -
 * @property {any} [serdeInfo] -
 * @property {boolean} [compressed] -
 * @property {string} [viewOriginalText] -
 * @property {string} [viewExpandedText] -
 * @property {any[]} [tags] -
 * @property {string} projectBucket -
 * @property {string | function(): string} region -
 * @property {number} [interval] -
 * @property {number} [createdAt] -
 * @property {string | function(): string} scheduleQueueArn -
 * @property {string | function(): string} scheduleQueueUrl -
 * @property {string | function(): string} daemonQueueUrl -
 * @property {string} [scheduleRoleArn] -
 * @property {string | function(): string} roleArn -
 * @property {string} operationTable -
 * @property {string} dependencyTable -
 * @property {string} locationTable -
 * @property {boolean} [migrationResource] -
 * @property {import('../../../../cli/project/typedefs').Model | import('../../../../cli/project/typedefs').Source} [userInput] -
 */

/**
 * @typedef WharfieResourceOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('./reconcilable').Status} [status] -
 * @property {WharfieResourceProperties & import('../typedefs').SharedProperties} properties -
 * @property {import('./reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./base-resource') | BaseResourceGroup>} [resources] -
 */

class WharfieResource extends BaseResourceGroup {
  /**
   * @param {WharfieResourceOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn, resources }) {
    const propertiesWithDefaults = Object.assign(
      {
        resourceId: `${properties.projectName}.${properties.resourceName}`,
      },
      WharfieResource.DefaultProperties,
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
      resources,
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('./base-resource') | BaseResourceGroup)[]} -
   */
  _defineGroupResources(parent) {
    const resources = [];
    const workgroup = new AthenaWorkGroup({
      name: `${this.get('deployment').name}-${this.get(
        'resourceName'
      )}-workgroup`,
      parent,
      dependsOn: [],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} resource ${this.get(
          'resourceName'
        )} workgroup`,
        outputLocation: `${this.get('outputLocation')}query_metadata/`,
      },
    });
    const inputTable = new GlueTable({
      name: `${this.get('resourceName')}_raw`,
      parent,
      dependsOn: [],
      properties: {
        deployment: () => this.get('deployment'),
        databaseName: this.get('databaseName'),
        location: this.get('inputLocation'),
        description: this.get('description'),
        tableType: this.get('tableType'),
        parameters: this.get('parameters'),
        partitionKeys: this.get('partitionKeys'),
        columns: this.get('columns'),
        inputFormat: this.get('inputFormat'),
        outputFormat: this.get('outputFormat'),
        ...(this.has('numberOfBuckets')
          ? { numberOfBuckets: this.get('numberOfBuckets') }
          : {}),
        ...(this.has('storedAsSubDirectories')
          ? { storedAsSubDirectories: this.get('storedAsSubDirectories') }
          : {}),
        ...(this.has('compressed')
          ? { compressed: this.get('compressed') }
          : {}),
        serdeInfo: this.get('serdeInfo'),
        ...(this.has('viewOriginalText')
          ? { viewOriginalText: this.get('viewOriginalText') }
          : {}),
        ...(this.has('viewExpandedText')
          ? { viewExpandedText: this.get('viewExpandedText') }
          : {}),
        tags: this.get('tags', []),
        region: () => this.get('region'),
        catalogId: () => this.get('catalogId'),
      },
    });
    const outputTable = new GlueTable({
      name: this.get('resourceName'),
      parent,
      dependsOn: [],
      properties: {
        deployment: () => this.get('deployment'),
        databaseName: this.get('databaseName'),
        location: this.get('migrationResource')
          ? `${this.get('outputLocation')}migrate-references/`
          : `${this.get('outputLocation')}references/`,
        description: this.get('description'),
        tableType: 'EXTERNAL_TABLE',
        parameters: { 'parquet.compress': 'GZIP', EXTERNAL: 'TRUE' },
        partitionKeys: this.get('partitionKeys'),
        columns: this.get('columns'),
        inputFormat:
          'org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat',
        outputFormat:
          'org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat',
        compressed: true,
        serdeInfo: {
          SerializationLibrary:
            'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
          Parameters: { 'parquet.compress': 'GZIP' },
        },
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        tags: this.get('tags', []),
        region: () => this.get('region'),
        catalogId: () => this.get('catalogId'),
      },
    });
    if (
      this.get('scheduleQueueArn') &&
      this.get('scheduleRoleArn') &&
      this.get('schedule')
    ) {
      const rule = new EventsRule({
        name: `${this.get('projectName')}-${this.get('resourceName')}-rule`,
        parent,
        dependsOn: [],
        properties: {
          deployment: () => this.get('deployment'),
          description: `${this.get('projectName')} resource ${this.get(
            'resourceName'
          )} rule`,
          state: this.has('schedule')
            ? EventsRule.ENABLED
            : EventsRule.DISABLED,
          scheduleExpression: generateSchedule(
            Number(this.get('schedule', 1800))
          ),
          roleArn: () => this.get('scheduleRoleArn'),
          targets: () => [
            {
              Id: `${this.get('projectName')}-${this.get(
                'resourceName'
              )}-rule-target`,
              Arn: this.get('scheduleQueueArn'),
              InputTransformer: {
                InputTemplate: new WharfieScheduleOperation({
                  resource_id: this.get('resourceId'),
                  operation_type: Operation.Type.BACKFILL,
                }).serialize(),
              },
            },
          ],
        },
      });
      resources.push(rule);
    }
    const records = [];

    records.push(
      new TableRecord({
        name: `${this.get('projectName')}-${this.get(
          'resourceName'
        )}-resource-record`,
        parent,
        dependsOn: [],
        dataResolver: async () => {
          const resource = await this.getResourceDef();
          return {
            data: resource.toRecord().data,
          };
        },
        properties: {
          deployment: () => this.get('deployment'),
          tableName: this.get('operationTable'),
          keyValue: this.get('resourceId'),
          keyName: 'resource_id',
          sortKeyValue: this.get('resourceId'),
          sortKeyName: 'sort_key',
        },
      })
    );
    const isView = this.get('tableType') === 'VIRTUAL_VIEW';
    if (isView) {
      const viewOriginalText = this.get('viewOriginalText');
      const view_sql = JSON.parse(
        Buffer.from(
          viewOriginalText.substring(16, viewOriginalText.length - 3),
          'base64'
        ).toString()
      ).originalSql;
      const { sources } = _athena.extractSources(view_sql);
      let dependencyCount = 0;
      while (sources.length > 0) {
        dependencyCount++;
        const source = sources.pop();
        if (!source || !source.DatabaseName || !source.TableName) continue;
        records.push(
          new TableRecord({
            name: `${this.get('projectName')}-${this.get(
              'resourceName'
            )}-dependency-record-${dependencyCount}`,
            parent,
            dependsOn: [],
            properties: {
              deployment: () => this.get('deployment'),
              tableName: this.get('dependencyTable'),
              keyValue: `${source.DatabaseName}.${source.TableName}`,
              keyName: 'dependency',
              sortKeyValue: this.get('resourceId'),
              sortKeyName: 'resource_id',
              data: {
                interval: Number(this.get('interval')),
              },
            },
          })
        );
      }
    }

    if (this.has('inputLocation')) {
      records.push(
        new TableRecord({
          name: `${this.get('projectName')}-${this.get(
            'resourceName'
          )}-location-record`,
          dependsOn: [],
          parent,
          properties: {
            deployment: () => this.get('deployment'),
            tableName: this.get('locationTable'),
            keyValue: this.get('inputLocation'),
            keyName: 'location',
            sortKeyValue: this.get('resourceId'),
            sortKeyName: 'resource_id',
            data: {
              interval: Number(this.get('interval')),
            },
          },
        })
      );
    }

    return [workgroup, inputTable, outputTable, ...records, ...resources];
  }

  /**
   * @returns {Promise<Resource>} -
   */
  async getResourceDef() {
    let source_region;
    if (this.get('inputLocation')) {
      const { bucket } = s3.parseS3Uri(this.get('inputLocation'));
      source_region = await s3.findBucketRegion({
        Bucket: bucket,
      });
    }
    const inputTable = this.getResource(`${this.get('resourceName')}_raw`);
    const outputTable = this.getResource(this.get('resourceName'));
    const workgroup = this.getResource(
      `${this.get('deployment').name}-${this.get('resourceName')}-workgroup`
    );
    const resource = new Resource({
      id: this.get('resourceId'),
      created_at: this.get('createdAt'),
      region: this.get('region'),
      source_region,
      wharfie_version: version,
      athena_workgroup: workgroup.name,
      daemon_config: {
        Role: this.get('roleArn'),
      },
      // @ts-ignore
      source_properties: {
        name: inputTable.name,
        ...inputTable.resolveProperties(),
      },
      // @ts-ignore
      destination_properties: {
        name: outputTable.name,
        ...outputTable.resolveProperties(),
      },
    });
    return resource;
  }

  // /**
  //  * @param {Resource} resourceDef -
  //  * @returns {WharfieResource} -
  //  */
  // static fromResourceDef(resourceDef) {
  //   return new WharfieResource({
  //     name: resourceDef.id,
  //     properties: {
  //         ...(resourceDef.source_properties.description ? { description: resourceDef.source_properties.description } : {}),
  //         columns: resourceDef.source_properties.columns,
  //         ...(resourceDef.source_properties.partitionKeys ? { partitionKeys: resourceDef.source_properties.partitionKeys } : {}),
  //         ...(resourceDef.source_properties.location ? { inputLocation: resourceDef.source_properties.location } : {}),
  //         tableType: resourceDef.source_properties.tableType,
  //         parameters: resourceDef.source_properties.parameters,
  //         inputFormat: resourceDef.source_properties.inputFormat,
  //         outputFormat: resourceDef.source_properties.outputFormat,
  //         serdeInfo: resourceDef.source_properties.serdeInfo,
  //         resourceName: '<NEEDED>',
  //         projectName: '<NEEDED>',
  //         databaseName: resourceDef.destination_properties.databaseName,
  //         ...(resourceDef.destination_properties.location ? { outputLocation: resourceDef.destination_properties.location } : {}),
  //         projectBucket: '<NEEDED>',
  //         region: resourceDef.region,
  //         catalogId: resourceDef.source_properties.catalogId,
  //         roleArn: resourceDef.daemon_config.Role,
  //         interval: resourceDef.daemon_config.SLA?.MaxDelay,
  //         resourceId: resourceDef.id,
  //         createdAt: resourceDef.created_at,
  //         deployment: '<NEEDED>',
  //         workgroup: resourceDef.athena_workgroup,
  //         wharfieVersion: resourceDef.wharfie_version,
  //         sourceRegion: resourceDef.source_region,
  //         operationTable: resourceDef.destination_properties.name,
  //         dependencyTable: `${resourceDef.destination_properties.databaseName}-dependencies`,
  //         locationTable: `${resourceDef.destination_properties.databaseName}-locations`,

  //         // general properties
  //         deployment: () => this.get('deployment'),
  //         resourceName: 'logs',
  //         projectName: this.get('deployment').name,
  //         databaseName: this.get('deployment').name,
  //         outputLocation: `s3://${systemBucket.name}/logs/processed/`,
  //         projectBucket: systemBucket.name,
  //         region: () => this.get('deployment').region,
  //         catalogId: () => this.get('deployment').accountId,
  //         roleArn: () => loggingResourceRole.get('arn'),
  //         operationTable: `${this.get('deployment').name}-operations`,
  //         dependencyTable: `${this.get('deployment').name}-dependencies`,
  //         locationTable: `${this.get('deployment').name}-locations`,
  //         scheduleQueueArn: () =>
  //           `arn:aws:sqs:${this.get('deployment').region}:${
  //             this.get('deployment').accountId
  //           }:${this.get('deployment').name}-events-queue`,
  //         scheduleQueueUrl: () =>
  //           `https://sqs.${this.get('deployment').region}.amazonaws.com/${
  //             this.get('deployment').accountId
  //           }/${this.get('deployment').name}-events-queue`,
  //         daemonQueueUrl: () =>
  //           `https://sqs.${this.get('deployment').region}.amazonaws.com/${
  //             this.get('deployment').accountId
  //           }/${this.get('deployment').name}-daemon-queue`,
  //         tags: [],
  //         createdAt: this.get('createdAt'),
  //     }
  // })
  // }

  async needsMigration() {
    const oldProperties = (await this.fetchStoredData())?.properties;
    if (!oldProperties) return true;
    const newProperties = this.serialize().properties;

    // Check if `resourceId` has changed
    if (oldProperties.resourceId !== newProperties.resourceId) return true;
    // Check if `catalogId` has changed
    if (oldProperties.catalogId !== newProperties.catalogId) return true;
    if (
      JSON.stringify(oldProperties.serdeInfo) !==
      JSON.stringify(newProperties.serdeInfo)
    )
      return true;

    // Check if `outputFormat` has changed
    if (oldProperties.outputFormat !== newProperties.outputFormat) return true;
    if (oldProperties.inputFormat !== newProperties.inputFormat) return true;
    if (oldProperties.numberOfBuckets !== newProperties.numberOfBuckets)
      return true;
    if (
      oldProperties.storedAsSubDirectories !==
      newProperties.storedAsSubDirectories
    )
      return true;
    if (oldProperties.compressed !== newProperties.compressed) return true;

    // Check if `inputLocation` has changed
    if (oldProperties.inputLocation !== newProperties.inputLocation)
      return true;
    // Check if `outputLocation` has changed
    if (oldProperties.outputLocation !== newProperties.outputLocation)
      return true;

    // Check if columns have changed in name, type, or order
    const oldColumns = oldProperties.columns || [];
    const newColumns = newProperties.columns || [];

    if (oldColumns.length !== newColumns.length) return true; // Check if column counts differ

    for (let i = 0; i < oldColumns.length; i++) {
      if (
        oldColumns[i].name !== newColumns[i].name || // Check if column names differ
        oldColumns[i].type !== newColumns[i].type // Check if column types differ
      ) {
        return true;
      }
    }

    const oldPartitionKeys = oldProperties.partitionKeys || [];
    const newPartitionKeys = newProperties.partitionKeys || [];

    if (oldPartitionKeys.length !== newPartitionKeys.length) return true; // Check if column counts differ

    for (let i = 0; i < oldPartitionKeys.length; i++) {
      if (
        oldPartitionKeys[i].name !== newPartitionKeys[i].name || // Check if column names differ
        oldPartitionKeys[i].type !== newPartitionKeys[i].type // Check if column types differ
      ) {
        return true;
      }
    }

    // If none of the targeted properties have changed, no migration is needed
    return false;
  }

  async _reconcile() {
    let change;
    if (
      this.getResources().find(
        (resource) => resource.status !== Reconcilable.Status.STABLE
      )
    ) {
      change = 'CREATED';
    } else if (await this.needsMigration()) {
      change = 'UPDATED';
    } else {
      change = 'NO_CHANGE';
    }
    await Promise.all(
      this.getResources().map((resource) => resource.reconcile())
    );
    this.change = change;
    if (change === 'CREATED') {
      await sqs.sendMessage({
        MessageBody: new WharfieScheduleOperation({
          resource_id: this.get('resourceId'),
          operation_type: Operation.Type.BACKFILL,
        }).serialize(),
        QueueUrl: this.get('scheduleQueueUrl'),
      });
    } else if (change === 'UPDATED') {
      const resource = await this.getResourceDef();
      await sqs.sendMessage({
        MessageBody: JSON.stringify({
          source: 'cli',
          operation_started_at: new Date(Date.now()),
          operation_type: 'MIGRATE',
          action_type: 'START',
          resource_id: this.get('resourceId'),
          operation_inputs: {
            migration_resource: resource.toRecord(),
          },
          action_inputs: {
            Version: `cli`,
            Duration: Infinity,
          },
        }),
        QueueUrl: this.get('daemonQueueUrl'),
      });
    }
  }
}

WharfieResource.DefaultProperties = {
  numberOfBuckets: 0,
  storedAsSubDirectories: false,
  compressed: false,
  interval: 300,
  migrationResource: false,
};

module.exports = WharfieResource;
