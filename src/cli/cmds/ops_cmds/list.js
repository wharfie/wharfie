import { loadApp } from '../../app/load-app.js';
import { createExecutionLedgerHistoryCommand } from '../../../core/runtime/operator/execution-ledger-history-command.js';

/**
 * Build the source run-history command. Source mode resolves application scope
 * from the same strict manifest as other authored-app commands; the shared
 * history implementation opens only the already-existing control state.
 * @param {{loadApp?: typeof loadApp}} [options] - Source identity seam.
 * @returns {import('commander').Command} - Fresh source history command.
 */
export function createSourceExecutionLedgerHistoryCommand(options = {}) {
  const loadSourceApp = options.loadApp || loadApp;
  return createExecutionLedgerHistoryCommand({
    allowDirectory: true,
    async resolveIdentity(identityInput) {
      const loaded = await loadSourceApp(
        identityInput.dir === undefined ? {} : { dir: identityInput.dir },
      );
      return { appId: loaded.manifest.app.id };
    },
  });
}
