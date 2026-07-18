import { describe, expect, test } from '@jest/globals';

import * as ledgerFacade from '../../src/core/lib/db/tables/execution-ledger.js';
import * as ledgerContract from '../../src/core/lib/ledger/execution-ledger-contract.js';

describe('execution ledger contract facade', () => {
  test('preserves public status, error, constant, and function identity', () => {
    const names = /** @type {const} */ ([
      'AttemptStatus',
      'EffectStatus',
      'EXECUTION_LEDGER_MAX_EVENT_PAYLOAD_BYTES',
      'EXECUTION_LEDGER_MAX_EVIDENCE_FRAMES',
      'EXECUTION_LEDGER_MAX_INLINE_PAYLOAD_BYTES',
      'EXECUTION_LEDGER_MAX_OPAQUE_ID_BYTES',
      'EXECUTION_LEDGER_MAX_REFERENCED_PAYLOAD_BYTES',
      'EXECUTION_LEDGER_SCHEMA_VERSION',
      'ExecutionLedgerConflictError',
      'ExecutionLedgerNotFoundError',
      'ExecutionLedgerProjectionError',
      'ExecutionLedgerRunConflictError',
      'ExecutionLedgerTransitionConflictError',
      'InvocationStatus',
      'RunStatus',
      'createManagedEffectDestinationId',
    ]);

    for (const name of names) {
      expect(ledgerFacade[name]).toBe(ledgerContract[name]);
    }
  });

  test('preserves the V5 destination-effect identity vector', () => {
    expect(
      ledgerFacade.createManagedEffectDestinationId({
        appId: 'contract-app',
        runId: 'contract-run',
        invocationId: 'contract-invocation',
        effectId: 'contract-effect',
      }),
    ).toBe('wfx_hVhZ-2ru1WjTXW08ht-j482ecKSplq7svM9wSTEVMf8');
  });
});
