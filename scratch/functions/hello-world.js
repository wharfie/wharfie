import { buffer } from 'node:stream/consumers';

/**
 * Hello world actor function.
 *
 * Demonstrates access to ActorSystem-provided resources via `context.resources`.
 *
 * @param {any} event
 * @param {{ resources?: any }} context
 * @returns {Promise<any>}
 */
export async function helloWorld(event, context) {
  const who = event?.who || 'world';

  const { db, queue, objectStorage } = context?.resources || {};
  if (!db || !queue || !objectStorage) {
    throw new Error(
      'Missing resources on context. Expected context.resources.{db, queue, objectStorage}',
    );
  }

  // --- DB ---
  await db.put({
    tableName: 'hello',
    keyName: 'id',
    record: { id: 'greeting', who, message: `hello ${who}` },
  });

  const dbRecord = await db.get({
    tableName: 'hello',
    keyName: 'id',
    keyValue: 'greeting',
  });

  // --- Queue ---
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

  // --- Object Storage ---
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
    // stream/consumers.buffer handles Readable and web streams in Node
    objectBody = (await buffer(obj.Body)).toString('utf8');
  }

  return {
    who,
    dbRecord,
    queueMessage: received?.Messages?.[0]?.Body,
    objectBody,
  };
}
