import { loadPreparedDurableExecution } from '../../app/load-durable-execution.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';
import { createDurableSubmitCommand } from '../../../core/runtime/operator/durable-submit-command.js';

const submitCommand = createDurableSubmitCommand({
  includeDirOption: true,
  output: {
    success: displaySuccess,
    failure: displayFailure,
  },
  loadExecution: loadPreparedDurableExecution,
});

export default submitCommand;
