// Modify the ActorSystem to accept an optional parent argument.
const SQS = require('../sqs');
const STS = require('../sts');
const Lambda = require('../lambda');
const IAM = require('../iam');
const WharfieDeploymentResources = require('./resources/wharfie-deployment-resources');
const Table = require('./resources/aws/table');
const BucketNotificationConfiguration = require('./resources/aws/bucket-notification-configuration');
const ActorDeployment = require('./actor-deployment');
const { Daemon, Cleanup, Events, Monitor } = require('./wharfie-actors');
const { putWithThroughputRetry } = require('../dynamo/');

// const bluebirdPromise = require('bluebird');
// const fs = require('fs');
// const path = require('path');
const WharfieActor = require('./wharfie-actor');
const envPaths = require('../env-paths');

/**
 * @typedef WharfieDeploymentProperties
 * @property {number} [globalQueryConcurrency] -
 * @property {number} [resourceQueryConcurrency] -
 * @property {number} [maxQueriesPerAction] -
 * @property {string} [loggingLevel] -
 */

/**
 * @typedef WharfieDeploymentOptions
 * @property {string} name -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {WharfieDeploymentProperties} [properties] -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

class WharfieDeployment extends ActorDeployment {
  /**
   * @param {WharfieDeploymentOptions} options -
   */
  constructor({ name, status, properties, dependsOn, resources }) {
    const propertiesWithDefaults = Object.assign(
      {
        globalQueryConcurrency: 10,
        resourceQueryConcurrency: 10,
        maxQueriesPerAction: 10000,
        loggingLevel: 'debug',
        _INTERNAL_STATE_RESOURCE: true,
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
    this.accountProvider = new STS();
    this.sqs = new SQS({});
    this.lambda = new Lambda({});
    this.iam = new IAM({});
  }

  getDeploymentProperties() {
    return {
      envPaths: this.get('envPaths', envPaths(this.name)),
      version: this.get('version', require('../../../package.json').version),
      stateTable: `${this.name}-state`,
      region: this.get('region'),
      accountId: this.get('accountId'),
      name: this.name,
    };
  }

  /**
   * @returns {(import('./resources/base-resource') | import('./resources/base-resource-group'))[]} -
   */
  _defineGroupResources() {
    const systemTable = new Table({
      name: `${this.name}-state`,
      properties: {
        _INTERNAL_STATE_RESOURCE: true,
        deployment: this.getDeploymentProperties.bind(this),
        attributeDefinitions: [
          {
            AttributeName: 'name',
            AttributeType: 'S',
          },
          { AttributeName: 'sort_key', AttributeType: 'S' },
        ],
        keySchema: [
          {
            AttributeName: 'name',
            KeyType: 'HASH',
          },
          { AttributeName: 'sort_key', KeyType: 'RANGE' },
        ],
        billingMode: Table.BillingMode.PAY_PER_REQUEST,
      },
    });

    const resourceGroup = new WharfieDeploymentResources({
      dependsOn: [systemTable],
      name: `${this.name}-deployment-resources`,
      properties: {
        deployment: this.getDeploymentProperties.bind(this),
        loggingLevel: this.get('loggingLevel'),
      },
    });

    // @ts-ignore
    this.createActor('daemon', Daemon, {
      dependsOn: [resourceGroup],
      properties: {
        deployment: this.getDeploymentProperties.bind(this),
      },
    });
    // @ts-ignore
    this.createActor('cleanup', Cleanup, {
      dependsOn: [resourceGroup],
      properties: {
        deployment: this.getDeploymentProperties.bind(this),
      },
    });
    // @ts-ignore
    this.createActor('events', Events, {
      dependsOn: [resourceGroup],
      properties: {
        deployment: this.getDeploymentProperties.bind(this),
      },
    });
    // @ts-ignore
    this.createActor('monitor', Monitor, {
      dependsOn: [resourceGroup],
      properties: {
        deployment: this.getDeploymentProperties.bind(this),
      },
    });
    const logNotificationBucketNotificationConfiguration =
      new BucketNotificationConfiguration({
        name: `${this.name}-log-notification-bucket-notification-configuration`,
        dependsOn: [resourceGroup, ...this.getActors()],
        properties: {
          deployment: this.getDeploymentProperties.bind(this),
          bucketName: resourceGroup.getBucket().name,
          notificationConfiguration: () => ({
            QueueConfigurations: [
              {
                Events: ['s3:ObjectCreated:*'],
                QueueArn: `arn:aws:sqs:${this.get('region')}:${this.get(
                  'accountId'
                )}:${this.name}-events-queue`,
              },
              {
                Events: ['s3:ObjectRemoved:*'],
                QueueArn: `arn:aws:sqs:${this.get('region')}:${this.get(
                  'accountId'
                )}:${this.name}-events-queue`,
              },
            ],
          }),
        },
      });

    return [
      resourceGroup,
      systemTable,
      logNotificationBucketNotificationConfiguration,
    ];
  }

  async setRegion() {
    if (this.has('region')) return;
    const region = await this.accountProvider.sts.config.region();
    this.set('region', region);
  }

  async setAccountId() {
    if (this.has('accountId')) return;
    const { Account } = await this.accountProvider.getCallerIdentity();
    this.set('accountId', Account || '');
  }

  /**
   * @returns {WharfieDeploymentResources} -
   */
  getDeploymentResources() {
    // @ts-ignore
    return this.getResource(`${this.name}-deployment-resources`);
  }

  /**
   * @returns {WharfieDeploymentResources} -
   */
  getSystemStateTable() {
    // @ts-ignore
    return this.getResource(`${this.name}-state`);
  }

  /**
   * @returns {WharfieActor[]} -
   */
  getActors() {
    // @ts-ignore
    return this.getResources().filter((r) => r instanceof WharfieActor);
  }

  /**
   * @returns {Events} -
   */
  getEventsActor() {
    // @ts-ignore
    return this.getResources().find((r) => r instanceof Events);
  }

  /**
   * @returns {Daemon} -
   */
  getDaemonActor() {
    // @ts-ignore
    return this.getResources().find((r) => r instanceof Daemon);
  }

  /**
   * @returns {import('./resources/aws/bucket')} -
   */
  getBucket() {
    // @ts-ignore
    return this.getResource(`${this.name}-deployment-resources`).getBucket();
  }

  /**
   * @param {import("./actor")} actor -
   */
  async _declareActorResources(actor) {}

  async reconcile() {
    await Promise.all([this.setAccountId(), this.setRegion()]);
    this.set('deployment', this.getDeploymentProperties());
    await this.getSystemStateTable().reconcile();
    await super.reconcile();
  }

  async destroy() {
    await Promise.all([this.setAccountId(), this.setRegion()]);
    this.set('deployment', this.getDeploymentProperties());
    await Promise.all([
      this.getDeploymentResources().destroy(),
      ...this.getActors().map((actor) => {
        return actor.destroy();
      }),
    ]);
    // remove the system table from the resources so that it is not destroyed
    // once the system table is destroyed updating state will cause errors
    const systemTable = this.getSystemStateTable();
    this.resources = {};
    await super.destroy();
    await systemTable.destroy();
  }

  // async cache() {
  //   if (!this.reconciled) {
  //     await this.reconcile();
  //   }
  //   await this.resourceGroup.cache();
  //   await bluebirdPromise.map(
  //     Object.values(this.actors),
  //     // @ts-ignore
  //     async (actor) => await actor.resourceGroup.cache(),
  //     { concurrency: 5 }
  //   );
  // }
  async save() {
    const { stateTable, version } = this.get('deployment');

    const serialized = this.serialize();
    await putWithThroughputRetry({
      TableName: stateTable,
      Item: {
        name: this.name,
        sort_key: this.name,
        serialized,
        status: this.status,
        version,
      },
      ReturnValues: 'NONE',
    });
  }
}

module.exports = WharfieDeployment;
