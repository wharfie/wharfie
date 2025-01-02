const WharfieActor = require('../wharfie-actor');
const EventsRule = require('../resources/aws/events-rule');

class Monitor extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').ExtendedWharfieActorOptions} options -
   */
  constructor({ status, parent, resources, properties }) {
    super({
      name: 'monitor',
      parent,
      status,
      resources,
      properties: {
        ...properties,
        handler: '<WHARFIE_BUILT_IN>/monitor.handler',
      },
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('../resources/base-resource') | import('../resources/base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    const resources = super._defineGroupResources(parent);
    const queue = resources.find(
      (resource) =>
        resource.name === `${this.get('deployment').name}-${this.name}-queue`
    );
    if (!queue) {
      throw new Error(`could not find actor queue`);
    }
    const dlq = resources.find(
      (resource) =>
        resource.name === `${this.get('deployment').name}-${this.name}-dlq`
    );
    if (!dlq) {
      throw new Error(`could not find actor dlq`);
    }
    const athena_events_rule = new EventsRule({
      dependsOn: [queue],
      name: `${this.name}-athena-events-rule`,
      parent,
      properties: {
        deployment: () => this.get('deployment'),
        description: `${this.name} athena events rule`,
        state: EventsRule.ENABLED,
        eventPattern: JSON.stringify({
          source: ['aws.athena'],
          'detail-type': ['Athena Query State Change'],
        }),
        targets: () => [
          {
            Id: `${this.name}-athena-events-rule-target`,
            Arn: queue.get('arn'),
            DeadLetterConfig: {
              Arn: dlq.get('arn'),
            },
          },
        ],
      },
    });
    return [...resources, athena_events_rule];
  }
}

module.exports = Monitor;
