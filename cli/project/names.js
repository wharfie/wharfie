const { WHARFIE_DEFAULT_ENVIRONMENT } = require('./constants');

/**
 * @param {import('./typedefs.js').Project} project -
 * @param {import('./typedefs.js').Environment} environment -
 * @returns {string} -
 */
function getDatabaseName(project, environment) {
  return `${project.name}${
    environment.name === WHARFIE_DEFAULT_ENVIRONMENT
      ? ''
      : `-${environment.name}`
  }`.replace(/-/g, '_');
}

export { getDatabaseName };

module.exports = {
  getDatabaseName,
};
