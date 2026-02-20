/**
 * @returns {import('../../lambdas/lib/actor/typedefs').DeploymentEnvironmentProperties} - mock deployment propertie
 */
function getMockDeploymentProperties() {
  return {
    name: 'test-deployment',
    accountId: '123456789012',
    region: 'us-east-1',
    envPaths: {
      data: '',
      config: '',
      cache: '',
      log: '',
      temp: '',
    },
    version: '0.0.1test',
    stateTable: '_testing_state_table',
  };
}

module.exports = {
  getMockDeploymentProperties,
};
