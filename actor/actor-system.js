// Modify the ActorSystem to accept an optional parent argument.
const SQS = require('../lambdas/lib/sqs');
const Lambda = require('../lambdas/lib/lambda');

class ActorSystem {
  constructor() {
    this.actors = {};
    this.sqs = new SQS({ region: process.env.AWS_REGION });
    this.lambda = new Lambda({ region: process.env.AWS_REGION });
  }

  createActor(name, ActorClass, parent = null) {
    if (this.actors[name]) {
      throw new Error(`Actor with name ${name} already exists.`);
    }
    const actor = new ActorClass(this, name, parent);
    this.actors[name] = actor;
    return actor;
  }

  send(target, message) {
    process.nextTick(() => {
      if (this.actors[target]) {
        this.actors[target].receive(message);
      } else {
        console.log(`No actor found with name ${target}`);
      }
    });
  }

  async provision() {
    const { QueueDetails } = await this.sqs.listQueues();
    const { Functions } = await this.lambda.listFunctions();
    for (const actor of Object.values(this.actors)) {
      await actor.reconcileInfra(
        {
          sqs: this.sqs,
          lambda: this.lambda,
        },
        {
          queues: QueueDetails,
          lambdas: Functions.reduce((acc, lambda) => {
            acc[lambda.FunctionName] = lambda;
            return acc;
          }, {}),
        }
      );
    }
  }
}

module.exports = ActorSystem;
