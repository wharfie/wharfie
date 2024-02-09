'use strict';

const path = require('path');
const { readFileSync } = require('fs');
const wharfie = require('../../client');

const Columns = [
  { Name: 'item_id', Type: 'string' },
  { Name: 'marketplace', Type: 'string' },
  { Name: 'path', Type: 'string' },
];

const AmazonBerkeleyObjectsJoin = new wharfie.MaterializedView({
  LogicalName: 'AmazonBerkeleyObjectsJoin',
  DatabaseName: wharfie.util.ref('Database'),
  TableName: 'amazon_berkeley_objects_join',
  WharfieDeployment: wharfie.util.ref('Deployment'),
  Description: 'Materialized Table',
  Columns,
  OriginalSql: readFileSync(path.join(__dirname, 'abo-join.sql'), 'utf8'),
  SqlVariables: { wharfie_db: wharfie.util.ref('Database') },
  CompactedConfig: {
    Location: wharfie.util.sub('s3://${Bucket}/AmazonBerkelyObjectsJoin/'),
  },
  DaemonConfig: {
    Role: wharfie.util.getAtt('WharfieExamplesRole', 'Arn'),
  },
});

module.exports = AmazonBerkeleyObjectsJoin;
