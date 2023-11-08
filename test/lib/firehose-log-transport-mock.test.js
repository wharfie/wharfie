/* eslint-disable jest/no-hooks */
'use strict';

let FirehoseLogTransport;
let firehoseLogTransport;
describe('mock tests for firehose log transport', () => {
  beforeAll(() => {
    process.env.AWS_MOCKS = true;
    jest.requireMock('@aws-sdk/client-firehose');
    FirehoseLogTransport = require('../../lambdas/lib/firehose-log-transport');
    firehoseLogTransport = new FirehoseLogTransport(
      {},
      { flushInterval: -1, logDeliveryStreamName: 'test-stream' }
    );
  });
  afterEach(() => {
    firehoseLogTransport.flushBuffer();
    firehoseLogTransport.firehose.__setMockState();
  });
  afterAll(() => {
    process.env.AWS_MOCKS = false;
  });

  it('log mock test basic', async () => {
    expect.assertions(3);
    await firehoseLogTransport.log('test1', () => {});
    await firehoseLogTransport.log('test2', () => {});
    await firehoseLogTransport.log('test3', () => {});
    await firehoseLogTransport.log('test4', () => {});
    await firehoseLogTransport.flushBuffer();
    await firehoseLogTransport.log('test5', () => {});
    await firehoseLogTransport.log('test6', () => {});
    await firehoseLogTransport.close();
    expect(
      firehoseLogTransport.firehose.__getMockState()['test-stream']
    ).toHaveLength(2);
    expect(
      firehoseLogTransport.firehose
        .__getMockState()
        ['test-stream'][0].Data.toString()
    ).toMatchInlineSnapshot(`
      "\\"test1\\"
      \\"test2\\"
      \\"test3\\"
      \\"test4\\"
      "
    `);
    expect(
      firehoseLogTransport.firehose
        .__getMockState()
        ['test-stream'][1].Data.toString()
    ).toMatchInlineSnapshot(`
      "\\"test5\\"
      \\"test6\\"
      "
    `);
  });

  it('log mock test binpacking', async () => {
    expect.assertions(2);
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE + 2).join('a') },
      () => {}
    );
    await firehoseLogTransport.log('test2', () => {});
    await firehoseLogTransport.log('test3', () => {});
    await firehoseLogTransport.log('test4', () => {});
    await firehoseLogTransport.close();
    expect(
      firehoseLogTransport.firehose.__getMockState()['test-stream']
    ).toHaveLength(2);
    expect(
      firehoseLogTransport.firehose
        .__getMockState()
        ['test-stream'][1].Data.toString()
    ).toMatchInlineSnapshot(`
      "\\"test2\\"
      \\"test3\\"
      \\"test4\\"
      "
    `);
  });

  it('log mock test autoFlush bytesize', async () => {
    expect.assertions(1);
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE).join('a') },
      () => {}
    );
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE).join('b') },
      () => {}
    );
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE).join('c') },
      () => {}
    );
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE).join('d') },
      () => {}
    );
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE).join('e') },
      () => {}
    );
    expect(
      firehoseLogTransport.firehose.__getMockState()['test-stream']
    ).toHaveLength(4);
  });

  it('log mock test autoFlush recordCount', async () => {
    expect.assertions(1);

    for (let i = 0; i < FirehoseLogTransport._MAX_BINS; i++) {
      await firehoseLogTransport.log('hi', () => {});
    }
    expect(
      firehoseLogTransport.firehose.__getMockState()['test-stream']
    ).toHaveLength(1);
  });

  it('shared output', async () => {
    expect.assertions(1);
    const firehoseLogTransportFoo = new FirehoseLogTransport(
      {},
      { flushInterval: -1, logDeliveryStreamName: 'test-stream' }
    );

    firehoseLogTransportFoo.log('hello', () => {});
    for (let i = 0; i < FirehoseLogTransport._MAX_BINS - 2; i++) {
      await firehoseLogTransport.log('hi', () => {});
    }
    firehoseLogTransportFoo.close();
    firehoseLogTransport.flushBuffer();

    expect(
      firehoseLogTransport.firehose.__getMockState()['test-stream']
    ).toStrictEqual(
      firehoseLogTransportFoo.firehose.__getMockState()['test-stream']
    );
  });

  it('log truncation', async () => {
    expect.assertions(2);
    await firehoseLogTransport.log(
      { message: new Array(FirehoseLogTransport._MAX_BIN_SIZE).join('a') },
      () => {}
    );
    await firehoseLogTransport.close();
    expect(
      firehoseLogTransport.firehose.__getMockState()['test-stream']
    ).toHaveLength(1);
    expect(
      firehoseLogTransport.firehose
        .__getMockState()
        ['test-stream'][0].Data.toString()
        .slice(0, 30)
    ).toMatchInlineSnapshot(`"{\\"message\\":\\"TRUNCATEDaaaaaaaaa"`);
  });
});
