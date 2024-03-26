'use strict';

const {
  displaySuccess,
  displayFailure,
  displayInstruction,
} = require('../../output');
const SQS = require('../../../lambdas/lib/sqs');
const STS = require('../../../lambdas/lib/sts');
const { createId } = require('../../../lambdas/lib/id');
const { getAllResources } = require('../../../lambdas/lib/dynamo/resource');
const sqs = new SQS();
const sts = new STS();

const backfill = async (resource_id, start, end) => {
  const { Account } = await sts.getCallerIdentity();

  const operation_start = start > end ? start : end;

  const difference = Math.abs(parseInt((start - end) / (1000 * 60)));

  await sqs.enqueue(
    {
      operation_type: 'BACKFILL',
      action_type: 'START',
      resource_id,
      action_inputs: {
        Version: `cli-${createId()}`,
        Duration: difference,
      },
      operation_started_at: new Date(operation_start).toISOString(),
    },
    0,
    `https://sqs.${process.env.WHARFIE_REGION}.amazonaws.com/${Account}/${process.env.WHARFIE_DEPLOYMENT_NAME}-Daemon-queue`
  );

  displaySuccess(`backfill started for ${resource_id}`);
};

const backfill_all = async (start, end) => {
  const resources = await getAllResources();
  while (resources.length > 0) {
    const resource_chunk = resources.splice(0, 10);
    await Promise.all(
      resource_chunk.map((resource) => {
        return backfill(resource.resource_id, start, end);
      })
    );
  }
};

exports.command = 'backfill [resource_id] [start] [end]';
exports.desc = 'start a backfill operation';
exports.builder = (yargs) => {
  yargs
    .positional('resource_id', {
      type: 'string',
      describe: 'the wharfie resource id',
      demand: 'Please provide a resource id',
    })
    .positional('start', {
      type: 'string',
      describe: 'start of backfill time range',
      demand: 'Please provide a start time',
    })
    .positional('end', {
      type: 'string',
      describe: 'end of backfill time range',
      demand: 'Please provide a end time',
    })
    .option('all', {
      alias: 'a',
      type: 'boolean',
      describe: 'DANGER! runs backfill for all wharfie resources',
    })
    .coerce({
      start: Date.parse,
      end: Date.parse,
    });
};
exports.handler = async function ({ resource_id, start, end, all }) {
  if (!resource_id && !all) {
    displayInstruction("Param 'resource_id' Missing 🙁");
    return;
  }
  if (!start) {
    displayInstruction("Param 'start' Missing 🙁");
    return;
  }
  if (!end) {
    displayInstruction("Param 'end' Missing 🙁");
    return;
  }
  try {
    if (all) {
      await backfill_all(start, end);
    } else {
      await backfill(resource_id, start, end);
    }
  } catch (err) {
    displayFailure(err);
  }
};
