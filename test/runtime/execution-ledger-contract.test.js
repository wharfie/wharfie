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
      'EXECUTION_LEDGER_MAX_UNRESOLVED_MANAGED_EFFECTS',
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

  test('preserves the V8 destination-effect identity vector', () => {
    expect(ledgerContract.EXECUTION_LEDGER_SCHEMA_VERSION).toBe(8);
    expect(
      ledgerFacade.createManagedEffectDestinationId({
        appId: 'contract-app',
        runId: 'contract-run',
        invocationId: 'contract-invocation',
        effectId: 'contract-effect',
      }),
    ).toBe('wfx_5y4LZtVgt_tExRKnCKEo5yAydwgrlHN0VLM3WG6RPwA');
  });

  test('normalizes an exact immutable destination binding shape', () => {
    const destination = {
      kind: 'application-state',
      version: 1,
      bindingId: 'primary',
      configuration: { namespace: 'contract-app', tableName: 'records' },
    };
    expect(
      ledgerContract.normalizeEffectDestinationDescriptor(
        destination,
        'destination',
      ),
    ).toEqual(destination);
    expect(
      ledgerContract.normalizeEffectDestinationDescriptor(
        { ...destination, bindingId: 'secondary' },
        'destination',
      ),
    ).not.toEqual(destination);
    expect(() =>
      ledgerContract.normalizeEffectDestinationDescriptor(
        { ...destination, unsupported: {} },
        'destination',
      ),
    ).toThrow(/exactly/i);
  });

  test('rejects an outcome bound to a different destination', () => {
    const destination = {
      kind: 'application-state',
      version: 1,
      bindingId: 'primary',
      configuration: { namespace: 'contract-app', tableName: 'records' },
    };
    const adapter = { id: 'application-state-put', version: 1 };
    const verifier = { kind: 'application-state-receipt', version: 1 };
    const outcome = ledgerContract.normalizeManagedEffectOutcome(
      {
        destinationEffectId: 'destination-effect',
        adapter,
        destination: { ...destination, bindingId: 'secondary' },
        verifier,
        ok: true,
        result: { created: true },
        substantiatedReplayProperties: ['transactional'],
        evidence: { receipt: 'receipt-1' },
      },
      'outcome',
    );
    expect(() =>
      ledgerContract.verifyManagedEffectOutcome(
        new Map(),
        {
          destinationEffectId: 'destination-effect',
          adapter,
          destination,
          verifier,
          substantiatedReplayProperties: ['transactional'],
        },
        /** @type {any} */ ({}),
        outcome,
        'outcome',
      ),
    ).toThrow(/persisted effect contract/i);
  });
});
