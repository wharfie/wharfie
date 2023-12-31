/* eslint-disable jest/no-large-snapshots */
'use strict';

const path = require('path');
const { deserializeRecords } = require('./util');

const RECORD_TEST_EVENT = {
  '@type': 'UserDefinedFunctionRequest',
  identity: {
    id: 'UNKNOWN',
    principal: 'UNKNOWN',
    account: '079185815456',
    arn: 'arn:aws:sts::079185815456:assumed-role/AWSReservedSSO_AdministratorAccess_7e34cc2f21392f6c/joe@wharfie.dev',
    tags: {},
    groups: [],
  },
  inputRecords: {
    aId: 'c5ac7fd0-99e8-4862-8563-70efb59e2ab4',
    schema:
      '/////4gAAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAEAAAAYAAAAAAASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAFARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAAAAAAA',
    records:
      '/////5gAAAAUAAAAAAAAAAwAFgAOABUAEAAEAAwAAAAoAAAAAAAAAAAABAAQAAAAAAMKABgADAAIAAQACgAAABQAAABIAAAAAQAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAQAAAAAAAAAIAAAAAAAAAAgAAAAAAAAAEAAAAAAAAAAYAAAAAAAAAAAAAAABAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAABgAAAAyMDIzLTA1LTI5VDIwOjIyOjI5LjY3M1o=',
  },
  outputSchema:
    '/////4gAAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAEAAAAYAAAAAAASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAFARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAAAAAAA',
  methodName: 'udf_name',
  functionType: 'SCALAR',
};

const RECORD_TEST_EVENT_MULTI_ROW = {
  '@type': 'UserDefinedFunctionRequest',
  identity: {
    id: 'UNKNOWN',
    principal: 'UNKNOWN',
    account: '079185815456',
    arn: 'arn:aws:sts::079185815456:assumed-role/AWSReservedSSO_AdministratorAccess_7e34cc2f21392f6c/joe@wharfie.dev',
    tags: {},
    groups: [],
  },
  inputRecords: {
    aId: 'f9187517-6af8-4dc6-b364-261c60beabfb',
    schema:
      '/////4gAAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAEAAAAYAAAAAAASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAFARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAAAAAAA',
    records:
      '/////5gAAAAUAAAAAAAAAAwAFgAOABUAEAAEAAwAAADQAQAAAAAAAAAABAAQAAAAAAMKABgADAAIAAQACgAAABQAAABIAAAAEAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAgAAAAAAAAAIAAAAAAAAAEQAAAAAAAAAUAAAAAAAAACAAQAAAAAAAAAAAAABAAAAEAAAAAAAAAAAAAAAAAAAAP//AAAAAAAAAAAAABgAAAAwAAAASAAAAGAAAAB4AAAAkAAAAKgAAADAAAAA2AAAAPAAAAAIAQAAIAEAADgBAABQAQAAaAEAAIABAAAAAAAAMjAyMy0wNi0yM1QyMTowNjoyOS41MzNaMjAyMy0wNi0yM1QyMToyNToyOS43NzNaMjAyMy0wNi0yOVQwNjo0MjoxNy4wMzNaMjAyMy0wNi0yOVQwNjo1OToxNy4wNDZaMjAyMy0wNi0yOVQwNjowMjoxNy4wNTRaMjAyMy0wNi0yOVQwNjozMjoxNy4wMDZaMjAyMy0wNi0yOVQwNjoyMjoxNy4xOTlaMjAyMy0wNi0yOVQwNjozNjoxNy4wMjlaMjAyMy0wNi0yOVQwNjowNjoxNi45NDlaMjAyMy0wNi0yOVQwNjo1MjoxNy4wMjBaMjAyMy0wNi0yOVQwNjowNDoxNi45NjdaMjAyMy0wNi0yOVQwNjo0NToxNy4xMTZaMjAyMy0wNi0yOVQwNjo0ODoxNy4wMDJaMjAyMy0wNi0yOVQwNTowNzoxNi45MjhaMjAyMy0wNi0yOVQwNToyNjoxNi45OTlaMjAyMy0wNi0yOVQwNToyODoxNy4wMDFa',
  },
  outputSchema:
    '/////4gAAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAEAAAAYAAAAAAASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAFARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAAAAAAA',
  methodName: 'udf_name',
  functionType: 'SCALAR',
};

