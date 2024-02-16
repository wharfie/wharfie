const loadEnvironment = require('./load-environment');
const {
  getStackName,
  buildProjectCloudformationTemplate,
} = require('./template');

const CloudFormation = require('../../lambdas/lib/cloudformation');

const cloudformation = new CloudFormation();
/**
 * @typedef DiffProjectOptions
 * @property {import('./typedefs').Project} project -
 * @property {string} environmentName -
 */

/**
 *  @param {DiffProjectOptions} options -
 *  @returns {Promise<{newProjectTemplate: any, existingProjectTemplate: any}>} -
 */
async function diffProject({ project, environmentName }) {
  const environment = loadEnvironment(project, environmentName);
  const newProjectTemplate = buildProjectCloudformationTemplate(
    project,
    environment
  );
  let existingProjectTemplate;
  try {
    existingProjectTemplate = await cloudformation.getTemplate({
      StackName: getStackName(project, environment),
    });
  } catch (err) {
    if (
      // @ts-ignore
      err.message.includes('does not exist')
    ) {
      existingProjectTemplate = {};
    }
  }
  return {
    newProjectTemplate,
    existingProjectTemplate,
  };
}

module.exports = diffProject;
