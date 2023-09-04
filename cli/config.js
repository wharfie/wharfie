'use strict';

const configuration = {
  region: process.env.WHARFIE_REGION,
  deployment_name: process.env.WHARFIE_DEPLOYMENT_NAME,
};

const check = ({ region, deployment_name }) => {
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
};

module.exports = {
  setConfig: ({ deployment_name, region }) => {
    check({ deployment_name, region });
    configuration.region = region;
    configuration.deployment_name = deployment_name;
  },
  clearConfig: () => {
    configuration.region = undefined;
    configuration.deployment_name = undefined;
  },
  getConfig: () => {
    check(configuration);
    return Object.assign({}, configuration);
  },
  setEnvironment: () => {
    check(configuration);
    process.env.WHARFIE_REGION = configuration.region;
    process.env.WHARFIE_DEPLOYMENT_NAME = configuration.deployment_name;
    process.env.AWS_REGION = configuration.region;
    process.env.RESOURCE_TABLE = configuration.deployment_name;
  },
};
