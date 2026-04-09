/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { fileURLToPath } from 'node:url';

import { describe, expect, it, jest } from '@jest/globals';

import LambdaBuild from '../../../src/core/resources/aws/lambda-build.js';

const explicitHandlerPath = fileURLToPath(
  new URL('../../fixtures/lambda-build-test-handler.handler', import.meta.url),
);

describe('LambdaBuild handler resolution', () => {
  it('keeps explicit handler module paths working', async () => {
    const resource = new LambdaBuild({
      name: 'explicit-handler',
      properties: {
        handler: explicitHandlerPath,
        artifactBucket: 'service-bucket',
      },
    });

    resource.s3 = /** @type {any} */ ({
      headObject: jest.fn(async () => ({})),
      putObject: jest.fn(),
    });

    await resource._reconcile();

    expect(resource.get('functionCodeHash')).toMatch(/^[a-f0-9]{64}$/);
    expect(resource.get('artifactKey')).toBe(
      `actor-artifacts/explicit-handler/${resource.get('functionCodeHash')}.zip`,
    );
    expect(resource.s3.headObject).toHaveBeenCalledWith({
      Bucket: 'service-bucket',
      Key: resource.get('artifactKey'),
    });
    expect(resource.s3.putObject).not.toHaveBeenCalled();
  });

  it('throws a clear error for legacy built-in handler aliases', async () => {
    const resource = new LambdaBuild({
      name: 'legacy-handler',
      properties: {
        handler: '<WHARFIE_BUILT_IN>/cleanup.handler',
        artifactBucket: 'service-bucket',
      },
    });

    resource.s3 = /** @type {any} */ ({
      headObject: jest.fn(),
      putObject: jest.fn(),
    });

    await expect(resource._reconcile()).rejects.toThrow(
      'LambdaBuild no longer supports legacy built-in handler aliases',
    );
    expect(resource.s3.headObject).not.toHaveBeenCalled();
    expect(resource.s3.putObject).not.toHaveBeenCalled();
  });
});
