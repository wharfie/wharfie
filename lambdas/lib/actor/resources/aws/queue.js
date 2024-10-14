'use strict';
const SQS = require('../../../sqs');
const BaseResource = require('../base-resource');
const { QueueDoesNotExist } = require('@aws-sdk/client-sqs');

/**
 * @typedef QueueProperties
 * @property {string} [visibilityTimeout] -
 * @property {string} [messageRetentionPeriod] -
 * @property {string} [delaySeconds] -
 * @property {string} [receiveMessageWaitTimeSeconds] -
 * @property {any | function(): Promise<any>} [policy] -
 */

/**
 * @typedef QueueOptions
 * @property {string} name -
 * @property {string} [parent] -
 * @property {import('../reconcilable').Status} [status] -
 * @property {QueueProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class Queue extends BaseResource {
  /**
   * @param {QueueOptions} options -
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    const propertiesWithDefaults = Object.assign(
      {
        visibilityTimeout: '300',
        messageRetentionPeriod: `1209600`,
        delaySeconds: `0`,
        receiveMessageWaitTimeSeconds: `0`,
      },
      properties
    );
    super({
      name,
      parent,
      status,
      properties: propertiesWithDefaults,
      dependsOn,
    });
    this.sqs = new SQS({});
  }

  async _reconcile() {
    try {
      const { QueueUrl } = await this.sqs.getQueueUrl({
        QueueName: this.name,
      });
      const { Attributes } = await this.sqs.getQueueAttributes({
        QueueUrl,
        AttributeNames: ['All'],
      });
      this.set('url', QueueUrl);
      this.set('arn', Attributes?.QueueArn);
      if (
        (this.has('policy') && Attributes?.Policy !== this.get('policy')) ||
        Attributes?.VisibilityTimeout !== this.get('visibilityTimeout') ||
        Attributes?.MessageRetentionPeriod !==
          this.get('messageRetentionPeriod') ||
        Attributes?.DelaySeconds !== this.get('delaySeconds') ||
        Attributes?.ReceiveMessageWaitTimeSeconds !==
          this.get('receiveMessageWaitTimeSeconds')
      ) {
        await this.sqs.setQueueAttributes({
          QueueUrl,
          Attributes: {
            VisibilityTimeout: this.get('visibilityTimeout'),
            MessageRetentionPeriod: this.get('messageRetentionPeriod'),
            DelaySeconds: this.get('delaySeconds'),
            ReceiveMessageWaitTimeSeconds: this.get(
              'receiveMessageWaitTimeSeconds'
            ),
            ...(this.has('policy')
              ? { Policy: JSON.stringify(this.get('policy')) }
              : {}),
          },
        });
      }
    } catch (error) {
      if (error instanceof QueueDoesNotExist) {
        const { QueueUrl } = await this.sqs.createQueue({
          QueueName: this.name,
          Attributes: {
            VisibilityTimeout: this.get('visibilityTimeout'),
            MessageRetentionPeriod: this.get('messageRetentionPeriod'),
            DelaySeconds: this.get('delaySeconds'),
            ReceiveMessageWaitTimeSeconds: this.get(
              'receiveMessageWaitTimeSeconds'
            ),
          },
        });
        const { Attributes } = await this.sqs.getQueueAttributes({
          QueueUrl,
          AttributeNames: ['QueueArn'],
        });
        this.set('url', QueueUrl);
        this.set('arn', Attributes?.QueueArn);
        if (this.has('policy')) {
          await this.sqs.setQueueAttributes({
            QueueUrl,
            Attributes: { Policy: JSON.stringify(this.get('policy')) },
          });
        }
      } else {
        throw error;
      }
    }
  }

  async _destroy() {
    try {
      const { QueueUrl } = await this.sqs.getQueueUrl({
        QueueName: this.name,
      });
      await this.sqs.deleteQueue({
        QueueUrl,
      });
    } catch (error) {
      // @ts-ignore
      if (error.name !== 'QueueDoesNotExist') throw error;
    }
  }
}

module.exports = Queue;
