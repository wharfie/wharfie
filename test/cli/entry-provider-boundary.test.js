/* eslint-env jest */

import path from 'node:path';

import { createProgram } from '../../src/cli/entry.js';

const DEPLOYMENT_INSTANCE_ID = `wdi1_${'A'.repeat(43)}`;

describe('CLI provider boundary', () => {
  test.each([
    [
      'plan',
      [
        'plan',
        'demo',
        '--profile',
        '/provider-guard/not-read.json',
        '--control-policy',
        'bootstrap',
      ],
    ],
    ['apply', ['apply', 'demo', '--profile', '/provider-guard/not-read.json']],
    ['inspect', ['inspect', DEPLOYMENT_INSTANCE_ID, '--region', 'us-east-1']],
    [
      'reconcile',
      ['reconcile', DEPLOYMENT_INSTANCE_ID, '--region', 'us-east-1'],
    ],
    ['destroy', ['destroy', DEPLOYMENT_INSTANCE_ID, '--region', 'us-east-1']],
  ])(
    'requires the AWS provider before paths or the %s operation',
    async (_operation, operationArgv) => {
      /** @type {string[]} */
      const order = [];
      const providerError = new Error('provider missing');
      const program = createProgram({
        pathsModule: {
          config: path.join(process.cwd(), '.wharfie-test-config'),
          createWharfiePaths: async () => {
            order.push('paths');
          },
        },
        requireProvider: async () => {
          order.push('provider');
          throw providerError;
        },
      });

      await expect(
        program.parseAsync(['node', 'wharfie', 'deployment', ...operationArgv]),
      ).rejects.toBe(providerError);

      expect(order).toEqual(['provider']);
    },
  );
});
