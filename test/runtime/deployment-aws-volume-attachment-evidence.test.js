import { describe, expect, it } from '@jest/globals';

import {
  AwsSingleNodeVolumeAttachmentEvidenceConflictError,
  AwsSingleNodeVolumeAttachmentEvidenceTransientError,
  AwsSingleNodeVolumeAttachmentEvidenceUnknownError,
  decodeAwsSingleNodeVolumeAttachmentInstanceResponse,
  decodeAwsSingleNodeVolumeAttachmentVolumeResponse,
  getAwsSingleNodeVolumeAttachmentObservedStateDigest,
  getAwsSingleNodeVolumeAttachmentProviderResourceId,
  getAwsSingleNodeVolumeAttachmentStateDigest,
  reconcileAwsSingleNodeVolumeAttachmentViews,
} from '../../src/core/runtime/deployment-aws-volume-attachment-evidence.js';
import {
  AWS_SINGLE_NODE_MACHINE_IMAGE_PARAMETERS,
  createAwsSingleNodeProviderSpec,
} from '../../src/core/runtime/deployment-aws-provider-spec.js';
import {
  createAwsSingleNodeProvider,
  createDeploymentProfile,
} from '../../src/core/runtime/deployment-profile.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const INSTANCE_ID = 'i-00000000000000001';
const VOLUME_ID = 'vol-00000000000000001';
const DEVICE_NAME = '/dev/sdf';

/** @param {unknown} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

/** @returns {Readonly<Record<string, any>>} */
function makeBase() {
  const accountId = '123456789012';
  const profile = createDeploymentProfile({
    profile: { id: 'production' },
    appId: 'volume-attachment-evidence-test',
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
    accountId,
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
      ownerAccountId: '137112412989',
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
      ebsKmsKeyArn: `arn:aws:kms:us-east-1:${accountId}:key/11111111-2222-3333-4444-555555555555`,
    },
  });
  return Object.freeze({ providerScope, providerSpec });
}

/** @param {Readonly<Record<string, any>>} base */
function evidenceOptions(base) {
  return {
    providerScope: base.providerScope,
    availabilityZoneId: base.providerSpec.placement.availabilityZoneId,
    instanceId: INSTANCE_ID,
    volumeId: VOLUME_ID,
    deviceName: DEVICE_NAME,
  };
}

/** @param {Record<string, any>} [overrides] */
function instanceMapping(overrides = {}) {
  return {
    DeviceName: DEVICE_NAME,
    Ebs: {
      VolumeId: VOLUME_ID,
      Status: 'attached',
      DeleteOnTermination: false,
      EbsCardIndex: 0,
    },
    ...overrides,
  };
}

/** @param {Record<string, any>} [overrides] */
function volumeAttachment(overrides = {}) {
  return {
    VolumeId: VOLUME_ID,
    InstanceId: INSTANCE_ID,
    Device: DEVICE_NAME,
    State: 'attached',
    DeleteOnTermination: false,
    EbsCardIndex: 0,
    ...overrides,
  };
}

/** @param {Record<string, any>} [instanceOverrides] @param {Record<string, any>} [responseOverrides] */
function instanceResponse(instanceOverrides = {}, responseOverrides = {}) {
  return {
    Reservations: [
      {
        OwnerId: '123456789012',
        Instances: [
          {
            InstanceId: INSTANCE_ID,
            Placement: { AvailabilityZoneId: 'use1-az1' },
            State: { Name: 'running', Code: 16 },
            BlockDeviceMappings: [instanceMapping()],
            ...instanceOverrides,
          },
        ],
      },
    ],
    ...responseOverrides,
  };
}

/** @param {Record<string, any>} [volumeOverrides] @param {Record<string, any>} [responseOverrides] */
function volumeResponse(volumeOverrides = {}, responseOverrides = {}) {
  return {
    Volumes: [
      {
        VolumeId: VOLUME_ID,
        AvailabilityZoneId: 'use1-az1',
        State: 'in-use',
        MultiAttachEnabled: false,
        Attachments: [volumeAttachment()],
        ...volumeOverrides,
      },
    ],
    ...responseOverrides,
  };
}