const RECORD_TEST_EVENT_ALL_TYPES_SINGLE_ROW = {
  '@type': 'UserDefinedFunctionRequest',
  identity: {
    id: 'UNKNOWN',
    principal: 'UNKNOWN',
    account: '079185815456',
    arn: 'arn:aws:sts::079185815456:assumed-role/AWSReservedSSO_AdministratorAccess_7e34cc2f21392f6c/joe@wharfie.dev',
    tags: {},
    groups: [],
  },
  inputRecords: {
    aId: 'd93d9d68-cb05-459d-8a5c-105e26825cda',
    schema:
      '/////9ACAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAwAAABkAgAAGAIAANgBAACgAQAAbAEAADgBAAAEAQAAzAAAAJQAAABkAAAANAAAAAQAAADe/f//FAAAABQAAAAUAAAAAAAGARAAAAAAAAAAAAAAAMz9//8CAAAAMTEAAAr+//8UAAAAFAAAABQAAAAAAAQBEAAAAAAAAAAAAAAA+P3//wIAAAAxMAAANv7//xQAAAAUAAAAFAAAAAAABQEQAAAAAAAAAAAAAAAk/v//AQAAADkAAABi/v//FAAAABQAAAAUAAAAAAACARgAAAAAAAAAAAAAANT+//8AAAABIAAAAAEAAAA4AAAAlv7//xQAAAAUAAAAFAAAAAAAAgEYAAAAAAAAAAAAAAAI////AAAAAUAAAAABAAAANwAAAMr+//8UAAAAFAAAABQAAAAAAAMBFAAAAAAAAAAAAAAA/v7//wAAAgABAAAANgAAAPr+//8UAAAAFAAAABQAAAAAAAMBFAAAAAAAAAAAAAAALv///wAAAgABAAAANQAAACr///8UAAAAFAAAABQAAAAAAAMBFAAAAAAAAAAAAAAAXv///wAAAQABAAAANAAAAFr///8UAAAAFAAAABQAAAAAAAIBGAAAAAAAAAAAAAAAzP///wAAAAEQAAAAAQAAADMAAACO////FAAAABQAAAAcAAAAAAACASAAAAAAAAAAAAAAAAgADAAIAAcACAAAAAAAAAEIAAAAAQAAADIAAADK////FAAAABQAAAAcAAAAAAAIARwAAAAAAAAAAAAAAAAABgAIAAYABgAAAAAAAAABAAAAMQASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAIARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAA=',
    records:
      '/////7gCAAAUAAAAAAAAAAwAFgAOABUAEAAEAAwAAADgAAAAAAAAAAAABAAQAAAAAAMKABgADAAIAAQACgAAABQAAAC4AQAAAQAAAAAAAAAAAAAAGgAAAAAAAAAAAAAAAQAAAAAAAAAIAAAAAAAAAAgAAAAAAAAAEAAAAAAAAAABAAAAAAAAABgAAAAAAAAABAAAAAAAAAAgAAAAAAAAAAEAAAAAAAAAKAAAAAAAAAABAAAAAAAAADAAAAAAAAAAAQAAAAAAAAA4AAAAAAAAAAIAAAAAAAAAQAAAAAAAAAABAAAAAAAAAEgAAAAAAAAABAAAAAAAAABQAAAAAAAAAAEAAAAAAAAAWAAAAAAAAAAIAAAAAAAAAGAAAAAAAAAAAQAAAAAAAABoAAAAAAAAAAgAAAAAAAAAcAAAAAAAAAABAAAAAAAAAHgAAAAAAAAACAAAAAAAAACAAAAAAAAAAAEAAAAAAAAAiAAAAAAAAAAEAAAAAAAAAJAAAAAAAAAAAQAAAAAAAACYAAAAAAAAAAgAAAAAAAAAoAAAAAAAAAAKAAAAAAAAALAAAAAAAAAAAQAAAAAAAAC4AAAAAAAAAAgAAAAAAAAAwAAAAAAAAAALAAAAAAAAANAAAAAAAAAAAQAAAAAAAADYAAAAAAAAAAEAAAAAAAAAAAAAAAwAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAFi04xuJAQAAAQAAAAAAAABVTAAAAAAAAAEAAAAAAAAAGwAAAAAAAAABAAAAAAAAAO9YAAAAAAAAAQAAAAAAAAAzc19DAAAAAAEAAAAAAAAAUPwYc2vS1UABAAAAAAAAAFD8GHNr0tVAAQAAAAAAAAD//0NsFgHbHgEAAAAAAAAA////fwAAAAABAAAAAAAAAAAAAAAKAAAAQnRoZW5hIFNRTAAAAAAAAAEAAAAAAAAAAAAAAAsAAABIZWxsbyB3b3JsZAAAAAAAAQAAAAAAAAAAAAAAAAAAAA==',
  },
  outputSchema:
    '/////4gAAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAEAAAAYAAAAAAASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAFARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAAAAAAA',
  methodName: 'udf_name',
  functionType: 'SCALAR',
};

