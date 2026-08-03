import { EXECUTION_PAYLOAD_MAX_BYTES } from '../../runtime/execution-payload.js';

export const EXECUTION_LEDGER_RUN_OUTPUT_SCHEMA_VERSION = 1;
export const EXECUTION_LEDGER_RUN_OUTPUT_KIND =
  'wharfie.execution-ledger.run-output';
export const EXECUTION_LEDGER_RUN_OUTPUT_DISCLOSURE =
  'application-sensitive-unredacted';

/**
 * One snapshot may contain a completed workflow prefix and repeat its final
 * value as the aggregate terminal result. Keep that useful v1 document
 * bounded while leaving larger histories for a future paged export contract.
 */
export const EXECUTION_LEDGER_RUN_OUTPUT_MAX_BYTES =
  EXECUTION_PAYLOAD_MAX_BYTES * 4;

export default {
  EXECUTION_LEDGER_RUN_OUTPUT_DISCLOSURE,
  EXECUTION_LEDGER_RUN_OUTPUT_KIND,
  EXECUTION_LEDGER_RUN_OUTPUT_MAX_BYTES,
  EXECUTION_LEDGER_RUN_OUTPUT_SCHEMA_VERSION,
};
