'use strict';

const path = require('path');
const { readFileSync } = require('fs');
const wharfie = require('../../client');

const Columns = [
  { Name: 'country', Type: 'string' },
  { Name: 'brands', Type: 'string' },
  { Name: 'count', Type: 'bigint' },
];

const AmazonBerkeleyObjectsAggregated = new wharfie.MaterializedView({
  LogicalName: 'AmazonBerkeleyObjectsAggregated',
  DatabaseName: wharfie.util.ref('Database'),
  TableName: 'amazon_berkeley_objects_aggregated',
  WharfieDeployment: wharfie.util.ref('Deployment'),
  Description: 'Materialized Table',
  Columns,
  OriginalSql: readFileSync(path.join(__dirname, 'abo-aggregated.sql'), 'utf8'),
  SqlVariables: { wharfie_db: wharfie.util.ref('Database') },
  InputLocation: wharfie.util.sub(
    's3://${Bucket}/AmazonBerkelyObjects/references/'
  ),
  CompactedConfig: {
    Location: wharfie.util.sub(
      's3://${Bucket}/AmazonBerkelyObjectsAggregated/'
    ),
  },
  Backfill: {
    Version: 1,
    Duration: 60 * 24,
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieExamplesRole', 'Arn'),
    Interval: 60 * 60,
  },
});

module.exports = AmazonBerkeleyObjectsAggregated;
