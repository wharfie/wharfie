'use strict';

const wharfie = require('../../../client');

const Resources = {
  CounterTable: {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: wharfie.util.join([wharfie.util.stackName, '-counters']),
      AttributeDefinitions: [
        { AttributeName: 'stack_name', AttributeType: 'S' },
        { AttributeName: 'counter', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'stack_name', KeyType: 'HASH' },
        { AttributeName: 'counter', KeyType: 'RANGE' },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1,
      },
    },
  },
  // READ AUTOSCALING
  CounterTableReadCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'CounterTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'CounterTableReadCapacityScalableTarget',
      },
      TargetTrackingScalingPolicyConfiguration: {
        TargetValue: 70.0,
        ScaleInCooldown: 0,
        ScaleOutCooldown: 0,
        PredefinedMetricSpecification: {
          PredefinedMetricType: 'DynamoDBReadCapacityUtilization',
        },
      },
    },
  },
  CounterTableReadCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('CounterTable'),
      ]),
      RoleARN: wharfie.util.getAtt('CounterTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // WRITE AUTOSCALING
  CounterTableWriteCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'CounterTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'CounterTableWriteCapacityScalableTarget',
      },
      TargetTrackingScalingPolicyConfiguration: {
        TargetValue: 70.0,
        ScaleInCooldown: 0,
        ScaleOutCooldown: 0,
        PredefinedMetricSpecification: {
          PredefinedMetricType: 'DynamoDBWriteCapacityUtilization',
        },
      },
    },
  },
  CounterTableWriteCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('CounterTable'),
      ]),
      RoleARN: wharfie.util.getAtt('CounterTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // IAM ROLE
  CounterTableScalingRole: {
    Type: 'AWS::IAM::Role',
    Properties: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: {
              Service: ['application-autoscaling.amazonaws.com'],
            },
            Action: ['sts:AssumeRole'],
          },
        ],
      },
      Path: '/',
      Policies: [
        {
          PolicyName: 'root',
          PolicyDocument: {
            Version: '2012-10-17',
            Statement: [
              {
                Effect: 'Allow',
                Action: ['dynamodb:DescribeTable', 'dynamodb:UpdateTable'],
                Resource: wharfie.util.getAtt('CounterTable', 'Arn'),
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
          },
        },
      ],
    },
  },
};

module.exports = { Resources };
