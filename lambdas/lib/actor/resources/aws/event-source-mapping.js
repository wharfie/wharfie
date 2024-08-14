'use strict';
const Lambda = require('../../../lambda');
const BaseResource = require('../base-resource');
const { ResourceNotFoundException } = require('@aws-sdk/client-lambda');

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
    const { EventSourceMappings } = await this.lambda.listEventSourceMappings({
      FunctionName: this.get('functionName'),
    });
    const existingMapping = (EventSourceMappings || []).find(
      (mapping) => mapping.EventSourceArn === this.get('eventSourceArn')
    );
    if (!existingMapping) {
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
    } else {
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
    }
  }

  async _destroy() {
    if (!this.get('uuid')) return;
    try {
      await this.lambda.updateEventSourceMapping({
        UUID: this.get('uuid'),
        Enabled: false,
      });
      await this.lambda.deleteEventSourceMapping({
        UUID: this.get('uuid'),
      });
      // this will throw and be caught
      this.waitForEventSourceMappingStatus('DELETED');
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }

  /**
   * @param {string} status -
   */
  async waitForEventSourceMappingStatus(status) {
    let currentStatus = '';
    do {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const { EventSourceMappings } = await this.lambda.listEventSourceMappings(
        {
          FunctionName: this.get('functionName'),
        }
      );
      const existingMapping = (EventSourceMappings || []).find(
        (mapping) => mapping.UUID === this.get('uuid')
      );
      currentStatus = existingMapping?.State || '';
    } while (currentStatus !== status);
  }
}

module.exports = EventSourceMapping;
