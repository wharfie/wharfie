import { describe, expect, it } from '@jest/globals';

import {
  DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
  validateProviderResourceId,
} from '../../src/core/runtime/deployment-resource-binding.js';

const INVALID_PROVIDER_RESOURCE_ID_MESSAGE = `providerResourceId must be a nonempty JSON-stable printable ASCII provider resource ID without spaces, quotes, or backslashes and must not exceed ${DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES} bytes.`;

/** @param {unknown} value @returns {Error} */
function captureProviderResourceIdError(value) {
  try {
    validateProviderResourceId(value);
  } catch (error) {
    return /** @type {Error} */ (error);
  }
  throw new Error('Expected providerResourceId validation to fail.');
}

describe('deployment resource binding provider identity', () => {
  it('accepts ordinary AWS resource identities and the exact size boundary', () => {
    expect(DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES).toBe(1024);
    expect(validateProviderResourceId('i-0123456789abcdef0')).toBe(
      'i-0123456789abcdef0',
    );
    expect(
      validateProviderResourceId(
        'arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-demo/stack-id',
      ),
    ).toBe(
      'arn:aws:cloudformation:us-east-1:123456789012:stack/wharfie-demo/stack-id',
    );

    const maximumLengthId = 'x'.repeat(
      DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES,
    );
    expect(validateProviderResourceId(maximumLengthId)).toBe(maximumLengthId);
  });

  it.each([
    ['empty', ''],
    ['embedded space', 'resource id sentinel'],
    ['leading space', ' resource-id-sentinel'],
    ['trailing space', 'resource-id-sentinel '],
    ['non-ASCII', 'resource-id-sentinél'],
    ['quote', 'resource-id-"sentinel'],
    ['backslash', 'resource-id-\\sentinel'],
    ['control character', 'resource-id-\nsentinel'],
    [
      'over the size boundary',
      'x'.repeat(DEPLOYMENT_PROVIDER_RESOURCE_ID_MAX_BYTES + 1),
    ],
  ])('rejects %s without echoing the rejected value', (_label, value) => {
    const error = captureProviderResourceIdError(value);

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toBe(INVALID_PROVIDER_RESOURCE_ID_MESSAGE);
  });
});
