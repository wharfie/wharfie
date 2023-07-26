'use strict';

const wharfie = require('../../../../client');

const Resources = {
  EventTable: {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: wharfie.util.join([wharfie.util.stackName, '-event']),
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
        WriteCapacityUnits: 1,
      },
      TimeToLiveSpecification: {
        AttributeName: 'ttl',
        Enabled: true,
      },
    },
  },
  // READ AUTOSCALING
  EventTableReadCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'EventTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'EventTableReadCapacityScalableTarget',
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
  EventTableReadCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('EventTable'),
      ]),
      RoleARN: wharfie.util.getAtt('EventTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // WRITE AUTOSCALING
  EventTableWriteCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'EventTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'EventTableWriteCapacityScalableTarget',
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
  EventTableWriteCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('EventTable'),
      ]),
      RoleARN: wharfie.util.getAtt('EventTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // IAM ROLE
  EventTableScalingRole: {
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
                Resource: wharfie.util.getAtt('EventTable', 'Arn'),
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
