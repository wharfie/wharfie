import { createHash } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';

import { createApplicationRevision } from '../../../../src/core/runtime/application-revision.js';
import { createArtifactRecord } from '../../../../src/core/runtime/artifact-record.js';
import { sha256Base64Url } from '../../../../src/core/runtime/content-id.js';
import { createAwsProviderScope } from '../../../../src/core/runtime/deployment-provider-scope.js';
import { createSingleNodeCloudInit } from '../../../../src/core/runtime/single-node-cloud-init.js';
import { createSingleNodeDeploymentDesired } from '../../../../src/core/runtime/single-node-deployment-desired.js';
import { createSingleNodeDeploymentIncarnationId } from '../../../../src/core/runtime/single-node-deployment-identity.js';
import {
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createSingleNodeDeploymentIntent,
} from '../../../../src/core/runtime/single-node-deployment-intent.js';

const INTENT_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
const DESTROY_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-destroy.js';
const JOURNAL_IMPORT =
  '../../../../src/core/runtime/single-node-deployment-journal.js';
const EVIDENCE_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-journal-evidence.js';

/** @type {jest.Mock<(value: unknown) => Readonly<Record<string, any>>>} */
const validateAwsSingleNodeProvisioningIntent = jest.fn((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('test AWS provisioning intent is invalid');
  }
  return /** @type {Readonly<Record<string, any>>} */ (value);
});

jest.unstable_mockModule(INTENT_IMPORT, () => ({
  validateAwsSingleNodeProvisioningIntent,
}));

const {
  AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
  AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
  createAwsSingleNodeDestroyCoordinator,
} = await import(DESTROY_IMPORT);
const {
  advanceSingleNodeDeploymentJournal,
  completeSingleNodeDeploymentMutation,
  createSingleNodeDeploymentJournal,
  prepareSingleNodeDeploymentDestruction,
  prepareSingleNodeDeploymentMutations,
  recordSingleNodeDeploymentDeletion,
  recordSingleNodeDeploymentResource,
  validateSingleNodeDeploymentJournalSuccessor,
} = await import(JOURNAL_IMPORT);
const {
  createAwsDeletionRecord,
  createAwsDestructionAttempt,
  createAwsProvisionedResourceRecord,
  createAwsProvisioningMutationAttempt,
} = await import(EVIDENCE_IMPORT);

const REGION = 'us-east-2';
const ACCOUNT_ID = '123456789012';
const OTHER_ACCOUNT_ID = '210987654321';
const DATA_ROOT = '/tmp/wharfie-aws-destroy-test';
const IDS = Object.freeze({
  securityGroup: 'sg-0123456789abcdef0',
  instance: 'i-0123456789abcdef0',
  rootVolume: 'vol-0123456789abcdef0',
});
const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/**
 * @param {string|Buffer|Uint8Array} value
 * @returns {{algorithm: 'sha256', value: string}}
 */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: sha256Base64Url(value),
  };
}

/** @param {string} value */
function wireString(value) {
  const bytes = Buffer.from(value, 'binary');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.byteLength);
  return Buffer.concat([length, bytes]);
}

function makeSshIdentity() {
  const blob = Buffer.concat([
    wireString('ssh-ed25519'),
    wireString(Buffer.alloc(32, 17).toString('binary')),
  ]);
  return Object.freeze({
    privateKeyPath: `${DATA_ROOT}/id_ed25519`,
    publicKey: `ssh-ed25519 ${blob.toString('base64')}`,
    publicKeyFingerprint: `SHA256:${createHash('sha256')
      .update(blob)
      .digest('base64')
      .replace(/=+$/u, '')}`,
    knownHostsPath: `${DATA_ROOT}/known_hosts`,
  });
}

