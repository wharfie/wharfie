'use strict';

const wharfie = require('../../../../client');

const Resources = {
  ResourceTable: {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: wharfie.util.stackName,
      AttributeDefinitions: [
        { AttributeName: 'resource_id', AttributeType: 'S' },
        { AttributeName: 'sort_key', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'resource_id', KeyType: 'HASH' },
        { AttributeName: 'sort_key', KeyType: 'RANGE' },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 50,
      },
    },
  },
  // READ AUTOSCALING
  ResourceTableReadCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'ResourceTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'ResourceTableReadCapacityScalableTarget',
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
  ResourceTableReadCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('ResourceTable'),
      ]),
      RoleARN: wharfie.util.getAtt('ResourceTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // WRITE AUTOSCALING
  ResourceTableWriteCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'ResourceTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'ResourceTableWriteCapacityScalableTarget',
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
  ResourceTableWriteCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('ResourceTable'),
      ]),
      RoleARN: wharfie.util.getAtt('ResourceTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // IAM ROLE
  ResourceTableScalingRole: {
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
                Resource: wharfie.util.getAtt('ResourceTable', 'Arn'),
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
