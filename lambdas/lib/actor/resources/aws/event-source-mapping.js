'use strict';
const Lambda = require('../../../lambda');
const BaseResource = require('../base-resource');
const {
  ResourceNotFoundException,
  ResourceConflictException,
} = require('@aws-sdk/client-lambda');

/**
 * @typedef EventSourceMappingProperties
 * @property {string} functionName -
 * @property {string | function(): string} eventSourceArn -
 * @property {number} batchSize -
 * @property {number} maximumBatchingWindowInSeconds -
 */

/**
 * @typedef EventSourceMappingOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {EventSourceMappingProperties & import('../../typedefs').SharedProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class EventSourceMapping extends BaseResource {
  /**
   * @param {EventSourceMappingOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
    this.lambda = new Lambda({});
  }

  async _reconcile() {
    const existingMapping = this.has('uuid');
    if (!existingMapping) {
      try {
        const { UUID } = await this.lambda.createEventSourceMapping({
          FunctionName: this.get('functionName'),
          EventSourceArn: this.get('eventSourceArn'),
          BatchSize: this.get('batchSize'),
          Enabled: true,
          MaximumBatchingWindowInSeconds: this.get(
            'maximumBatchingWindowInSeconds'
          ),
        });
        this.set('uuid', UUID);
        await this.waitForEventSourceMappingStatus('Enabled');
      } catch (error) {
        if (error instanceof ResourceConflictException) {
          const { EventSourceMappings } =
            await this.lambda.listEventSourceMappings({
              FunctionName: this.get('functionName'),
            });
          const existingMapping = (EventSourceMappings || []).find(
            (mapping) => mapping.EventSourceArn === this.get('eventSourceArn')
          );
          if (existingMapping && existingMapping.UUID) {
            await this.destroyMapping(existingMapping.UUID);
          }
        }
        throw error;
      }
    } else {
      const existingMapping = await this.lambda.getEventSourceMapping({
        UUID: this.get('uuid'),
      });
      if (
        existingMapping.BatchSize !== this.get('batchSize') ||
        existingMapping.MaximumBatchingWindowInSeconds !==
          this.get('maximumBatchingWindowInSeconds')
      ) {
        await this.lambda.updateEventSourceMapping({
          UUID: existingMapping.UUID,
          BatchSize: this.get('batchSize'),
          Enabled: true,
          MaximumBatchingWindowInSeconds: this.get(
            'maximumBatchingWindowInSeconds'
          ),
        });
      }
      this.set('uuid', existingMapping.UUID);
      await this.waitForEventSourceMappingStatus('Enabled');
    }
  }

  async _destroy() {
    if (!this.has('uuid')) return;
    await this.destroyMapping(this.get('uuid'));
  }

  /**
   * @param {string} uuid -
   */
  async destroyMapping(uuid) {
    try {
      await this.lambda.updateEventSourceMapping({
        UUID: uuid,
        Enabled: false,
      });
      await this.waitForEventSourceMappingStatus('Disabled', uuid);
      await this.lambda.deleteEventSourceMapping({
        UUID: uuid,
      });
      // this will throw and be caught
      await this.waitForEventSourceMappingStatus('DELETED', uuid);
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }

  /**
   * @param {string} status -
   * @param {string} [uuid] -
   */
  async waitForEventSourceMappingStatus(status, uuid = this.get('uuid')) {
    let currentStatus = '';
    let attempts = 0;
    const MAX_RETRY_TIMEOUT_SECONDS = 10;
    do {
      const { State } = await this.lambda.getEventSourceMapping({
        UUID: uuid,
      });
      currentStatus = State || '';
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.floor(
            Math.random() *
              Math.min(MAX_RETRY_TIMEOUT_SECONDS, 1 * Math.pow(2, attempts))
          ) * 1000
        )
      );
      attempts++;
    } while (currentStatus !== status);
  }
}

module.exports = EventSourceMapping;