function makeDesired() {
  const revision = createApplicationRevision({
    contract: {
      schemaVersion: 4,
      app: { id: 'destroy-app' },
      cli: {
        entrypoint: {
          kind: 'node',
          path: 'src/cli.js',
          export: 'main',
        },
      },
      activities: {
        greet: {
          entrypoint: {
            kind: 'node',
            path: 'src/greet.js',
            export: 'greet',
          },
        },
      },
    },
    inputs: {
      source: { format: 'wharfie-source-tree-v1', digest: digest('source') },
      dependencies: {
        format: 'wharfie-npm-package-lock-v3-closure-v1',
        digest: digest('dependencies'),
      },
      runtime: { format: 'wharfie-runtime-v1', digest: digest('runtime') },
    },
  });
  const bytes = Buffer.from('exact Linux SEA payload');
  const artifactRecord = createArtifactRecord({
    bytes,
    revision,
    target: TARGET,
    provenance: {
      schemaVersion: 1,
      builder: {
        name: '@wharfie/wharfie',
        version: '0.0.15',
        runtimeDigest: revision.inputs.runtime.digest,
        toolchainDigest: digest('toolchain'),
      },
      node: {
        version: TARGET.nodeVersion,
        archive: {
          fileName: `node-v${TARGET.nodeVersion}-linux-x64.tar.gz`,
          digest: digest('node-archive'),
        },
        binary: { digest: digest('node-binary') },
      },
      dependencies: {
        lock: revision.inputs.dependencies,
        digest: digest('dependency-closure'),
      },
      signing: { mode: 'unsigned' },
    },
  });
  const intent = createSingleNodeDeploymentIntent({
    deployment: { id: 'production' },
    appId: 'destroy-app',
    target: TARGET,
    mode: SINGLE_NODE_DEPLOYMENT_MODE,
    machine: SINGLE_NODE_MACHINE,
    access: {
      kind: 'public-ssh',
      allowedIpv4: ['203.0.113.7/32'],
    },
    provider: { kind: 'aws', region: REGION },
  });
  return createSingleNodeDeploymentDesired({
    intent,
    revision,
    artifactRecord,
    observation: {
      artifactId: artifactRecord.artifactId,
      byteDigest: artifactRecord.byteDigest,
      size: artifactRecord.size,
    },
  });
}

function makeFixture() {
  const desired = makeDesired();
  const incarnationId = createSingleNodeDeploymentIncarnationId(
    Buffer.alloc(32, 41),
  );
  const sshIdentity = makeSshIdentity();
  const cloudInit = createSingleNodeCloudInit({
    deploymentInstanceId: desired.deploymentInstanceId,
    incarnationId,
    publicKey: sshIdentity.publicKey,
    publicKeyFingerprint: sshIdentity.publicKeyFingerprint,
  });
  const scope = createAwsProviderScope({
    partition: 'aws',
    accountId: ACCOUNT_ID,
    region: REGION,
  });
  const providerIntent = Object.freeze({
    schemaVersion: 1,
    kind: 'awsSingleNodeProvisioningIntent',
    provisioningIntentId: 'wsapi1_test-destroy-provisioning-intent',
    incarnationId,
    cloudInitDigest: cloudInit.digest,
    plan: Object.freeze({
      schemaVersion: 1,
      kind: 'awsSingleNodeDeploymentPlan',
      planId: 'wsap1_test-destroy-plan',
      deploymentInstanceId: desired.deploymentInstanceId,
      desired,
      providerSpec: Object.freeze({
        providerSpecId: 'wsas1_test-destroy-provider-spec',
        providerScope: scope,
      }),
    }),
  });
  return Object.freeze({
    desired,
    providerIntent,
    scope,
    sshIdentity,
    cloudInit,
  });
}

/**
 * @param {ReturnType<typeof makeFixture>} fixture
 * @param {'empty'|'securityGroupPrepared'|'computePrepared'|'provisioned'} state
 */
