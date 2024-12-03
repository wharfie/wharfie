/*
 * This is a javascript rewrite of the athena udf connector library from https://github.com/awslabs/aws-athena-query-federation/tree/master/athena-udfs
 */
'use strict';

const arrow = require('apache-arrow');
const path = require('path');
const SOURCE_TYPE = process.env.AWS_LAMBDA_FUNCTION_NAME || 'wharfie_udf';
const HANDLER = process.env.WHARFIE_UDF_HANDLER;

const UDF_HANDLER = load_entrypoint();
/**
 * Loads the entrypoint file and returns the handler function
 * @returns {function} - The handler function
 */
function load_entrypoint() {
  // Split the entry point into filename and handler
  let fileName;
  let handlerName;

  const lastDotIndex = HANDLER.lastIndexOf('.');

  if (lastDotIndex !== -1) {
    fileName = HANDLER.slice(0, lastDotIndex);
    handlerName = HANDLER.slice(lastDotIndex + 1);
  }

  // Dynamically import the module
  let handlerModule;
  if (path.isAbsolute(fileName)) {
    // eslint-disable-next-line import/no-dynamic-require
    handlerModule = require(fileName);
  } else {
    // eslint-disable-next-line import/no-dynamic-require
    handlerModule = require(path.resolve(__dirname, fileName));
  }
  // Get the handler function
  const udf_handler = handlerModule[handlerName];

  if (!udf_handler || typeof udf_handler !== 'function') {
    throw new Error(
      `Handler function "${handlerName}" not found in module "${fileName}"`
    );
  }
  return udf_handler;
}
/*
 * Used to convey the capabilities of this SDK instance when negotiating functionality with
 * Athena. You can think of this like a version number that is specific to the feature set
 * and protocol used by the SDK. Purely client side changes in the SDK would not be expected
 * to change the capabilities.
 *
 * Version history:
 * 23 - initial preview release
 * 24 - explicit, versioned serialization introduced
 * 25 - upgraded Arrow to 3.0.0, addressed backwards incompatible changes
 */
const CAPABILITIES = 24;
/*
 * Used to convey the version of serialization of this SDK instance when negotiating functionality with
 * Athena. You can think of this like a version number that is specific to the protocol used by the SDK.
 * Any modification in the way existing over-the-wire objects are serialized would require incrementing
 * this value.
 */
const SERDE_VERSION = 4;

/**
 *
 * @param {any} type -
 * @param {any} serialized_param -
 * @returns {any} -
 */
function deserialize_param(type, serialized_param) {
  // console.log(type.toString(), type.constructor.name, type, serialized_param);
  switch (String(type)) {
    case 'Utf8': {
      let str = '';
      for (let i = 0; i < serialized_param.length; i++) {
        str += String.fromCharCode(serialized_param[i]);
      }
      return str;
    }
    case 'Int8':
    case 'Int16':
    case 'Int32':
    case 'Int64':
      return Number(serialized_param);
    case 'Float32':
    case 'Float64':
      return Number(serialized_param);
    case 'Date64<MILLISECOND>':
    case 'Date32<DAY>':
      if (type.unit === 0) {
        // days since epoch
        const days = serialized_param[0];
        return new Date(days * 24 * 60 * 60 * 1000);
      } else if (type.unit === 1) {
        // Combine the high and low bits into a single 64-bit BigInt
        const timestampBigInt =
          (BigInt(serialized_param[1]) << BigInt(32)) +
          BigInt(serialized_param[0]);
        return new Date(Number(timestampBigInt));
      } else {
        throw Error(`Unknown date unit: ${type.unit}`);
      }
    case 'Binary':
      return Buffer.from(serialized_param);
    case 'Bool':
      return !serialized_param;
    default:
      throw Error(`Unknown type: ${type}`);
  }
}

/**
 * @param {import('./typedefs').AthenaUDFPingInputEvent & import('./typedefs').AthenaUDFRecordsInputEvent} event -
 * @returns {Promise<import('./typedefs').AthenaUDFPingOutputEvent & import('./typedefs').AthenaUDFRecordsOutputEvent>} -
 */
