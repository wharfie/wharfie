'use strict';

const { Firehose } = require('./firehose');
const { Role } = require('./role');
const { Resource } = require('./resource');
const { MaterializedView } = require('./materialized-view');
const { UDF } = require('./udf');
const util = require('./util');

module.exports = {
  Firehose,
  Role,
  Resource,
  MaterializedView,
  UDF,
  util,
};
