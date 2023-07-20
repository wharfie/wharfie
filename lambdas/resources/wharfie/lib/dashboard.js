'use strict';

/**
 * @typedef CloudWatchDashboard
 * @property {any} widgets -
 * @param {string} LogicalResourceId -
 * @param {string} OriginalStackName -
 * @param {any} Metadata -
 * @returns {CloudWatchDashboard} -
 */
module.exports = (LogicalResourceId, OriginalStackName, Metadata) => ({
  widgets: [
    {
      type: 'log',
      x: 0,
      y: 2,
      width: 24,
      height: 9,
      properties: {
        query:
          "SOURCE '/aws/lambda/${WharfieStack}-daemon' | SOURCE '/aws/lambda/${WharfieStack}-monitor' | fields @timestamp, message, operation_type, operation_id, resource_id\n| filter resource_id = '${AWS::StackName}'\n| sort @timestamp desc\n| limit 2000",
        region: '${Region}',
        stacked: false,
        title: 'Operation Logs',
        view: 'table',
      },
    },
    {
      type: 'metric',
      x: 12,
      y: 11,
      width: 12,
      height: 9,
      properties: {
        metrics: [
          [
            'AWS/Athena',
            'ProcessedBytes',
            'WorkGroup',
            '${AWS::StackName}',
            { id: 'm1' },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${Region}',
        stat: 'Sum',
        period: 60,
        title: 'Data Scan',
      },
    },
    {
      type: 'metric',
      x: 0,
      y: 20,
      width: 12,
      height: 9,
      properties: {
        metrics: [
          [
            {
              expression:
                'SUM(SEARCH(\'{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform MetricName="FAILED-queries" Stack="${WharfieStack}" WorkGroup="${AWS::StackName}"\', \'SampleCount\', 60))',
              id: 'e1',
              label: 'Failed Queries',
            },
          ],
          [
            {
              expression:
                'SUM(SEARCH(\'{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform MetricName="CANCELLED-queries" Stack="${WharfieStack}" WorkGroup="${AWS::StackName}"\', \'SampleCount\', 60))',
              id: 'e2',
              label: 'Cancelled Queries',
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${Region}',
        stat: 'Average',
        period: 300,
        title: 'Failed and Cancelled Queries',
      },
    },
    {
      type: 'metric',
      x: 0,
      y: 11,
      width: 12,
      height: 9,
      properties: {
        metrics: [
          [
            {
              expression:
                'SEARCH(\'{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform/ WorkGroup="${AWS::StackName}" Stack="${WharfieStack}" MetricName="QUEUED-queries"\', \'SampleCount\', 60)',
              id: 'e2',
            },
          ],
          [
            {
              expression:
                'SEARCH(\'{DataPlatform/Athena,Stack,StatementType,WorkGroup} DataPlatform/ WorkGroup="${AWS::StackName}" Stack="${WharfieStack}" MetricName="RUNNING-queries"\', \'SampleCount\', 60)',
              id: 'e1',
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${Region}',
        stat: 'Average',
        period: 300,
        title: 'Running and Queued Queries',
      },
    },
    {
      type: 'metric',
      x: 12,
      y: 20,
      width: 12,
      height: 9,
      properties: {
        metrics: [
          [
            {
              expression:
                'SEARCH(\'{Wharfie,operation_type,resource,stack} Wharfie resource="${AWS::StackName}" stack="${WharfieStack}" MetricName="operations"\', \'Maximum\', 60)',
              id: 'e2',
              period: 60,
            },
          ],
        ],
        view: 'timeSeries',
        stacked: false,
        region: '${Region}',
        stat: 'Maximum',
        period: 60,
        title: 'Operation Runtimes',
      },
    },
    {
      type: 'text',
      x: 0,
      y: 0,
      width: 24,
      height: 2,
      properties: {
        markdown: `\n# Wharfie ID: \${AWS::StackName} for resource **${LogicalResourceId}** in the **${OriginalStackName}** stack\n[//]: <> (${JSON.stringify(
          Metadata
        )
          .replace(/\(/g, '')
          .replace(/\)/g, '')})`,
      },
    },
  ],
});
