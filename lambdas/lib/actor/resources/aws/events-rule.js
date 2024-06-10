'use strict';
const CloudWatchEvents = require('../../../cloudwatch-events');
const BaseResource = require('../base-resource');
const AWS = require('@aws-sdk/client-cloudwatch-events');

/**
 * @typedef EventsRuleProperties
 * @property {string} description -
 * @property {string} [scheduleExpression] -
 * @property {string} [eventPattern] -
 * @property {string | function} roleArn -
 * @property {import('@aws-sdk/client-cloudwatch-events').RuleState} state -
 * @property {import('@aws-sdk/client-cloudwatch-events').Target[] | function(): import('@aws-sdk/client-cloudwatch-events').Target[]} targets -
 */

/**
 * @typedef EventsRuleOptions
 * @property {string} name -
 * @property {import('../reconcilable').Status} [status] -
 * @property {EventsRuleProperties & import('../../typedefs').SharedDeploymentProperties} properties -
 * @property {import('../reconcilable')[]} [dependsOn] -
 */

class EventsRule extends BaseResource {
  /**
   * @param {EventsRuleOptions} options -
   */
  constructor({ name, status, properties, dependsOn = [] }) {
    super({ name, status, properties, dependsOn });
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

  async _reconcile() {
    try {
      const { State } = await this.cloudwatchEvents.describeRule({
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
      // TODO handle target updates
    } catch (error) {
      // @ts-ignore
      if (error.name === 'ResourceNotFoundException') {
        await this.cloudwatchEvents.putRule({
          Name: this.name,
          Description: this.get('description'),
          ...(this.has('scheduleExpression')
            ? { ScheduleExpression: this.get('scheduleExpression') }
            : {}),
          ...(this.has('eventPattern')
            ? { EventPattern: this.get('eventPattern') }
            : {}),
          RoleArn: this.get('roleArn'),
          State: this.get('state'),
        });
      } else {
        throw error;
      }
    }
    await this._reconcileTargets();
  }

  async _destroy() {
    try {
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
        await this.cloudwatchEvents.deleteRuleCommand({
          Name: this.name,
        });
      } catch (error) {
        // @ts-ignore
        if (error.name !== 'NoSuchBucket') {
          throw error;
        }
      }
    } catch (error) {
      // @ts-ignore
      if (error.name !== 'ResourceNotFoundException') {
        throw error;
      }
    }
  }
}

EventsRule.ENABLED = AWS.RuleState.ENABLED;
EventsRule.DISABLED = AWS.RuleState.DISABLED;

module.exports = EventsRule;
