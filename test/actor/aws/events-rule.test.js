/* eslint-disable jest/no-large-snapshots */
'use strict';

process.env.AWS_MOCKS = true;
const { EventsRule } = require('../../../lambdas/lib/actor/resources/aws/');
const { CloudWatchEvents } = jest.requireMock(
  '@aws-sdk/client-cloudwatch-events'
);

const { deserialize } = require('../../../lambdas/lib/actor/deserialize');

describe('events rule IaC', () => {
  it('basic', async () => {
    expect.assertions(6);
    const cloudWatchEvents = new CloudWatchEvents({});
    const eventsRule = new EventsRule({
      name: 'test-rule',
      properties: {
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
              InputTemplate: `{"operation_started_at":<time>, "operation_type":"MAINTAIN", "action_type":"START", "resource_id":"test-id"}`,
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
        "properties": {
          "description": "practice rule",
          "roleArn": "arn:aws:iam::123456789012:role/test-role",
          "scheduleExpression": "rate(1 minute)",
          "state": "ENABLED",
          "targets": [
            {
              "Arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
              "Id": "rule-target",
              "InputTransformer": {
                "InputPathsMap": {
                  "time": "$.time",
                },
                "InputTemplate": "{"operation_started_at":<time>, "operation_type":"MAINTAIN", "action_type":"START", "resource_id":"test-id"}",
              },
            },
          ],
        },
        "resourceType": "EventsRule",
        "status": "STABLE",
      }
    `);

    const deserialized = deserialize(serialized);
    await deserialized.reconcile();
    expect(deserialized).toMatchInlineSnapshot(`
      EventsRule {
        "_MAX_RETRIES": 10,
        "_MAX_RETRY_TIMEOUT_SECONDS": 10,
        "_destroyErrors": [],
        "_reconcileErrors": [],
        "cloudwatchEvents": CloudWatchEvents {
          "cloudwatchEvents": CloudWatchEventsMock {},
        },
        "dependsOn": [],
        "emit": false,
        "name": "test-rule",
        "properties": {
          "description": "practice rule",
          "roleArn": "arn:aws:iam::123456789012:role/test-role",
          "scheduleExpression": "rate(1 minute)",
          "state": "ENABLED",
          "targets": [
            {
              "Arn": "arn:aws:firehose:us-east-1:123456789012:deliverystream/test-table",
              "Id": "rule-target",
              "InputTransformer": {
                "InputPathsMap": {
                  "time": "$.time",
                },
                "InputTemplate": "{"operation_started_at":<time>, "operation_type":"MAINTAIN", "action_type":"START", "resource_id":"test-id"}",
              },
            },
          ],
        },
        "resourceType": "EventsRule",
        "status": "STABLE",
      }
    `);
    expect(deserialized.status).toBe('STABLE');

    const res = await cloudWatchEvents.describeRule({
      Name: eventsRule.name,
    });

    expect(res).toMatchInlineSnapshot(`
      {
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
              "InputTemplate": "{"operation_started_at":<time>, "operation_type":"MAINTAIN", "action_type":"START", "resource_id":"test-id"}",
            },
          },
        ],
      }
    `);
    await deserialized.destroy();
    expect(deserialized.status).toBe('DESTROYED');
    await expect(
      cloudWatchEvents.describeRule({
        Name: eventsRule.name,
      })
    ).rejects.toThrowErrorMatchingInlineSnapshot(`"Rule not found"`);
  });
});
