'use strict';

const { parse } = require('@sandfox/arn');

const templateGenerator = require('./lib/template-generator');
const { getImmutableID } = require('../../lib/cloudformation/id');
const CloudFormation = require('../../lib/cloudformation');
const validation = require('./lib/validation');

/**
 * @param {import('../../typedefs').CloudformationUpdateEvent} event -
 * @returns {Promise<import('../../typedefs').ResourceRouterResponse>} -
 */
async function update(event) {
  const {
    StackId,
    ResourceProperties: { Tags },
  } = event;
  const { region } = parse(StackId);
  const cloudformation = new CloudFormation({ region });
  const StackName = `WharfieUDF-${getImmutableID(event)}`;

  event = validation.update(event);
  const template = templateGenerator.WharfieUDF(event);

  await cloudformation.updateStack({
    StackName,
    Tags,
    TemplateBody: JSON.stringify(template),
    Capabilities: ['CAPABILITY_IAM'],
  });
  return {
    respond: true,
  };
}

module.exports = update;
