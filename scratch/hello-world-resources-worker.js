import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import sandboxWorker from '../lambdas/lib/code-execution/worker.js';
import { createActorSystemResources } from '../lambdas/lib/actor/runtime/resources.js';

async function main() {
  const tmp = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-hello-world-worker-rpc-'),
  );

  const { resources, close } = await createActorSystemResources({
    db: { adapter: 'vanilla', options: { path: tmp } },
    queue: { adapter: 'vanilla', options: { path: tmp } },
    objectStorage: { adapter: 'vanilla', options: { path: tmp } },
  });

  const fnName = 'hello-world-resources-worker';
  const codeString = `
    global[Symbol.for(${JSON.stringify(fnName)})] = async (event, context) => {
      const who = event?.who || 'world';
      const message = 'hello ' + who;

      await context.resources.db.put({
        tableName: 'hello',
        keyName: 'id',
        record: { id: 'greeting', who, message }
      });

      await context.resources.queue.sendMessage({
        QueueUrl: 'hello-queue',
        MessageBody: JSON.stringify({ hello: who })
      });

      await context.resources.objectStorage.createBucket({ Bucket: 'hello-bucket' });
      await context.resources.objectStorage.putObject({
        Bucket: 'hello-bucket',
        Key: 'greeting.txt',
        Body: message,
      });
    };
  `;

  try {
    await sandboxWorker.runInSandbox(
      fnName,
      codeString,
      [{ who: 'world' }, { resources: {} }],
      { rpc: { resources } },
    );

    const dbRecord = await resources.db.get({
      tableName: 'hello',
      keyName: 'id',
      keyValue: 'greeting',
    });

    const q = await resources.queue.receiveMessage({
      QueueUrl: 'hello-queue',
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 0,
    });

    const objectBody = await resources.objectStorage.getObject({
      Bucket: 'hello-bucket',
      Key: 'greeting.txt',
    });

    console.log('hello-world worker+rpc result:', {
      who: 'world',
      dbRecord,
      queueMessage: q?.Messages?.[0]?.Body ?? null,
      objectBody,
    });
  } finally {
    await close();
    await sandboxWorker._destroyWorker();
    sandboxWorker._clearSandboxCache();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
