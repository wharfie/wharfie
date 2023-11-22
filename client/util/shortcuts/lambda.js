'use strict';

const merge = require('../merge');
const ServiceRole = require('./service-role');

/**
 * Baseline CloudFormation resources involved in a Lambda Function. Creates a
 * Log Group, a Role, an Alarm on function errors, and the Lambda Function itself.
 * @param {object} options - Options.
 * @param {string} options.LogicalName - The logical name of the Lambda function
 * within the CloudFormation template. This is used to construct the logical
 * names of the other resources, as well as the Lambda function's name.
 * @param {object} options.Code - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-code.html).
 * @param {object} [options.DeadLetterConfig=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-deadletterconfig).
 * @param {string} [options.Description='${logical name} in the ${stack name} stack'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-description).
 * @param {object} [options.Environment=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-environment).
 * @param {string} [options.FunctionName='${stack name}-${logical name}'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-functionname).
 * @param {string} [options.Handler='index.handler'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-handler).
 * @param {string} [options.KmsKeyArn=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-kmskeyarn).
 * @param {Array<string>} [options.Layers=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-layers).
 * @param {number} [options.MemorySize=128] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-memorysize).
 * @param {number} [options.ReservedConcurrentExecutions=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-reservedconcurrentexecutions).
 * @param {string} [options.Runtime='nodejs16.x'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-runtime).
 * @param {Array<object>} [options.Tags=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-tags).
 * @param {number} [options.Timeout=300] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-timeout).
 * @param {object} [options.TracingConfig=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-tracingconfig).
 * @param {object} [options.VpcConfig=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-vpcconfig).
 * @param {string} [options.Condition=undefined] - If there is a `Condition` defined in the template
 * that should control whether to create this Lambda function, specify
 * the name of the condition here. See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/conditions-section-structure.html).
 * @param {string} [options.DependsOn=undefined] - Specify a stack resource dependency
 * to this Lambda function. See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-dependson.html).
 * @param {Array<object>} [options.Statement=[]] Policy statements that will be added to a generated IAM role defining the permissions your Lambda function needs to run. _Do not use this option when specifying your own role via RoleArn._
 * @param {string} [options.RoleArn=undefined] If specified, the Lambda function will use this role instead of creating a new role. _If this option is specified, do not use the Statement option; add the permissions you need to your Role directly._
 * @param {string} [options.AlarmName='${stack name}-${logical name}-Errors-${region}'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-alarmname).
 * @param {string} [options.AlarmDescription='Error alarm for ${stack name}-${logical name} lambda function in ${stack name} stack'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-alarmdescription).
 * @param {Array<string>} [options.AlarmActions=[]] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-alarmactions).
 * @param {number} [options.Period=60] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-period).
 * @param {number} [options.EvaluationPeriods=1] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-evaluationperiods).
 * @param {string} [options.Statistic='Sum'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-statistic).
 * @param {number} [options.DatapointsToAlarm=1] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarm-datapointstoalarm).
 * @param {number} [options.Threshold=0] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-threshold).
 * @param {string} [options.ComparisonOperator='GreaterThanThreshold'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-comparisonoperator).
 * @param {string} [options.TreatMissingData='notBreaching'] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-treatmissingdata).
 * @param {string} [options.EvaluateLowSampleCountPercentile=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-evaluatelowsamplecountpercentile).
 * @param {string} [options.ExtendedStatistic=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-extendedstatistic)]
 * @param {Array<string>} [options.OKActions=undefined] - See [AWS documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-cw-alarm.html#cfn-cloudwatch-alarms-okactions).
 */
