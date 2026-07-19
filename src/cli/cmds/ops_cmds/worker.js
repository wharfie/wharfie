import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import {
  displayFailure,
  displayInfo,
  displaySuccess,
} from '../../output/basic.js';
import { createDurableWorkerCommand } from '../../../core/runtime/operator/durable-worker-command.js';

const workerCommand = createDurableWorkerCommand({
  includeDirOption: true,
  output: {
    info: displayInfo,
    success: displaySuccess,
    failure: displayFailure,
  },
  loadExecution: loadPreparedDurableExecution,
});

export default workerCommand;