function makeJournal(fixture, state) {
  let journal = createSingleNodeDeploymentJournal({
    desired: fixture.desired,
    providerIntent: { provider: 'aws', intent: fixture.providerIntent },
  });
  journal = advanceSingleNodeDeploymentJournal(journal, 'provisioning');
  if (state === 'empty') return journal;

  const securityGroupAttempt = createAwsProvisioningMutationAttempt(
    fixture.providerIntent,
    'securityGroup',
  );
  journal = prepareSingleNodeDeploymentMutations(journal, [
    securityGroupAttempt,
  ]);
  if (state === 'securityGroupPrepared') return journal;
  journal = completeSingleNodeDeploymentMutation(
    journal,
    createAwsProvisionedResourceRecord(
      fixture.providerIntent,
      'securityGroup',
      IDS.securityGroup,
    ),
  );

  const computeAttempts = ['instance', 'rootVolume'].map((role) =>
    createAwsProvisioningMutationAttempt(fixture.providerIntent, role),
  );
  journal = prepareSingleNodeDeploymentMutations(journal, computeAttempts);
  if (state === 'computePrepared') return journal;
  for (const role of ['instance', 'rootVolume']) {
    journal = completeSingleNodeDeploymentMutation(
      journal,
      createAwsProvisionedResourceRecord(
        fixture.providerIntent,
        role,
        IDS[/** @type {keyof typeof IDS} */ (role)],
      ),
    );
  }
  journal = recordSingleNodeDeploymentResource(journal, {
    provider: 'aws',
    role: 'instance',
    providerResourceId: IDS.instance,
    publicIpv4: '203.0.113.40',
    state: 'present',
  });
  return advanceSingleNodeDeploymentJournal(journal, 'provisioned');
}

/**
 * @param {ReturnType<typeof makeFixture>} fixture
 * @returns {Readonly<Record<string, any>>}
 */
function makeDestroyedJournal(fixture) {
  let journal = makeJournal(fixture, 'provisioned');
  journal = advanceSingleNodeDeploymentJournal(journal, 'destroying');
  for (const role of ['instance', 'rootVolume', 'securityGroup']) {
    const id = IDS[/** @type {keyof typeof IDS} */ (role)];
    const attempt = createAwsDestructionAttempt(
      fixture.providerIntent,
      role,
      id,
    );
    journal = prepareSingleNodeDeploymentDestruction(journal, attempt);
    journal = recordSingleNodeDeploymentDeletion(
      journal,
      createAwsDeletionRecord(fixture.providerIntent, role, id, attempt),
    );
  }
  return advanceSingleNodeDeploymentJournal(journal, 'destroyed');
}

/**
 * @typedef HarnessOptions
 * @property {Readonly<Record<string, any>>|null} [journal] Initial durable state.
 * @property {Readonly<Record<string, any>>} [authorityScope] Opened AWS scope.
 * @property {Error} [closeError] Injected authority cleanup failure.
 * @property {Error} [releaseError] Injected lock cleanup failure.
 * @property {boolean} [crashAfterDestroyAttempt] Crash after a delete fence.
 * @property {boolean} [crashAfterRecoveredResource] Crash after create recovery.
 * @property {boolean} [malformedAuthority] Add an unsupported authority field.
 */

