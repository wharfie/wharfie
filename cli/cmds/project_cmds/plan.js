'use strict';

const diffProject = require('../../project/diff');
const loadProject = require('../../project/load');
const { displayFailure, displayInfo } = require('../../output');
const Diff = require('diff');
const chalk = require('chalk');

const plan = async (path, environmentName) => {
  displayInfo(`showing changes to project...`);
  const project = await loadProject({
    path,
  });
  const { newProjectTemplate, existingProjectTemplate } = await diffProject({
    project,
    environmentName,
  });
  // TODO: this isn't very intuitive
  const diff = Diff.diffJson(newProjectTemplate, existingProjectTemplate);
  diff.forEach((part) => {
    // green for additions, red for deletions
    if (part.added) {
      console.log(chalk.green(part.value));
    }
    if (part.removed) {
      console.log(chalk.red(part.value));
    }
  });
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
    console.error(err);
    displayFailure(err);
  }
};
