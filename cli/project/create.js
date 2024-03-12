const {
  buildProjectCloudformationTemplate,
  getStackName,
} = require('./template');

const CloudFormation = require('../../lambdas/lib/cloudformation');

const cloudformation = new CloudFormation();
/**
 * @typedef CreateProjectOptions
 * @property {import('./typedefs').Project} project -
 * @property {import('./typedefs').Environment} environment -
 */

/**
 *  @param {CreateProjectOptions} options -
 */
async function createProject({ project, environment }) {
  const projectTemplate = await buildProjectCloudformationTemplate(
    project,
    environment
  );
  const stackName = getStackName(project, environment);

  await cloudformation.createStack({
    StackName: stackName,
    Tags: [],
    Parameters: [
      {
        ParameterKey: 'Deployment',
        ParameterValue: process.env.WHARFIE_DEPLOYMENT_NAME,
      },
    ],
    Capabilities: ['CAPABILITY_IAM'],
    TemplateBody: JSON.stringify(projectTemplate),
  });
}

module.exports = createProject;
