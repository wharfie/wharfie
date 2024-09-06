'use strict';

require('./config');
const bluebirdPromise = require('bluebird');

const logging = require('./lib/logging/');
const daemon_log = logging.getDaemonLogger();

const maintain = require('./operations/maintain/');
const backfill = require('./operations/backfill/');
const s3_event = require('./operations/s3_event/');
const migrate = require('./operations/migrate/');
const query = require('./operations/query/');
const SQS = require('./lib/sqs');
const SNS = require('./lib/sns');
const STS = require('./lib/sts');
const resource_db = require('./lib/dynamo/operations');
const { getResource } = require('./migrations/');

const response = require('./lib/cloudformation/cfn-response');
const { getImmutableID } = require('./lib/cloudformation/id');
const { createId } = require('./lib/id');
const { Action, Operation } = require('./lib/graph/');

const sqs = new SQS({ region: process.env.AWS_REGION });

const QUEUE_URL = process.env.DAEMON_QUEUE_URL || '';
const DLQ_URL = process.env.DLQ_URL || '';
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 7);

/**
 * @param {import('./typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {import('./lib/graph/').Resource} resource -
 * @param {Operation?} operation -
 * @returns {Promise<import('./typedefs').ActionProcessingOutput>} -
 */
async function daemonRouter(event, context, resource, operation) {
  // START SPECIAL CASE
  if (event.action_type === Action.Type.START) {
    switch (event.operation_type) {
      case Operation.Type.MAINTAIN:
        return await maintain.start(event, context, resource);
      case Operation.Type.BACKFILL:
        return await backfill.start(event, context, resource);
      case Operation.Type.S3_EVENT:
        return await s3_event.start(event, context, resource);
      case Operation.Type.MIGRATE:
        return await migrate.start(event, context, resource);
      default:
        throw new Error(`Invalid Operation, must be one of ${Operation.Type}`);
    }
  }
  if (!operation)
    throw new Error(`No operation found for event: ${JSON.stringify(event)}`);
  // FINISH SPECIAL CASE
  if (event.action_type === Action.Type.FINISH) {
    switch (event.operation_type) {
      case Operation.Type.MAINTAIN:
        return await maintain.finish(event, context, resource, operation);
      case Operation.Type.BACKFILL:
        return await backfill.finish(event, context, resource, operation);
      case Operation.Type.S3_EVENT:
        return await s3_event.finish(event, context, resource, operation);
      case Operation.Type.MIGRATE:
        return await migrate.finish(event, context, resource, operation);
      default:
        throw new Error(`Invalid Operation, must be one of ${Operation.Type}`);
    }
  }

  // OPERATION:ACTION ROUTING
  switch (event.operation_type) {
    case Operation.Type.MAINTAIN:
      return await maintain.route(event, context, resource, operation);
    case Operation.Type.BACKFILL:
      return await backfill.route(event, context, resource, operation);
    case Operation.Type.S3_EVENT:
      return await s3_event.route(event, context, resource, operation);
    case Operation.Type.MIGRATE:
      return await migrate.route(event, context, resource, operation);
    default:
      throw new Error(`Invalid Operation, must be one of ${Operation.Type}`);
  }
}

/**
 * @param {import('./typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
async function daemon(event, context) {
  const resource = await getResource(event, context);
  if (!resource) {
    daemon_log.warn('resource unexpectedly missing, maybe it was deleted?');
    return;
  }

  if (!event.operation_id) event.operation_id = createId();
  if (!event.action_id) event.action_id = createId();
  const event_log = logging.getEventLogger(event, context);
  // _operation will be null when the action is START
  const _operation = await resource_db.getOperation(
    resource.id,
    event.operation_id
  );

  // CHECK THAT ACTION DEPENDENCIES ARE MET
  // START action has no prerequisites and will not have _operation defined
  if (_operation && event.action_type !== 'START') {
    event_log.debug('checking action prerequisites...');
    if (
      !(await resource_db.checkActionPrerequisites(
        _operation,
        event.action_type,
        event_log
      ))
    ) {
      event_log.info(
        `action ${event.operation_type}:${event.action_type} prerequisites not met, reenqueueing`
      );
      await sqs.reenqueue(event, QUEUE_URL);
      return;
    }
  }
  if (!_operation && event.action_type !== 'START') {
    // operation was deleted, warn and return
    event_log.warn(
      `operation ${event.operation_type} unexpectedly missing, maybe it was deleted?`
    );
    return;
  }
  event_log.info(
    `running action ${event.operation_type}:${event.action_type}....`
  );

  const action_output = await daemonRouter(
    event,
    context,
    resource,
    _operation
  );

  const action = await resource_db.getAction(
    resource.id,
    event.operation_id,
    event.action_id
  );
  if (!action) throw new Error('action missing unexpectedly');
  const operation = await resource_db.getOperation(
    resource.id,
    event.operation_id
  );
  if (!operation) throw new Error('operation missing unexpectedly');

  action.status = action_output.status;
  await resource_db.putAction(action);

  if (action_output.status === 'COMPLETED') {
    event_log.info(
      `action ${event.operation_type}:${event.action_type} completed, equeueing next actions`
    );
    // START NEXT ACTIONS
    const current_action = action;
    const next_action_ids =
      operation.getDownstreamActionIds(current_action.id) || [];
    await Promise.all(
      next_action_ids.map(async (action_id) => {
        if (
          !(await resource_db.checkActionPrerequisites(
            operation,
            current_action.type,
            event_log,
            false
          ))
        )
          return Promise.resolve();
        const updated_status = resource_db.updateActionStatus(
          new Action({
            id: action_id,
            resource_id: resource.id,
            operation_id: operation.id,
            type: operation.getActionTypeById(action_id),
          }),
          Action.Status.RUNNING
        );
        if (!updated_status) {
          // status already in RUNNING state, caused by action graph with reduce pattern
          return Promise.resolve();
        }
        await sqs.enqueue(
          {
            operation_id: operation.id,
            operation_type: operation.type,
            action_id,
            action_type: operation.getActionTypeById(action_id),
            resource_id: resource.id,
            retries: 0,
            action_inputs: action_output.nextActionInputs || {},
          },
          QUEUE_URL
        );
      })
    );
    if (
      next_action_ids.length === 0 &&
      operation.status === Operation.Status.COMPLETED
    ) {
      event_log.info(
        `operation ${event.operation_type} completed, cleaning up...`
      );
      await resource_db.deleteOperation(operation);
    }
  }
}

/**
 * @param {import('./typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {any} err -
 */
