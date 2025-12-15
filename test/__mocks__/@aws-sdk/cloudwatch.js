import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

class CloudWatchMock {
  __setMockState(state = {}) {
    CloudWatchMock.__state = state;
  }

  __getMockState() {
    return CloudWatchMock.__state;
  }

  putMetricData(params) {
    if (!CloudWatchMock.__state[params.Namespace])
      CloudWatchMock.__state[params.Namespace] = [];
    for (const metric of params.MetricData) {
      CloudWatchMock.__state[params.Namespace].push(metric);
    }
    return {
      promise: async () => Promise.resolve(),
    };
  }
}

CloudWatchMock.__state = {};

module.exports = CloudWatchMock;
