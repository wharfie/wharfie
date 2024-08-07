'use strict';

const ansiEscapes = require('ansi-escapes');
const chalk = require('chalk');
const Table = require('cli-table3');

const { loadProject } = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const ProjectCostEstimator = require('../../project/cost');
const { displayFailure, displayInfo } = require('../../output/');

const {
  displayValidationError,
  isValidationError,
} = require('../../output/validation-error');

const cost = async (path, environmentName) => {
  displayInfo(`calculating cost estimates for project...`);
  const project = await loadProject({
    path,
  });
  const environment = loadEnvironment(project, environmentName);
  const costEstimator = new ProjectCostEstimator({
    project,
    environment,
  });

  const cost = await costEstimator.calculateProjectCost();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);

  let output = '';
  output += `${chalk.white('Models:')}\n`;
  const models = cost.filter(
    (c) => c.monthly_cost_estimate > 0 && c.type === 'model'
  );
  const modelTable = new Table({
    head: ['Name', 'Monthy Cost Estimate'],
    style: { head: [] },
  });
  models.forEach((model) => {
    modelTable.push([
      model.name,
      chalk.green(
        costEstimator.currencyFormatter.format(model.monthly_cost_estimate)
      ),
    ]);
  });
  output += `${modelTable.toString()}\n`;

  output += `${chalk.white('Sources:')}\n`;
  const sources = cost.filter(
    (c) => c.monthly_cost_estimate > 0 && c.type === 'source'
  );
  const sourceTable = new Table({
    head: ['Name', 'Monthy Cost Estimate'],
    style: { head: [] },
  });
  sources.forEach((model) => {
    sourceTable.push([
      model.name,
      chalk.green(
        costEstimator.currencyFormatter.format(model.monthly_cost_estimate)
      ),
    ]);
  });
  output += `${sourceTable.toString()}\n`;
  output += `${chalk.white.bold(
    'Total monthly project cost estimate:'
  )} ${chalk.green.bold(
    costEstimator.currencyFormatter.format(
      cost.reduce((acc, c) => acc + c.monthly_cost_estimate, 0)
    )
  )}`;
  console.log(output);
};

exports.command = 'cost [path]';
exports.desc = 'show cost estimates for wharfie project';
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
    await cost(path, environment);
  } catch (err) {
    if (isValidationError(err)) {
      displayValidationError(err);
    } else {
      displayFailure(err);
    }
  }
};
