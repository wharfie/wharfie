'use strict';
const cloudfront = require('./cloudfront');
const cloudtrail = require('./cloudtrail');
const csv = require('./csv');
const json = require('./json');
const orc = require('./orc');
const parquet = require('./parquet');
const s3 = require('./s3');

module.exports = (params) => {
  switch (params.Format) {
    case 'cloudfront':
      return cloudfront(params);
    case 'cloudtrail':
      return cloudtrail(params);
    case 's3':
      return s3(params);
    case 'csv':
      return csv(params);
    case 'json':
      return json(params);
    case 'orc':
      return orc(params);
    case 'parquet':
      return parquet(params);
    default:
      throw new Error(`No format of type ${params.Format}`);
  }
};