/** @param {HarnessOptions} [options] */
function makeHarness(options = {}) {
  const fixture = makeFixture();
  /** @type {Readonly<Record<string, any>>|null} */
  let journal =
    options.journal === undefined
      ? makeJournal(fixture, 'provisioned')
      : options.journal;
  const events = /** @type {string[]} */ ([]);
  const reconciliationInputs = /** @type {Record<string, any>[]} */ ([]);
  const destructionInputs = /** @type {Record<string, any>[]} */ ([]);
  let reconcileCalls = 0;
  let destructionCalls = 0;
  let destroyCrashUsed = false;
  let recoveryCrashUsed = false;
  const release = jest.fn(
    /** @this {unknown} */ async function () {
      expect(this).toBeUndefined();
      events.push('release');
      if (options.releaseError) throw options.releaseError;
    },
  );
  const close = jest.fn(
    /** @this {unknown} */ async function () {
      expect(this).toBeUndefined();
      events.push('authority-close');
      if (options.closeError) throw options.closeError;
    },
  );
  const ensureSshIdentity = jest.fn(
    /** @this {unknown} */ async function () {
      expect(this).toBeUndefined();
      events.push('identity');
      return fixture.sshIdentity;
    },
  );
  const api = Object.fromEntries(
    [
      'describeSecurityGroups',
      'describeInstances',
      'describeVolumes',
      'describeInstanceCreditSpecifications',
      'createSecurityGroup',
      'authorizeSecurityGroupIngress',
      'runInstances',
      'terminateInstances',
      'deleteVolume',
      'deleteSecurityGroup',
    ].map((method) => [
      method,
      /** @this {unknown} */ async function () {
        expect(this).toBeUndefined();
        throw new Error(`test coordinator must not call ${method} directly`);
      },
    ]),
  );
  const createOperationAuthority = jest.fn(
    /** @this {unknown} */ async function () {
      expect(this).toBeUndefined();
      events.push('authority-open');
      const providerScope = options.authorityScope ?? fixture.scope;
      const authority = {
        schemaVersion: 1,
        kind: 'awsSingleNodeOperationAuthority',
        providerScope,
        api,
        resolveScope: /** @this {unknown} */ async function () {
          expect(this).toBeUndefined();
          events.push('scope');
          return providerScope;
        },
        close,
      };
      return options.malformedAuthority
        ? { ...authority, unexpectedPower: async () => undefined }
        : authority;
    },
  );

  const dependencies = {
    acquireOperationLock: /** @this {unknown} */ async function () {
      expect(this).toBeUndefined();
      events.push('lock');
      return release;
    },
    createOperationAuthority,
    createJournalStore: /** @this {unknown} */ function () {
      expect(this).toBeUndefined();
      return {
        prepareStorage: /** @this {unknown} */ async function () {
          expect(this).toBeUndefined();
          events.push('storage');
        },
        read: /** @this {unknown} */ async function () {
          expect(this).toBeUndefined();
          return journal;
        },
        /**
         * @this {unknown}
         * @param {Record<string, any>} request
         */
        commit: async function (request) {
          expect(this).toBeUndefined();
          if (
            journal === null ||
            request.expectedGeneration !== journal.generation ||
            request.expectedJournalId !== journal.journalId
          ) {
            throw new Error('test journal CAS mismatch');
          }
          const prior = journal;
          const committed = validateSingleNodeDeploymentJournalSuccessor(
            prior,
            request.next,
          );
          journal = committed;
          if (committed.phase !== prior.phase) {
            events.push(`phase-${committed.phase}`);
          } else {
            events.push(`journal-${committed.generation}`);
          }
          return committed;
        },
      };
    },
    ensureSshIdentity,
    /**
     * @this {unknown}
     * @param {Record<string, any>} value
     */
    reconcilePreparedCreates: async function (value) {
      expect(this).toBeUndefined();
      reconcileCalls += 1;
      events.push('reconcile');
      reconciliationInputs.push(value);
      const roles = ['securityGroup', 'instance', 'rootVolume'];
      const pending = roles.filter(
        (role) =>
          value.storedMutationAttempts[role] !== null &&
          value.storedResourceIds[role] === null,
      );
      await value.recordMutationAttempts(
        pending.map((role) => value.storedMutationAttempts[role]),
      );
      /** @type {Record<string, string|null>} */
      const recoveredIds = {
        securityGroup: value.storedResourceIds.securityGroup,
        instance: value.storedResourceIds.instance,
        rootVolume: value.storedResourceIds.rootVolume,
      };
      for (const role of pending) {
        const id = IDS[/** @type {keyof typeof IDS} */ (role)];
        await value.recordResource(
          createAwsProvisionedResourceRecord(value.intent, role, id),
        );
        recoveredIds[role] = id;
        events.push(`recovered-${role}`);
        if (options.crashAfterRecoveredResource && !recoveryCrashUsed) {
          recoveryCrashUsed = true;
          throw new Error('injected crash after recovered resource');
        }
      }
      return {
        schemaVersion: 1,
        kind: 'awsSingleNodePreparedCreateReconciliationResult',
        provisioningIntentId: value.intent.provisioningIntentId,
        planId: value.intent.plan.planId,
        deploymentInstanceId: value.intent.plan.deploymentInstanceId,
        incarnationId: value.intent.incarnationId,
        resources: {
          securityGroupId: recoveredIds.securityGroup,
          instanceId: recoveredIds.instance,
          rootVolumeId: recoveredIds.rootVolume,
        },
        status: 'reconciled',
      };
    },
    /**
     * @this {unknown}
     * @param {Record<string, any>} value
     */
    convergeDestruction: async function (value) {
      expect(this).toBeUndefined();
      destructionCalls += 1;
      events.push(`destroy-${destructionCalls}`);
      destructionInputs.push(value);
      /** @type {Record<string, Readonly<Record<string, any>>|null>} */
      const attempts = { ...value.storedDestroyAttempts };
      /** @type {Record<string, Readonly<Record<string, any>>|null>} */
      const deletions = { ...value.storedDeletionRecords };
      for (const role of ['instance', 'rootVolume', 'securityGroup']) {
        const id = value.storedResourceIds[role];
        if (id === null || deletions[role] !== null) continue;
        if (attempts[role] === null) {
          attempts[role] = createAwsDestructionAttempt(value.intent, role, id);
          await value.recordDestroyAttempt(attempts[role]);
          events.push(`destroy-fence-${role}`);
          if (options.crashAfterDestroyAttempt && !destroyCrashUsed) {
            destroyCrashUsed = true;
            throw new Error('injected crash after destroy attempt');
          }
        }
        deletions[role] = createAwsDeletionRecord(
          value.intent,
          role,
          id,
          attempts[role],
        );
        await value.recordDeletion(deletions[role]);
        events.push(`deleted-${role}`);
      }
      return {
        schemaVersion: 1,
        kind: 'awsSingleNodeDestructionResult',
        provisioningIntentId: value.intent.provisioningIntentId,
        planId: value.intent.plan.planId,
        providerSpecId: value.intent.plan.providerSpec.providerSpecId,
        deploymentInstanceId: value.intent.plan.deploymentInstanceId,
        incarnationId: value.intent.incarnationId,
        status: 'destroyed',
        resources: Object.fromEntries(
          ['instance', 'rootVolume', 'securityGroup'].map((role) => [
            role,
            {
              providerResourceId: value.storedResourceIds[role],
              state: 'absent',
              deletionId: deletions[role]?.deletionId ?? null,
            },
          ]),
        ),
      };
    },
  };

  const coordinator = createAwsSingleNodeDestroyCoordinator(dependencies);
  return {
    fixture,
    coordinator,
    events,
    reconciliationInputs,
    destructionInputs,
    release,
    close,
    ensureSshIdentity,
    createOperationAuthority,
    getJournal: () => journal,
    getReconcileCalls: () => reconcileCalls,
    getDestructionCalls: () => destructionCalls,
  };
}

