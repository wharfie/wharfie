import { describe, expect, it, jest } from '@jest/globals';

import {
  AwsSingleNodeRetainedStorageProviderEvidenceConflictError,
  AwsSingleNodeRetainedStorageProviderEvidenceUnknownError,
  AwsSingleNodeRetainedStorageProviderEvidenceUnstableError,
  createAwsSingleNodeRetainedStorageProviderEvidenceCollector,
  validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-provider-evidence.js';
import {
  AwsSingleNodeRetainedStorageProviderExperimentInactiveError,
  createAwsSingleNodeRetainedStorageProviderExperiment,
  getAwsSingleNodeRetainedStorageProviderExperimentTags,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-provider-experiment.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const ACCOUNT_ID = '123456789012';
const AMI_OWNER_ID = '137112412989';
const INSTANCE_ID = 'i-00000000000000001';
const ROOT_VOLUME_ID = 'vol-00000000000000001';
const EVIDENCE_VOLUME_ID = 'vol-00000000000000002';
const SOURCE_COMMIT = 'a'.repeat(40);
const OBSERVED_AT = '2026-07-25T12:30:00.000Z';
const NOT_BEFORE = '2026-07-25T12:00:00.000Z';
const EXPIRES_AT = '2026-07-25T18:00:00.000Z';

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @param {Readonly<Record<string, string>>} value @returns {{Key: string, Value: string}[]} */
function tags(value) {
  return Object.entries(value).map(([Key, Value]) => ({ Key, Value }));
}

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'retained-storage-provider-evidence-test',
    target: {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
    mode: { kind: 'single-node-systemd-user', version: 1 },
    provider: createAwsSingleNodeProvider('us-east-1'),
  });
  const providerScope = createAwsProviderScope({
    partition: 'aws',
    accountId: ACCOUNT_ID,
    region: 'us-east-1',
  });
  const providerSpec = createAwsSingleNodeProviderSpec({
    profile,
    providerScope,
    machineImage: {
      sourceParameter: {
        name: AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS.x86_64,
        version: 42,
      },
      imageId: 'ami-0123456789abcdef0',
      ownerAccountId: AMI_OWNER_ID,
      architecture: 'x86_64',
      imageType: 'machine',
      rootDeviceType: 'ebs',
      virtualizationType: 'hvm',
      enaSupport: true,
      rootDeviceName: '/dev/xvda',
      rootBlockDevice: {
        snapshotId: 'snap-0123456789abcdef0',
        volumeType: 'gp3',
        volumeSizeGiB: 8,
        encrypted: false,
        deleteOnTermination: true,
      },
    },
    placement: { availabilityZoneId: 'use1-az1' },
    storage: {
      ebsKmsKeyArn: `arn:aws:kms:us-east-1:${ACCOUNT_ID}:key/11111111-2222-3333-4444-555555555555`,
    },
  });
  const experiment = createAwsSingleNodeRetainedStorageProviderExperiment({
    sourceCommit: SOURCE_COMMIT,
    providerScopeId: providerScope.providerScopeId,
    providerSpecId: providerSpec.providerSpecId,
    volumeRole: 'application-state',
    notBefore: NOT_BEFORE,
    expiresAt: EXPIRES_AT,
  });
  return Object.freeze({
    experiment,
    providerScope,
    providerSpec,
    tagContract:
      getAwsSingleNodeRetainedStorageProviderExperimentTags(experiment),
  });
}

/** @param {Readonly<Record<string, any>>} base @returns {Record<string, any>} */
function parameterResponse(base) {
  const source = base.providerSpec.machineImage.sourceParameter;
  return {
    Parameter: {
      Name: source.name,
      Type: 'String',
      Value: base.providerSpec.machineImage.imageId,
      Version: source.version,
      Selector: `:${source.version}`,
      LastModifiedDate: new Date('2026-07-24T12:00:00.000Z'),
      ARN: `arn:aws:ssm:us-east-1::parameter${source.name}`,
      DataType: 'text',
    },
  };
}

