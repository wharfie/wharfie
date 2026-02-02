import { buffer } from 'node:stream/consumers';

/**
 * Actor used by unit tests to validate ActorSystem resource injection.
 *
 * @param {any} event
 * @param {{ resources?: any }} context
 * @returns {Promise<any>}
 */
export async function helloResources(event, context) {
  const who = event?.who || 'world';
  const { db, queue, objectStorage } = context?.resources || {};

  if (!db || !queue || !objectStorage) {
    throw new Error('expected context.resources.{db, queue, objectStorage}');
  }

  // DB smoke test
  await db.put({
    tableName: 'hello',
    keyName: 'id',
    record: { id: 'greeting', message: `hello ${who}` },
  });
  const dbRecord = await db.get({
    tableName: 'hello',
    keyName: 'id',
    keyValue: 'greeting',
  });

  // Queue smoke test
  await queue.createQueue({ QueueName: 'hello-queue' });
  await queue.sendMessage({
    QueueUrl: 'hello-queue',
    MessageBody: JSON.stringify({ hello: who }),
  });
  const received = await queue.receiveMessage({
    QueueUrl: 'hello-queue',
    MaxNumberOfMessages: 1,
    WaitTimeSeconds: 0,
    VisibilityTimeout: 1,
  });

  // Object storage smoke test
  await objectStorage.createBucket({ Bucket: 'hello-bucket' });
  await objectStorage.putObject({
    Bucket: 'hello-bucket',
    Key: 'hello.txt',
    Body: Buffer.from(`hello ${who}`),
  });
  const obj = await objectStorage.getObject({
    Bucket: 'hello-bucket',
    Key: 'hello.txt',
  });

  // Adapter compatibility:
  // - vanilla adapter returns a string body
  // - s3 adapter returns { Body: ReadableStream }
  let objectBody = '';
  if (typeof obj === 'string') {
    objectBody = obj;
  } else if (obj?.Body) {
    objectBody = (await buffer(obj.Body)).toString('utf8');
  }

  return {
    who,
    dbRecord,
    queueBody: received?.Messages?.[0]?.Body,
    objectBody,
  };
}
