'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const { loadProject } = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const ProjectCostEstimator = require('../../project/cost');
const { displayInfo } = require('../../output/basic');
const ansiEscapes = require('../../output/escapes');
const { handleError } = require('../../output/error');

/**
 * Calculates and displays cost estimates for a Wharfie project.
 * @param {string} path - The path to the Wharfie project root.
 * @param {string} environmentName - The Wharfie project environment to use.
 */
const cost = async (path, environmentName) => {
  displayInfo('Calculating cost estimates for project...');
  const project = await loadProject({ path });
  const environment = loadEnvironment(project, environmentName);
  const costEstimator = new ProjectCostEstimator({ project, environment });

  const cost = await costEstimator.calculateProjectCost();
  process.stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine);

  let output = '';
  output += `${chalk.white('Models:')}\n`;
  const models = cost.filter(
    (c) => c.monthly_cost_estimate > 0 && c.type === 'model'
  );
  const modelTable = new Table({
    head: ['Name', 'Monthly Cost Estimate'],
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
    head: ['Name', 'Monthly Cost Estimate'],
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

const costCommand = new Command('cost')
  .description('Show cost estimates for Wharfie project')
  .argument('[path]', 'The path of the Wharfie project root')
  .option(
    '-e, --environment <environment>',
    'The Wharfie project environment to use'
  )
  .action(async (path, options) => {
    const { environment } = options;
    if (!path) {
      path = process.cwd();
    }
    try {
      await cost(path, environment);
    } catch (err) {
      handleError(err);
    }
  });

module.exports = costCommand;