const handler = async (event) => {
  // console.log('event', JSON.stringify(event));
  if (event['@type'] === 'PingRequest') {
    const catalogName = event.catalogName;
    const queryId = event.queryId;

    return {
      '@type': 'PingResponse',
      catalogName,
      queryId,
      sourceType: SOURCE_TYPE,
      capabilities: CAPABILITIES,
      serDeVersion: SERDE_VERSION,
    };
  }
  if (event['@type'] === 'UserDefinedFunctionRequest') {
    const recordsBytes = Buffer.from(event.inputRecords.records, 'base64');
    const schemaBytes = Buffer.from(event.inputRecords.schema, 'base64');
    const schemaReader = new arrow.MessageReader(schemaBytes);
    const schemaMessage = schemaReader.readMessage();

    let paramBatchReader = arrow.RecordBatchReader.from(recordsBytes);
    paramBatchReader = paramBatchReader.reset(schemaMessage._createHeader());
    const serializedParams = paramBatchReader.readAll();
    const param_values = serializedParams[0].data.children.map(
      (serializedParam, paramIndex) => {
        const record_params = [];
        const offsets = serializedParam.valueOffsets;
        const values = serializedParam.values;
        for (let i = 0; i < serializedParam.length; i++) {
          let raw_record_param = null;
          if (offsets && offsets.length > 0) {
            const next_offset = offsets[i + 1];
            raw_record_param = values.slice(offsets[i], next_offset);
          } else if (serializedParam.stride) {
            raw_record_param = values.slice(
              i * serializedParam.stride,
              (i + 1) * serializedParam.stride
            );
          } else {
            raw_record_param = values[i];
          }
          if (i === 0) {
            console.log(
              `PARAM ${paramIndex} ARROW TYPE: ${serializedParam.type}`
            );
          }
          const record_param = deserialize_param(
            serializedParam.type,
            raw_record_param
          );
          // if (i === 0) {
          // console.log(`PARAM ${paramIndex} JS TYPE: ${typeof record_param}`);
          // console.log(`PARAM ${paramIndex} EXAMPLE VALUE: ${record_param}`);
          // }
          record_params.push(record_param);
        }
        return record_params;
      }
    );

    // switch (result[0].data.children[0].type.constructor.name) {
    //   case 'Utf8':
    //     param = String.fromCharCode.apply(
    //       null,
    //       result[0].data.children[0].values
    //     );
    //     break;
    //   default:
    //     throw Error(`Unknown type: ${result[0].data.children[0].type}`);
    // }

    const return_values = [];
    console.log('UDF RECORD COUNT: ', param_values[0].length);
    for (let i = 0; i < param_values[0].length; i++) {
      const params = param_values.map((param) => param[i]);
      let _return = null;
      try {
        _return = await UDF_HANDLER(...params);
      } catch (e) {
        console.error(e);
        throw e;
      }
      // only supports string return types
      return_values.push(String(_return));
    }

    // const serializedReturn = Array.from(_return, (char) => char.charCodeAt(0));

    const outputSchemaBytes = Buffer.from(event.outputSchema, 'base64');
    const outputSchemaReader = new arrow.MessageReader(outputSchemaBytes);
    const outputSchemaMessage = outputSchemaReader.readMessage();

    const outputSchema = outputSchemaMessage._createHeader();
    const schemaStruct = new arrow.Struct(outputSchema.fields);

    const returnValueOffests = [0];
    // MODIFY EMPTY VALUE BASED ON RETURN TYPE
    let returnData = '';
    return_values.forEach((_return) => {
      const valueOffset =
        _return.length + returnValueOffests[returnValueOffests.length - 1];
      returnValueOffests.push(valueOffset);
      returnData += _return;
    });
    const internalData = arrow.makeData({
      length: return_values.length,
      valueOffsets: returnValueOffests,
      type: new arrow.Utf8(),
      data: returnData,
    });

    const data = arrow.makeData({
      length: 1,
      type: schemaStruct,
      children: [internalData],
    });
    const outputRecordBatch = new arrow.RecordBatch(outputSchema, data);
    console.log('OUTPUT SCHEMA: ', outputSchema);

    const outputWriter = new arrow.RecordBatchWriter();
    // Athena udf's pass the schema of the returned data in a seperate json field, and will error if the first message in arrow is a schema message
    // To get around this, we override the _writeSchema method to do nothing
    // eslint-disable-next-line no-unused-vars
    outputWriter._writeSchema = (_schema) => {};
    outputWriter.write(outputRecordBatch);
    outputWriter.finish();
    const outputArray = outputWriter.toUint8Array(true);
    const base64String = Buffer.from(outputArray).toString('base64');

    return {
      '@type': 'UserDefinedFunctionResponse',
      records: {
        aId: event.inputRecords.aId,
        schema: event.outputSchema,
        records: base64String,
      },
      methodName: event.methodName,
    };
  }
};

module.exports = {
  handler,
};
