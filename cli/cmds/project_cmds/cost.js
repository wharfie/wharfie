'use strict';

const loadProject = require('../../project/load');
const loadEnvironment = require('../../project/load-environment');
const ProjectCostEstimator = require('../../project/cost');
const { displayFailure, displayInfo, displaySuccess } = require('../../output');

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
  console.table(
    cost
      .filter((c) => c.monthly_cost_estimate > 0 && c.type === 'model')
      .map((c) => ({
        name: c.name,
        montly_cost_estimate: costEstimator.currencyFormatter.format(
          c.monthly_cost_estimate
        ),
      }))
  );
  console.table(
    cost
      .filter((c) => c.monthly_cost_estimate > 0 && c.type === 'source')
      .map((c) => ({
        name: c.name,
        montly_cost_estimate: costEstimator.currencyFormatter.format(
          c.monthly_cost_estimate
        ),
      }))
  );

  displaySuccess(
    `Total monthly project cost estimate: ${costEstimator.currencyFormatter.format(
      cost.reduce((acc, c) => acc + c.monthly_cost_estimate, 0)
    )}`
  );
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
    displayFailure(err);
  }
};
