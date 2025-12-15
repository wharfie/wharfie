import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

class SNSMock {
  __setMockState(snsState = {}) {
    SNSMock.__state = snsState;
  }

  __getMockState() {
    return SNSMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'PublishCommand':
        return await this.publish(command.input);
    }
  }

  async publish(params) {
    if (!SNSMock.__state[params.TopicArn])
      SNSMock.__state[params.TopicArn] = [];
    SNSMock.__state[params.TopicArn].push(params.Message);
  }
}

SNSMock.__state = {};

module.exports = SNSMock;