/** @param {Readonly<Record<string, any>>} base @returns {Record<string, any>} */
function imageResponse(base) {
  const image = base.providerSpec.machineImage;
  return {
    Images: [
      {
        ImageId: image.imageId,
        OwnerId: image.ownerAccountId,
        ImageOwnerAlias: 'amazon',
        Public: true,
        Architecture: image.architecture,
        ImageType: image.imageType,
        RootDeviceType: image.rootDeviceType,
        VirtualizationType: image.virtualizationType,
        EnaSupport: image.enaSupport,
        PlatformDetails: 'Linux/UNIX',
        PublicSsmParameterName: image.sourceParameter.name.slice(1),
        State: 'available',
        RootDeviceName: image.rootDeviceName,
        BlockDeviceMappings: [
          {
            DeviceName: image.rootDeviceName,
            Ebs: {
              SnapshotId: image.rootBlockDevice.snapshotId,
              VolumeType: image.rootBlockDevice.volumeType,
              VolumeSize: image.rootBlockDevice.volumeSizeGiB,
              Encrypted: image.rootBlockDevice.encrypted,
              DeleteOnTermination: image.rootBlockDevice.deleteOnTermination,
            },
          },
        ],
      },
    ],
  };
}

/** @param {Readonly<Record<string, any>>} base @param {Partial<Record<string, any>>} [instanceOverrides] @returns {Record<string, any>} */
function instanceResponse(base, instanceOverrides = {}) {
  const spec = base.providerSpec;
  return {
    Reservations: [
      {
        OwnerId: ACCOUNT_ID,
        Instances: [
          {
            InstanceId: INSTANCE_ID,
            ImageId: spec.machineImage.imageId,
            Architecture: spec.machineImage.architecture,
            InstanceType: spec.node.instanceType,
            EbsOptimized: spec.node.ebsOptimized,
            EnaSupport: spec.machineImage.enaSupport,
            VirtualizationType: spec.machineImage.virtualizationType,
            RootDeviceName: spec.node.rootVolume.deviceName,
            RootDeviceType: spec.machineImage.rootDeviceType,
            State: { Name: 'running', Code: 16 },
            Placement: {
              AvailabilityZoneId: spec.placement.availabilityZoneId,
              Tenancy: spec.node.tenancy,
            },
            Tags: tags(base.tagContract.instance),
            BlockDeviceMappings: [
              {
                DeviceName: spec.node.rootVolume.deviceName,
                Ebs: {
                  VolumeId: ROOT_VOLUME_ID,
                  Status: 'attached',
                  DeleteOnTermination: true,
                  EbsCardIndex: 0,
                },
              },
              {
                DeviceName: spec.capabilities.applicationState.deviceName,
                Ebs: {
                  VolumeId: EVIDENCE_VOLUME_ID,
                  Status: 'attached',
                  DeleteOnTermination: false,
                  EbsCardIndex: 0,
                },
              },
            ],
            ...instanceOverrides,
          },
        ],
      },
    ],
  };
}

/** @param {Readonly<Record<string, any>>} base @param {Partial<Record<string, any>>} [overrides] @returns {Record<string, any>} */
function evidenceVolumeResponse(base, overrides = {}) {
  const spec = base.providerSpec;
  const capability = spec.capabilities.applicationState;
  return {
    Volumes: [
      {
        VolumeId: EVIDENCE_VOLUME_ID,
        AvailabilityZone: 'us-east-1a',
        AvailabilityZoneId: spec.placement.availabilityZoneId,
        VolumeType: capability.volumeType,
        Size: capability.sizeGiB,
        Iops: capability.iops,
        Throughput: capability.throughputMiBps,
        MultiAttachEnabled: capability.multiAttach,
        Encrypted: capability.encrypted,
        KmsKeyId: spec.storage.ebsKmsKeyArn,
        SnapshotId: '',
        SseType: 'sse-kms',
        State: 'in-use',
        CreateTime: new Date(OBSERVED_AT),
        Tags: tags(base.tagContract.evidenceVolume),
        Attachments: [
          {
            VolumeId: EVIDENCE_VOLUME_ID,
            InstanceId: INSTANCE_ID,
            Device: capability.deviceName,
            State: 'attached',
            DeleteOnTermination: false,
            EbsCardIndex: 0,
          },
        ],
        ...overrides,
      },
    ],
  };
}

