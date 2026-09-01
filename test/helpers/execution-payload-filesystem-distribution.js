import { createLocalExecutionPayloadStore } from '../../src/core/lib/payload-store/local.js';
import { normalizeExecutionPayloadDistributionIdentity } from '../../src/core/lib/payload-store/replicated.js';

/**
 * Build a test-only immutable execution-payload distribution whose verified
 * bytes survive process death. The local content-addressed store already owns
 * create-if-absent publication, fsync, exact readback, and integrity checks;
 * this adapter only supplies the provider-neutral distribution port used by
 * replicated payload stores in separate crash processes.
 * @param {{identity: unknown, root: string}} options - Exact distribution scope.
 * @returns {{identity: Readonly<Record<string, any>>, publishImmutable: (input: {reference: unknown, bytes: Buffer}) => Promise<void>, readBytes: (reference: unknown) => Promise<Buffer>}} - Process-durable distribution port.
 */
export function createFilesystemExecutionPayloadDistribution(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError(
      'Filesystem execution-payload distribution requires options.',
    );
  }
  if (typeof options.root !== 'string' || options.root.length === 0) {
    throw new TypeError(
      'Filesystem execution-payload distribution requires a root.',
    );
  }
  const identity = normalizeExecutionPayloadDistributionIdentity(
    options.identity,
    'filesystem execution-payload distribution identity',
  );
  const artifacts = createLocalExecutionPayloadStore({
    path: options.root,
    storeId: identity.storeId,
  });
  return Object.freeze({
    identity,
    async publishImmutable({ reference, bytes }) {
      await artifacts.importBytes({ reference, bytes });
    },
    async readBytes(reference) {
      return await artifacts.readBytes(reference);
    },
  });
}

export default createFilesystemExecutionPayloadDistribution;
