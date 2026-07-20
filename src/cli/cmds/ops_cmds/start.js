import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { createDurableWorkflowStartCommand } from '../../../core/runtime/operator/durable-workflow-start-command.js';

const startCommand = createDurableWorkflowStartCommand({
  includeDirOption: true,
  output: {
    success: displaySuccess,
    failure: displayFailure,
  },
  loadExecution: loadPreparedDurableExecution,
});

export default startCommand;
