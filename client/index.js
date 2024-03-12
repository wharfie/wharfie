'use strict';

const { Firehose } = require('./resources/firehose');
const { Role } = require('./resources/role');
const { Resource } = require('./resources/resource');
const { MaterializedView } = require('./resources/materialized-view');
const { UDF } = require('./resources/udf');
const {
  S3BucketEventNotification,
} = require('./resources/s3-bucket-event-notification');
const util = require('./util');

module.exports = {
  Firehose,
  Role,
  Resource,
  MaterializedView,
  UDF,
  S3BucketEventNotification,
  util,
};
