import { describe, expect, test } from '@jest/globals';

import { createAwsSingleNodeDesiredResourceTargetCatalog } from '../../src/core/runtime/deployment-aws-desired-resource-targets.js';
import {
  AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_USER_MANAGER_GATE_ASSERTION_KIND,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_USER_MANAGER_GATE_ASSERTION_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_DOMAIN,
  AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
  createAwsSingleNodeHostDeactivationReceipt,
  createAwsSingleNodeHostDeactivationRequest,
  validateAwsSingleNodeHostDeactivationReceipt,
  validateAwsSingleNodeHostDeactivationReceiptContext,
  validateAwsSingleNodeHostDeactivationRequest,
  validateAwsSingleNodeHostDeactivationRequestContext,
} from '../../src/core/runtime/deployment-aws-host-deactivation-contract.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';
import { createDeploymentHead } from '../../src/core/runtime/deployment-head.js';
import { createDeploymentPlan } from '../../src/core/runtime/deployment-plan.js';
import { getAwsSingleNodeResourceDestroyOrder } from '../../src/core/runtime/deployment-resource-graph.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
  reverseObjectKeys,
  semanticId,
} from './fixtures/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostSettledStorageFixture } from './fixtures/deployment-aws-host-settled-storage.js';

/** @typedef {Record<string, any>} AnyRecord */

/**
 * @param {{inspection?: number, planBasisGenerationOffset?: number, headGenerationOffset?: number, operationStatus?: 'running'|'blocked', firstIntentStatus?: 'pending'|'intended', differentLastOperation?: boolean, mutateActions?: (actions: AnyRecord[]) => AnyRecord[]}} [options]
 * @returns {Promise<Readonly<Record<string, any>>>}
 */
