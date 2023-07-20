'use strict';

const wharfie = require('../../client');
const widget_json = {
  widgets: [
    {
      height: 9,
      width: 12,
      y: 14,
      x: 0,
      type: 'metric',
      properties: {
        metrics: [
          [
            {
              expression:
                'SUM(SEARCH(\'{Wharfie/Wharfie,operation_type,resource,stack} Wharfie MetricName="operations" stack="${AWS::StackName}"\', \'SampleCount\', 300))',
              id: 'e1',
              period: 300,
              region: '${AWS::Region}',
              label: 'Wharfie Operations',
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        stat: 'Average',
        period: 300,
        title: 'Operations Completed',
      },
    },
    {
      height: 9,
      width: 12,
      y: 14,
      x: 12,
      type: 'metric',
      properties: {
        metrics: [
          [
            {
              expression:
                "SUM(SEARCH('{AWS/Athena,WorkGroup} Wharfie', 'Sum', 300))",
              id: 'e1',
              period: 300,
              region: '${AWS::Region}',
              label: 'Athena Data Scan',
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        stat: 'Average',
        period: 300,
        title: 'Data Processed',
      },
    },
    {
      height: 9,
      width: 12,
      y: 23,
      x: 0,
      type: 'metric',
      properties: {
        metrics: [
          [
            'AWS/Lambda',
            'Errors',
            'FunctionName',
            '${AWS::StackName}-bootstrap',
          ],
          ['...', '${AWS::StackName}-daemon'],
          ['...', '${AWS::StackName}-monitor'],
          ['...', '${AWS::StackName}-events'],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        title: 'Wharfie Lambda Errors',
        period: 300,
        stat: 'Sum',
      },
    },
    {
      height: 9,
      width: 12,
      y: 32,
      x: 0,
      type: 'metric',
      properties: {
        metrics: [
          [
            'AWS/SQS',
            'ApproximateNumberOfMessagesVisible',
            'QueueName',
            '${AWS::StackName}-Daemon-dead-letter',
            { id: 'm1' },
          ],
          ['...', '${AWS::StackName}-monitor-dead-letter', { id: 'm2' }],
          ['...', '${AWS::StackName}-events-dead-letter', { id: 'm3' }],
          [
            '...',
            '${AWS::StackName}-Daemon-resource-dead-letter',
            { id: 'm5', color: '#800080' },
          ],
          [
            {
              expression: 'ANOMALY_DETECTION_BAND(m5, 2)',
              label: '${AWS::StackName}-Daemon-resource-dead-letter (expected)',
              id: 'ad1',
              color: '#800080',
              stat: 'Maximum',
            },
          ],
          [
            'AWS/SQS',
            'ApproximateNumberOfMessagesVisible',
            'QueueName',
            '${AWS::StackName}-monitor-resource-dead-letter',
            { id: 'm6', color: '#A9A9A9' },
          ],
          [
            {
              expression: 'ANOMALY_DETECTION_BAND(m6, 2)',
              label:
                '${AWS::StackName}-monitor-resource-dead-letter (expected)',
              id: 'ad2',
              color: '#A9A9A9',
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        title: 'DLQ depths',
        period: 300,
        stat: 'Maximum',
      },
    },
    {
      height: 9,
      width: 12,
      y: 23,
      x: 12,
      type: 'metric',
      properties: {
        metrics: [
          [
            {
              expression:
                'SUM(SEARCH(\'{AWS/Athena,QueryState,QueryType,WorkGroup} Wharfie QueryState="FAILED" MetricName="ProcessedBytes"\', \'SampleCount\', 300))',
              id: 'e1',
              period: 300,
              label: 'Failed',
              region: '${AWS::Region}',
            },
          ],
          [
            {
              expression:
                'SUM(SEARCH(\'{AWS/Athena,QueryState,QueryType,WorkGroup} Wharfie MetricName="ProcessedBytes" QueryState="CANCELED"\', \'SampleCount\', 300))',
              id: 'e2',
              period: 300,
              label: 'Cancelled',
              region: '${AWS::Region}',
            },
          ],
          [
            {
              expression:
                'SUM(SEARCH(\'{AWS/Athena,QueryState,QueryType,WorkGroup} Wharfie MetricName="ProcessedBytes" QueryState="SUCCEEDED"\', \'SampleCount\', 300))',
              id: 'e3',
              period: 300,
              label: 'Succeeded',
              region: '${AWS::Region}',
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        stat: 'Average',
        title: 'Athena Queries',
        period: 300,
      },
    },
    {
      height: 6,
      width: 24,
      y: 1,
      x: 0,
      type: 'metric',
      properties: {
        metrics: [
          [
            'AWS/SQS',
            'NumberOfMessagesSent',
            'QueueName',
            '${AWS::StackName}-Daemon-resource-dead-letter',
            { id: 'm1', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-Daemon-dead-letter',
            { id: 'm2', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-Daemon-queue',
            { id: 'm3', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-monitor-queue',
            { id: 'm4', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-monitor-resource-dead-letter',
            { id: 'm5', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-monitor-dead-letter',
            { id: 'm6', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-events-queue',
            { id: 'm7', visible: false },
          ],
          [
            '...',
            '${AWS::StackName}-events-dead-letter',
            { id: 'm8', visible: false },
          ],
          [
            {
              expression: '100 - (m1 + m2 + m5 + m6 + m8) / (m3 + m4 + m7)',
              label: 'Total Service ${!AVG}%',
              id: 'e1',
              period: 300,
              region: '${AWS::Region}',
              stat: 'Sum',
            },
          ],
          [
            {
              expression: '100 - (m1 + m2) / (m3)',
              label: 'Daemon Events ${!AVG}%',
              id: 'e2',
              period: 300,
              region: '${AWS::Region}',
              stat: 'Sum',
            },
          ],
          [
            {
              expression: '100 - (m5 + m6) / (m4)',
              label: 'Monitor Events ${!AVG}%',
              id: 'e3',
              period: 300,
              region: '${AWS::Region}',
              stat: 'Sum',
            },
          ],
          [
            {
              expression: '100 - (m8) / (m7)',
              label: 'S3 Events ${!AVG}%',
              id: 'e4',
              period: 300,
              region: '${AWS::Region}',
              stat: 'Sum',
            },
          ],
        ],
        title: 'Event Processing Success Rate',
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        stat: 'Sum',
        period: 300,
        yAxis: {
          left: {
            showUnits: false,
            label: 'Percent',
          },
        },
        annotations: {
          horizontal: [
            {
              label: 'ALARM',
              value: 99.9,
            },
          ],
        },
      },
    },
    {
      height: 1,
      width: 24,
      y: 0,
      x: 0,
      type: 'text',
      properties: {
        markdown: '\n# ALARM\n',
      },
    },
    {
      height: 1,
      width: 24,
      y: 13,
      x: 0,
      type: 'text',
      properties: {
        markdown: '\n# Usage Metrics\n',
      },
    },
    {
      height: 6,
      width: 24,
      y: 7,
      x: 0,
      type: 'metric',
      properties: {
        metrics: [
          [
            {
              expression: 'MAX(METRICS())',
              label: 'Total Service p99 Latency ${!MAX}',
              id: 'e1',
              visible: false,
            },
          ],
          [
            'AWS/SQS',
            'ApproximateAgeOfOldestMessage',
            'QueueName',
            '${AWS::StackName}-monitor-queue',
            { id: 'm1', label: 'Monitor Events' },
          ],
          [
            '...',
            '${AWS::StackName}-Daemon-queue',
            { id: 'm2', label: 'Daemon Events' },
          ],
          [
            '...',
            '${AWS::StackName}-events-queue',
            { id: 'm3', label: 'Events' },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${AWS::Region}',
        stat: 'p99',
        period: 86400,
        title: 'Event Processing Latency p99',
        annotations: {
          horizontal: [
            {
              label: 'ALARM',
              value: 900,
            },
          ],
        },
        yAxis: {
          left: {
            label: 'Seconds',
            showUnits: false,
          },
        },
      },
    },
  ],
};

const Resources = {
  Dashboard: {
    Type: 'AWS::CloudWatch::Dashboard',
    Properties: {
      DashboardName: wharfie.util.sub('${AWS::StackName}-health'),
      DashboardBody: wharfie.util.sub(JSON.stringify(widget_json)),
    },
  },
};
module.exports = { Resources };
