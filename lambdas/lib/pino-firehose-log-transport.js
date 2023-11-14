'use strict';

const FirehoseLogTransport = require('./firehose-log-transport');

module.exports = (
  /** @type {{ flushInterval: Number; logDeliveryStreamName: string; }} */ options
) => {
  const transport = new FirehoseLogTransport({
    flushInterval: options.flushInterval,
    logDeliveryStreamName: options.logDeliveryStreamName,
  });
  return transport._stream;
};