const RECORD_TEST_EVENT_ALL_TYPES_MULTIPLE_ROWS = {
  '@type': 'UserDefinedFunctionRequest',
  identity: {
    id: 'UNKNOWN',
    principal: 'UNKNOWN',
    account: '079185815456',
    arn: 'arn:aws:sts::079185815456:assumed-role/AWSReservedSSO_AdministratorAccess_7e34cc2f21392f6c/joe@wharfie.dev',
    tags: {},
    groups: [],
  },
  inputRecords: {
    aId: 'e8231ed2-3a1b-43e7-9701-f65814ffb5af',
    schema:
      '/////9ACAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAwAAABkAgAAGAIAANgBAACgAQAAbAEAADgBAAAEAQAAzAAAAJQAAABkAAAANAAAAAQAAADe/f//FAAAABQAAAAUAAAAAAAGARAAAAAAAAAAAAAAAMz9//8CAAAAMTEAAAr+//8UAAAAFAAAABQAAAAAAAQBEAAAAAAAAAAAAAAA+P3//wIAAAAxMAAANv7//xQAAAAUAAAAFAAAAAAABQEQAAAAAAAAAAAAAAAk/v//AQAAADkAAABi/v//FAAAABQAAAAUAAAAAAACARgAAAAAAAAAAAAAANT+//8AAAABIAAAAAEAAAA4AAAAlv7//xQAAAAUAAAAFAAAAAAAAgEYAAAAAAAAAAAAAAAI////AAAAAUAAAAABAAAANwAAAMr+//8UAAAAFAAAABQAAAAAAAMBFAAAAAAAAAAAAAAA/v7//wAAAgABAAAANgAAAPr+//8UAAAAFAAAABQAAAAAAAMBFAAAAAAAAAAAAAAALv///wAAAgABAAAANQAAACr///8UAAAAFAAAABQAAAAAAAMBFAAAAAAAAAAAAAAAXv///wAAAQABAAAANAAAAFr///8UAAAAFAAAABQAAAAAAAIBGAAAAAAAAAAAAAAAzP///wAAAAEQAAAAAQAAADMAAACO////FAAAABQAAAAcAAAAAAACASAAAAAAAAAAAAAAAAgADAAIAAcACAAAAAAAAAEIAAAAAQAAADIAAADK////FAAAABQAAAAcAAAAAAAIARwAAAAAAAAAAAAAAAAABgAIAAYABgAAAAAAAAABAAAAMQASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAIARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAA=',
    records:
      '/////7gCAAAUAAAAAAAAAAwAFgAOABUAEAAEAAwAAABwAQAAAAAAAAAABAAQAAAAAAMKABgADAAIAAQACgAAABQAAAC4AQAAAwAAAAAAAAAAAAAAGgAAAAAAAAAAAAAAAQAAAAAAAAAIAAAAAAAAABgAAAAAAAAAIAAAAAAAAAABAAAAAAAAACgAAAAAAAAADAAAAAAAAAA4AAAAAAAAAAEAAAAAAAAAQAAAAAAAAAADAAAAAAAAAEgAAAAAAAAAAQAAAAAAAABQAAAAAAAAAAYAAAAAAAAAWAAAAAAAAAABAAAAAAAAAGAAAAAAAAAADAAAAAAAAABwAAAAAAAAAAEAAAAAAAAAeAAAAAAAAAAYAAAAAAAAAJAAAAAAAAAAAQAAAAAAAACYAAAAAAAAABgAAAAAAAAAsAAAAAAAAAABAAAAAAAAALgAAAAAAAAAGAAAAAAAAADQAAAAAAAAAAEAAAAAAAAA2AAAAAAAAAAMAAAAAAAAAOgAAAAAAAAAAQAAAAAAAADwAAAAAAAAABAAAAAAAAAAAAEAAAAAAAAeAAAAAAAAACABAAAAAAAAAQAAAAAAAAAoAQAAAAAAABAAAAAAAAAAOAEAAAAAAAAhAAAAAAAAAGABAAAAAAAAAQAAAAAAAABoAQAAAAAAAAEAAAAAAAAAAAAAAAwAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAwAAAAAAAAAAAAAAAAAAAAMAAAAAAAAAAAAAAAAAAAAHAAAAAAAAAFgQCiGJAQAAWGwwJokBAABYWL0WiQEAAAcAAAAAAAAAVkwAAFdMAABUTAAAAAAAAAcAAAAAAAAAJS9/AAAAAAAHAAAAAAAAAMwMtBD/fwAABwAAAAAAAACauaFDmrnTQ2bm9kIAAAAABwAAAAAAAABQ/Bhza5bfQCh+jLk1reRAofgx5tYcyEAHAAAAAAAAAFD8GHNrlt9AKH6MuTWt5ECh+DHm1hzIQAcAAAAAAAAA//+nE8q3uyz//wu7fW6cOv////////9/BwAAAAAAAADMrcISzI64GP///38AAAAABwAAAAAAAAAAAAAACgAAABQAAAAeAAAAQ3RoZW5hIFNRTER0aGVuYSBTUUxBdGhlbmEgU1FMAAAHAAAAAAAAAAAAAAALAAAAFgAAACEAAABIZWxsbyB3b3JsZEhlbGxvIHdvcmxkSGVsbG8gd29ybGQAAAAAAAAABwAAAAAAAAAEAAAAAAAAAA==',
  },
  outputSchema:
    '/////4gAAAAQAAAAAAAKAA4ABgANAAgACgAAAAAABAAQAAAAAAEKAAwAAAAIAAQACgAAAAgAAAAIAAAAAAAAAAEAAAAYAAAAAAASABgAFAATABIADAAAAAgABAASAAAAFAAAABQAAAAYAAAAAAAFARQAAAAAAAAAAAAAAAQABAAEAAAAAQAAADAAAAAAAAAA',
  methodName: 'udf_name',
  functionType: 'SCALAR',
};

