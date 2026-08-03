import { describe, expect, it } from '@jest/globals';

import {
  AwsSingleNodeMachineImageEvidenceConflictError,
  AwsSingleNodeMachineImageEvidenceTransientError,
  AwsSingleNodeMachineImageEvidenceUnknownError,
  decodeAwsSingleNodeExactMachineImageParameterResponse,
  decodeAwsSingleNodeExactMachineImageResponse,
} from '../../src/core/runtime/deployment-aws-machine-image-evidence.js';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const PARAMETER_NAME =
  '/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64';
const IMAGE_ID = 'ami-0123456789abcdef0';
const SCOPE = Object.freeze({
  partition: 'aws',
  region: 'us-east-1',
});
const SELECTION = Object.freeze({
  name: PARAMETER_NAME,
  version: 87,
  imageId: IMAGE_ID,
});

/** @returns {Record<string, any>} */
function parameterResponse() {
  return {
    Parameter: {
      Name: PARAMETER_NAME,
      Type: 'String',
      Value: IMAGE_ID,
      Version: 87,
      LastModifiedDate: new Date('2025-12-20T00:00:00.000Z'),
      ARN: `arn:aws:ssm:us-east-1::parameter${PARAMETER_NAME}`,
      DataType: 'text',
      Selector: ':87',
    },
  };
}

/** @returns {Record<string, any>} */
function imageResponse() {
  return {
    Images: [
      {
        ImageId: IMAGE_ID,
        OwnerId: '137112412989',
        ImageOwnerAlias: 'amazon',
        Public: true,
        Architecture: 'x86_64',
        ImageType: 'machine',
        RootDeviceType: 'ebs',
        VirtualizationType: 'hvm',
        EnaSupport: true,
        State: 'available',
        PlatformDetails: 'Linux/UNIX',
        PublicSsmParameterName: PARAMETER_NAME.slice(1),
        ImageAllowed: true,
        DeprecationTime: '2027-01-01T00:00:00Z',
        RootDeviceName: '/dev/xvda',
        BlockDeviceMappings: [
          {
            DeviceName: '/dev/xvda',
            Ebs: {
              SnapshotId: 'snap-0123456789abcdef0',
              VolumeType: 'gp3',
              VolumeSize: 8,
              Encrypted: false,
              DeleteOnTermination: true,
            },
          },
        ],
      },
    ],
  };
}

describe('AWS single-node machine-image evidence', () => {
  it('decodes one exact version-pinned public SSM selection', () => {
    const selection = decodeAwsSingleNodeExactMachineImageParameterResponse(
      parameterResponse(),
      SCOPE,
      PARAMETER_NAME,
      87,
    );

    expect(selection).toEqual(SELECTION);
    expect(Object.isFrozen(selection)).toBe(true);
  });

  it('distinguishes malformed SSM evidence from authoritative drift', () => {
    expect(() =>
      decodeAwsSingleNodeExactMachineImageParameterResponse(
        { Parameter: null },
        SCOPE,
        PARAMETER_NAME,
        87,
      ),
    ).toThrow(AwsSingleNodeMachineImageEvidenceUnknownError);

    const drifted = parameterResponse();
    drifted.Parameter.Version = 88;
    expect(() =>
      decodeAwsSingleNodeExactMachineImageParameterResponse(
        drifted,
        SCOPE,
        PARAMETER_NAME,
        87,
      ),
    ).toThrow(AwsSingleNodeMachineImageEvidenceConflictError);
  });

  it('decodes one exact available AL2023 AMI receipt', () => {
    const receipt = decodeAwsSingleNodeExactMachineImageResponse(
      imageResponse(),
      SELECTION,
      'x86_64',
      NOW,
    );

    expect(receipt).toEqual({
      sourceParameter: {
        name: PARAMETER_NAME,
        version: 87,
      },
      imageId: IMAGE_ID,
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
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.rootBlockDevice)).toBe(true);
  });

  it.each([
    ['empty image set', { Images: [] }],
    ['pending image', { Images: [{ ImageId: IMAGE_ID, State: 'pending' }] }],
  ])('classifies %s as transient', (_name, response) => {
    expect(() =>
      decodeAwsSingleNodeExactMachineImageResponse(
        response,
        SELECTION,
        'x86_64',
        NOW,
      ),
    ).toThrow(AwsSingleNodeMachineImageEvidenceTransientError);
  });

  it('distinguishes malformed EC2 evidence from authoritative drift', () => {
    expect(() =>
      decodeAwsSingleNodeExactMachineImageResponse(
        { Images: [null] },
        SELECTION,
        'x86_64',
        NOW,
      ),
    ).toThrow(AwsSingleNodeMachineImageEvidenceUnknownError);

    const drifted = imageResponse();
    drifted.Images[0].Architecture = 'arm64';
    expect(() =>
      decodeAwsSingleNodeExactMachineImageResponse(
        drifted,
        SELECTION,
        'x86_64',
        NOW,
      ),
    ).toThrow(AwsSingleNodeMachineImageEvidenceConflictError);
  });
});
