/* eslint-disable jest/no-large-snapshots */
import { describe, expect, it, jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

process.env.AWS_MOCKS = '1';
const { EventsRule } = require('../../../lambdas/lib/actor/resources/aws/');
const { CloudWatchEvents } = jest.requireMock(
  '@aws-sdk/client-cloudwatch-events',
);

const { getMockDeploymentProperties } = require('../util');

describe('events rule IaC', () => {
  it('basic', async () => {
    expect.assertions(4);

    const cloudWatchEvents = new CloudWatchEvents({});
    const eventsRule = new EventsRule({
      name: 'test-rule',
      properties: {
        deployment: getMockDeploymentProperties(),
        tags: [
          {
            Key: 'test-key',
            Value: 'test-value',
          },
        ],
        description: `practice rule`,
        state: EventsRule.ENABLED,
        scheduleExpression: 'rate(1 minute)',
        roleArn: 'arn:aws:iam::123456789012:role/test-role',
        targets: [
          {
            Id: `rule-target`,
            Arn: 'arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table',
            InputTransformer: {
              InputPathsMap: {
                time: '$.time',
              },
              InputTemplate: `{"operation_started_at":<time>, "operation_type":"BACKFILL", "action_type":"START", "resource_id":"test-id"}`,
            },
          },
        ],
      },
    });
    await eventsRule.reconcile();

    const serialized = eventsRule.serialize();

    expect(serialized).toMatchInlineSnapshot(`
      {
        "dependsOn": [],
        "name": "test-rule",
        "parent": "",
        "properties": {
          "arn": "arn:aws:events:us-east-1:123456789012:rule/test-rule",
          "deployment": {
            "accountId": "123456789012",
            "envPaths": {
              "cache": "",
              "config": "",
              "data": "",
              "log": "",
              "temp": "",
            },
            "name": "test-deployment",
            "region": "us-east-1",
            "stateTable": "_testing_state_table",
            "version": "0.0.1test",
          },
          "description": "practice rule",
          "roleArn": "arn:aws:iam::123456789012:role/test-role",
          "scheduleExpression": "rate(1 minute)",
          "state": "ENABLED",
          "tags": [
            {
              "Key": "test-key",
              "Value": "test-value",
            },
          ],
          "targets": [
            {
              "Arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
              "Id": "rule-target",
              "InputTransformer": {
                "InputPathsMap": {
                  "time": "$.time",
                },
                "InputTemplate": "{"operation_started_at":<time>, "operation_type":"BACKFILL", "action_type":"START", "resource_id":"test-id"}",
              },
            },
          ],
        },
        "resourceType": "EventsRule",
        "status": "STABLE",
      }
    `);

    const res = await cloudWatchEvents.describeRule({
      Name: eventsRule.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
        "Arn": "arn:aws:events:us-east-1:123456789012:rule/test-rule",
        "Description": "practice rule",
        "Name": "test-rule",
        "RoleArn": "arn:aws:iam::123456789012:role/test-role",
        "ScheduleExpression": "rate(1 minute)",
        "State": "ENABLED",
        "Targets": [
          {
            "Arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
            "Id": "rule-target",
            "InputTransformer": {
              "InputPathsMap": {
                "time": "$.time",
              },
              "InputTemplate": "{"operation_started_at":<time>, "operation_type":"BACKFILL", "action_type":"START", "resource_id":"test-id"}",
            },
          },
        ],
      }
    `);

    await eventsRule.destroy();

    expect(eventsRule.status).toBe('DESTROYED');
    await expect(
      cloudWatchEvents.describeRule({
        Name: eventsRule.name,
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Rule not found"`);
  });
});
