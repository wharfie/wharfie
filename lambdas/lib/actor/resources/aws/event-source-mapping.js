import Lambda from '../../../lambda.js';
import BaseResource from '../base-resource.js';
import {
  ResourceNotFoundException,
  ResourceConflictException,
} from '@aws-sdk/client-lambda';

/**
 * @typedef EventSourceMappingProperties
 * @property {string} functionName - functionName.
 * @property {string | function(): string} eventSourceArn - eventSourceArn.
 * @property {number} batchSize - batchSize.
 * @property {number} maximumBatchingWindowInSeconds - maximumBatchingWindowInSeconds.
 * @property {Record<string, string>} [tags] - tags.
 */

/**
 * @typedef EventSourceMappingOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {EventSourceMappingProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class EventSourceMapping extends BaseResource {
  /**
   * @param {EventSourceMappingOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.lambda = new Lambda({});
  }

  async _reconcileTags() {
    const { Tags } = await this.lambda.listTags({
      Resource: this.get('arn'),
    });
    const currentTags = Tags || {};

    const tagsToAdd = Object.entries(this.get('tags') || {}).filter(
      ([key, value]) =>
        !Object.entries(currentTags).some(
          ([tagKey, tagValue]) => tagKey === key && tagValue === value,
        ),
    );
    const tagsToRemove = Object.entries(currentTags).filter(
      ([key, value]) =>
        !Object.entries(this.get('tags', {})).some(
          ([tagKey, tagValue]) => tagKey === key && tagValue === value,
        ),
    );

    if (tagsToAdd.length > 0) {
      await this.lambda.tagResource({
        Resource: this.get('arn'),
        Tags: Object.fromEntries(tagsToAdd),
      });
    }
    if (tagsToRemove.length > 0) {
      await this.lambda.untagResource({
        Resource: this.get('arn'),
        TagKeys: Object.keys(Object.fromEntries(tagsToRemove)),
      });
    }
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
            'maximumBatchingWindowInSeconds',
          ),
        });
        this.set('uuid', UUID);
        this.set(
          'arn',
          `arn:aws:lambda:${this.get('deployment').region}:${
            this.get('deployment').accountId
          }:event-source-mapping:${UUID}`,
        );
        await this.waitForEventSourceMappingStatus('Enabled');
      } catch (error) {
        if (error instanceof ResourceConflictException) {
          const { EventSourceMappings } =
            await this.lambda.listEventSourceMappings({
              FunctionName: this.get('functionName'),
            });
          const existingMapping = (EventSourceMappings || []).find(
            (mapping) => mapping.EventSourceArn === this.get('eventSourceArn'),
          );
          if (existingMapping && existingMapping.UUID) {
            await this.destroyMapping(existingMapping.UUID);
          }
          await this._reconcile();
          return;
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
            'maximumBatchingWindowInSeconds',
          ),
        });
      }
      this.set('uuid', existingMapping.UUID);
      this.set(
        'arn',
        `arn:aws:lambda:${this.get('deployment').region}:${
          this.get('deployment').accountId
        }:event-source-mapping:${existingMapping.UUID}`,
      );
      await this.waitForEventSourceMappingStatus('Enabled');
    }
    await this._reconcileTags();
  }

  async _destroy() {
    if (!this.has('uuid')) return;
    await this.destroyMapping(this.get('uuid'));
  }

  /**
   * @param {string} uuid - uuid.
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
   * @param {string} status - status.
   * @param {string} [uuid] - uuid.
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
              Math.min(MAX_RETRY_TIMEOUT_SECONDS, 1 * Math.pow(2, attempts)),
          ) * 1000,
        ),
      );
      attempts++;
    } while (currentStatus !== status);
  }
}

export default EventSourceMapping;
