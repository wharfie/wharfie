/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, jest, test } from '@jest/globals';

import {
  DB_ADAPTER_IDENTITY,
  DB_ADAPTER_NAMES,
  assertDBClientAdapterIdentity,
  readDBClientAdapterIdentity,
} from '../../../src/core/lib/db/base.js';
import { getAdapterMatrix } from '../../helpers/db-adapters.js';

describe('DB client adapter identity', () => {
  for (const adapter of getAdapterMatrix()) {
    test(`${adapter.name} reports an enumerable identity that survives a spread wrapper`, async () => {
      const { db, cleanup } = await adapter.create();
      const expected =
        /** @type {import('../../../src/core/lib/db/base.js').DBAdapterIdentity} */ (
          adapter.name
        );

      try {
        expect(readDBClientAdapterIdentity(db)).toBe(expected);
        expect(assertDBClientAdapterIdentity(db, expected)).toBe(expected);
        expect(
          Object.getOwnPropertyDescriptor(db, DB_ADAPTER_IDENTITY),
        ).toEqual({
          configurable: false,
          enumerable: true,
          value: expected,
          writable: false,
        });

        const injectedTransactionFailure = jest.fn(async () => {
          throw new Error('injected transaction failure');
        });
        const wrapped = {
          ...db,
          transactionWrite: injectedTransactionFailure,
        };

        expect(
          Object.prototype.hasOwnProperty.call(wrapped, DB_ADAPTER_IDENTITY),
        ).toBe(true);
        expect(
          Object.getOwnPropertyDescriptor(wrapped, DB_ADAPTER_IDENTITY),
        ).toMatchObject({
          enumerable: true,
          value: expected,
        });
        expect(readDBClientAdapterIdentity(wrapped)).toBe(expected);
        expect(assertDBClientAdapterIdentity(wrapped, expected)).toBe(expected);
      } finally {
        await cleanup();
      }
    });
  }

  test('strict readers reject missing, inherited, hidden, unknown, and mismatched identities', () => {
    expect(() => readDBClientAdapterIdentity(null)).toThrow(
      /must be an object/i,
    );
    expect(() => readDBClientAdapterIdentity({})).toThrow(/missing/i);
    expect(() =>
      readDBClientAdapterIdentity(
        Object.create({ [DB_ADAPTER_IDENTITY]: DB_ADAPTER_NAMES.LMDB }),
      ),
    ).toThrow(/own enumerable/i);

    const hidden = {};
    Object.defineProperty(hidden, DB_ADAPTER_IDENTITY, {
      value: DB_ADAPTER_NAMES.LMDB,
    });
    expect(() => readDBClientAdapterIdentity(hidden)).toThrow(
      /own enumerable/i,
    );
    expect(() =>
      readDBClientAdapterIdentity({ [DB_ADAPTER_IDENTITY]: 'sqlite' }),
    ).toThrow(/must be one of/i);
    expect(() =>
      assertDBClientAdapterIdentity(
        { [DB_ADAPTER_IDENTITY]: DB_ADAPTER_NAMES.VANILLA },
        DB_ADAPTER_NAMES.LMDB,
      ),
    ).toThrow(/expected 'lmdb', received 'vanilla'/i);
  });
});
