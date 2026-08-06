/* eslint-env jest */

import * as providerNamespace from '@wharfie/aws';
import { describe, expect, it, jest } from '@jest/globals';

const BOUNDARY_IMPORT = '../../src/core/runtime/aws-provider-module.js';
const NOT_EMBEDDED_MESSAGE =
  "AWS deployment support was not embedded. Install matching '@wharfie/aws@0.0.15' beside '@wharfie/wharfie@0.0.15' in the builder, rebuild the application, and retry.";

describe('sealed provider-free AWS boundary', () => {
  it('cannot discover or register a companion after sealing', async () => {
    jest.resetModules();
    const boundary = await import(`${BOUNDARY_IMPORT}?sealed-provider-free`);

    expect(boundary.sealAwsProviderUnavailable()).toBeUndefined();
    expect(boundary.sealAwsProviderUnavailable()).toBeUndefined();
    await expect(boundary.loadAwsProviderBindings()).rejects.toMatchObject({
      code: 'WHARFIE_AWS_PROVIDER_NOT_EMBEDDED',
      reason: 'not-embedded',
      message: NOT_EMBEDDED_MESSAGE,
    });
    expect(() => boundary.registerAwsProviderModule(providerNamespace)).toThrow(
      expect.objectContaining({
        code: 'WHARFIE_AWS_PROVIDER_NOT_EMBEDDED',
        reason: 'not-embedded',
        message: NOT_EMBEDDED_MESSAGE,
      }),
    );
  });

  it('does not allow a registered provider to become unavailable', async () => {
    jest.resetModules();
    const boundary = await import(`${BOUNDARY_IMPORT}?registered-provider`);

    boundary.registerAwsProviderModule(providerNamespace);
    expect(() => boundary.sealAwsProviderUnavailable()).toThrow(
      expect.objectContaining({
        code: 'WHARFIE_AWS_PROVIDER_INCOMPATIBLE',
        reason: 'incompatible',
      }),
    );
  });
});
