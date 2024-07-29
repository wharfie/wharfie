const AthenaWorkGroup = require('./athena-workgroup');
const AutoscalingPolicy = require('./autoscaling-policy');
const AutoscalingTable = require('./autoscaling-table');
const AutoscalingTarget = require('./autoscaling-target');
const Bucket = require('./bucket');
const EventSourceMapping = require('./event-source-mapping');
const EventsRule = require('./events-rule');
const Firehose = require('./firehose');
const GlueDatabase = require('./glue-database');
const GlueTable = require('./glue-table');
const LambdaFunction = require('./lambda-function');
const LambdaBuild = require('./lambda-build');
const Policy = require('./policy');
const Queue = require('./queue');
const Role = require('./role');
const Table = require('./table');
const TableRecord = require('./table-record');
const BucketNotificationConfiguration = require('./bucket-notification-configuration');

module.exports = {
  AthenaWorkGroup,
  AutoscalingPolicy,
  AutoscalingTable,
  AutoscalingTarget,
  Bucket,
  EventSourceMapping,
  EventsRule,
  Firehose,
  GlueDatabase,
  GlueTable,
  LambdaFunction,
  LambdaBuild,
  Policy,
  Queue,
  Role,
  Table,
  TableRecord,
  BucketNotificationConfiguration,
};
