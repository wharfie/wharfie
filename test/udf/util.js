import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const arrow = require('apache-arrow');

/**
 *
 * @param {any} schema -
 * @param {any} records -
 * @returns {string} -
 */
function serializeRecords(schema, records) {
  const schemaStruct = new arrow.Struct(schema.fields);
  const children = records.map((record) =>
    arrow.makeData({
      length: 1,
      valueOffsets: [0, record.length],
      type: new arrow.Utf8(),
      data: record,
    }),
  );
  const data = arrow.makeData({
    length: 1,
    type: schemaStruct,
    children,
  });
  const outputRecordBatch = new arrow.RecordBatch(schema, data);

  const writer = new arrow.RecordBatchWriter();
  // Athena udf's pass the schema of the returned data in a seperate json field, and will error if the first message in arrow is a schema message
  // To get around this, we override the _writeSchema method to do nothing
  // eslint-disable-next-line no-unused-vars
  writer._writeSchema = (_schema) => {};
  writer.write(outputRecordBatch);
  writer.finish();
  const outputArray = writer.toUint8Array(true);
  const base64String = Buffer.from(outputArray).toString('base64');

  return base64String;
}

/**
 *
 * @param {any} schema -
 * @returns {string} -
 */
function serializeSchema(schema) {
  const writer = new arrow.RecordBatchWriter();
  const sink = new arrow.AsyncByteQueue();
  writer.reset(sink, schema);
  writer.finish();
  const outputArray = sink.toUint8Array(true);
  const base64String = Buffer.from(outputArray).toString('base64');

  return base64String;
}

/**
 *
 * @param {any} result -
 * @returns {any} -
 */
function deserializeRecords(result) {
  const schemaBytes = Buffer.from(result.records.schema, 'base64');
  const schemaReader = new arrow.MessageReader(schemaBytes);
  const schemaMessage = schemaReader.readMessage();

  const recordsBytes = Buffer.from(result.records.records, 'base64');
  let recordsBatchReader = arrow.RecordBatchReader.from(recordsBytes);
  recordsBatchReader = recordsBatchReader.reset(schemaMessage._createHeader());
  const outputRecords = recordsBatchReader.readAll();
  const output = String.fromCharCode.apply(
    null,
    outputRecords[0].data.children[0].values,
  );
  return output;
}

module.exports = {
  serializeRecords,
  serializeSchema,
  deserializeRecords,
};
