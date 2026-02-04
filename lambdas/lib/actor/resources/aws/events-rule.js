import CloudWatchEvents from '../../../cloudwatch-events.js';
import BaseResource from '../base-resource.js';
import {
  ResourceNotFoundException,
  RuleState,
} from '@aws-sdk/client-cloudwatch-events';
import { NoSuchBucket } from '@aws-sdk/client-s3';

/**
 * @typedef EventsRuleProperties
 * @property {string} description - description.
 * @property {string} [scheduleExpression] - scheduleExpression.
 * @property {string} [eventPattern] - eventPattern.
 * @property {string | function} [roleArn] - roleArn.
 * @property {import('@aws-sdk/client-cloudwatch-events').RuleState} state - state.
 * @property {import('@aws-sdk/client-cloudwatch-events').Target[] | function(): import('@aws-sdk/client-cloudwatch-events').Target[]} targets - targets.
 * @property {import('@aws-sdk/client-cloudwatch-events').Tag[]} [tags] - tags.
 */

/**
 * @typedef EventsRuleOptions
 * @property {string} name - name.
 * @property {string} [parent] - parent.
 * @property {import('../reconcilable.js').default.Status} [status] - status.
 * @property {EventsRuleProperties & import('../../typedefs.js').SharedProperties} properties - properties.
 * @property {import('../reconcilable.js').default[]} [dependsOn] - dependsOn.
 */

class EventsRule extends BaseResource {
  /**
   * @param {EventsRuleOptions} options - options.
   */
  constructor({ name, parent, status, properties, dependsOn = [] }) {
    super({ name, parent, status, properties, dependsOn });
    this.cloudwatchEvents = new CloudWatchEvents({});
  }

  async _reconcileTargets() {
    const { Targets } = await this.cloudwatchEvents.listTargetsByRule({
      Rule: this.name,
      Limit: 10,
    });

    /**
     * @type {import('@aws-sdk/client-cloudwatch-events').Target[]}
     */
    const targetsToAdd = [];
    /**
     * @type {import('@aws-sdk/client-cloudwatch-events').Target[]}
     */
    const targetsToRemove = [];
    /**
     * @type {import('@aws-sdk/client-cloudwatch-events').Target[]}
     */
    const desiredTargets = this.get('targets');

    desiredTargets.forEach((target) => {
      if (!Targets?.some((t) => t.Id === target.Id)) {
        targetsToAdd.push(target);
      }
    });
    Targets?.forEach((target) => {
      if (!desiredTargets.some((t) => t.Id === target.Id)) {
        targetsToRemove.push(target);
      }
    });

    /**
     * @type {string[]}
     */
    const targetsIdsToRemove = targetsToRemove
      .filter((target) => target?.Id)
      .map((target) => target?.Id || '');

    await Promise.all([
      targetsToAdd.length > 0
        ? this.cloudwatchEvents.putTargets({
            Rule: this.name,
            Targets: targetsToAdd,
          })
        : Promise.resolve(),
      targetsIdsToRemove.length > 0
        ? this.cloudwatchEvents.removeTargets({
            Rule: this.name,
            Ids: targetsIdsToRemove,
          })
        : Promise.resolve(),
    ]);
  }

  async _reconcileTags() {
    const { Tags } = await this.cloudwatchEvents.listTagsForResource({
      ResourceARN: this.get('arn'),
    });

    const desiredTags = this.get('tags') || [];
    const tagsToAdd = desiredTags.filter(
      (/** @type {import('@aws-sdk/client-cloudwatch-events').Tag} */ tag) =>
        !Tags?.some((t) => t.Key === tag.Key),
    );
    const tagsToRemove = (Tags || []).filter(
      (tag) =>
        !desiredTags.some(
          (/** @type {import('@aws-sdk/client-cloudwatch-events').Tag} */ t) =>
            t.Key === tag.Key,
        ),
    );

    if (tagsToRemove?.length > 0)
      await this.cloudwatchEvents.untagResource({
        ResourceARN: this.get('arn'),
        TagKeys: tagsToRemove.map((tag) => tag.Key || ''),
      });
    if (tagsToAdd.length > 0)
      await this.cloudwatchEvents.tagResource({
        ResourceARN: this.get('arn'),
        Tags: tagsToAdd,
      });
  }

  async _reconcile() {
    try {
      const { State, Arn } = await this.cloudwatchEvents.describeRule({
        Name: this.name,
      });
      if (this.get('state') !== State) {
        if (this.get('state') === EventsRule.ENABLED) {
          await this.cloudwatchEvents.enableRule({
            Name: this.name,
          });
        } else if (this.get('state') === EventsRule.DISABLED) {
          await this.cloudwatchEvents.disableRule({
            Name: this.name,
          });
        }
      }
      this.set('arn', Arn);
      // TODO handle target updates
    } catch (error) {
      if (error instanceof ResourceNotFoundException) {
        const { RuleArn } = await this.cloudwatchEvents.putRule({
          Name: this.name,
          Description: this.get('description'),
          ...(this.has('scheduleExpression')
            ? { ScheduleExpression: this.get('scheduleExpression') }
            : {}),
          ...(this.has('eventPattern')
            ? { EventPattern: this.get('eventPattern') }
            : {}),
          ...(this.has('roleArn') ? { RoleArn: this.get('roleArn') } : {}),
          State: this.get('state'),
        });
        this.set('arn', RuleArn);
      } else {
        throw error;
      }
    }
    await this._reconcileTargets();
    await this._reconcileTags();
  }

  async _destroy() {
    try {
      await this.cloudwatchEvents.disableRule({
        Name: this.name,
      });
      const { Targets } = await this.cloudwatchEvents.listTargetsByRule({
        Rule: this.name,
        Limit: 10,
      });
      if (Targets && Targets.length > 0) {
        await this.cloudwatchEvents.removeTargets({
          Rule: this.name,
          Ids: Targets.map((target) => target?.Id || ''),
        });
      }
      try {
        await this.cloudwatchEvents.deleteRule({
          Name: this.name,
        });
      } catch (error) {
        if (!(error instanceof NoSuchBucket)) {
          throw error;
        }
      }
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) {
        throw error;
      }
    }
  }

  /**
   * @param {string} status - status.
   */
  async waitForEventsRuleStatus(status) {
    let currentStatus = '';
    let attempts = 0;
    const MAX_RETRY_TIMEOUT_SECONDS = 10;
    do {
      const { State } = await this.cloudwatchEvents.describeRule({
        Name: this.name,
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

EventsRule.ENABLED = RuleState.ENABLED;
EventsRule.DISABLED = RuleState.DISABLED;

export default EventsRule;
