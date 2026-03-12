import { buffer } from 'node:stream/consumers';

/**
 * Resource-backed Function API demo.
 *
 * @param {{ who?: string }} [event] - Event payload.
 * @param {{ resources?: any }} [context] - Invocation context.
 * @returns {Promise<{ who: string, dbRecord: any, queueBody: string | undefined, objectBody: string }>} - Result.
 */
export async function helloResources(event = {}, context = {}) {
  const who = event.who || 'world';
  const { db, queue, objectStorage } = context.resources || {};

  if (!db || !queue || !objectStorage) {
    throw new Error('expected context.resources.{db, queue, objectStorage}');
  }

  await db.put({
    tableName: 'demo_hello',
    keyName: 'id',
    record: { id: 'greeting', who, message: `hello ${who}` },
  });

  const dbRecord = await db.get({
    tableName: 'demo_hello',
    keyName: 'id',
    keyValue: 'greeting',
  });

  await queue.createQueue({ QueueName: 'demo-hello-queue' });
  await queue.sendMessage({
    QueueUrl: 'demo-hello-queue',
    MessageBody: JSON.stringify({ hello: who }),
  });

  const received = await queue.receiveMessage({
    QueueUrl: 'demo-hello-queue',
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 0,
    VisibilityTimeout: 1,
  });

  await objectStorage.createBucket({ Bucket: 'demo-hello-bucket' });
  await objectStorage.putObject({
    Bucket: 'demo-hello-bucket',
    Key: 'hello.txt',
    Body: Buffer.from(`hello ${who}`),
  });

  const objectResult = await objectStorage.getObject({
    Bucket: 'demo-hello-bucket',
    Key: 'hello.txt',
  });

  let objectBody = '';
  if (typeof objectResult === 'string') {
    objectBody = objectResult;
  } else if (objectResult?.Body) {
    objectBody = (await buffer(objectResult.Body)).toString('utf8');
  }

  return {
    who,
    dbRecord,
    queueBody: received?.Messages?.[0]?.Body,
    objectBody,
  };
}
