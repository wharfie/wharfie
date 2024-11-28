const Queue = require('./aws/queue');
const Role = require('./aws/role');
const LambdaFunction = require('./aws/lambda-function');
const EventSourceMapping = require('./aws/event-source-mapping');
const LambdaBuild = require('./aws/lambda-build');
const BaseResourceGroup = require('./base-resource-group');
const S3 = require('../../s3');

/**
 * @typedef WharfieActorResourceProperties
 * @property {string | function(): string} handler -
 * @property {string} actorName -
 * @property {string[] | function(): string[]} actorPolicyArns -
 * @property {string | function(): string} artifactBucket -
 * @property {Object<string,string> | function(): Object<string,string>} environmentVariables -
 */

/**
 * @typedef WharfieActorResourceOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('./reconcilable').Status} [status] -
 * @property {WharfieActorResourceProperties & import('../typedefs').SharedProperties} properties -
 * @property {import('./reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./base-resource') | BaseResourceGroup>} [resources] -
 */

class WharfieActorResources extends BaseResourceGroup {
  /**
   * @param {WharfieActorResourceOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn, resources }) {
    if (!properties.handler) throw new Error('No handler defined');
    super({
      name,
      parent,
      status,
      properties,
      dependsOn,
      resources,
    });
    this.s3 = new S3();
  }

  /**
   * @param {string} parent -
   * @returns {(import('./base-resource') | BaseResourceGroup)[]} -
   */
  _defineGroupResources(parent) {
    const build = new LambdaBuild({
      name: `${this.get('deployment').name}-${this.get('actorName')}-build`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        handler: () => this.get('handler'),
        artifactBucket: () => this.get('artifactBucket'),
      },
    });
    const queue = new Queue({
      name: `${this.get('deployment').name}-${this.get('actorName')}-queue`,
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
      name: `${this.get('deployment').name}-${this.get('actorName')}-dlq`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
      },
    });
    const role = new Role({
      name: `${this.get('deployment').name}-${this.get('actorName')}-role`,
      parent,
      dependsOn: [queue, dlq],
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.get('deployment').name} actor ${this.get(
          'actorName'
        )} role`,
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
      name: `${this.get('deployment').name}-${this.get('actorName')}-function`,
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
        description: `${this.get('actorName')} lambda`,
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
      name: `${this.get('actorName')}-mapping`,
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
    return [build, lambda, queue, dlq, role, eventSourceMapping];
  }
}

module.exports = WharfieActorResources;
