'use strict';

const wharfie = require('../../../../client');

const Resources = {
  DependencyTable: {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: wharfie.util.join([wharfie.util.stackName, '-dependency']),
      AttributeDefinitions: [
        { AttributeName: 'dependency', AttributeType: 'S' },
        { AttributeName: 'resource_id', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'dependency', KeyType: 'HASH' },
        { AttributeName: 'resource_id', KeyType: 'RANGE' },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1,
      },
    },
  },
  // READ AUTOSCALING
  DependencyTableReadCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'DependencyTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'DependencyTableReadCapacityScalableTarget',
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
  DependencyTableReadCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('DependencyTable'),
      ]),
      RoleARN: wharfie.util.getAtt('DependencyTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // WRITE AUTOSCALING
  DependencyTableWriteCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'DependencyTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'DependencyTableWriteCapacityScalableTarget',
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
  DependencyTableWriteCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('DependencyTable'),
      ]),
      RoleARN: wharfie.util.getAtt('DependencyTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // IAM ROLE
  DependencyTableScalingRole: {
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
                Resource: wharfie.util.getAtt('DependencyTable', 'Arn'),
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
