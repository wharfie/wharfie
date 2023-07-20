'use strict';

const path = require('path');
const { readFileSync } = require('fs');
const wharfie = require('../../client');

const Columns = [
  { Name: 'item_id', Type: 'string' },
  { Name: 'marketplace', Type: 'string' },
  { Name: 'image_byte_size', Type: 'bigint' },
];

const AmazonBerkeleyObjectsUDFJoin = new wharfie.MaterializedView({
  LogicalName: 'AmazonBerkeleyObjectsUDFJoin',
  DatabaseName: wharfie.util.ref('Database'),
  TableName: 'amazon_berkeley_objects_udf_join',
  WharfieDeployment: wharfie.util.ref('Deployment'),
  Description: 'Materialized Table',
  Columns,
  OriginalSql: readFileSync(path.join(__dirname, 'abo-udf-join.sql'), 'utf8'),
  SqlVariables: { wharfie_db: wharfie.util.ref('Database') },
  InputLocation: wharfie.util.sub(
    's3://${ExamplesBucket}/AmazonBerkelyObjects/references/'
  ),
  CompactedConfig: {
    Location: wharfie.util.sub(
      's3://${ExamplesBucket}/AmazonBerkelyObjectsUDFJoin/'
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

module.exports = AmazonBerkeleyObjectsUDFJoin;
