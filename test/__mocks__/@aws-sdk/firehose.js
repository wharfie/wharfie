'use strict';

class FirehoseMock {
  __setMockState(firehoseState = {}) {
    FirehoseMock.__state = firehoseState;
  }

  __getMockState() {
    return FirehoseMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'PutRecordBatchCommand':
        return await this.putRecordBatch(command.input);
    }
  }

  async putRecordBatch(params) {
    if (!FirehoseMock.__state[params.DeliveryStreamName]) {
      FirehoseMock.__state[params.DeliveryStreamName] = [];
    }
    FirehoseMock.__state[params.DeliveryStreamName].push(...params.Records);
    return {};
  }
}

/** @type {Object<string, string[]>} */
FirehoseMock.__state = {};

module.exports = FirehoseMock;
