import { getAwsSingleNodeHostActivationIntentId } from '../../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
  createAwsSingleNodeHostControlStorageAdapter,
} from '../../../src/core/runtime/deployment-aws-host-retained-storage.js';
import { createAwsSingleNodeHostRuntimeIdentityAdapter } from '../../../src/core/runtime/deployment-aws-host-runtime-identity.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Build the exact V66 adapter context shape in one test-only location.
 * @param {Readonly<AnyRecord>} request - Exact activation request.
 * @param {string} kind - Exact activation step kind.
 * @param {Readonly<AnyRecord>} priorEvidence - Complete predecessor evidence.
 * @param {number} [attemptGeneration] - Durable attempt generation.
 * @returns {Readonly<AnyRecord>} - Frozen exact adapter context.
 */
export function createAwsSingleNodeHostTestStepContext(
  request,
  kind,
  priorEvidence,
  attemptGeneration = 0,
) {
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(request, kind),
      kind,
      attemptGeneration,
    },
    priorEvidence,
  });
}

/**
 * Add only the live device projection that separates a retained-storage
 * desired contract from settled evidence. The complete stable schema comes
 * from the production adapter rather than being copied into tests.
 * @param {Readonly<AnyRecord>} desired - Production-emitted desired contract.
 * @returns {Readonly<AnyRecord>} - Candidate settled command evidence.
 */
function settledEvidenceFromDesired(desired) {
  const application = desired.capabilityKind === 'application-state';
  const device = {
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: desired.volumeProviderResourceId,
    path: application ? '/dev/nvme1n1' : '/dev/nvme2n1',
    major: 259,
    minor: application ? 1 : 2,
  };
  return deepFreeze({
    ...desired,
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
    kind: application
      ? AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND
      : AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
    device,
    mount: {
      ...desired.mount,
      sourcePath: device.path,
      mounted: true,
    },
  });
}

/**
 * Create the exact settled runtime/application/control prefix through the
 * concrete production validators. The returned adapters can also be composed
 * into activation-kernel integration tests.
 * @param {Readonly<AnyRecord>} request - Exact activation request.
 * @returns {Promise<Readonly<{priorEvidence: Readonly<AnyRecord>, steps: Readonly<AnyRecord>}>>}
 */
export async function createAwsSingleNodeHostSettledStorageFixture(request) {
  const runtimeIdentity = createAwsSingleNodeHostRuntimeIdentityAdapter({
    client: {
      async getCallerIdentity() {
        return {
          Account: request.providerScope.accountId,
          UserId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
          Arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
        };
      },
    },
    providerScope: request.providerScope,
    maxAttempts: 1,
    attemptTimeoutMilliseconds: 100,
  });
  const runtimeContext = createAwsSingleNodeHostTestStepContext(
    request,
    'runtime-identity',
    {},
  );
  const runtimeObservation = await runtimeIdentity.observe(runtimeContext);
  if (runtimeObservation.status !== 'settled') {
    throw new Error('test runtime identity did not settle');
  }

  /** @returns {Readonly<AnyRecord>} */
  function createStorageCommand() {
    return Object.freeze({
      /** @param {Readonly<AnyRecord>} desired - Exact role desired state. */
      inspect(desired) {
        return {
          status: 'settled',
          evidence: settledEvidenceFromDesired(desired),
        };
      },
      converge() {
        throw new Error('settled test storage must not converge');
      },
    });
  }

  const applicationStorage = createAwsSingleNodeHostApplicationStorageAdapter({
    command: createStorageCommand(),
  });
  const applicationContext = createAwsSingleNodeHostTestStepContext(
    request,
    'application-storage',
    {
      'runtime-identity': runtimeObservation.evidence,
    },
  );
  const applicationObservation =
    await applicationStorage.observe(applicationContext);
  if (applicationObservation.status !== 'settled') {
    throw new Error('test application storage did not settle');
  }

  const controlStorage = createAwsSingleNodeHostControlStorageAdapter({
    command: createStorageCommand(),
  });
  const controlContext = createAwsSingleNodeHostTestStepContext(
    request,
    'control-storage',
    {
      'runtime-identity': runtimeObservation.evidence,
      'application-storage': applicationObservation.evidence,
    },
  );
  const controlObservation = await controlStorage.observe(controlContext);
  if (controlObservation.status !== 'settled') {
    throw new Error('test control storage did not settle');
  }

  return deepFreeze({
    priorEvidence: {
      'runtime-identity': runtimeObservation.evidence,
      'application-storage': applicationObservation.evidence,
      'control-storage': controlObservation.evidence,
    },
    steps: {
      runtimeIdentity,
      applicationStorage,
      controlStorage,
    },
  });
}
