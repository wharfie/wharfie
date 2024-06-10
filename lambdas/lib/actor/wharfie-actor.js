const WharfieActorResources = require('./resources/wharfie-actor-resources');
const Actor = require('./actor');

/**
 * @typedef WharfieActorProperties
 * @property {string} handler -
 */

/**
 * @typedef WharfieActorOptions
 * @property {import("./wharfie-deployment")} deployment -
 * @property {string} name -
 * @property {import('./resources/reconcilable').Status} [status] -
 * @property {Actor} [parentActor] -
 * @property {WharfieActorProperties & import('./typedefs').SharedDeploymentProperties} properties -
 * @property {import('./resources/reconcilable')[]} [dependsOn] -
 * @property {Object<string, import('./resources/base-resource') | import('./resources/base-resource-group')>} [resources] -
 */

class WharfieActor extends Actor {
  /**
   * @param {WharfieActorOptions} options -
   */
  constructor({
    deployment,
    name,
    status,
    parentActor,
    properties,
    resources,
    dependsOn,
  }) {
    if (!properties.handler) throw new Error('No handler defined');
    super({
      deployment,
      name,
      status,
      parentActor,
      properties,
      resources,
      dependsOn,
    });
    this.deployment = deployment;
  }

  /**
   * @returns {(import('./resources/base-resource') | import('./resources/base-resource-group'))[]} -
   */
  _defineGroupResources() {
    const actorResources = new WharfieActorResources({
      name: `${this.name}-actor-resources`,
      properties: {
        deployment: this.get('deployment'),
        handler: this.get('handler'),
        actorName: this.name,
        actorSharedPolicyArn: () =>
          this.deployment.getDeploymentResources().getActorPolicyArn(),
        artifactBucket: () =>
          this.deployment.getDeploymentResources().getBucket().name,
        environmentVariables: () => {
          /**
           * @type {Record<string, string>}
           */
          const actorQueues = {};
          Object.values(this.deployment.getActors()).forEach((actor) => {
            actorQueues[`${actor.name.toUpperCase()}_QUEUE_URL`] =
              // @ts-ignore
              actor
                .getActorResources()
                .getResource(`${this.deployment.name}-${actor.name}-queue`)
                .get('url');
          });

          return {
            LOGGING_LEVEL: this.deployment.get('loggingLevel'),
            GLOBAL_QUERY_CONCURRENCY: `${this.deployment.get(
              'globalQueryConcurrency'
            )}`,
            RESOURCE_QUERY_CONCURRENCY: `${this.deployment.get(
              'resourceQueryConcurrency'
            )}`,
            TEMPORARY_GLUE_DATABASE: this.deployment
              .getDeploymentResources()
              .getTemporaryDatabase().name,
            RESOURCE_TABLE: this.deployment
              .getDeploymentResources()
              .getResource(`${this.deployment.name}-resource-autoscaling-table`)
              // @ts-ignore
              .getResource(`${this.deployment.name}-resource`).name,
            SEMAPHORE_TABLE: this.deployment
              .getDeploymentResources()
              .getResource(
                `${this.deployment.name}-semaphore-autoscaling-table`
              )
              // @ts-ignore
              .getResource(`${this.deployment.name}-semaphore`).name,
            LOCATION_TABLE: this.deployment
              .getDeploymentResources()
              .getResource(
                `${this.deployment.name}-locations-autoscaling-table`
              )
              // @ts-ignore
              .getResource(`${this.deployment.name}-locations`).name,
            DEPENDENCY_TABLE: this.deployment
              .getDeploymentResources()
              .getResource(
                `${this.deployment.name}-dependencies-autoscaling-table`
              )
              // @ts-ignore
              .getResource(`${this.deployment.name}-dependencies`).name,
            EVENT_TABLE: this.deployment
              .getDeploymentResources()
              .getResource(`${this.deployment.name}-events-autoscaling-table`)
              // @ts-ignore
              .getResource(`${this.deployment.name}-events`).name,
            WHARFIE_SERVICE_BUCKET: this.deployment
              .getDeploymentResources()
              .getBucket().name,
            WHARFIE_LOGGING_FIREHOSE: this.deployment
              .getDeploymentResources()
              .getResource(`${this.deployment.name}-firehose`).name,
            ...actorQueues,
          };
        },
      },
    });
    return [actorResources];
  }

  /**
   * @param {any} message -
   */
  async send(message) {
    // @ts-ignore
    await this.system.sqs.sendMessage({
      QueueUrl: this.getQueue().get('url'),
      MessageBody: JSON.stringify(message),
    });
  }

  /**
   * @param {import('aws-lambda').SQSEvent} event -
   * @param {import('aws-lambda').Context} context -
   */
  async run(event, context) {
    for (const record of event.Records) {
      const message = JSON.parse(record.body);
      await this.receive(message);
    }
  }

  /**
   * @returns {WharfieActorResources} -
   */
  getActorResources() {
    // @ts-ignore
    return this.getResource(`${this.name}-actor-resources`);
  }

  getQueue() {
    return this.getActorResources().getResource(
      `${this.get('deployment').name}-${this.name}-queue`
    );
  }

  getRole() {
    return this.getActorResources().getResource(
      `${this.get('deployment').name}-${this.name}-role`
    );
  }
}

module.exports = WharfieActor;
