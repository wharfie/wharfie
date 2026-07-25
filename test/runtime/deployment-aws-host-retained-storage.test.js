import { describe, expect, it, jest } from '@jest/globals';

import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import {
  AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
  createAwsSingleNodeHostControlStorageAdapter,
  getAwsSingleNodeHostRetainedFilesystemUuid,
  getAwsSingleNodeHostRetainedStorageLayout,
  validateAwsSingleNodeHostApplicationStorageEvidence,
  validateAwsSingleNodeHostControlStorageEvidence,
  validateAwsSingleNodeHostRetainedStorageDesired,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  makeReconcileFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const RUNTIME_UID = 1001;
const RUNTIME_GID = 1002;

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
function runtimeEvidence(request) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: request.requestId,
    accountId: request.providerScope.accountId,
    userId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
    arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
  });
}

/**
 * @param {Readonly<AnyRecord>} request
 * @param {'application-storage'|'control-storage'} stepKind
 * @param {Readonly<AnyRecord>|null} applicationEvidence
 * @param {number} [attemptGeneration]
 * @param {AnyRecord} [overrides]
 * @returns {Readonly<AnyRecord>}
 */
function makeContext(
  request,
  stepKind,
  applicationEvidence,
  attemptGeneration = 0,
  overrides = {},
) {
  const priorEvidence = {
    'runtime-identity': runtimeEvidence(request),
    ...(stepKind === 'control-storage'
      ? { 'application-storage': applicationEvidence }
      : {}),
  };
  return deepFreeze({
    request,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(request, stepKind),
      kind: stepKind,
      attemptGeneration,
    },
    priorEvidence,
    ...overrides,
  });
}

/**
 * @param {Readonly<AnyRecord>} desired
 * @param {AnyRecord} [deviceOverrides]
 * @param {AnyRecord} [evidenceOverrides]
 * @returns {Readonly<AnyRecord>}
 */
function evidenceFromDesired(
  desired,
  deviceOverrides = {},
  evidenceOverrides = {},
) {
  const application = desired.capabilityKind === 'application-state';
  const device = {
    nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    nvmeSerialVolumeId: desired.volumeProviderResourceId,
    path: application ? '/dev/nvme1n1' : '/dev/nvme2n1',
    major: 259,
    minor: application ? 1 : 2,
    ...deviceOverrides,
  };
  return deepFreeze({
    ...clone(desired),
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
    kind: application
      ? AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND
      : AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
    device,
    mount: {
      ...clone(desired.mount),
      sourcePath: device.path,
      mounted: true,
    },
    ...evidenceOverrides,
  });
}

/**
 * @param {'application'|'control'} role
 * @param {(desired: Readonly<AnyRecord>) => unknown} [inspectImplementation]
 * @param {(desired: Readonly<AnyRecord>) => unknown} [convergeImplementation]
 * @param {AnyRecord} [optionOverrides]
 * @returns {{adapter: Readonly<AnyRecord>, inspect: AnyRecord, converge: AnyRecord}}
 */
function makeAdapter(
  role,
  inspectImplementation = () => ({ status: 'ready' }),
  convergeImplementation = () => ({ ignored: true }),
  optionOverrides = {},
) {
  const inspect = jest.fn(inspectImplementation);
  const converge = jest.fn(convergeImplementation);
  const create =
    role === 'application'
      ? createAwsSingleNodeHostApplicationStorageAdapter
      : createAwsSingleNodeHostControlStorageAdapter;
  const adapter = create({
    runtimeUid: RUNTIME_UID,
    runtimeGid: RUNTIME_GID,
    command: { inspect, converge },
    ...optionOverrides,
  });
  return { adapter, inspect, converge };
}

/**
 * Observe application storage once and synthesize its exact settled evidence.
 * @param {Readonly<AnyRecord>} request
 * @returns {Promise<{context: Readonly<AnyRecord>, evidence: Readonly<AnyRecord>, desired: Readonly<AnyRecord>}>}
 */