/** @param {Readonly<Record<string, any>>} base @param {Partial<Record<string, any>>} [overrides] @returns {Record<string, any>} */
function rootVolumeResponse(base, overrides = {}) {
  const spec = base.providerSpec;
  const root = spec.node.rootVolume;
  return {
    Volumes: [
      {
        VolumeId: ROOT_VOLUME_ID,
        AvailabilityZoneId: spec.placement.availabilityZoneId,
        VolumeType: root.volumeType,
        Size: root.sizeGiB,
        Iops: root.iops,
        Throughput: root.throughputMiBps,
        MultiAttachEnabled: root.multiAttach,
        Encrypted: root.encrypted,
        KmsKeyId: spec.storage.ebsKmsKeyArn,
        SnapshotId: root.snapshotId,
        SseType: 'sse-kms',
        State: 'in-use',
        Tags: tags(base.tagContract.rootVolume),
        Attachments: [
          {
            VolumeId: ROOT_VOLUME_ID,
            InstanceId: INSTANCE_ID,
            Device: root.deviceName,
            State: 'attached',
            DeleteOnTermination: true,
            EbsCardIndex: 0,
          },
        ],
        ...overrides,
      },
    ],
  };
}

/** @param {Readonly<Record<string, any>>} base @param {{secondEvidenceCreateTime?: string, instance?: Record<string, any>, nowValues?: string[], ssmError?: Error, ssmResponse?: unknown}} [options] */
function makeCollector(base, options = {}) {
  let evidenceReads = 0;
  const getParameter = jest.fn(function (request) {
    if (options.ssmError) throw options.ssmError;
    if (options.ssmResponse !== undefined) return options.ssmResponse;
    return parameterResponse(base);
  });
  const describeImages = jest.fn(function (_request) {
    return imageResponse(base);
  });
  const describeInstances = jest.fn(function (_request) {
    return instanceResponse(base, options.instance);
  });
  const describeVolumes = jest.fn(function (request) {
    const id = /** @type {Record<string, any>} */ (request).VolumeIds[0];
    if (id === EVIDENCE_VOLUME_ID) {
      evidenceReads += 1;
      return evidenceVolumeResponse(
        base,
        evidenceReads === 2 && options.secondEvidenceCreateTime
          ? {
              CreateTime: new Date(options.secondEvidenceCreateTime),
            }
          : {},
      );
    }
    if (id === ROOT_VOLUME_ID) return rootVolumeResponse(base);
    return { Volumes: [] };
  });
  const now = jest.fn(() => Date.parse(OBSERVED_AT));
  for (const value of options.nowValues || []) {
    now.mockReturnValueOnce(Date.parse(value));
  }
  const collector = createAwsSingleNodeRetainedStorageProviderEvidenceCollector(
    {
      providerScope: base.providerScope,
      clients: {
        ssm: { getParameter },
        ec2: {
          describeImages,
          describeInstances,
          describeVolumes,
        },
      },
      now,
    },
  );
  return {
    collector,
    calls: {
      describeImages,
      describeInstances,
      describeVolumes,
      getParameter,
      now,
    },
  };
}

/** @param {Readonly<Record<string, any>>} base @returns {Record<string, any>} */
function collectInput(base) {
  return {
    experiment: base.experiment,
    providerSpec: base.providerSpec,
    instanceId: INSTANCE_ID,
    volumeId: EVIDENCE_VOLUME_ID,
  };
}