async function makeDestroyFixture(options = {}) {
  const fixture = makeFixture();
  const activationRequest = createAwsSingleNodeHostActivationRequest(
    fixture.requestContext,
  );
  const settledStorage =
    await createAwsSingleNodeHostSettledStorageFixture(activationRequest);
  const bindingByKey = new Map(
    fixture.bindings.map((/** @type {Readonly<AnyRecord>} */ binding) => [
      binding.resourceKey,
      binding,
    ]),
  );
  const targetByKey = new Map(
    createAwsSingleNodeDesiredResourceTargetCatalog({
      deploymentRevision: fixture.deploymentRevision,
      profile: fixture.profile,
      providerScope: fixture.providerScope,
      providerSpec: fixture.providerSpec,
      deploymentInstanceId: fixture.deploymentInstanceId,
      incarnationId: fixture.incarnationId,
      head: fixture.readyHead,
    }).map((target) => [target.resourceKey, target]),
  );
  /** @type {AnyRecord[]} */
  let actions = getAwsSingleNodeResourceDestroyOrder().map((resourceKey) => {
    const binding = bindingByKey.get(resourceKey);
    const target = targetByKey.get(resourceKey);
    if (binding === undefined || target === undefined) {
      throw new Error(`Destroy fixture lacks '${resourceKey}'.`);
    }
    const before = {
      providerType: target.target.providerType,
      providerResourceId: binding.providerResourceId,
      stateDigest: target.target.stateDigest,
    };
    const retained = binding.onDestroy === 'retain';
    return {
      resourceKey,
      capability: target.capability,
      role: target.role,
      management: target.management,
      ownershipMode: target.ownershipMode,
      dependsOn: target.dependsOn,
      onDestroy: target.onDestroy,
      action: retained ? 'noop' : 'delete',
      destructive: !retained,
      reason: retained ? 'retained-data' : 'destroy-requested',
      before,
      after: retained ? before : null,
    };
  });
  if (options.mutateActions !== undefined) {
    actions = options.mutateActions(clone(actions));
  }
  const planBasisGeneration =
    fixture.readyHead.generation + (options.planBasisGenerationOffset ?? 0);
  const plan = createDeploymentPlan(
    {
      operation: 'destroy',
      deploymentRevision: fixture.deploymentRevision,
      providerScope: fixture.providerScope,
      providerSpec: fixture.providerSpec,
      deploymentInstanceId: fixture.deploymentInstanceId,
      incarnationId: fixture.incarnationId,
      basis: {
        headGeneration: planBasisGeneration,
        settledDeploymentRevisionId:
          fixture.deploymentRevision.deploymentRevisionId,
        inspectionId: semanticId(
          'win6',
          'wharfie:test:host-deactivation-inspection:v1',
          {
            headId: fixture.readyHead.headId,
            inspection: options.inspection ?? 1,
          },
        ),
      },
      actions,
    },
    { profile: fixture.profile },
  );
  const intents = plan.actions.map(
    (/** @type {Readonly<AnyRecord>} */ action) => {
      const binding = bindingByKey.get(action.resourceKey);
      if (binding === undefined) {
        throw new Error(`Destroy fixture lacks '${action.resourceKey}'.`);
      }
      return {
        actionId: action.actionId,
        status: 'pending',
        ownershipNonce: binding.ownershipNonce,
      };
    },
  );
  if (options.firstIntentStatus !== undefined) {
    intents[0].status = options.firstIntentStatus;
  }
  const lastOperation = /** @type {AnyRecord} */ (
    clone(fixture.readyHead.lastOperation)
  );
  if (options.differentLastOperation === true) {
    delete lastOperation.operationId;
    lastOperation.planId = semanticId(
      'wpl3',
      'wharfie:test:host-deactivation-other-settlement:v1',
      fixture.readyHead.headId,
    );
  }
  const head = createDeploymentHead({
    deploymentInstanceId: fixture.deploymentInstanceId,
    providerScope: fixture.providerScope,
    incarnationId: fixture.incarnationId,
    generation: planBasisGeneration + (options.headGenerationOffset ?? 1),
    phase: 'DESTROYING',
    settledDeploymentRevisionId:
      fixture.deploymentRevision.deploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: fixture.bindings,
    activeOperation: {
      kind: 'destroy',
      planId: plan.planId,
      status: options.operationStatus ?? 'running',
      nextActionIndex: 0,
      intents,
    },
    lastOperation,
  });
  return Object.freeze({
    fixture,
    activationRequest,
    plan,
    head,
    context: Object.freeze({
      activationRequest,
      plan,
      head,
      runtimeIdentity: settledStorage.priorEvidence['runtime-identity'],
      applicationStorage: settledStorage.priorEvidence['application-storage'],
      controlStorage: settledStorage.priorEvidence['control-storage'],
    }),
  });
}

/**
 * @param {Readonly<AnyRecord>} destroy
 * @param {{generation: number, operationStatus?: 'running'|'blocked', firstIntentStatus?: 'pending'|'intended'}} options
 * @returns {Readonly<AnyRecord>}
 */
function createCurrentHead(destroy, options) {
  const activeOperation = /** @type {AnyRecord} */ (
    clone(destroy.head.activeOperation)
  );
  delete activeOperation.operationId;
  activeOperation.status = options.operationStatus ?? 'running';
  if (options.firstIntentStatus !== undefined) {
    activeOperation.intents[0].status = options.firstIntentStatus;
  }
  return createDeploymentHead({
    deploymentInstanceId: destroy.head.deploymentInstanceId,
    providerScope: destroy.head.providerScope,
    incarnationId: destroy.head.incarnationId,
    generation: options.generation,
    phase: 'DESTROYING',
    settledDeploymentRevisionId: destroy.head.settledDeploymentRevisionId,
    targetDeploymentRevisionId: null,
    resourceBindings: destroy.head.resourceBindings,
    activeOperation,
    lastOperation: destroy.head.lastOperation,
  });
}