async function makeApplicationEvidence(request) {
  /** @type {Readonly<AnyRecord>|undefined} */
  let desired;
  const { adapter } = makeAdapter('application', (input) => {
    desired = input;
    return { status: 'ready' };
  });
  const context = makeContext(request, 'application-storage', null);
  await adapter.observe(context);
  if (desired === undefined) throw new Error('application desired not read');
  return {
    context,
    desired,
    evidence: evidenceFromDesired(desired),
  };
}

describe('AWS single-node host retained storage', () => {
  it('derives fixed local-app mount targets and stable role-separated UUIDv8 values', () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const reconcileRequest = createAwsSingleNodeHostActivationRequest(
      makeReconcileFixture(fixture).requestContext,
    );
    const layout = getAwsSingleNodeHostRetainedStorageLayout(request);
    const applicationUuid = getAwsSingleNodeHostRetainedFilesystemUuid(
      request,
      'application-state',
    );
    const controlUuid = getAwsSingleNodeHostRetainedFilesystemUuid(
      request,
      'control-state',
    );

    expect(layout).toEqual({
      dataRoot: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT,
      applicationMountTarget: `${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT}/applications/${request.appId}/state/application-state`,
      controlMountTarget: `${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT}/applications/${request.appId}/state/control`,
    });
    expect(applicationUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(controlUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    expect(applicationUuid).not.toBe(controlUuid);
    expect(
      getAwsSingleNodeHostRetainedFilesystemUuid(
        reconcileRequest,
        'application-state',
      ),
    ).toBe(applicationUuid);
    expectDeepFrozen(layout);
  });

  it('passes one exact frozen role-specific desired contract without requested aliases', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const application = makeAdapter('application');
    const context = makeContext(request, 'application-storage', null);

    await expect(application.adapter.observe(context)).resolves.toEqual({
      status: 'ready',
    });

    expect(application.inspect).toHaveBeenCalledTimes(1);
    const desired = application.inspect.mock.calls[0][0];
    expect(desired).toMatchObject({
      kind: 'awsSingleNodeHostApplicationStorageDesired',
      requestId: request.requestId,
      capabilityKind: 'application-state',
      volumeProviderResourceId: request.volumes[0].volumeProviderResourceId,
      sizeBytes: request.volumes[0].sizeBytes,
      createdWithoutSnapshot: true,
      filesystem: {
        type: 'ext4',
        profileId: 'wharfie-ext4-v1',
      },
      mount: {
        target:
          getAwsSingleNodeHostRetainedStorageLayout(request)
            .applicationMountTarget,
        readOnly: false,
        nodev: true,
        noexec: true,
        nosuid: true,
        privatePropagation: true,
      },
      directory: {
        user: 'wharfie-runtime',
        group: 'wharfie-runtime',
        uid: RUNTIME_UID,
        gid: RUNTIME_GID,
        mode: 0o700,
      },
      bootWiring: {
        projectionId: 'wharfie-systemd-retained-storage-v2',
        persistent: true,
        enabled: true,
        sourceByVolumeIdentity: true,
        orderedBeforeRuntimeUserManager: true,
      },
    });
    expect(JSON.stringify(desired)).not.toContain(
      request.volumes[0].requestedDeviceName,
    );
    const validatedDesired = validateAwsSingleNodeHostRetainedStorageDesired(
      clone(desired),
    );
    expect(validatedDesired).toEqual(desired);
    expect(validatedDesired).not.toBe(desired);
    expectDeepFrozen(validatedDesired);
    expectDeepFrozen(desired);
  });

  it('independently rejects desired role, stable identity, path, security, account, and wiring forgeries', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    /** @type {Readonly<AnyRecord>|undefined} */
    let desired;
    const { adapter } = makeAdapter('application', (input) => {
      desired = input;
      return { status: 'ready' };
    });
    await adapter.observe(makeContext(request, 'application-storage', null));
    if (desired === undefined) throw new Error('desired storage was not read');

    const mutations = [
      (/** @type {AnyRecord} */ candidate) => {
        candidate.kind = 'awsSingleNodeHostControlStorageDesired';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.filesystem.uuid = '00000000-0000-8000-8000-000000000000';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.filesystem.profileId = 'forged-profile';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.mount.target = `${candidate.mount.target}-forged`;
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.appId = `${'a-'.repeat(31)}a`;
        candidate.mount.target = `${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_DATA_ROOT}/applications/${candidate.appId}/state/application-state`;
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.mount.nodev = false;
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.directory.user = 'root';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.bootWiring.id = `${candidate.bootWiring.id}-forged`;
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.bootWiring.projectionId =
          'wharfie-systemd-retained-storage-v1';
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.directory.uid = 65_534;
      },
      (/** @type {AnyRecord} */ candidate) => {
        candidate.attachmentBindingId = candidate.volumeBindingId;
      },
    ];
    for (const mutate of mutations) {
      const candidate = clone(desired);
      mutate(candidate);
      expect(() =>
        validateAwsSingleNodeHostRetainedStorageDesired(candidate),
      ).toThrow();
    }

    const accessor = clone(desired);
    Object.defineProperty(accessor, 'mount', {
      enumerable: true,
      get() {
        throw new Error('must not invoke desired accessor');
      },
    });
    expect(() =>
      validateAwsSingleNodeHostRetainedStorageDesired(accessor),
    ).toThrow(/plain JSON property/u);
  });

  it.each(['ready', 'unknown', 'conflict'])(
    'normalizes and freezes the exact %s observation',
    async (status) => {
      const request = createAwsSingleNodeHostActivationRequest(
        makeFixture().requestContext,
      );
      const { adapter } = makeAdapter('application', () => ({ status }));

      const result = await adapter.observe(
        makeContext(request, 'application-storage', null),
      );

      expect(result).toEqual({ status });
      expectDeepFrozen(result);
    },
  );

  it('normalizes exact settled evidence and binds it generically and at the factory', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    /** @type {Readonly<AnyRecord>|undefined} */
    let desired;
    const { adapter } = makeAdapter('application', (input) => {
      desired = input;
      return {
        status: 'settled',
        evidence: evidenceFromDesired(input),
      };
    });
    const context = makeContext(request, 'application-storage', null);

    const result = await adapter.observe(context);

    expect(result.status).toBe('settled');
    expect(result.evidence.device).toEqual({
      nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
      nvmeSerialVolumeId: request.volumes[0].volumeProviderResourceId,
      path: '/dev/nvme1n1',
      major: 259,
      minor: 1,
    });
    expect(
      validateAwsSingleNodeHostApplicationStorageEvidence(
        clone(result.evidence),
        context,
      ),
    ).toEqual(result.evidence);
    expect(adapter.validateEvidence(clone(result.evidence), context)).toEqual(
      result.evidence,
    );
    expect(desired).toBeDefined();
    expectDeepFrozen(result);
  });

  it.each([
    null,
    {},
    { status: 'settled' },
    { status: 'ready', evidence: {} },
    { status: 'settled', evidence: {} },
    { status: 'unsupported' },
  ])('bounds malformed command result %# as unknown', async (result) => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const { adapter } = makeAdapter('application', () => result);

    await expect(
      adapter.observe(makeContext(request, 'application-storage', null)),
    ).resolves.toEqual({ status: 'unknown' });
  });

  it('maps command failure to unknown without weakening malformed V66 context rejection', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const { adapter } = makeAdapter('application', () => {
      throw new Error('raw command diagnostic');
    });

    await expect(
      adapter.observe(makeContext(request, 'application-storage', null)),
    ).resolves.toEqual({ status: 'unknown' });
    await expect(
      adapter.observe(
        makeContext(request, 'application-storage', null, 0, {
          priorEvidence: {},
        }),
      ),
    ).rejects.toThrow(/runtime-identity/u);
  });

  it('requires a positive V66 attempt, passes the exact desired, and ignores converge response', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const { adapter, inspect, converge } = makeAdapter(
      'application',
      () => ({ status: 'ready' }),
      () => ({ untrusted: 'mutation-response' }),
    );
    const observeContext = makeContext(request, 'application-storage', null, 0);
    const effectContext = makeContext(request, 'application-storage', null, 1);

    await adapter.observe(observeContext);
    await expect(adapter.converge(effectContext)).resolves.toBeUndefined();

    expect(converge).toHaveBeenCalledTimes(1);
    expect(converge.mock.calls[0][0]).toEqual({
      desired: inspect.mock.calls[0][0],
      intentId: effectContext.step.intentId,
      attemptGeneration: 1,
    });
    expectDeepFrozen(converge.mock.calls[0][0]);
    await expect(adapter.converge(observeContext)).rejects.toThrow(
      /positive safe integer/u,
    );
  });

  it('enforces exact factories, own-data commands, and fixed public roles', () => {
    const command = {
      inspect() {
        return { status: 'ready' };
      },
      converge() {},
    };
    expect(() =>
      createAwsSingleNodeHostApplicationStorageAdapter({
        runtimeUid: RUNTIME_UID,
        runtimeGid: RUNTIME_GID,
        command,
        role: 'control-state',
      }),
    ).toThrow(/role is not supported/u);
    expect(() =>
      createAwsSingleNodeHostControlStorageAdapter({
        runtimeUid: RUNTIME_UID,
        runtimeGid: RUNTIME_GID,
        command: {
          get inspect() {
            throw new Error('must not invoke accessor');
          },
          converge() {},
        },
      }),
    ).toThrow(/own data property/u);
  });

  it('revalidates the runtime frontier and rejects role evidence substitution', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const application = await makeApplicationEvidence(request);
    const forgedRuntime = /** @type {AnyRecord} */ (
      clone(runtimeEvidence(request))
    );
    forgedRuntime.accountId = '999999999999';
    const appContext = makeContext(request, 'application-storage', null, 0, {
      priorEvidence: { 'runtime-identity': forgedRuntime },
    });
    const { adapter } = makeAdapter('application');

    await expect(adapter.observe(appContext)).rejects.toThrow(
      /accountId does not match/u,
    );

    /** @type {Readonly<AnyRecord>|undefined} */
    let controlDesired;
    const control = makeAdapter('control', (input) => {
      controlDesired = input;
      return { status: 'ready' };
    });
    const controlContext = makeContext(
      request,
      'control-storage',
      application.evidence,
    );
    await control.adapter.observe(controlContext);
    if (controlDesired === undefined)
      throw new Error('control desired missing');
    const controlEvidence = evidenceFromDesired(controlDesired);
    expect(() =>
      validateAwsSingleNodeHostApplicationStorageEvidence(
        clone(controlEvidence),
        application.context,
      ),
    ).toThrow(/kind/u);
    expect(() =>
      validateAwsSingleNodeHostControlStorageEvidence(
        clone(application.evidence),
        controlContext,
      ),
    ).toThrow(/kind/u);
  });

  it('revalidates application evidence before control command invocation', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const application = await makeApplicationEvidence(request);
    const forgedApplication = /** @type {AnyRecord} */ (
      clone(application.evidence)
    );
    forgedApplication.requestId =
      'whaq1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const control = makeAdapter('control');

    await expect(
      control.adapter.observe(
        makeContext(request, 'control-storage', deepFreeze(forgedApplication)),
      ),
    ).rejects.toThrow(/settled-evidence-mismatch/u);
    expect(control.inspect).not.toHaveBeenCalled();
  });

  it.each([
    [
      'path',
      (/** @type {Readonly<AnyRecord>} */ application) => ({
        path: application.device.path,
      }),
    ],
    [
      'major and minor',
      (/** @type {Readonly<AnyRecord>} */ application) => ({
        major: application.device.major,
        minor: application.device.minor,
      }),
    ],
  ])('classifies a cross-role %s alias as conflict', async (_label, alias) => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const application = await makeApplicationEvidence(request);
    const control = makeAdapter('control', (desired) => ({
      status: 'settled',
      evidence: evidenceFromDesired(desired, alias(application.evidence)),
    }));

    await expect(
      control.adapter.observe(
        makeContext(request, 'control-storage', application.evidence),
      ),
    ).resolves.toEqual({ status: 'conflict' });
  });

  it('settles distinct control media with separate identity, mount, and evidence kind', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const application = await makeApplicationEvidence(request);
    const control = makeAdapter('control', (desired) => ({
      status: 'settled',
      evidence: evidenceFromDesired(desired),
    }));
    const context = makeContext(
      request,
      'control-storage',
      application.evidence,
    );

    const result = await control.adapter.observe(context);

    expect(result).toMatchObject({
      status: 'settled',
      evidence: {
        kind: AWS_SINGLE_NODE_HOST_CONTROL_STORAGE_EVIDENCE_KIND,
        capabilityKind: 'control-state',
        device: {
          path: '/dev/nvme2n1',
          major: 259,
          minor: 2,
        },
      },
    });
    expect(
      validateAwsSingleNodeHostControlStorageEvidence(
        clone(result.evidence),
        context,
      ),
    ).toEqual(result.evidence);
    expectDeepFrozen(result);
  });

  it('binds factory UID/GID while generic validation accepts only their strict shape', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const application = await makeApplicationEvidence(request);
    const genericEvidence = clone(application.evidence);
    genericEvidence.directory.uid = 2001;
    genericEvidence.directory.gid = 2002;
    const generic = validateAwsSingleNodeHostApplicationStorageEvidence(
      genericEvidence,
      application.context,
    );
    expect(generic.directory).toMatchObject({ uid: 2001, gid: 2002 });

    const { adapter } = makeAdapter('application', () => ({
      status: 'settled',
      evidence: genericEvidence,
    }));
    await expect(adapter.observe(application.context)).resolves.toEqual({
      status: 'conflict',
    });

    /** @type {Readonly<AnyRecord>|undefined} */
    let controlDesired;
    const control = makeAdapter('control', (desired) => {
      controlDesired = desired;
      return { status: 'ready' };
    });
    const controlContext = makeContext(
      request,
      'control-storage',
      application.evidence,
    );
    await control.adapter.observe(controlContext);
    if (controlDesired === undefined)
      throw new Error('control desired missing');
    const differentControlAccount = /** @type {AnyRecord} */ (
      clone(evidenceFromDesired(controlDesired))
    );
    differentControlAccount.directory.uid = 2001;
    differentControlAccount.directory.gid = 2002;
    expect(() =>
      validateAwsSingleNodeHostControlStorageEvidence(
        differentControlAccount,
        controlContext,
      ),
    ).toThrow(/cross-role-runtime-account-mismatch/u);
  });

  it('binds stable request evidence while allowing reboot-variable device identity', async () => {
    const request = createAwsSingleNodeHostActivationRequest(
      makeFixture().requestContext,
    );
    const application = await makeApplicationEvidence(request);
    const rebooted = clone(application.evidence);
    rebooted.device.path = '/dev/nvme3n1';
    rebooted.device.major = 260;
    rebooted.device.minor = 7;
    rebooted.mount.sourcePath = rebooted.device.path;

    expect(
      validateAwsSingleNodeHostApplicationStorageEvidence(
        rebooted,
        application.context,
      ),
    ).toMatchObject({
      device: {
        nvmeSerialVolumeId: request.volumes[0].volumeProviderResourceId,
        path: '/dev/nvme3n1',
        major: 260,
        minor: 7,
      },
    });

    const reconcileRequest = createAwsSingleNodeHostActivationRequest(
      makeReconcileFixture(makeFixture()).requestContext,
    );
    expect(() =>
      validateAwsSingleNodeHostApplicationStorageEvidence(
        clone(application.evidence),
        makeContext(reconcileRequest, 'application-storage', null),
      ),
    ).toThrow(/settled-evidence-mismatch/u);
  });
});
