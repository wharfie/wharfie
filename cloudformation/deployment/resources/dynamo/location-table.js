'use strict';

const wharfie = require('../../../../client');

const Resources = {
  LocationTable: {
    Type: 'AWS::DynamoDB::Table',
    Properties: {
      TableName: wharfie.util.join([wharfie.util.stackName, '-location']),
      AttributeDefinitions: [
        { AttributeName: 'location', AttributeType: 'S' },
        { AttributeName: 'resource_id', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'location', KeyType: 'HASH' },
        { AttributeName: 'resource_id', KeyType: 'RANGE' },
      ],
      ProvisionedThroughput: {
        ReadCapacityUnits: 1,
        WriteCapacityUnits: 1,
      },
    },
  },
  // READ AUTOSCALING
  LocationTableReadCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'LocationTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'LocationTableReadCapacityScalableTarget',
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
  LocationTableReadCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('LocationTable'),
      ]),
      RoleARN: wharfie.util.getAtt('LocationTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:ReadCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // WRITE AUTOSCALING
  LocationTableWriteCapacityScalingPolicy: {
    Type: 'AWS::ApplicationAutoScaling::ScalingPolicy',
    Properties: {
      PolicyName: 'LocationTableScalingRole',
      PolicyType: 'TargetTrackingScaling',
      ScalingTargetId: {
        Ref: 'LocationTableWriteCapacityScalableTarget',
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
  LocationTableWriteCapacityScalableTarget: {
    Type: 'AWS::ApplicationAutoScaling::ScalableTarget',
    Properties: {
      MinCapacity: 1,
      MaxCapacity: 50,
      ResourceId: wharfie.util.join('/', [
        'table',
        wharfie.util.ref('LocationTable'),
      ]),
      RoleARN: wharfie.util.getAtt('LocationTableScalingRole', 'Arn'),
      ScalableDimension: 'dynamodb:table:WriteCapacityUnits',
      ServiceNamespace: 'dynamodb',
    },
  },
  // IAM ROLE
  LocationTableScalingRole: {
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
                Resource: wharfie.util.getAtt('LocationTable', 'Arn'),
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