/** @param {Readonly<AnyRecord>} request @returns {AnyRecord} */
function reidentifyRequest(request) {
  const payload = /** @type {AnyRecord} */ (clone(request));
  delete payload.requestId;
  return {
    ...payload,
    requestId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_DEACTIVATION_REQUEST_ID_PREFIX,
      value: payload,
    }),
  };
}

/** @param {Readonly<AnyRecord>} receipt @returns {AnyRecord} */
function reidentifyReceipt(receipt) {
  const payload = /** @type {AnyRecord} */ (clone(receipt));
  delete payload.receiptId;
  return {
    ...payload,
    receiptId: createCanonicalJsonSha256Id({
      domain: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_DOMAIN,
      prefix: AWS_SINGLE_NODE_HOST_DEACTIVATION_RECEIPT_ID_PREFIX,
      value: payload,
    }),
  };
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<Record<string, any>>} */
function settledEvidence(request) {
  return Object.freeze({
    service: Object.freeze({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_SERVICE_ASSERTION_KIND,
      ...request.service,
      disposition: 'uninstalled',
      lifecycleStatus: 'STOPPED',
      runtimeSession: 'absent',
      loadState: 'not-found',
      unitFileState: '',
      activeState: 'inactive',
      subState: 'dead',
      result: 'success',
      mainPid: 0,
      execMainStatus: 0,
      fragmentPath: '',
      dropInPaths: '',
      needDaemonReload: false,
    }),
    storage: Object.freeze(
      request.storage.map((/** @type {Readonly<AnyRecord>} */ identity) =>
        Object.freeze({
          schemaVersion:
            AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_SCHEMA_VERSION,
          kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_STORAGE_ASSERTION_KIND,
          ...identity,
          syncStatus: 'complete',
          mountStatus: 'unmounted',
          mountUnitLoadState: 'not-found',
          mountUnitFileState: '',
          mountUnitActiveState: 'inactive',
          mountUnitFragmentPath: '',
          mountUnitDropInPaths: '',
          mountUnitNeedDaemonReload: false,
          mountUnitFileStatus: 'absent',
          localFsEnableLinkStatus: 'absent',
        }),
      ),
    ),
    userManagerGate: Object.freeze({
      schemaVersion:
        AWS_SINGLE_NODE_HOST_DEACTIVATION_USER_MANAGER_GATE_ASSERTION_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_HOST_DEACTIVATION_USER_MANAGER_GATE_ASSERTION_KIND,
      ...request.userManagerGate,
      dropInStatus: 'absent',
      legacyDropInStatuses: ['absent', 'absent'],
      userManagerBindsTo: [],
      userManagerAfter: [],
      userManagerNeedDaemonReload: false,
    }),
  });
}

