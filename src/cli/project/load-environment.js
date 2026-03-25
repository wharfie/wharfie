const { WHARFIE_DEFAULT_ENVIRONMENT } = require('./constants');

/**
 * @param {import('./typedefs').Project} project -
 * @param {string} environmentName -
 * @returns {import('./typedefs').Environment} -
 */
function loadEnvironment(project, environmentName) {
  if (!environmentName) {
    environmentName = WHARFIE_DEFAULT_ENVIRONMENT;
  }
  const activeEnvironment = project.environments.filter(
    (env) => env.name === environmentName,
  )[0];
  if (!activeEnvironment) {
    if (activeEnvironment === WHARFIE_DEFAULT_ENVIRONMENT) {
      throw new Error(`environment file wharfie.yaml not found`);
    }
    throw new Error(`environment ${environmentName} not found`);
  }
  return activeEnvironment;
}

module.exports = loadEnvironment;
