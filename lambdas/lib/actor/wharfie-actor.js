const Queue = require('./resources/aws/queue');
const Role = require('./resources/aws/role');
const LambdaFunction = require('./resources/aws/lambda-function');
const EventSourceMapping = require('./resources/aws/event-source-mapping');
const LambdaBuild = require('./resources/aws/lambda-build');
const BaseResourceGroup = require('./resources/base-resource-group');
// const ActionDefinitionRecord = require('./resources/records/action-type-definition-record');

/**
 * @typedef ExtendedWharfieActorProperties
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef ExtendedWharfieActorOptions
 * @property {string} parent -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {ExtendedWharfieActorProperties & import('./typedefs').SharedProperties} properties -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

/**
 * @typedef WharfieActorProperties
 * @property {string} handler -
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {string | function(): string} actionDefinitionTable -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef WharfieActorOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {WharfieActorProperties & import('./typedefs').SharedProperties} properties -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

class WharfieActor extends BaseResourceGroup {
  /**
   * @param {WharfieActorOptions} options -
   */
  constructor({ name, parent, status, properties, resources, dependsOn }) {
    if (!properties.handler) throw new Error('No handler defined');
    super({
      name,
      parent,
      status,
      properties,
      resources,
      dependsOn,
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('./resources/base-resource') | import('./resources/base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    const build = new LambdaBuild({
      name: `${this.get('deployment').name}-${this.name}-build`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        handler: () => this.get('handler'),
        artifactBucket: () => this.get('artifactBucket'),
      },
    });
    const queue = new Queue({
      name: `${this.get('deployment').name}-${this.name}-queue`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        policy: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Sid: 'accept-s3-events',
              Effect: 'Allow',
              Principal: {
                Service: 's3.amazonaws.com',
              },
              Action: ['sqs:SendMessage'],
              Condition: {
                StringEquals: {
                  'aws:SourceAccount': this.get('deployment').accountId,
                },
              },
              Resource: queue.get('arn'),
            },
            {
              Sid: 'accept-cloudwatch-events',
              Effect: 'Allow',
              Principal: {
                Service: 'events.amazonaws.com',
              },
              Action: ['sqs:SendMessage'],
              Condition: {
                StringEquals: {
                  'aws:SourceAccount': this.get('deployment').accountId,
                },
              },
              Resource: queue.get('arn'),
            },
          ],
        }),
      },
    });
    const dlq = new Queue({
      name: `${this.get('deployment').name}-${this.name}-dlq`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
      },
    });
    const role = new Role({
      name: `${this.get('deployment').name}-${this.name}-role`,
      parent,
      dependsOn: [queue, dlq],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} actor ${this.name} role`,
        assumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
        managedPolicyArns: () => this.get('actorPolicyArns'),
        rolePolicyDocument: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'sqs:DeleteMessage',
                'sqs:ReceiveMessage',
                'sqs:GetQueueAttributes',
                'sqs:SendMessage',
              ],
              Resource: [queue.get('arn'), dlq.get('arn')],
            },
          ],
        }),
      },
    });
    const lambda = new LambdaFunction({
      name: `${this.get('deployment').name}-${this.name}-function`,
      parent,
      dependsOn: [role, dlq, queue, build],
      properties: {
        deployment: () => this.get('deployment'),
        runtime: 'nodejs22.x',
        role: () => role.get('arn'),
        handler: `index.handler`,
        code: () => ({
          S3Bucket: this.get('artifactBucket'),
          S3Key: build.get('artifactKey'),
        }),
        description: `${this.name} lambda`,
        memorySize: 1024,
        timeout: 300,
        deadLetterConfig: () => ({
          TargetArn: dlq.get('arn'),
        }),
        codeHash: () => build.get('functionCodeHash') || '',
        environment: () => {
          return {
            Variables: {
              NODE_OPTIONS: '--enable-source-maps',
              AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
              STACK_NAME: this.get('deployment').name,
              DLQ_URL: dlq.get('url'),
              ...this.get('environmentVariables'),
            },
          };
        },
      },
    });
    const eventSourceMapping = new EventSourceMapping({
      name: `${this.name}-mapping`,
      parent,
      dependsOn: [lambda, queue],
      properties: {
        deployment: () => this.get('deployment'),
        functionName: lambda.name,
        eventSourceArn: () => queue.get('arn'),
        batchSize: 1,
        maximumBatchingWindowInSeconds: 0,
      },
    });

    // const record = new ActionDefinitionRecord({
    //   name: `${this.get('projectName')}-${this.get(
    //     'resourceName'
    //   )}-location-record`,
    //   dependsOn: [lambda, queue],
    //   parent,
    //   properties: {
    //     table_name: this.get('actionDefinitionTable'),
    //     deployment: () => this.get('deployment'),
    //     data: {
    //       resource_id: this.get('resourceId'),
    //       location: this.get('inputLocation'),
    //       interval: this.get('interval'),
    //     },
    //   },
    // })
    return [build, lambda, queue, dlq, role, eventSourceMapping];
  }

  getQueue() {
    return this.getResource(
      `${this.get('deployment').name}-${this.name}-queue`
    );
  }

  getDLQ() {
    return this.getResource(`${this.get('deployment').name}-${this.name}-dlq`);
  }

  getRole() {
    return this.getResource(`${this.get('deployment').name}-${this.name}-role`);
  }
}

module.exports = WharfieActor;
