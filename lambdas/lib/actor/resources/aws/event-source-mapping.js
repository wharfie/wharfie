'use strict';
const Lambda = require('../../../lambda');
const BaseResource = require('../base-resource');

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
 * @property {EventSourceMappingProperties & import('../../typedefs').SharedDeploymentProperties} properties -
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
          MaximumBatchingWindowInSeconds: this.get(
            'maximumBatchingWindowInSeconds'
          ),
        });
      }
      this.set('uuid', existingMapping.UUID);
    }
  }

  async _destroy() {
    const { EventSourceMappings } = await this.lambda.listEventSourceMappings({
      FunctionName: this.get('functionName'),
    });
    const existingMapping = (EventSourceMappings || []).find(
      (mapping) => mapping.EventSourceArn === this.get('eventSourceArn')
    );
    if (existingMapping) {
      try {
        await this.lambda.deleteEventSourceMapping({
          UUID: existingMapping.UUID,
        });
      } catch (error) {
        // @ts-ignore
        if (error.name !== 'ResourceNotFoundException') throw error;
      }
    }
  }
}

module.exports = EventSourceMapping;
