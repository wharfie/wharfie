const WharfieActor = require('../wharfie-actor');
const EventsRule = require('../resources/aws/events-rule');
const WharfieActorResources = require('../resources/wharfie-actor-resources');

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
        handler: './lambdas/monitor.handler',
      },
    });
  }

  /**
   * @param {string} parent -
   * @returns {(import('../resources/base-resource') | import('../resources/base-resource-group'))[]} -
   */
  _defineGroupResources(parent) {
    const resources = super._defineGroupResources(parent);
    const actorResourceGroup = resources.find(
      (resource) => resource instanceof WharfieActorResources
    );
    if (!actorResourceGroup) {
      throw new Error(`could not find actor resources`);
    }
    const athena_events_rule = new EventsRule({
      dependsOn: [
        // @ts-ignore
        actorResourceGroup.getResource(
          `${this.get('deployment').name}-${this.name}-queue`
        ),
      ],
      name: `${this.name}-athena-events-rule`,
      parent,
      properties: {
        deployment: this.get('deployment'),
        description: `${this.name} athena events rule`,
        state: EventsRule.ENABLED,
        eventPattern: JSON.stringify({
          source: ['aws.athena'],
          'detail-type': ['Athena Query State Change'],
        }),
        targets: () => [
          {
            Id: `${this.name}-athena-events-rule-target`,
            Arn: this.getActorResources()
              .getResource(`${this.get('deployment').name}-${this.name}-queue`)
              .get('arn'),
            DeadLetterConfig: {
              Arn: this.getActorResources()
                .getResource(`${this.get('deployment').name}-${this.name}-dlq`)
                .get('arn'),
            },
          },
        ],
      },
    });
    return [...resources, athena_events_rule];
  }
}

module.exports = Monitor;
