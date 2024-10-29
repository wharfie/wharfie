const AthenaWorkGroup = require('./aws/athena-workgroup');
const GlueTable = require('./aws/glue-table');
const EventsRule = require('./aws/events-rule');
const LocationRecord = require('./records/location-record');
const DependencyRecord = require('./records/dependency-record');
const WharfieResourceRecord = require('./records/wharfie-resource-record');
const BaseResourceGroup = require('./base-resource-group');
const BaseResource = require('./base-resource');
const { generateSchedule } = require('../../cron');
const Athena = require('../../athena');
const S3 = require('../../s3');
const SQS = require('../../sqs');
const { Resource } = require('../../graph/');
const { version } = require('../../../../package.json');
const WharfieScheduleOperation = require('../../../scheduler/events/wharfie-schedule-operation');
const Operation = require('../../../lib/graph/operation');
const Action = require('../../../lib/graph/action');
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
      // important to prefix with wharfie, else monitor lambda will ignore notifications
      name: `wharfie-${this.get('deployment').name}-${this.get(
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
      new WharfieResourceRecord({
        name: `${this.get('projectName')}-${this.get(
          'resourceName'
        )}-resource-record`,
        parent,
        dependsOn: [inputTable, outputTable, workgroup],
        properties: {
          table_name: this.get('operationTable'),
          deployment: () => this.get('deployment'),
          data: () => {
            const resource = new Resource({
              id: this.get('resourceId'),
              created_at: this.get('createdAt'),
              region: this.get('region'),
              wharfie_version: version,
              athena_workgroup: workgroup.name,
              daemon_config: {
                Role: this.get('roleArn'),
              },
              // @ts-ignore
              resource_properties: this.resolveProperties(),
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
            return resource.toRecord();
          },
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
          new DependencyRecord({
            name: `${this.get('projectName')}-${this.get(
              'resourceName'
            )}-dependency-record-${dependencyCount}`,
            parent,
            dependsOn: [],
            properties: {
              deployment: () => this.get('deployment'),
              table_name: this.get('dependencyTable'),
              data: {
                resource_id: this.get('resourceId'),
                dependency: `${source.DatabaseName}.${source.TableName}`,
                interval: this.get('interval'),
              },
            },
          })
        );
      }
    }

    if (this.has('inputLocation')) {
      records.push(
        new LocationRecord({
          name: `${this.get('projectName')}-${this.get(
            'resourceName'
          )}-location-record`,
          dependsOn: [],
          parent,
          properties: {
            table_name: this.get('locationTable'),
            deployment: () => this.get('deployment'),
            data: {
              resource_id: this.get('resourceId'),
              location: this.get('inputLocation'),
              interval: this.get('interval'),
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
      `wharfie-${this.get('deployment').name}-${this.get(
        'resourceName'
      )}-workgroup`
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
      resource_properties: this.resolveProperties(),
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

  /**
   * @param {Object<string,any>?} oldProperties -
   * @returns {Promise<boolean>} -
   */
  async needsMigration(oldProperties) {
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

  async _wait_for_status() {
    let current_status = await this.getStatus();
    while (current_status !== Reconcilable.Status.STABLE) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      current_status = await this.getStatus();
    }
  }

  async _reconcile() {
    let change;
    const storedResource = await this.fetchStoredData();
    const oldProperties = storedResource?.properties;
    if (!oldProperties) {
      change = 'CREATED';
    } else if (this.status === Reconcilable.Status.MIGRATING) {
      change = 'MIGRATING';
    } else if (await this.needsMigration(storedResource)) {
      change = 'START_MIGRATION';
    } else if (await this.needsUpdate(storedResource)) {
      change = 'UPDATED';
    } else {
      change = 'NO_CHANGE';
    }
    if (change !== 'UPDATED') {
      await Promise.all(
        this.getResources().map((resource) => resource.reconcile())
      );
    }
    if (this.get('migrationResource')) {
      change = 'INTERNAL_MIGRATION_RESOURCE';
    }
    this.change = change;
    if (change === 'CREATED' || change === 'UPDATED') {
      await sqs.sendMessage({
        MessageBody: new WharfieScheduleOperation({
          resource_id: this.get('resourceId'),
          operation_type: Operation.Type.BACKFILL,
        }).serialize(),
        QueueUrl: this.get('scheduleQueueUrl'),
      });
    } else if (change === 'START_MIGRATION') {
      this.status = Reconcilable.Status.MIGRATING;
      await this.save();
      await sqs.sendMessage({
        MessageBody: JSON.stringify({
          source: 'cli',
          operation_started_at: new Date(Date.now()),
          operation_type: Operation.Type.MIGRATE,
          action_type: Action.Type.START,
          resource_id: this.get('resourceId'),
          action_inputs: {
            Version: `cli`,
            Duration: Infinity,
          },
          operation_inputs: {
            migration_resource_properties: this.resolveProperties(),
          },
        }),
        QueueUrl: this.get('daemonQueueUrl'),
      });
      await this._wait_for_status();
    }
  }

  /**
   * @param {BaseResource | BaseResourceGroup} resource -
   */
  updateResource(resource) {
    if (!this.resources[resource.name]) {
      this.resources[resource.name] = resource;
      return;
    }
    this.resources[resource.name].setProperties(resource.properties);
  }

  /**
   * @param {(BaseResource | BaseResourceGroup)[]} resources -
   */
  updateResources(resources) {
    resources.forEach((resource) => {
      this.updateResource(resource);
    });
  }

  /**
   * @param {any} properties -
   */
  async setProperties(properties) {
    super.setProperties(properties);
    this.updateResources(this._defineGroupResources(this._getParentName()));
  }

  /**
   * @param {string} key -
   * @param {any} value -
   */
  set(key, value) {
    super.set(key, value);
    this.updateResources(this._defineGroupResources(this._getParentName()));
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
