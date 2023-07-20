/* eslint-disable */
'use strict';
const {
  FirehoseClient,
  PutRecordBatchCommand,
} = require('@aws-sdk/client-firehose');
exports.handler = async function (event, context) {
  const client = new FirehoseClient();
  const input = {
    // PutRecordBatchInput
    DeliveryStreamName: '${AWS::StackName}_FirehoseExampleFirehose',
    Records: [
      {
        Data: Buffer.from(
          JSON.stringify({
            name: 'test-event',
            time: new Date().toISOString(),
          })
        ),
      },
    ],
  };
  const command = new PutRecordBatchCommand(input);
  await client.send(command);
};
