class Actor {
  constructor(system, name, parent = null) {
    this.system = system;
    this.name = name;
    this.parent = parent;
  }

  createSubActor(name, actorClass) {
    const fullName = `${this.name}/${name}`;
    return this.system.createActor(fullName, actorClass, this);
  }

  receive(message) {
    console.log(`${this.name} received a message:`, message);
  }

  compareInfra(existingResources, neededResources) {
    return {
      create: neededResources.filter(
        (resource) => !existingResources.includes(resource)
      ),
      delete: existingResources.filter(
        (resource) => !neededResources.includes(resource)
      ),
    };
  }

  async reconcileInfra(clients, existingResources) {
    const neededResources = {
      queues: [
        {
          QueueArn:
            'arn:aws:sqs:us-west-2:079185815456:wharfie-testing-Daemon-dead-letter',
          ApproximateNumberOfMessages: '0',
          ApproximateNumberOfMessagesNotVisible: '0',
          ApproximateNumberOfMessagesDelayed: '0',
          CreatedTimestamp: '1710888278',
          LastModifiedTimestamp: '1710888278',
          VisibilityTimeout: '30',
          MaximumMessageSize: '262144',
          MessageRetentionPeriod: '1209600',
          DelaySeconds: '0',
          ReceiveMessageWaitTimeSeconds: '0',
          SqsManagedSseEnabled: 'true',
        },
      ],
      lambdas: [
        {
          Description: 'Monitor in the wharfie-testing stack',
          TracingConfig: { Mode: 'PassThrough' },
          SnapStart: { OptimizationStatus: 'Off', ApplyOn: 'None' },
          RevisionId: '1ab779c1-8d35-4582-b76d-95a9dd0986bb',
          LastModified: '2024-03-20T14:45:01.000+0000',
          FunctionName: 'wharfie-testing-monitor',
          Runtime: 'nodejs20.x',
          Version: '$LATEST',
          PackageType: 'Zip',
          Layers: [],
          MemorySize: 1024,
          Timeout: 300,
          Handler: 'index.handler',
          Role: 'arn:aws:iam::079185815456:role/wharfie-testing-WharfieRole-G8C6ERxAybHk',
          LoggingConfig: {
            LogFormat: 'Text',
            LogGroup: '/aws/lambda/wharfie-testing-monitor',
          },
          Environment: {
            Variables: {
              DLQ_URL:
                'https://sqs.us-west-2.amazonaws.com/079185815456/wharfie-testing-monitor-resource-dead-letter',
            },
          },
          EphemeralStorage: { Size: 512 },
          Architectures: ['arm64'],
        },
      ],
    };
    // console.log(
    //   JSON.stringify(existingResources.lambdas['wharfie-testing-monitor'])
    // );
    // console.log(
    //   JSON.stringify(
    //     existingResources.queues[
    //       'https://sqs.us-west-2.amazonaws.com/079185815456/wharfie-testing-Daemon-dead-letter'
    //     ]
    //   )
    // );
    // console.log(neededResources);
    // await clients.sqs.createQueue({
    //     QueueName: this.name
    // })
  }
}

module.exports = Actor;
