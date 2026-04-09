/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';

import LambdaBuild from '../../../src/core/resources/aws/lambda-build.js';

describe('LambdaBuild', () => {
  it('fails fast for legacy built-in handler aliases that no longer exist in the package', async () => {
    const lambdaBuild = new LambdaBuild({
      name: 'test-function',
      properties: {
        handler: '<WHARFIE_BUILT_IN>/cleanup.handler',
        artifactBucket: 'artifact-bucket',
      },
    });

    await expect(lambdaBuild.reconcile()).rejects.toThrow(
      /no longer supports legacy built-in handler aliases/i,
    );
  });
});
