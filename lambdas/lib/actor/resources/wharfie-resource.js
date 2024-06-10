const AthenaWorkGroup = require('./aws/athena-workgroup');
const GlueTable = require('./aws/glue-table');
const EventsRule = require('./aws/events-rule');
const TableRecord = require('./aws/table-record');
const BaseResourceGroup = require('./base-resource-group');
const { generateSchedule } = require('../../../resources/wharfie/lib/cron');
const Athena = require('../../athena/');
const { version } = require('../../../../package.json');

const _athena = new Athena({});

/**
 * @typedef WharfieResourceProperties
 * @property {string} resourceName -
 * @property {string} projectName -
 * @property {string} databaseName -
 * @property {string} catalogId -
 * @property {string} [schedule] -
 * @property {string} description -
 * @property {string} tableType -
 * @property {any} parameters -
 * @property {import('../typedefs').WharfieTableColumn[]} partitionKeys -
 * @property {import('../typedefs').WharfieTableColumn[]} columns -
 * @property {string} inputFormat -
 * @property {string} outputFormat -
 * @property {string} [inputLocation] -
 * @property {string} outputLocation -
 * @property {number} [numberOfBuckets] -
 * @property {boolean} [storedAsSubDirectories] -
 * @property {any} serdeInfo -
 * @property {boolean} [compressed] -
 * @property {string} [viewOriginalText] -
 * @property {string} [viewExpandedText] -
 * @property {any} tags -
 * @property {string} deploymentBucket -
 * @property {string} region -
 * @property {number} [interval] -
 * @property {string} scheduleQueueArn -
 * @property {string} scheduleRoleArn -
 * @property {string | function(): string} roleArn -
 * @property {string} resourceTable -
 * @property {string} dependencyTable -
 * @property {string} locationTable -
 */

/**
 * @typedef WharfieResourceOptions
 * @property {string} name -
 * @property {import('./reconcilable').Status} [status] -
 * @property {WharfieResourceProperties & import('../typedefs').SharedDeploymentProperties} properties -
 * @property {import('./reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./base-resource') | BaseResourceGroup>} [resources] -
 */

class WharfieResource extends BaseResourceGroup {
  /**
   * @param {WharfieResourceOptions} options -
   */
  constructor({ name, status, properties, dependsOn, resources }) {
    const propertiesWithDefaults = Object.assign(
      {
        numberOfBuckets: 0,
        storedAsSubDirectories: false,
        compressed: false,
        interval: 300,
      },
      properties
    );
    super({
      name,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
      resources,
    });
  }

  /**
   * @returns {(import('./base-resource') | BaseResourceGroup)[]} -
   */
  _defineGroupResources() {
    const workgroup = new AthenaWorkGroup({
      name: `${this.get('deployment').name}-${this.get(
        'resourceName'
      )}-workgroup`,
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} resource ${this.get(
          'resourceName'
        )} workgroup`,
        outputLocation: `s3://${this.get('deploymentBucket')}/${this.get(
          'resourceName'
        )}/query_metadata/`,
      },
    });
    const inputTable = new GlueTable({
      name: `${this.get('resourceName')}_raw`,
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
        region: this.get('region'),
        catalogId: this.get('catalogId'),
      },
    });
    const outputTable = new GlueTable({
      name: this.get('resourceName'),
      properties: {
        deployment: () => this.get('deployment'),
        databaseName: this.get('databaseName'),
        location: this.get('outputLocation'),
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
        region: this.get('region'),
        catalogId: this.get('catalogId'),
      },
    });
    const rule = new EventsRule({
      name: `${this.get('projectName')}-${this.get('resourceName')}-rule`,
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('projectName')} resource ${this.get(
          'resourceName'
        )} rule`,
        state: this.has('schedule') ? EventsRule.ENABLED : EventsRule.DISABLED,
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
              InputPathsMap: {
                time: '$.time',
              },
              // TODO use a real id
              InputTemplate: `{"operation_started_at":<time>, "operation_type":"MAINTAIN", "action_type":"START", "resource_id":"${this.get(
                'resourceName'
              )}"}`,
            },
          },
        ],
      },
    });
    const records = [];

    records.push(
      new TableRecord({
        name: `${this.get('projectName')}-${this.get(
          'resourceName'
        )}-resource-record`,
        properties: {
          deployment: () => this.get('deployment'),
          tableName: this.get('resourceTable'),
          keyValue: this.get('resourceName'),
          keyName: 'resource_id',
          sortKeyValue: this.get('resourceName'),
          sortKeyName: 'sort_key',
          data: {
            data: {
              region: this.get('region'),
              wharfie_version: version,
              status: 'CREATING',
              athena_workgroup: workgroup.name,
              daemon_config: {
                Role: () => this.get('roleArn'),
              },
              source_properties: {
                name: inputTable.name,
                ...inputTable.resolveProperties(),
              },
              destination_properties: {
                name: outputTable.name,
                ...outputTable.resolveProperties(),
              },
            },
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
          new TableRecord({
            name: `${this.get('projectName')}-${this.get(
              'resourceName'
            )}-dependency-record-${dependencyCount}`,
            properties: {
              deployment: () => this.get('deployment'),
              tableName: this.get('dependencyTable'),
              keyValue: `${source.DatabaseName}.${source.TableName}`,
              keyName: 'dependency',
              sortKeyValue: this.get('resourceName'),
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
          properties: {
            deployment: () => this.get('deployment'),
            tableName: this.get('locationTable'),
            keyValue: this.get('inputLocation'),
            keyName: 'location',
            sortKeyValue: this.get('resourceName'),
            sortKeyName: 'resource_id',
            data: {
              interval: Number(this.get('interval')),
            },
          },
        })
      );
    }

    return [workgroup, inputTable, outputTable, rule, ...records];
  }
}

module.exports = WharfieResource;