describe('AWS retained-storage provider evidence', () => {
  it('double-reads exact provider views into a strict frozen receipt', async () => {
    const base = makeBase();
    const { collector, calls } = makeCollector(base);
    const receipt = await collector.collect(collectInput(base));

    expect(receipt).toMatchObject({
      evidenceId: expect.stringMatching(/^wpe1_[A-Za-z0-9_-]{43}$/),
      classification: 'read-only-provider-no-host',
      authority: 'none',
      experiment: base.experiment,
      providerScope: base.providerScope,
      providerSpec: base.providerSpec,
      observation: {
        instance: {
          instanceId: INSTANCE_ID,
          rootVolumeId: ROOT_VOLUME_ID,
          evidenceVolumeId: EVIDENCE_VOLUME_ID,
        },
        evidenceVolume: {
          providerResourceId: EVIDENCE_VOLUME_ID,
          resourceKey: 'application-state',
          lifecycle: 'in-use',
          createTime: OBSERVED_AT,
        },
        exclusion: {
          distinctVolume: true,
          distinctDevice: true,
        },
      },
      conclusion: {
        authoritative: false,
        observations: 2,
        stable: true,
        instanceStorageProjectionMatchesProviderSpec: true,
      },
    });
    expect(calls.getParameter).toHaveBeenCalledTimes(2);
    expect(calls.describeImages).toHaveBeenCalledTimes(2);
    expect(calls.describeInstances).toHaveBeenCalledTimes(2);
    expect(calls.describeVolumes).toHaveBeenCalledTimes(4);
    expect(calls.now).toHaveBeenCalledTimes(3);
    expect(calls.getParameter.mock.calls[0][0]).toEqual({
      Name: `${base.providerSpec.machineImage.sourceParameter.name}:42`,
      WithDecryption: false,
    });
    expect(calls.describeImages.mock.calls[0][0]).toEqual({
      ImageIds: [base.providerSpec.machineImage.imageId],
      Owners: ['amazon'],
      IncludeDeprecated: true,
      IncludeDisabled: true,
    });
    expect(calls.describeInstances.mock.calls[0][0]).toEqual({
      InstanceIds: [INSTANCE_ID],
    });
    expect(
      calls.describeVolumes.mock.calls.map(([request]) => request),
    ).toEqual([
      { VolumeIds: [EVIDENCE_VOLUME_ID] },
      { VolumeIds: [ROOT_VOLUME_ID] },
      { VolumeIds: [EVIDENCE_VOLUME_ID] },
      { VolumeIds: [ROOT_VOLUME_ID] },
    ]);
    for (const call of [
      ...calls.getParameter.mock.calls,
      ...calls.describeImages.mock.calls,
      ...calls.describeInstances.mock.calls,
      ...calls.describeVolumes.mock.calls,
    ]) {
      expectDeepFrozen(call[0]);
    }
    expectDeepFrozen(receipt);

    const serialized = JSON.parse(JSON.stringify(receipt));
    const validated =
      validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt(serialized);
    expect(validated).toEqual(receipt);
    expect(validated).not.toBe(serialized);
    expectDeepFrozen(validated);
  });

  it('rejects a changed second normalized observation', async () => {
    const base = makeBase();
    const { collector } = makeCollector(base, {
      secondEvidenceCreateTime: '2026-07-25T12:30:00.001Z',
    });

    await expect(collector.collect(collectInput(base))).rejects.toThrow(
      AwsSingleNodeRetainedStorageProviderEvidenceUnstableError,
    );
  });

  it('rejects a root/evidence collision before publishing a receipt', async () => {
    const base = makeBase();
    const collisionMappings = instanceResponse(
      base,
    ).Reservations[0].Instances[0].BlockDeviceMappings.map(
      /** @param {Record<string, any>} mapping */ (mapping) => ({
        ...mapping,
        Ebs: {
          ...mapping.Ebs,
          VolumeId: EVIDENCE_VOLUME_ID,
        },
      }),
    );
    const { collector } = makeCollector(base, {
      instance: { BlockDeviceMappings: collisionMappings },
    });

    await expect(collector.collect(collectInput(base))).rejects.toThrow(
      AwsSingleNodeRetainedStorageProviderEvidenceConflictError,
    );
  });

  it('sanitizes provider failures without leaking their messages', async () => {
    const base = makeBase();
    const { collector } = makeCollector(base, {
      ssmError: new Error('credential-secret-value'),
    });

    const failure = await collector.collect(collectInput(base)).then(
      () => null,
      (error) => error,
    );
    expect(failure).toBeInstanceOf(
      AwsSingleNodeRetainedStorageProviderEvidenceUnknownError,
    );
    expect(failure.message).not.toContain('credential-secret-value');
  });

  it('rejects accessor-backed provider responses without invoking them', async () => {
    const base = makeBase();
    let invoked = false;
    const response = {};
    Object.defineProperty(response, 'Parameter', {
      enumerable: true,
      get() {
        invoked = true;
        return parameterResponse(base).Parameter;
      },
    });
    const { collector } = makeCollector(base, { ssmResponse: response });

    await expect(collector.collect(collectInput(base))).rejects.toThrow(
      AwsSingleNodeRetainedStorageProviderEvidenceUnknownError,
    );
    expect(invoked).toBe(false);
  });

  it('rejects an inactive experiment before any provider read', async () => {
    const base = makeBase();
    const { collector, calls } = makeCollector(base);
    calls.now.mockReturnValue(Date.parse(EXPIRES_AT));

    await expect(collector.collect(collectInput(base))).rejects.toThrow(
      AwsSingleNodeRetainedStorageProviderExperimentInactiveError,
    );
    expect(calls.getParameter).not.toHaveBeenCalled();
    expect(calls.describeImages).not.toHaveBeenCalled();
    expect(calls.describeInstances).not.toHaveBeenCalled();
    expect(calls.describeVolumes).not.toHaveBeenCalled();
  });

  it.each([
    [
      'second observation',
      [OBSERVED_AT, EXPIRES_AT],
      { parameter: 1, volume: 2 },
    ],
    [
      'publication',
      [OBSERVED_AT, OBSERVED_AT, EXPIRES_AT],
      { parameter: 2, volume: 4 },
    ],
  ])('rejects expiry before %s', async (_phase, nowValues, expectedReads) => {
    const base = makeBase();
    const { collector, calls } = makeCollector(base, { nowValues });

    await expect(collector.collect(collectInput(base))).rejects.toThrow(
      AwsSingleNodeRetainedStorageProviderExperimentInactiveError,
    );
    expect(calls.getParameter).toHaveBeenCalledTimes(expectedReads.parameter);
    expect(calls.describeVolumes).toHaveBeenCalledTimes(expectedReads.volume);
  });

  it('rejects receipt tampering and exact-surface expansion', async () => {
    const base = makeBase();
    const { collector } = makeCollector(base);
    const receipt = await collector.collect(collectInput(base));

    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt({
        ...receipt,
        authority: 'format',
      }),
    ).toThrow();
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt({
        ...receipt,
        extra: true,
      }),
    ).toThrow(/exact required keys/i);
    const semanticTamper = JSON.parse(JSON.stringify(receipt));
    semanticTamper.observation.evidenceVolume.createTime =
      '2026-07-25T12:30:00.001Z';
    expect(() =>
      validateAwsSingleNodeRetainedStorageProviderEvidenceReceipt(
        semanticTamper,
      ),
    ).toThrow(/ID does not match/i);
    expect(() =>
      createAwsSingleNodeRetainedStorageProviderEvidenceCollector({
        providerScope: base.providerScope,
        clients: {
          ssm: { getParameter() {}, putParameter() {} },
          ec2: {
            describeImages() {},
            describeInstances() {},
            describeVolumes() {},
          },
        },
        now() {
          return Date.parse(OBSERVED_AT);
        },
      }),
    ).toThrow(/exact required keys/i);
    await expect(
      collector.collect({ ...collectInput(base), devicePath: '/dev/nvme1n1' }),
    ).rejects.toThrow(/exact required keys/i);
  });
});
