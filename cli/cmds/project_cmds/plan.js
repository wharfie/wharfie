'use strict';

const diffProject = require('../../project/diff');
const { loadProject } = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const { displayFailure, displayInfo } = require('../../output');
const Diff = require('diff');
const chalk = require('chalk');

const plan = async (path, environmentName) => {
  displayInfo(`showing changes to project...`);
  const project = await loadProject({
    path,
  });
  const environment = loadEnvironment(project, environmentName);
  const { newProjectTemplate, existingProjectTemplate } = await diffProject({
    project,
    environment,
  });
  // TODO: this isn't very intuitive
  const diff = Diff.diffJson(existingProjectTemplate, newProjectTemplate);
  let additions = 0;
  let deletions = 0;
  diff.forEach((part) => {
    // green for additions, red for deletions
    if (part.added) {
      console.log(chalk.green(part.value));
      additions++;
    }
    if (part.removed) {
      console.log(chalk.red(part.value));
      deletions++;
    }
  });
  displayInfo(`A total of ${additions + deletions} changes will be made.`);
};

exports.command = 'plan [path]';
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
    displayFailure(err);
  }
};