class Lambda {
  constructor(options) {
    if (!options) throw new Error('Options required');
    const {
      LogicalName,
      Code,
      DeadLetterConfig,
      Description = {
        'Fn::Sub': `${LogicalName} in the \${AWS::StackName} stack`,
      },
      Environment,
      FunctionName = { 'Fn::Sub': `\${AWS::StackName}-${LogicalName}` },
      Handler = 'index.handler',
      KmsKeyArn,
      Layers = [],
      MemorySize = 128,
      ReservedConcurrentExecutions,
      Runtime = 'nodejs18.x',
      Tags,
      Timeout = 300,
      TracingConfig,
      VpcConfig,
      Condition = undefined,
      DependsOn = undefined,
      Statement = [],
      RoleArn,
      AlarmName = {
        'Fn::Sub': `\${AWS::StackName}-${LogicalName}-Errors-\${AWS::Region}`,
      },
      AlarmDescription = {
        'Fn::Sub': [
          'Error alarm for ${name} lambda function in ${AWS::StackName} stack',
          { name: FunctionName },
        ],
      },
      AlarmActions = [],
      Period = 60,
      EvaluationPeriods = Math.ceil(Timeout / Period),
      Statistic = 'Sum',
      DatapointsToAlarm = 1,
      Threshold = 0,
      Architectures = ['arm64'],
      ComparisonOperator = 'GreaterThanThreshold',
      TreatMissingData = 'notBreaching',
      EvaluateLowSampleCountPercentile,
      ExtendedStatistic,
      OKActions,
    } = options;

    if (options.EvaluationPeriods < Math.ceil(Timeout / Period))
      throw new Error(
        'Cloudwatch alarm evalution window shorter than lambda timeout'
      );

    const required = [LogicalName, Code];
    if (required.some((variable) => !variable))
      throw new Error('You must provide a LogicalName, and Code');

    if (Statement.length > 0 && RoleArn) {
      throw new Error('You cannot specify both Statements and a RoleArn');
    }
    let roleName;
    if (RoleArn) {
      roleName = { 'Fn::Select': [1, { 'Fn::Split': ['/', RoleArn] }] };
    } else {
      roleName = { Ref: `${LogicalName}Role` };
    }

    this.LogicalName = LogicalName;
    this.FunctionName = FunctionName;
    this.Condition = Condition;

    this.Resources = {
      [`${LogicalName}Logs`]: {
        Type: 'AWS::Logs::LogGroup',
        Condition: 'IsDebug',
        Properties: {
          LogGroupName: {
            'Fn::Sub': ['/aws/lambda/${name}', { name: FunctionName }],
          },
          RetentionInDays: 14,
        },
      },
      [`${LogicalName}`]: {
        Type: 'AWS::Lambda::Function',
        Condition,
        DependsOn,
        Properties: {
          Architectures,
          Code,
          DeadLetterConfig,
          Description,
          Environment,
          FunctionName,
          Handler,
          KmsKeyArn,
          Layers,
          MemorySize,
          ReservedConcurrentExecutions,
          Runtime,
          Timeout,
          TracingConfig,
          VpcConfig,
          Tags,
        },
      },

      [`${LogicalName}ErrorAlarm`]: {
        Type: 'AWS::CloudWatch::Alarm',
        Condition,
        Properties: {
          AlarmName,
          AlarmDescription,
          AlarmActions,
          Period,
          EvaluationPeriods,
          DatapointsToAlarm,
          Statistic,
          Threshold,
          ComparisonOperator,
          TreatMissingData,
          EvaluateLowSampleCountPercentile,
          ExtendedStatistic,
          OKActions,
          Namespace: 'AWS/Lambda',
          Dimensions: [
            {
              Name: 'FunctionName',
              Value: { Ref: LogicalName },
            },
          ],
          MetricName: 'Errors',
        },
      },
      [`${LogicalName}LogPolicy`]: {
        Type: 'AWS::IAM::Policy',
        Condition,
        DependsOn: RoleArn ? undefined : `${LogicalName}Role`,
        Properties: {
          PolicyName: `${LogicalName}-lambda-log-access`,
          Roles: [roleName],
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: 'logs:*',
                Resource: {
                  'Fn::GetAtt': [`${LogicalName}Logs`, 'Arn'],
                },
              },
            ],
          },
        },
      },
    };

    if (RoleArn) {
      this.Resources[`${LogicalName}`].Properties.Role = RoleArn;
    } else {
      const serviceRole = new ServiceRole({
        LogicalName: `${LogicalName}Role`,
        Service: 'lambda',
        Condition,
        Statement,
      });
      this.Resources[`${LogicalName}`].Properties.Role = {
        'Fn::GetAtt': [`${LogicalName}Role`, 'Arn'],
      };
      this.Resources = merge(this, serviceRole).Resources;
    }
  }
}

module.exports = Lambda;