/** @param {ReturnType<typeof makeHarness>} harness */
function destroyInput(harness) {
  return {
    appId: harness.fixture.desired.intent.appId,
    deploymentInstanceId: harness.fixture.desired.deploymentInstanceId,
    dataRoot: DATA_ROOT,
  };
}

describe('AWS single-node destroy coordinator', () => {
  it('persists ordered absence evidence and returns the stable result contract', async () => {
    const harness = makeHarness();

    const result = await harness.coordinator.destroy(destroyInput(harness));

    expect(result).toEqual({
      schemaVersion: AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
      kind: AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
      provider: 'aws',
      status: 'destroyed',
      appId: harness.fixture.desired.intent.appId,
      deploymentInstanceId: harness.fixture.desired.deploymentInstanceId,
      incarnationId: harness.fixture.providerIntent.incarnationId,
      provisioningIntentId: harness.fixture.providerIntent.provisioningIntentId,
      journalId: harness.getJournal()?.journalId,
      journalGeneration: harness.getJournal()?.generation,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(harness.getJournal()?.phase).toBe('destroyed');
    expect(harness.ensureSshIdentity).not.toHaveBeenCalled();
    expect(harness.getReconcileCalls()).toBe(0);
    expect(harness.events.indexOf('scope')).toBeLessThan(
      harness.events.indexOf('phase-destroying'),
    );
    expect(harness.events.slice(-2)).toEqual(['authority-close', 'release']);
  });

  it('adopts a prepared security group before destroying without loading SSH identity', async () => {
    const fixture = makeFixture();
    const harness = makeHarness({
      journal: makeJournal(fixture, 'securityGroupPrepared'),
    });

    await harness.coordinator.destroy(destroyInput(harness));

    expect(harness.getReconcileCalls()).toBe(1);
    expect(harness.reconciliationInputs[0].cloudInitBytes).toBeNull();
    expect(harness.ensureSshIdentity).not.toHaveBeenCalled();
    expect(harness.events.indexOf('recovered-securityGroup')).toBeLessThan(
      harness.events.indexOf('phase-destroying'),
    );
    expect(harness.getJournal()?.phase).toBe('destroyed');
  });

  it('regenerates exact cloud-init only for prepared RunInstances recovery', async () => {
    const fixture = makeFixture();
    const harness = makeHarness({
      journal: makeJournal(fixture, 'computePrepared'),
    });

    await harness.coordinator.destroy(destroyInput(harness));

    expect(harness.ensureSshIdentity).toHaveBeenCalledTimes(1);
    expect(Buffer.from(harness.reconciliationInputs[0].cloudInitBytes)).toEqual(
      harness.fixture.cloudInit.bytes,
    );
    expect(harness.events.indexOf('identity')).toBeLessThan(
      harness.events.indexOf('reconcile'),
    );
    expect(harness.events.indexOf('recovered-rootVolume')).toBeLessThan(
      harness.events.indexOf('phase-destroying'),
    );
  });

  it('fails closed on cloud-init identity drift before replay or phase advance', async () => {
    const fixture = makeFixture();
    const journal = makeJournal(
      {
        ...fixture,
        providerIntent: {
          ...fixture.providerIntent,
          cloudInitDigest: digest('different cloud-init'),
        },
      },
      'computePrepared',
    );
    const harness = makeHarness({ journal });

    await expect(
      harness.coordinator.destroy(destroyInput(harness)),
    ).rejects.toThrow(
      'SSH identity conflicts with durable cloud-init authority',
    );

    expect(harness.getReconcileCalls()).toBe(0);
    expect(harness.getDestructionCalls()).toBe(0);
    expect(harness.getJournal()?.phase).toBe('provisioning');
    expect(harness.events.slice(-2)).toEqual(['authority-close', 'release']);
  });

  it('rejects mismatched ambient scope before durable or provider mutation', async () => {
    const otherScope = createAwsProviderScope({
      partition: 'aws',
      accountId: OTHER_ACCOUNT_ID,
      region: REGION,
    });
    const harness = makeHarness({ authorityScope: otherScope });
    const initialId = harness.getJournal()?.journalId;

    await expect(
      harness.coordinator.destroy(destroyInput(harness)),
    ).rejects.toThrow(
      'ambient credentials do not match durable provider scope',
    );

    expect(harness.getJournal()?.journalId).toBe(initialId);
    expect(harness.getReconcileCalls()).toBe(0);
    expect(harness.getDestructionCalls()).toBe(0);
    expect(harness.events.slice(-2)).toEqual(['authority-close', 'release']);
  });

  it('resumes a durably fenced deletion after a crash without replacing it', async () => {
    const harness = makeHarness({ crashAfterDestroyAttempt: true });

    await expect(
      harness.coordinator.destroy(destroyInput(harness)),
    ).rejects.toThrow('injected crash after destroy attempt');
    const attempt = harness.getJournal()?.destroyAttempts[0];
    expect(attempt?.role).toBe('instance');

    await harness.coordinator.destroy(destroyInput(harness));

    expect(harness.getDestructionCalls()).toBe(2);
    expect(harness.destructionInputs[1].storedDestroyAttempts.instance).toEqual(
      attempt,
    );
    expect(harness.getJournal()?.destroyAttempts).toHaveLength(3);
    expect(harness.getJournal()?.phase).toBe('destroyed');
  });

  it('retains a recovered create ID across a crash and deletes it on retry', async () => {
    const fixture = makeFixture();
    const harness = makeHarness({
      journal: makeJournal(fixture, 'securityGroupPrepared'),
      crashAfterRecoveredResource: true,
    });

    await expect(
      harness.coordinator.destroy(destroyInput(harness)),
    ).rejects.toThrow('injected crash after recovered resource');
    expect(harness.getJournal()?.phase).toBe('provisioning');
    expect(harness.getJournal()?.resources[0].providerResourceId).toBe(
      IDS.securityGroup,
    );

    await harness.coordinator.destroy(destroyInput(harness));

    expect(harness.getReconcileCalls()).toBe(1);
    expect(harness.destructionInputs[0].storedResourceIds.securityGroup).toBe(
      IDS.securityGroup,
    );
    expect(harness.getJournal()?.phase).toBe('destroyed');
  });

  it('returns an already-destroyed journal without acquiring AWS or SSH authority', async () => {
    const fixture = makeFixture();
    const destroyed = makeDestroyedJournal(fixture);
    const harness = makeHarness({ journal: destroyed });

    const result = await harness.coordinator.destroy(destroyInput(harness));

    expect(result.status).toBe('destroyed');
    expect(result.journalId).toBe(destroyed.journalId);
    expect(harness.createOperationAuthority).not.toHaveBeenCalled();
    expect(harness.ensureSshIdentity).not.toHaveBeenCalled();
    expect(harness.events).toEqual(['lock', 'storage', 'release']);
  });

  it('does not acquire AWS authority when durable local authority is missing', async () => {
    const harness = makeHarness({ journal: null });

    await expect(
      harness.coordinator.destroy(destroyInput(harness)),
    ).rejects.toThrow('no durable local deployment authority');

    expect(harness.createOperationAuthority).not.toHaveBeenCalled();
    expect(harness.events).toEqual(['lock', 'storage', 'release']);
  });

  it('closes an opened authority whose remaining contract is malformed', async () => {
    const harness = makeHarness({ malformedAuthority: true });

    await expect(
      harness.coordinator.destroy(destroyInput(harness)),
    ).rejects.toThrow('operationAuthority fields are invalid');

    expect(harness.close).toHaveBeenCalledTimes(1);
    expect(harness.getDestructionCalls()).toBe(0);
    expect(harness.events.slice(-2)).toEqual(['authority-close', 'release']);
  });

  it('aggregates operation, authority-close, and lock-release failures in cleanup order', async () => {
    const closeError = new Error('close failed');
    const releaseError = new Error('release failed');
    const harness = makeHarness({
      authorityScope: createAwsProviderScope({
        partition: 'aws',
        accountId: OTHER_ACCOUNT_ID,
        region: REGION,
      }),
      closeError,
      releaseError,
    });

    let caught;
    try {
      await harness.coordinator.destroy(destroyInput(harness));
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect(/** @type {AggregateError} */ (caught).errors).toHaveLength(3);
    expect(/** @type {AggregateError} */ (caught).errors.slice(1)).toEqual([
      closeError,
      releaseError,
    ]);
    expect(harness.events.slice(-2)).toEqual(['authority-close', 'release']);
  });
});
