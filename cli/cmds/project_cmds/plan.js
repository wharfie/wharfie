'use strict';

const diffProject = require('../../project/diff');
const loadProject = require('../../project/load');
const { displayFailure, displayInfo } = require('../../output');

const plan = async (path, environmentName) => {
  displayInfo(`showing changes to project...`);
  const project = await loadProject({
    path,
  });
  const { newProjectTemplate, existingProjectTemplate } = await diffProject({
    project,
    environmentName,
  });
  // TODO: diff the templates
  console.log(newProjectTemplate);
  console.log(existingProjectTemplate);
};

exports.command = 'plan [path] [environment]';
exports.desc = 'plan changes to wharfie project';
exports.builder = (yargs) => {
  yargs
    .positional('path', {
      type: 'string',
      describe: 'the path of the wharfie project root',
      optional: true,
    })
    .option('environment', {
      alias: 'e',
      type: 'string',
      describe: 'the wharfie project environment to use',
    });
};
exports.handler = async function ({ path, environment }) {
  if (!path) {
    path = process.cwd();
  }
  try {
    await plan(path, environment);
  } catch (err) {
    console.error(err);
    displayFailure(err);
  }
};
