'use strict';

const Lambda = require('./lambda');
const QueueLambda = require('./queue-lambda');
const Role = require('./role');
const s3Bucket = require('./s3-bucket');
const ServiceRole = require('./service-role');

module.exports = {
  Lambda,
  QueueLambda,
  Role,
  ServiceRole,
  s3Bucket,
};