describe('AWS single-node host deactivation contract', () => {
  test('creates one canonical request from a recovery-aware untouched destroy frontier', async () => {
    const destroy = await makeDestroyFixture({
      planBasisGenerationOffset: 5,
      headGenerationOffset: 4,
    });
    const request = createAwsSingleNodeHostDeactivationRequest(destroy.context);

    expect(request.schemaVersion).toBe(2);
    expect(request.requestId).toMatch(/^whdq2_/u);
    expect(
      createAwsSingleNodeHostDeactivationRequest(
        reverseObjectKeys(destroy.context),
      ),
    ).toEqual(request);
    expect(
      validateAwsSingleNodeHostDeactivationRequest(reverseObjectKeys(request)),
    ).toEqual(request);
    expect(
      validateAwsSingleNodeHostDeactivationRequestContext(
        request,
        destroy.context,
      ),
    ).toEqual(request);
    expect(request).toMatchObject({
      activationRequestId: destroy.activationRequest.requestId,
      destroyPlanId: destroy.plan.planId,
      destroyOperationId: destroy.head.activeOperation.operationId,
      authorizedHeadId: destroy.head.headId,
      authorizedHeadGeneration: destroy.head.generation,
      lastSettledOperationId: destroy.activationRequest.deploymentOperationId,
      nodeBindingId: destroy.activationRequest.nodeBindingId,
      runtimeRoleBindingId: destroy.activationRequest.runtimeRoleBindingId,
      runtimeAccount: {
        user: 'wharfie-runtime',
        group: 'wharfie-runtime',
        uid: 1001,
        gid: 1002,
      },
      service: {
        unitName: `wharfie-${destroy.activationRequest.appId}.service`,
        unitPath: `/var/lib/wharfie-runtime/.config/systemd/user/wharfie-${destroy.activationRequest.appId}.service`,
      },
    });
    expect(destroy.plan.basis.headGeneration).toBeGreaterThan(
      destroy.activationRequest.authorizedHeadGeneration,
    );
    expect(destroy.head.generation).toBeGreaterThan(
      destroy.plan.basis.headGeneration,
    );
    expect(
      request.storage.map(
        (/** @type {Readonly<AnyRecord>} */ entry) => entry.capabilityKind,
      ),
    ).toEqual(['application-state', 'control-state']);
    expect(request.storage[0].volumeProviderResourceId).not.toBe(
      request.storage[1].volumeProviderResourceId,
    );
    expect(request.storage[0].mountTarget).not.toBe(
      request.storage[1].mountTarget,
    );
    for (const storage of request.storage) {
      expect(storage).toMatchObject({
        filesystemType: 'ext4',
        filesystemProfileId: 'wharfie-ext4-v1',
        bootProjectionId: 'wharfie-systemd-retained-storage-v2',
        createdWithoutSnapshot: true,
      });
      expect(storage.mountUnitPath).toBe(
        `/etc/systemd/system/${storage.mountUnitName}`,
      );
      expect(storage.localFsEnableLinkPath).toBe(
        `/etc/systemd/system/local-fs.target.wants/${storage.mountUnitName}`,
      );
      expect(storage.volumeIdentityPath).toContain(
        storage.volumeProviderResourceId.replace('-', ''),
      );
    }
    expect(request.userManagerGate).toEqual({
      userManagerUnitName: 'user@1001.service',
      dropInPath:
        '/etc/systemd/system/user@1001.service.d/60-wharfie-retained-storage.conf',
      legacyDropInPaths: [
        '/etc/systemd/system/user@1001.service.d/60-wharfie-retained-application-state.conf',
        '/etc/systemd/system/user@1001.service.d/61-wharfie-retained-control-state.conf',
      ],
      retainedMountUnitNames: request.storage.map(
        (/** @type {Readonly<AnyRecord>} */ storage) => storage.mountUnitName,
      ),
      bootProjectionId: 'wharfie-systemd-retained-storage-v2',
    });
    expectDeepFrozen(request);
  });

  test('rejects blocked, intended, lineage-divergent, and binding-divergent authority', async () => {
    const rejected = [
      await makeDestroyFixture({ operationStatus: 'blocked' }),
      await makeDestroyFixture({ firstIntentStatus: 'intended' }),
      await makeDestroyFixture({ differentLastOperation: true }),
      await makeDestroyFixture({
        mutateActions(actions) {
          const application = actions.find(
            (action) => action.resourceKey === 'application-state',
          );
          const control = actions.find(
            (action) => action.resourceKey === 'control-state',
          );
          if (application === undefined || control === undefined) {
            throw new Error('Destroy fixture lacks retained storage roles.');
          }
          application.before.providerResourceId =
            control.before.providerResourceId;
          application.after = clone(application.before);
          return actions;
        },
      }),
    ];
    for (const destroy of rejected) {
      expect(() =>
        createAwsSingleNodeHostDeactivationRequest(destroy.context),
      ).toThrow();
    }
  });

  test('rejects content tampering and every host/storage binding alias shape', async () => {
    const destroy = await makeDestroyFixture();
    const request = createAwsSingleNodeHostDeactivationRequest(destroy.context);
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest({
        ...request,
        requestId: `${request.requestId.slice(0, -1)}x`,
      }),
    ).toThrow(/requestId/i);

    const withinRoleAlias = clone(request);
    withinRoleAlias.storage[0].attachmentBindingId =
      withinRoleAlias.storage[0].volumeBindingId;
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(withinRoleAlias),
      ),
    ).toThrow(/distinct/i);

    const crossRoleFieldAlias = clone(request);
    crossRoleFieldAlias.storage[1].volumeBindingId =
      crossRoleFieldAlias.storage[0].attachmentBindingId;
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(crossRoleFieldAlias),
      ),
    ).toThrow(/distinct/i);

    const nodeStorageAlias = clone(request);
    nodeStorageAlias.storage[0].volumeBindingId =
      nodeStorageAlias.nodeBindingId;
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(nodeStorageAlias),
      ),
    ).toThrow(/globally distinct/i);

    const oneMountGate = clone(request);
    oneMountGate.userManagerGate.retainedMountUnitNames.pop();
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(oneMountGate),
      ),
    ).toThrow(/shared projection/i);

    const reversedGate = clone(request);
    reversedGate.userManagerGate.retainedMountUnitNames.reverse();
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(reversedGate),
      ),
    ).toThrow(/sorted unique/i);

    const substitutedGatePath = clone(request);
    substitutedGatePath.userManagerGate.dropInPath =
      substitutedGatePath.userManagerGate.dropInPath.replace(
        'user@1001.service',
        'user@1003.service',
      );
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(substitutedGatePath),
      ),
    ).toThrow(/shared projection/i);

    const substitutedLegacyPath = clone(request);
    substitutedLegacyPath.userManagerGate.legacyDropInPaths[0] =
      '/etc/systemd/system/user@1001.service.d/60-forged.conf';
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(substitutedLegacyPath),
      ),
    ).toThrow(/shared projection/i);

    const legacyProjection = clone(request);
    legacyProjection.storage[0].bootProjectionId =
      'wharfie-systemd-retained-storage-v1';
    expect(() =>
      validateAwsSingleNodeHostDeactivationRequest(
        reidentifyRequest(legacyProjection),
      ),
    ).toThrow(/boot projection profiles/i);
  });

  test('creates only an exact service/storage/gate terminal assertion', async () => {
    const destroy = await makeDestroyFixture();
    const request = createAwsSingleNodeHostDeactivationRequest(destroy.context);
    const evidence = settledEvidence(request);
    const receipt = createAwsSingleNodeHostDeactivationReceipt({
      request,
      ...evidence,
    });

    expect(receipt.schemaVersion).toBe(2);
    expect(receipt.receiptId).toMatch(/^whdr2_/u);
    expect(
      createAwsSingleNodeHostDeactivationReceipt({
        request: reverseObjectKeys(request),
        service: reverseObjectKeys(evidence.service),
        storage: reverseObjectKeys(evidence.storage),
        userManagerGate: reverseObjectKeys(evidence.userManagerGate),
      }),
    ).toEqual(receipt);
    expect(
      validateAwsSingleNodeHostDeactivationReceipt(reverseObjectKeys(receipt)),
    ).toEqual(receipt);
    expect(
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: destroy.context,
        currentHead: destroy.head,
      }),
    ).toEqual(receipt);
    const recoveredHead = createCurrentHead(destroy, {
      generation: destroy.head.generation + 7,
    });
    expect(
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: destroy.context,
        currentHead: recoveredHead,
      }),
    ).toEqual(receipt);
    expect(receipt.service).toMatchObject({
      disposition: 'uninstalled',
      lifecycleStatus: 'STOPPED',
      runtimeSession: 'absent',
      loadState: 'not-found',
      activeState: 'inactive',
      mainPid: 0,
      needDaemonReload: false,
    });
    for (const storage of receipt.storage) {
      expect(storage).toMatchObject({
        syncStatus: 'complete',
        mountStatus: 'unmounted',
        mountUnitLoadState: 'not-found',
        mountUnitFileState: '',
        mountUnitActiveState: 'inactive',
        mountUnitFragmentPath: '',
        mountUnitDropInPaths: '',
        mountUnitNeedDaemonReload: false,
        mountUnitFileStatus: 'absent',
        localFsEnableLinkStatus: 'absent',
      });
    }
    expect(receipt.userManagerGate).toMatchObject({
      dropInStatus: 'absent',
      legacyDropInStatuses: ['absent', 'absent'],
      userManagerBindsTo: [],
      userManagerAfter: [],
      userManagerNeedDaemonReload: false,
    });
    expectDeepFrozen(receipt);
  });

  test('rejects every nonterminal service or retained-storage assertion', async () => {
    const destroy = await makeDestroyFixture();
    const request = createAwsSingleNodeHostDeactivationRequest(destroy.context);
    const failures = [
      ['service', 'disposition', 'installed'],
      ['service', 'lifecycleStatus', 'READY'],
      ['service', 'mainPid', 42],
      ['service', 'fragmentPath', request.service.unitPath],
      ['service', 'dropInPaths', '/tmp/not-absent.conf'],
      ['service', 'needDaemonReload', true],
      ['storage', 'syncStatus', 'pending'],
      ['storage', 'mountStatus', 'mounted'],
      ['storage', 'mountUnitLoadState', 'loaded'],
      ['storage', 'mountUnitActiveState', 'active'],
      ['storage', 'mountUnitFragmentPath', request.storage[0].mountUnitPath],
      ['storage', 'mountUnitDropInPaths', '/tmp/not-absent.conf'],
      ['storage', 'mountUnitNeedDaemonReload', true],
      ['storage', 'mountUnitFileStatus', 'present'],
      ['storage', 'localFsEnableLinkStatus', 'present'],
      ['gate', 'dropInStatus', 'present'],
      ['gate', 'legacyDropInStatuses', ['present', 'absent']],
      ['gate', 'userManagerNeedDaemonReload', true],
    ];
    for (const [section, key, value] of failures) {
      const evidence = clone(settledEvidence(request));
      const target =
        section === 'service'
          ? evidence.service
          : section === 'storage'
            ? evidence.storage[0]
            : evidence.userManagerGate;
      target[key] = value;
      expect(() =>
        createAwsSingleNodeHostDeactivationReceipt({
          request,
          ...evidence,
        }),
      ).toThrow();
    }

    const boundDependency = clone(settledEvidence(request));
    boundDependency.userManagerGate.userManagerBindsTo = [
      request.storage[0].mountUnitName,
    ];
    expect(() =>
      createAwsSingleNodeHostDeactivationReceipt({
        request,
        ...boundDependency,
      }),
    ).toThrow(/must not name/i);

    const orderedDependency = clone(settledEvidence(request));
    orderedDependency.userManagerGate.userManagerAfter = [
      request.storage[1].mountUnitName,
    ];
    expect(() =>
      createAwsSingleNodeHostDeactivationReceipt({
        request,
        ...orderedDependency,
      }),
    ).toThrow(/must not name/i);

    const missingMount = clone(settledEvidence(request));
    missingMount.userManagerGate.retainedMountUnitNames = [
      request.storage[0].mountUnitName,
    ];
    expect(() =>
      createAwsSingleNodeHostDeactivationReceipt({
        request,
        ...missingMount,
      }),
    ).toThrow(/both retained mount units|does not match/i);
  });

  test('independently rejects storage binding aliases and a substituted runtime account', async () => {
    const destroy = await makeDestroyFixture();
    const request = createAwsSingleNodeHostDeactivationRequest(destroy.context);

    const aliased = clone(settledEvidence(request));
    aliased.storage[1].volumeBindingId = aliased.storage[0].attachmentBindingId;
    expect(() =>
      createAwsSingleNodeHostDeactivationReceipt({
        request,
        ...aliased,
      }),
    ).toThrow(/four globally distinct/i);

    const substituted = clone(settledEvidence(request));
    const substituteUid = request.runtimeAccount.uid + 1;
    const originalUnit = request.userManagerGate.userManagerUnitName;
    substituted.userManagerGate.userManagerUnitName = `user@${substituteUid}.service`;
    substituted.userManagerGate.dropInPath =
      substituted.userManagerGate.dropInPath.replace(
        originalUnit,
        substituted.userManagerGate.userManagerUnitName,
      );
    substituted.userManagerGate.legacyDropInPaths =
      substituted.userManagerGate.legacyDropInPaths.map(
        (/** @type {string} */ legacyPath) =>
          legacyPath.replace(
            originalUnit,
            substituted.userManagerGate.userManagerUnitName,
          ),
      );
    expect(() =>
      createAwsSingleNodeHostDeactivationReceipt({
        request,
        ...substituted,
      }),
    ).toThrow(/userManagerGate/i);
  });

  test('binds a receipt to an equal-or-later live successor only', async () => {
    const first = await makeDestroyFixture({
      inspection: 1,
      headGenerationOffset: 4,
    });
    const second = await makeDestroyFixture({
      inspection: 2,
      headGenerationOffset: 4,
    });
    const request = createAwsSingleNodeHostDeactivationRequest(first.context);
    const otherRequest = createAwsSingleNodeHostDeactivationRequest(
      second.context,
    );
    const evidence = settledEvidence(request);
    const receipt = createAwsSingleNodeHostDeactivationReceipt({
      request,
      ...evidence,
    });
    const tampered = clone(receipt);
    tampered.storage[0].mountUnitFileStatus = 'present';
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceipt(reidentifyReceipt(tampered)),
    ).toThrow(/mountUnitFileStatus/i);

    const forgedGatePath = clone(receipt);
    forgedGatePath.userManagerGate.dropInPath =
      '/etc/systemd/system/user@1001.service.d/60-forged.conf';
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceipt(
        reidentifyReceipt(forgedGatePath),
      ),
    ).toThrow(/canonical user manager/i);

    const reorderedLegacyPaths = clone(receipt);
    reorderedLegacyPaths.userManagerGate.legacyDropInPaths.reverse();
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceipt(
        reidentifyReceipt(reorderedLegacyPaths),
      ),
    ).toThrow(/canonical V1 paths/i);

    const noncanonicalUserManager = clone(receipt);
    noncanonicalUserManager.userManagerGate.userManagerUnitName =
      'user@01001.service';
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceipt(
        reidentifyReceipt(noncanonicalUserManager),
      ),
    ).toThrow(/canonical numeric user manager/i);

    const recoveredHead = createCurrentHead(first, {
      generation: request.authorizedHeadGeneration + 5,
    });
    expect(
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: first.context,
        currentHead: recoveredHead,
      }),
    ).toEqual(receipt);

    const staleHead = createCurrentHead(first, {
      generation: request.authorizedHeadGeneration - 1,
    });
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: first.context,
        currentHead: staleHead,
      }),
    ).toThrow(/equal-or-later/i);

    const blockedHead = createCurrentHead(first, {
      generation: request.authorizedHeadGeneration + 1,
      operationStatus: 'blocked',
    });
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: first.context,
        currentHead: blockedHead,
      }),
    ).toThrow();

    const intendedHead = createCurrentHead(first, {
      generation: request.authorizedHeadGeneration + 1,
      firstIntentStatus: 'intended',
    });
    expect(() =>
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: first.context,
        currentHead: intendedHead,
      }),
    ).toThrow();

    expect(() =>
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request,
        requestContext: first.context,
        currentHead: second.head,
      }),
    ).toThrow();

    expect(() =>
      validateAwsSingleNodeHostDeactivationReceiptContext(receipt, {
        request: otherRequest,
        requestContext: second.context,
        currentHead: second.head,
      }),
    ).toThrow(/exact deactivation request/i);
  });
});
