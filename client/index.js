'use strict';

const { Firehose } = require('./resources/firehose');
const { Role } = require('./resources/role');
const { Resource } = require('./resources/resource');
const { MaterializedView } = require('./resources/materialized-view');
const { UDF } = require('./resources/udf');
const util = require('./util');

module.exports = {
  Firehose,
  Role,
  Resource,
  MaterializedView,
  UDF,
  util,
};
