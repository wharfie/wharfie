/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { __resolveResourceAdapterName } from '../../../lambdas/lib/actor/runtime/resources.js';
import { jest } from '@jest/globals';

describe('ActorSystem runtime resource adapter selection', () => {
  it('chooses vanilla for adapter=auto even when AWS_REGION is set', () => {
    withEnv(
      {
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
      },
      () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          expect(__resolveResourceAdapterName('auto', 'db')).toBe('vanilla');
          expect(
            __resolveResourceAdapterName({ adapter: 'auto' }, 'queue'),
          ).toBe('vanilla');
          expect(__resolveResourceAdapterName('auto', 'objectStorage')).toBe(
            'vanilla',
          );

          // Warning is emitted once per process, regardless of resource kind.
          expect(warn).toHaveBeenCalledTimes(1);
        } finally {
          warn.mockRestore();
        }
      },
    );
  });

  it("honors explicit adapters (no 'auto' inference)", () => {
    withEnv({ AWS_REGION: 'us-east-1' }, () => {
      expect(__resolveResourceAdapterName('dynamodb', 'db')).toBe('dynamodb');
      expect(__resolveResourceAdapterName('sqs', 'queue')).toBe('sqs');
    });
  });
});

/**
 * Temporarily applies env var overrides for the duration of the callback.
 *
 * @template T
 * @param {Record<string, string | undefined>} overrides - overrides.
 * @param {() => T} fn - fn.
 * @returns {T} - Result.
 */
function withEnv(overrides, fn) {
  /** @type {Record<string, string | undefined>} */
  const previous = {};

  for (const [key, value] of Object.entries(overrides)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
