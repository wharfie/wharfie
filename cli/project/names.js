import { WHARFIE_DEFAULT_ENVIRONMENT } from './constants.js';

/**
 * @param {import('./typedefs.js').Project} project -
 * @param {import('./typedefs.js').Environment} environment -
 * @returns {string} -
 */
export function getDatabaseName(project, environment) {
  return `${project.name}${
    environment.name === WHARFIE_DEFAULT_ENVIRONMENT
      ? ''
      : `-${environment.name}`
  }`.replace(/-/g, '_');
}
