'use strict';

const configuration = {
  region: process.env.WHARFIE_REGION,
  deployment_name: process.env.WHARFIE_DEPLOYMENT_NAME,
  artifact_bucket: process.env.WHARFIE_ARTIFACT_BUCKET,
};

const check = ({ region, deployment_name, artifact_bucket }) => {
  if (!region) {
    throw new Error(
      'wharfie region not found. Please make sure you set up the cli config correctly (run wharfie config)'
    );
  }
  if (!deployment_name) {
    throw new Error(
      'wharfie service name not found. Please make sure you set up the cli config correctly (run wharfie config)'
    );
  }
  if (!artifact_bucket) {
    throw new Error(
      'artifact bucket not found. Please make sure you set up config the cli correctly (run wharfie config)'
    );
  }
};

module.exports = {
  setConfig: ({ deployment_name, region, artifact_bucket }) => {
    check({ deployment_name, region, artifact_bucket });
    configuration.region = region;
    configuration.deployment_name = deployment_name;
    configuration.artifact_bucket = artifact_bucket;
  },
  clearConfig: () => {
    configuration.region = undefined;
    configuration.deployment_name = undefined;
    configuration.artifact_bucket = undefined;
  },
  getConfig: () => {
    check(configuration);
    return Object.assign({}, configuration);
  },
};
