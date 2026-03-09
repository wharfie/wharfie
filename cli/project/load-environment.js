import { WHARFIE_DEFAULT_ENVIRONMENT } from './constants.js';

/**
 * @param {import('./typedefs.js').Project} project -
 * @param {string} environmentName -
 * @returns {import('./typedefs.js').Environment} -
 */
export default function loadEnvironment(project, environmentName) {
  if (!environmentName) {
    environmentName = WHARFIE_DEFAULT_ENVIRONMENT;
  }
  const activeEnvironment = project.environments.filter(
    (env) => env.name === environmentName,
  )[0];
  if (!activeEnvironment) {
    if (environmentName === WHARFIE_DEFAULT_ENVIRONMENT) {
      throw new Error(`environment file wharfie.yaml not found`);
    }
    throw new Error(`environment ${environmentName} not found`);
  }
  return activeEnvironment;
}
