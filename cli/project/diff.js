const {
  getStackName,
  buildProjectCloudformationTemplate,
} = require('./template');

const CloudFormation = require('../../lambdas/lib/cloudformation');

const cloudformation = new CloudFormation();
/**
 * @typedef DiffProjectOptions
 * @property {import('./typedefs').Project} project -
 * @property {import('./typedefs').Environment} environment -
 */

/**
 *  @param {DiffProjectOptions} options -
 *  @returns {Promise<{newProjectTemplate: any, existingProjectTemplate: any}>} -
 */
async function diffProject({ project, environment }) {
  const newProjectTemplate = await buildProjectCloudformationTemplate(
    project,
    environment
  );
  let existingProjectTemplate = {};
  try {
    const getTemplateResponse = await cloudformation.getTemplate({
      StackName: getStackName(project, environment),
    });
    existingProjectTemplate = JSON.parse(getTemplateResponse.TemplateBody);
  } catch (err) {
    if (
      // @ts-ignore
      err.message.includes('does not exist')
    ) {
      existingProjectTemplate = {};
    }
    throw err;
  }
  return {
    newProjectTemplate,
    existingProjectTemplate,
  };
}

module.exports = diffProject;
