const WharfieActor = require('../wharfie-actor');
const EventsRule = require('../resources/aws/events-rule');
const Role = require('../resources/aws/role');
const WharfieActorResources = require('../resources/wharfie-actor-resources');

const path = require('path');

class Monitor extends WharfieActor {
  /**
   * @param {import('../wharfie-actor').WharfieActorOptions} options -
   */
  constructor({ deployment, name, status, resources, properties }) {
    super({
      deployment,
      name,
      status,
      resources,
      properties: {
        ...properties,
        handler: path.join(__dirname, '../../../monitor.handler'),
      },
    });
  }

  /**
   * @returns {(import('../resources/base-resource') | import('../resources/base-resource-group'))[]} -
   */
  _defineGroupResources() {
    const resources = super._defineGroupResources();
    const actorResourceGroup = resources.find(
      (resource) => resource instanceof WharfieActorResources
    );
    if (!actorResourceGroup) {
      throw new Error(`could not find actor resources`);
    }
    const athena_events_rule_role = new Role({
      name: `${this.name}-athena-events-role`,
      properties: {
        deployment: this.get('deployment'),
        description: `${this.name} athena events role`,
        assumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: ['events.amazonaws.com', 'sqs.amazonaws.com'],
              },
              Action: 'sts:AssumeRole',
            },
          ],
        },
      },
    });
    const athena_events_rule = new EventsRule({
      dependsOn: [
        athena_events_rule_role,
        // @ts-ignore
        actorResourceGroup.getResource(
          `${this.get('deployment').name}-${this.name}-queue`
        ),
      ],
      name: `${this.name}-athena-events-rule`,
      properties: {
        deployment: this.get('deployment'),
        description: `${this.name} athena events rule`,
        state: EventsRule.ENABLED,
        eventPattern: JSON.stringify({
          source: ['aws.athena'],
          'detail-type': ['Athena Query State Change'],
        }),
        roleArn: () => athena_events_rule_role.get('arn'),
        targets: () => [
          {
            Id: `${this.name}-athena-events-rule-target`,
            Arn: this.getActorResources()
              .getResource(`${this.get('deployment').name}-${this.name}-queue`)
              .get('arn'),
          },
        ],
      },
    });
    return [...resources, athena_events_rule_role, athena_events_rule];
  }
}

module.exports = Monitor;
