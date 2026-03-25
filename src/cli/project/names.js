const { WHARFIE_DEFAULT_ENVIRONMENT } = require('./constants');

/**
 * @param {import('./typedefs').Project} project -
 * @param {import('./typedefs').Environment} environment -
 * @returns {String} -
 */
function getDatabaseName(project, environment) {
  return `${project.name}${
    environment.name === WHARFIE_DEFAULT_ENVIRONMENT
      ? ''
      : `-${environment.name}`
  }`.replace(/-/g, '_');
}

module.exports = {
  getDatabaseName,
};
