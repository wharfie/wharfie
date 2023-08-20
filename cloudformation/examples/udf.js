'use strict';

const wharfie = require('../../client/');

const udf = new wharfie.UDF({
  LogicalName: 'UDFLambda',
  WharfieDeployment: wharfie.util.ref('Deployment'),
  Handler: 'udf_function.handler',
  Code: {
    S3Bucket: wharfie.util.ref('ArtifactBucket'),
    S3Key: wharfie.util.sub('wharfie/udf/udf_test/${GitSha}.zip'),
  },
});

module.exports = wharfie.util.merge(udf);