describe('AWS single-node retained volume attachment evidence', () => {
  it('derives immutable role-specific desired state and exact pair identity', () => {
    const base = makeBase();
    const applicationDigest = getAwsSingleNodeVolumeAttachmentStateDigest(
      base.providerSpec,
      'application-state',
    );
    const controlDigest = getAwsSingleNodeVolumeAttachmentStateDigest(
      base.providerSpec,
      'control-state',
    );
    expect(applicationDigest).not.toEqual(controlDigest);
    expect(
      getAwsSingleNodeVolumeAttachmentProviderResourceId(
        base.providerSpec,
        'application-state',
        INSTANCE_ID,
        VOLUME_ID,
      ),
    ).toMatch(/^wva1_[A-Za-z0-9_-]{43}$/);
    expectDeepFrozen(applicationDigest);
  });

  it('normalizes and freezes exact matching instance and volume views', () => {
    const base = makeBase();
    const instance = decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      instanceResponse(),
      evidenceOptions(base),
    );
    const volume = decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      volumeResponse(),
      evidenceOptions(base),
    );
    const logical = reconcileAwsSingleNodeVolumeAttachmentViews({
      action: 'create',
      instanceView: instance,
      volumeView: volume,
    });
    expect(logical).toEqual({
      state: 'attached',
      instanceState: 'running',
      instanceDeleteOnTermination: false,
      volumeDeleteOnTermination: false,
    });
    expect(
      getAwsSingleNodeVolumeAttachmentObservedStateDigest(
        base.providerSpec,
        'application-state',
        logical,
      ),
    ).toEqual(
      getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        'application-state',
      ),
    );
    expectDeepFrozen(instance);
    expectDeepFrozen(volume);
    expectDeepFrozen(logical);
  });

  it('treats successful empty exact responses as unknown rather than absence', () => {
    const base = makeBase();
    expect(() =>
      decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
        { Reservations: [] },
        evidenceOptions(base),
      ),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceUnknownError);
    expect(() =>
      decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
        { Volumes: [] },
        evidenceOptions(base),
      ),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceUnknownError);
  });

  it('rejects owner, zone, multi-attach, pagination, and slot contradictions', () => {
    const base = makeBase();
    expect(() =>
      decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
        {
          ...instanceResponse(),
          Reservations: [
            {
              ...instanceResponse().Reservations[0],
              OwnerId: '999999999999',
            },
          ],
        },
        evidenceOptions(base),
      ),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
        instanceResponse(
          { Placement: { AvailabilityZoneId: 'use1-az2' } },
          { NextToken: 'unexpected' },
        ),
        evidenceOptions(base),
      ),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
        volumeResponse({ MultiAttachEnabled: true }),
        evidenceOptions(base),
      ),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceConflictError);
    expect(() =>
      decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
        instanceResponse({
          BlockDeviceMappings: [
            instanceMapping(),
            instanceMapping({
              DeviceName: '/dev/sdg',
              Ebs: {
                VolumeId: VOLUME_ID,
                Status: 'attached',
                DeleteOnTermination: false,
              },
            }),
          ],
        }),
        evidenceOptions(base),
      ),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceConflictError);
  });

  it('keeps one-sided and lifecycle propagation transient', () => {
    const base = makeBase();
    const instance = decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      instanceResponse(),
      evidenceOptions(base),
    );
    const volume = decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      volumeResponse({ Attachments: [], State: 'available' }),
      evidenceOptions(base),
    );
    expect(() =>
      reconcileAwsSingleNodeVolumeAttachmentViews({
        action: 'create',
        instanceView: instance,
        volumeView: volume,
      }),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceTransientError);
  });

  it('exposes stable ordinary absence separately from typed endpoint absence', () => {
    const base = makeBase();
    const instance = decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      instanceResponse({ BlockDeviceMappings: [] }),
      evidenceOptions(base),
    );
    const volume = decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      volumeResponse({ Attachments: [], State: 'available' }),
      evidenceOptions(base),
    );
    expect(
      reconcileAwsSingleNodeVolumeAttachmentViews({
        action: 'delete',
        instanceView: instance,
        volumeView: volume,
      }),
    ).toEqual({ state: 'absent', instanceState: 'running' });
    expect(
      reconcileAwsSingleNodeVolumeAttachmentViews({
        action: 'delete',
        instanceView: null,
        volumeView: null,
      }),
    ).toEqual({
      state: 'endpoint-absent',
      signature: 'instance-and-volume',
    });
    expect(() =>
      reconcileAwsSingleNodeVolumeAttachmentViews({
        action: 'create',
        instanceView: null,
        volumeView: null,
      }),
    ).toThrow(AwsSingleNodeVolumeAttachmentEvidenceConflictError);
  });

  it('hashes readable retention drift without reproducing desired state', () => {
    const base = makeBase();
    const instance = decodeAwsSingleNodeVolumeAttachmentInstanceResponse(
      instanceResponse({
        BlockDeviceMappings: [
          instanceMapping({
            Ebs: {
              VolumeId: VOLUME_ID,
              Status: 'attached',
              DeleteOnTermination: true,
              EbsCardIndex: 0,
            },
          }),
        ],
      }),
      evidenceOptions(base),
    );
    const volume = decodeAwsSingleNodeVolumeAttachmentVolumeResponse(
      volumeResponse(),
      evidenceOptions(base),
    );
    const logical = reconcileAwsSingleNodeVolumeAttachmentViews({
      action: 'noop',
      instanceView: instance,
      volumeView: volume,
    });
    expect(logical.state).toBe('needs-retention');
    expect(
      getAwsSingleNodeVolumeAttachmentObservedStateDigest(
        base.providerSpec,
        'application-state',
        logical,
      ),
    ).not.toEqual(
      getAwsSingleNodeVolumeAttachmentStateDigest(
        base.providerSpec,
        'application-state',
      ),
    );
  });
});
