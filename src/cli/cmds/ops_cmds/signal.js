import { createDurableWorkflowSignalCommand } from '../../../core/runtime/operator/durable-workflow-signal-command.js';
import { displayFailure, displaySuccess } from '../../output/basic.js';

const signalCommand = createDurableWorkflowSignalCommand({
  output: {
    success: displaySuccess,
    failure: displayFailure,
  },
});

export default signalCommand;