async function DLQ(event, context, err) {
  const operation = await resource_db.getOperation(
    event.resource_id,
    event.operation_id || ''
  );
  if (!operation) {
    daemon_log.warn(
      'properties unexpectedly missing, maybe the operation was deleted?'
    );
    return;
  }

  const resource = await getResource(event, context);
  if (!resource || !event.action_id) {
    daemon_log.warn(
      'properties unexpectedly missing, maybe the resource was deleted?'
    );
    return;
  }

  const event_log = logging.getEventLogger(event, context);

  if (operation.type === Operation.Type.MIGRATE) {
    event_log.error(
      `Migration action has expended its retries, marking update as failure and rolling back`,
      {
        ...event,
      }
    );
    await response(err, operation.operation_inputs.cloudformation_event, {
      id: getImmutableID(operation.operation_inputs.cloudformation_event),
    });
    return;
  }
  event_log.error(`Record has expended its retries, sending to DLQ`, {
    ...event,
  });

  const action = await resource_db.getAction(
    event.resource_id,
    event.operation_id || '',
    event.action_id
  );
  if (!action) {
    event_log.warn(
      'properties unexpectedly missing, maybe the action was deleted?'
    );
    return;
  }
  action.status = Action.Status.FAILED;

  await sqs.sendMessage({
    MessageBody: JSON.stringify(event),
    QueueUrl: DLQ_URL,
  });
  await resource_db.putAction(action);

  if (
    !resource.daemon_config.AlarmActions ||
    resource.daemon_config.AlarmActions.length === 0
  )
    return;

  const region = resource.region;
  const sts = new STS({ region });
  const credentials = await sts.getCredentials(resource.daemon_config.Role);
  const sns = new SNS({ region, credentials });
  await Promise.all(
    resource.daemon_config.AlarmActions.map((action) =>
      sns.publish({
        TopicArn: action,
        Message: JSON.stringify({
          AlarmName: 'Wharfie Failure',
          AlarmDescription: `Processing Failed with error: ${err}`,
        }),
      })
    )
  );
}

/**
 * @param {import('./typedefs').WharfieEvent} event -
 * @param {import('aws-lambda').Context} context -
 * @param {any} err -
 */
async function retry(event, context, err) {
  if ((event.retries || 0) >= MAX_RETRIES) {
    try {
      await DLQ(event, context, err);
    } catch (err) {
      // @ts-ignore
      daemon_log.error(`Failed to DLQ event ${err.stack || err}`, { ...event });
    }
    return;
  }
  await sqs.sendMessage({
    MessageBody: JSON.stringify(
      Object.assign(event, {
        retries: (event.retries || 0) + 1,
      })
    ),
    // full-jitter exp backoff (0 - 180 seconds)
    DelaySeconds: Math.floor(
      Math.random() * Math.min(180, 1 * Math.pow(2, event.retries || 0))
    ),
    QueueUrl: QUEUE_URL,
  });
}

/**
 * @param {import('aws-lambda').SQSRecord} record -
 * @param {import('aws-lambda').Context} context -
 */
async function processRecord(record, context) {
  /** @type {import('./typedefs').WharfieEvent} */
  const event = JSON.parse(record.body);

  try {
    if (event.query_id) {
      await query.run(event, context);
    } else {
      await daemon(event, context);
    }
  } catch (err) {
    const event_log = logging.getEventLogger(event, context);
    event_log.error(
      `daemon caught error ${
        // @ts-ignore
        err.stack || err
      }, retrying Record: ${JSON.stringify(event)}`
    );
    await retry(event, context, err);
  }
}

/**
 * @param {import('aws-lambda').SQSEvent} event -
 * @param {import('aws-lambda').Context} context -
 */
module.exports.handler = async (event, context) => {
  daemon_log.debug(`processing ${event.Records.length} records....`);
  await bluebirdPromise.map(
    event.Records,
    (/** @type {import('aws-lambda').SQSRecord} */ record) => {
      return processRecord(record, context);
    },
    { concurrency: 4 }
  );
  daemon_log.info(process.memoryUsage());
  await logging.flush();
};