describe('tests for js UDF requests', () => {
  it('fixtured udf test', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_1.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const recordresult = await handler(RECORD_TEST_EVENT);
    const output = await deserializeRecords(recordresult);
    expect(output).toMatchInlineSnapshot(
      `"HELLO WORLD, input 2023-05-29T20:22:29.673Z     "`
    );
  });

  it('fixtured multiple row udf test', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_1.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const recordresult = await handler(RECORD_TEST_EVENT_MULTI_ROW);
    const output = await deserializeRecords(recordresult);
    expect(output).toMatchInlineSnapshot(
      `"HELLO WORLD, input 2023-06-23T21:06:29.533ZHELLO WORLD, input 2023-06-23T21:25:29.773ZHELLO WORLD, input 2023-06-29T06:42:17.033ZHELLO WORLD, input 2023-06-29T06:59:17.046ZHELLO WORLD, input 2023-06-29T06:02:17.054ZHELLO WORLD, input 2023-06-29T06:32:17.006ZHELLO WORLD, input 2023-06-29T06:22:17.199ZHELLO WORLD, input 2023-06-29T06:36:17.029ZHELLO WORLD, input 2023-06-29T06:06:16.949ZHELLO WORLD, input 2023-06-29T06:52:17.020ZHELLO WORLD, input 2023-06-29T06:04:16.967ZHELLO WORLD, input 2023-06-29T06:45:17.116ZHELLO WORLD, input 2023-06-29T06:48:17.002ZHELLO WORLD, input 2023-06-29T05:07:16.928ZHELLO WORLD, input 2023-06-29T05:26:16.999ZHELLO WORLD, input 2023-06-29T05:28:17.001Z"`
    );
  });
  it('fixtured all data types single row udf test', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_3.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const recordresult = await handler(RECORD_TEST_EVENT_ALL_TYPES_SINGLE_ROW);
    const output = await deserializeRecords(recordresult);
    expect(output).toMatchInlineSnapshot(
      `"timestamp: Mon Jul 03 2023 13:14:15 GMT+0000 (Coordinated Universal Time), date: Mon Jul 03 2023 00:00:00 GMT+0000 (Coordinated Universal Time), tinyint: 27, smallint: 22767, real: 223.4499969482422, double: 22345.6789, decimal: 22345.6789, bigint: 2223372036854775800, integer: 2147483647, varchar: Bthena SQL, varbinary: Hello world, boolean: false  "`
    );
  });
  it('fixtured all data types multiple rows udf test', async () => {
    expect.assertions(1);
    process.env.WHARFIE_UDF_HANDLER = `${path.join(
      __dirname,
      'request_test_udf_3.js'
    )}.handler`;
    jest.resetModules();
    const { handler } = require('../../lambdas/udf_entrypoint');
    const recordresult = await handler(
      RECORD_TEST_EVENT_ALL_TYPES_MULTIPLE_ROWS
    );
    const output = await deserializeRecords(recordresult);
    expect(output).toMatchInlineSnapshot(
      `"timestamp: Tue Jul 04 2023 13:14:15 GMT+0000 (Coordinated Universal Time), date: Tue Jul 04 2023 00:00:00 GMT+0000 (Coordinated Universal Time), tinyint: 37, smallint: 3276, real: 323.45001220703125, double: 32345.6789, decimal: 32345.6789, bigint: 3223372036854776000, integer: 314748364, varchar: Cthena SQL, varbinary: Hello world, boolean: falsetimestamp: Wed Jul 05 2023 13:14:15 GMT+0000 (Coordinated Universal Time), date: Wed Jul 05 2023 00:00:00 GMT+0000 (Coordinated Universal Time), tinyint: 47, smallint: 4276, real: 423.45001220703125, double: 42345.6789, decimal: 42345.6789, bigint: 4223372036854776000, integer: 414748364, varchar: Dthena SQL, varbinary: Hello world, boolean: falsetimestamp: Sun Jul 02 2023 13:14:15 GMT+0000 (Coordinated Universal Time), date: Sun Jul 02 2023 00:00:00 GMT+0000 (Coordinated Universal Time), tinyint: 127, smallint: 32767, real: 123.44999694824219, double: 12345.6789, decimal: 12345.6789, bigint: 9223372036854776000, integer: 2147483647, varchar: Athena SQL, varbinary: Hello world, boolean: false      "`
    );
  });
});
