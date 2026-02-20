/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { __resolveAdapterName } from '../../../lambdas/lib/db/state/store.js';

describe('Actor runtime state store adapter selection', () => {
  it('defaults to vanilla even when AWS_REGION is set (no explicit adapter)', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_STATE_ADAPTER: undefined,
        WHARFIE_DB_ADAPTER: undefined,
      },
      () => {
        expect(__resolveAdapterName()).toBe('vanilla');
      },
    );
  });

  it('uses explicit WHARFIE_STATE_ADAPTER when set', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        AWS_REGION: undefined,
        AWS_EXECUTION_ENV: undefined,
        WHARFIE_STATE_ADAPTER: 'dynamodb',
        WHARFIE_DB_ADAPTER: undefined,
      },
      () => {
        expect(__resolveAdapterName()).toBe('dynamodb');
      },
    );
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
