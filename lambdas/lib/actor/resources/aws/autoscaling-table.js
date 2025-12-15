import Role from './role.js';
import Table from './table.js';
import AutoScalingPolicy from './autoscaling-policy.js';
import AutoScalingTarget from './autoscaling-target.js';
import ApplicationAutoScaling from '../../../application-auto-scaling.js';
import BaseResourceGroup from '../base-resource-group.js';

/**
 * @typedef AutoscalingTableProperties
 * @property {string} tableName -
 * @property {import("@aws-sdk/client-dynamodb").AttributeDefinition[]} attributeDefinitions -
 * @property {import("@aws-sdk/client-dynamodb").KeySchemaElement[]} keySchema -
 * @property {import("@aws-sdk/client-dynamodb").ProvisionedThroughput} provisionedThroughput -
 * @property {import("@aws-sdk/client-dynamodb").TimeToLiveSpecification} [timeToLiveSpecification] -
 * @property {number} minWriteCapacity -
 * @property {number} maxWriteCapacity -
 * @property {number} minReadCapacity -
 * @property {number} maxReadCapacity -
 */

/**
 * @typedef AutoscalingTableOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable.js').default.Status} [status] -
 * @property {AutoscalingTableProperties & import('../../typedefs.js').SharedProperties} properties -
 * @property {import('../reconcilable.js').default[]} [dependsOn] -
 * @property {Object<string, import('../base-resource.js').default | BaseResourceGroup>} [resources] -
 */

class AutoscalingTable extends BaseResourceGroup {
  /**
   * @param {AutoscalingTableOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn, resources }) {
    super({ name, parent, status, properties, dependsOn, resources });
  }

  /**
   * @param {string} parent -
   * @returns {(import('../base-resource.js').default | BaseResourceGroup)[]} -
   */
  _defineGroupResources(parent) {
    const table = new Table({
      name: this.get('tableName'),
      dependsOn: this.dependsOn,
      parent,
      properties: {
        _INTERNAL_STATE_RESOURCE: this.get('_INTERNAL_STATE_RESOURCE'),
        deployment: () => this.get('deployment'),
        attributeDefinitions: this.get('attributeDefinitions'),
        keySchema: this.get('keySchema'),
        provisionedThroughput: this.get('provisionedThroughput'),
        ...(this.has('timeToLiveSpecification')
          ? { timeToLiveSpecification: this.get('timeToLiveSpecification') }
          : {}),
      },
    });
    const role = new Role({
      name: `${this.get('tableName')}-autoscaling-role`,
      dependsOn: [table],
      parent,
      properties: {
        _INTERNAL_STATE_RESOURCE: this.get('_INTERNAL_STATE_RESOURCE'),
        deployment: () => this.get('deployment'),
        description: `Role for ${this.get('tableName')} table autoscaling`,
        assumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: ['application-autoscaling.amazonaws.com'],
              },
            },
          ],
        },
        rolePolicyDocument: () => ({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['dynamodb:DescribeTable', 'dynamodb:UpdateTable'],
              Resource: table.get('arn'),
            },
            {
              Effect: 'Allow',
              Action: [
                'cloudwatch:PutMetricAlarm',
                'cloudwatch:DescribeAlarms',
                'cloudwatch:GetMetricStatistics',
                'cloudwatch:SetAlarmState',
                'cloudwatch:DeleteAlarms',
              ],
              Resource: '*',
            },
          ],
        }),
      },
    });
    const readAutoscalingTarget = new AutoScalingTarget({
      name: `${this.get('tableName')}-readAutoscalingTarget`,
      dependsOn: [role],
      parent,
      properties: {
        _INTERNAL_STATE_RESOURCE: this.get('_INTERNAL_STATE_RESOURCE'),
        deployment: () => this.get('deployment'),
        minCapacity: this.get('minReadCapacity'),
        maxCapacity: this.get('maxReadCapacity'),
        resourceId: `table/${this.get('tableName')}`,
        scalableDimension: 'dynamodb:table:ReadCapacityUnits',
        serviceNamespace: ApplicationAutoScaling.ServiceNamespace.DYNAMODB,
        roleArn: () => role.get('arn'),
      },
    });
    const readAutoscalingPolicy = new AutoScalingPolicy({
      name: `${this.get('tableName')}-readAutoscalingPolicy`,
      dependsOn: [readAutoscalingTarget],
      parent,
      properties: {
        _INTERNAL_STATE_RESOURCE: this.get('_INTERNAL_STATE_RESOURCE'),
        deployment: () => this.get('deployment'),
        resourceId: `table/${this.get('tableName')}`,
        serviceNamespace: ApplicationAutoScaling.ServiceNamespace.DYNAMODB,
        policyType: ApplicationAutoScaling.PolicyType.TargetTrackingScaling,
        scalableDimension: 'dynamodb:table:ReadCapacityUnits',
        targetTrackingScalingPolicyConfiguration: {
          TargetValue: 70.0,
          ScaleInCooldown: 0,
          ScaleOutCooldown: 0,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'DynamoDBReadCapacityUtilization',
          },
        },
      },
    });
    const writeAutoscalingTarget = new AutoScalingTarget({
      name: `${this.get('tableName')}-writeAutoscalingTarget`,
      dependsOn: [role],
      parent,
      properties: {
        _INTERNAL_STATE_RESOURCE: this.get('_INTERNAL_STATE_RESOURCE'),
        deployment: () => this.get('deployment'),
        minCapacity: this.get('minWriteCapacity'),
        maxCapacity: this.get('maxWriteCapacity'),
        resourceId: `table/${this.get('tableName')}`,
        scalableDimension: 'dynamodb:table:WriteCapacityUnits',
        serviceNamespace: ApplicationAutoScaling.ServiceNamespace.DYNAMODB,
        roleArn: () => role.get('arn'),
      },
    });
    const writeAutoscalingPolicy = new AutoScalingPolicy({
      name: `${this.get('tableName')}-writeAutoscalingPolicy`,
      dependsOn: [writeAutoscalingTarget],
      parent,
      properties: {
        _INTERNAL_STATE_RESOURCE: this.get('_INTERNAL_STATE_RESOURCE'),
        deployment: () => this.get('deployment'),
        resourceId: `table/${this.get('tableName')}`,
        serviceNamespace: ApplicationAutoScaling.ServiceNamespace.DYNAMODB,
        policyType: ApplicationAutoScaling.PolicyType.TargetTrackingScaling,
        scalableDimension: 'dynamodb:table:WriteCapacityUnits',
        targetTrackingScalingPolicyConfiguration: {
          TargetValue: 70.0,
          ScaleInCooldown: 0,
          ScaleOutCooldown: 0,
          PredefinedMetricSpecification: {
            PredefinedMetricType: 'DynamoDBWriteCapacityUtilization',
          },
        },
      },
    });

    return [
      table,
      role,
      readAutoscalingTarget,
      readAutoscalingPolicy,
      writeAutoscalingTarget,
      writeAutoscalingPolicy,
    ];
  }

  /**
   * @param {Omit<import("@aws-sdk/lib-dynamodb").PutCommandInput, 'TableName'>} params -
   * @returns {Promise<import("@aws-sdk/lib-dynamodb").PutCommandOutput>} -
   */
  async put(params) {
    const table = this.getResource(this.name);
    if (table && table instanceof Table) {
      return table.put(params);
    }
    throw new Error('Table not found');
  }

  getTable() {
    return this.getResource(this.get('tableName'));
  }
}

export default AutoscalingTable;
