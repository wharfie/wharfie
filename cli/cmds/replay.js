'use strict';

const {
  displaySuccess,
  displayFailure,
  displayInstruction,
} = require('../output');
const SQS = require('../../lambdas/lib/sqs');
const STS = require('../../lambdas/lib/sts');
const sqs = new SQS();
const sts = new STS();

const queues = (queue, region, deployment_name, account_id) => {
  switch (queue) {
    case 'daemon':
      return {
        dlqURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-Daemon-dead-letter`,
        queueURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-Daemon-queue`,
      };
    case 'daemon-resource':
      return {
        dlqURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-Daemon-resource-dead-letter`,
        queueURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-Daemon-queue`,
      };
    case 'monitor':
      return {
        dlqURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-monitor-dead-letter`,
        queueURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-monitor-queue`,
      };
    case 'monitor-resource':
      return {
        dlqURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-monitor-resource-dead-letter`,
        queueURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-monitor-queue`,
      };
    case 'events':
      return {
        dlqURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-events-dead-letter`,
        queueURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-events-queue`,
      };
    case 'cleanup':
      return {
        dlqURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-cleanup-dead-letter`,
        queueURL: `https://sqs.${region}.amazonaws.com/${account_id}/${deployment_name}-cleanup-queue`,
      };
    default:
      throw new Error('Queue does not exist');
  }
};

const replay = async (queue, purge) => {
  const { Account } = await sts.getCallerIdentity();

  const { dlqURL, queueURL } = queues(
    queue,
    process.env.WHARFIE_REGION,
    process.env.WHARFIE_DEPLOYMENT_NAME,
    Account
  );

  let message_send_count = 0;
  let messages_purged_count = 0;

  const replayed_messages = new Set();

  const replayer = async () => {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const dlqMessages = await sqs.receiveMessage({
        QueueUrl: dlqURL,
        MaxNumberOfMessages: 10,
      });
      if (!dlqMessages.Messages || dlqMessages.Messages.length === 0) {
        return;
      }
      const sendMessageEntries = dlqMessages.Messages.reduce((acc, msg) => {
        if (replayed_messages.has(msg.MessageID) || !purge) {
          const result = {
            Id: msg.MessageId,
            MessageBody: msg.Body,
          };
          replayed_messages.add(msg.MessageId);
          return acc.concat(result);
        } else {
          messages_purged_count = messages_purged_count + 1;
        }
        return acc;
      }, []);
      if (sendMessageEntries.length > 0)
        await sqs.sendMessageBatch({
          Entries: sendMessageEntries,
          QueueUrl: queueURL,
        });
      message_send_count = message_send_count + dlqMessages.Messages.length;
      const deleteMessageEntries = dlqMessages.Messages.map((msg) => {
        return {
          Id: msg.MessageId,
          ReceiptHandle: msg.ReceiptHandle,
        };
      });
      await sqs.deleteMessageBatch({
        Entries: deleteMessageEntries,
        QueueUrl: dlqURL,
      });
    }
  };

  await Promise.all(Array.from({ length: 30 }, () => replayer()));

  displaySuccess(`${message_send_count} messages replayed`);
  if (purge) displaySuccess(`${messages_purged_count} messages purged`);
};

exports.command = 'replay [queue]';
exports.builder = (yargs) => {
  yargs
    .positional('queue', {
      type: 'string',
      describe: 'replays a dlq',
      demand: 'Please provide a queue to replay',
      choices: [
        'daemon',
        'daemon-resource',
        'monitor',
        'monitor-resource',
        'events',
        'cleanup',
      ],
    })
    .option('purge', {
      alias: 'p',
      type: 'boolean',
      describe: 'pruged replayed messages that end up back in the dlq',
    });
};
exports.desc = 'replay dlq';
exports.handler = async function ({ queue, purge }) {
  if (!queue) {
    displayInstruction("Param 'queue' Missing 🙁");
    return;
  }
  try {
    await replay(queue, purge);
  } catch (err) {
    displayFailure(err);
  }
};
