import { describe, expect, it, jest } from '@jest/globals';

import {
  createCanonicalJsonSha256Id,
  sha256Base64Url,
} from '../../../../src/core/runtime/content-id.js';
import { createSingleNodeDeploymentIncarnationId } from '../../../../src/core/runtime/single-node-deployment-identity.js';

const PLAN_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-plan.js';
const INTENT_IMPORT =
  '../../../../src/core/runtime/providers/aws/single-node-provisioning-intent.js';
const INTENT_ID_DOMAIN = 'wharfie:aws-single-node-provisioning-intent:v1';

/** @type {jest.Mock<(value: unknown) => Readonly<Record<string, any>>>} */
const validateAwsSingleNodePlan = jest.fn((value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('aws plan must be an object');
  }
  return /** @type {Readonly<Record<string, any>>} */ (value);
});

jest.unstable_mockModule(PLAN_IMPORT, () => ({
  validateAwsSingleNodePlan,
}));

const {
  AWS_PROVISIONING_INTENT_ID_PREFIX,
  AWS_PROVISIONING_MUTATION_REQUEST_CONTRACT_VERSION,
  createAwsSingleNodeProvisioningIntent,
  default: defaultExport,
  validateAwsSingleNodeProvisioningIntent,
} = await import(INTENT_IMPORT);

const PLAN = Object.freeze({
  schemaVersion: 1,
  kind: 'awsSingleNodeDeploymentPlan',
  planId: 'wsap1_test-plan',
  deploymentInstanceId: 'wsndi1_test-deployment',
  status: 'actionable',
  providerSpec: Object.freeze({
    providerScope: Object.freeze({
      provider: 'aws',
      partition: 'aws',
      accountId: '123456789012',
      region: 'us-east-2',
    }),
  }),
});

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/** @returns {Record<string, any>} */
function makeInput() {
  return {
    plan: clone(PLAN),
    incarnationId: createSingleNodeDeploymentIncarnationId(
      Buffer.alloc(32, 37),
    ),
    cloudInitDigest: {
      algorithm: 'sha256',
      value: sha256Base64Url('#cloud-config\n'),
    },
  };
}

/** @param {unknown} value @returns {boolean} */
function deeplyFrozen(value) {
  return (
    value === null ||
    typeof value !== 'object' ||
    (Object.isFrozen(value) && Object.values(value).every(deeplyFrozen))
  );
}

/** @param {() => unknown} callback @param {string} secret */
function expectRejectionWithoutSecret(callback, secret) {
  /** @type {unknown} */
  let thrown;
  try {
    callback();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeDefined();
  expect(String(thrown)).not.toContain(secret);
}

describe('AWS single-node provisioning intent request contract', () => {
  it('derives and content-addresses the immutable mutation request version', () => {
    const intent = createAwsSingleNodeProvisioningIntent(makeInput());
    const payload = clone(intent);
    delete payload.provisioningIntentId;

    expect(AWS_PROVISIONING_MUTATION_REQUEST_CONTRACT_VERSION).toBe(1);
    expect(
      defaultExport.AWS_PROVISIONING_MUTATION_REQUEST_CONTRACT_VERSION,
    ).toBe(AWS_PROVISIONING_MUTATION_REQUEST_CONTRACT_VERSION);
    expect(intent.mutationRequestContractVersion).toBe(
      AWS_PROVISIONING_MUTATION_REQUEST_CONTRACT_VERSION,
    );
    expect(intent.provisioningIntentId).toBe(
      createCanonicalJsonSha256Id({
        domain: INTENT_ID_DOMAIN,
        prefix: AWS_PROVISIONING_INTENT_ID_PREFIX,
        value: payload,
      }),
    );

    const legacyPayload = clone(payload);
    delete legacyPayload.mutationRequestContractVersion;
    expect(intent.provisioningIntentId).not.toBe(
      createCanonicalJsonSha256Id({
        domain: INTENT_ID_DOMAIN,
        prefix: AWS_PROVISIONING_INTENT_ID_PREFIX,
        value: legacyPayload,
      }),
    );
    expect(createAwsSingleNodeProvisioningIntent(makeInput())).toEqual(intent);
  });

  it('round-trips serialized authority and deeply freezes every result', () => {
    const created = createAwsSingleNodeProvisioningIntent(makeInput());
    const validated = validateAwsSingleNodeProvisioningIntent(
      JSON.parse(JSON.stringify(created)),
    );

    expect(validated).toEqual(created);
    expect(deeplyFrozen(created)).toBe(true);
    expect(deeplyFrozen(validated)).toBe(true);
  });

  it('rejects absent, unknown, and tampered request contract versions', () => {
    const intent = createAwsSingleNodeProvisioningIntent(makeInput());
    const absent = clone(intent);
    delete absent.mutationRequestContractVersion;
    expect(() => validateAwsSingleNodeProvisioningIntent(absent)).toThrow(
      /fields are invalid/iu,
    );

    for (const mutationRequestContractVersion of [2, 0, '1', null]) {
      const tampered = {
        ...clone(intent),
        mutationRequestContractVersion,
      };
      expect(() => validateAwsSingleNodeProvisioningIntent(tampered)).toThrow(
        /mutationRequestContractVersion is unsupported/iu,
      );
    }
  });

  it('rejects unknown document fields and caller-selected protocol versions', () => {
    const intent = createAwsSingleNodeProvisioningIntent(makeInput());
    expect(() =>
      validateAwsSingleNodeProvisioningIntent({
        ...clone(intent),
        futureRequestSemantics: true,
      }),
    ).toThrow(/fields are invalid/iu);
    expect(() =>
      createAwsSingleNodeProvisioningIntent({
        ...makeInput(),
        mutationRequestContractVersion:
          AWS_PROVISIONING_MUTATION_REQUEST_CONTRACT_VERSION,
      }),
    ).toThrow(/fields are invalid/iu);
  });

  it('rejects inline credentials without copying them into output or errors', () => {
    const secret = 'DO-NOT-LEAK-THIS-AWS-SECRET';
    const input = makeInput();
    input.plan.credentials = { secretAccessKey: secret };

    expectRejectionWithoutSecret(
      () => createAwsSingleNodeProvisioningIntent(input),
      secret,
    );
    const intent = createAwsSingleNodeProvisioningIntent(makeInput());
    expect(JSON.stringify(intent)).not.toContain(secret);
  });
});
