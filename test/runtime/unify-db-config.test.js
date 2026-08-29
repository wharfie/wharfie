/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  COORDINATOR_AUTHORITY_MAX_TIMER_MS,
  DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
  closeDB,
  createControlDBClient,
  resolveControlAdapterName,
  resolveControlStoreRegion,
  resolveExecutionLedgerTableName,
  resolveExecutionPayloadPath,
  resolveExecutionPayloadStoreId,
  resolveLedgerServiceSessionPath,
  resolveResidentCoordinatorAuthorityConfiguration,
  resolveStateAdapterName,
} from '../../src/core/lib/config/db.js';
import { __resolveAdapterName as __resolveStateStoreAdapter } from '../../src/core/lib/db/state/store.js';

const TABLE_RESOURCE_ID = `wdtr1_${'A'.repeat(43)}`;

describe('Unified DB config', () => {
  afterEach(async () => {
    await closeDB();
  });

  test('state adapter selection never infers DynamoDB from AWS env vars', async () => {
    await withEnv(
      {
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_DB_ADAPTER: undefined,
        WHARFIE_STATE_ADAPTER: undefined,
      },
      async () => {
        expect(resolveStateAdapterName()).toBe('vanilla');
        expect(__resolveStateStoreAdapter()).toBe('vanilla');
      },
    );
  });

  test('control store has isolated test defaults and durable local defaults', async () => {
    await withEnv(
      {
        NODE_ENV: 'test',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_CONTROL_ADAPTER: undefined,
        WHARFIE_CONTROL_PATH: undefined,
        WHARFIE_EXECUTION_LEDGER_TABLE: undefined,
      },
      async () => {
        expect(resolveControlAdapterName()).toBe('vanilla');
        expect(resolveExecutionLedgerTableName()).toBe(
          'wharfie-execution-ledger-v10',
        );

        const first = await createControlDBClient();
        const second = await createControlDBClient();
        try {
          await first.put({
            tableName: 'isolation-probe',
            keyName: 'id',
            record: { id: 'only-in-first' },
          });
          expect(
            await second.get({
              tableName: 'isolation-probe',
              keyName: 'id',
              keyValue: 'only-in-first',
            }),
          ).toBeUndefined();
        } finally {
          await first.close();
          await second.close();
        }
      },
    );

    await withEnv(
      {
        NODE_ENV: 'development',
        AWS_REGION: 'us-east-1',
        AWS_EXECUTION_ENV: 'AWS_Lambda_nodejs22.x',
        WHARFIE_CONTROL_ADAPTER: undefined,
      },
      async () => {
        expect(resolveControlAdapterName()).toBe('lmdb');
      },
    );
  });

  test('control store honors explicit adapter selection', async () => {
    await withEnv({ WHARFIE_CONTROL_ADAPTER: 'LMDB' }, async () => {
      expect(resolveControlAdapterName()).toBe('lmdb');
    });
    await withEnv({ WHARFIE_CONTROL_ADAPTER: 'dynamodb' }, async () => {
      expect(resolveControlAdapterName()).toBe('dynamodb');
    });
    await withEnv({ WHARFIE_CONTROL_ADAPTER: 'vanilla' }, async () => {
      expect(resolveControlAdapterName()).toBe('vanilla');
    });
  });

  test('snapshots an explicit DynamoDB region without enabling automatic replacement', async () => {
    await withEnv(
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE: undefined,
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: undefined,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: undefined,
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: undefined,
      },
      async () => {
        expect(resolveControlStoreRegion('dynamodb')).toBe('us-east-2');
        expect(
          resolveResidentCoordinatorAuthorityConfiguration({
            adapterName: 'dynamodb',
            tableName: 'ledger-table',
            region: 'us-east-2',
          }),
        ).toBeUndefined();
      },
    );
    await withEnv({ AWS_REGION: undefined }, async () => {
      expect(resolveControlStoreRegion('dynamodb')).toBeUndefined();
    });
  });

  test('resolves only the explicit bounded DynamoDB RVN resident profile', async () => {
    await withEnv(
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '15000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      async () => {
        const configuration = resolveResidentCoordinatorAuthorityConfiguration({
          adapterName: 'dynamodb',
          tableName: ' ledger-table ',
          region: resolveControlStoreRegion('dynamodb'),
        });
        expect(configuration).toEqual({
          profile: 'dynamodb-rvn-v1',
          adapterName: 'dynamodb',
          region: 'us-east-2',
          tableName: 'ledger-table',
          tableResourceId: TABLE_RESOURCE_ID,
          renewalIntervalMs: 5000,
          observationWindowMs: 15000,
        });
        expect(Object.isFrozen(configuration)).toBe(true);
      },
    );
  });

  test.each([
    [
      'unsupported profile',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE: 'timestamp-lease-v0',
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '15000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      'WHARFIE_COORDINATOR_AUTHORITY_PROFILE',
    ],
    [
      'missing renewal',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: undefined,
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '15000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      'WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS',
    ],
    [
      'unbounded observation',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: String(
          COORDINATOR_AUTHORITY_MAX_TIMER_MS + 1,
        ),
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      'must be no greater',
    ],
    [
      'window no larger than cadence',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '5000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      'must be greater',
    ],
    [
      'missing table resource identity',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '15000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: undefined,
      },
      'WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID',
    ],
    [
      'noncanonical table resource identity',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '15000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: `wdtr1_${'A'.repeat(42)}B`,
      },
      'canonical DynamoDB table resource identity',
    ],
    [
      'table resource identity without a profile',
      {
        AWS_REGION: 'us-east-2',
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE: undefined,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: undefined,
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: undefined,
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      'WHARFIE_COORDINATOR_AUTHORITY_PROFILE',
    ],
  ])('rejects %s', async (_label, environment, message) => {
    await withEnv(environment, async () => {
      expect(() =>
        resolveResidentCoordinatorAuthorityConfiguration({
          adapterName: 'dynamodb',
          tableName: 'ledger-table',
          region: 'us-east-2',
        }),
      ).toThrow(message);
    });
  });

  test('rejects automatic replacement outside exact DynamoDB routing', async () => {
    await withEnv(
      {
        WHARFIE_COORDINATOR_AUTHORITY_PROFILE:
          DYNAMODB_RVN_COORDINATOR_AUTHORITY_PROFILE,
        WHARFIE_COORDINATOR_RENEWAL_INTERVAL_MS: '5000',
        WHARFIE_COORDINATOR_OBSERVATION_WINDOW_MS: '15000',
        WHARFIE_COORDINATOR_AUTHORITY_TABLE_RESOURCE_ID: TABLE_RESOURCE_ID,
      },
      async () => {
        expect(() =>
          resolveResidentCoordinatorAuthorityConfiguration({
            adapterName: 'lmdb',
            tableName: 'ledger-table',
          }),
        ).toThrow(/DynamoDB control adapter/u);
      },
    );
  });

  test('execution ledger table names resolve independently at call time', async () => {
    await withEnv(
      { WHARFIE_EXECUTION_LEDGER_TABLE: ' ledger-a ' },
      async () => {
        expect(resolveExecutionLedgerTableName()).toBe('ledger-a');
        await withEnv(
          { WHARFIE_EXECUTION_LEDGER_TABLE: 'ledger-b' },
          async () => {
            expect(resolveExecutionLedgerTableName()).toBe('ledger-b');
          },
        );
      },
    );
  });

  test('execution payload storage is independently configurable and stable per root', async () => {
    const controlPath = join(tmpdir(), 'wharfie-control-payload-config');
    await withEnv(
      {
        WHARFIE_CONTROL_PATH: controlPath,
        WHARFIE_EXECUTION_PAYLOAD_PATH: undefined,
        WHARFIE_EXECUTION_PAYLOAD_STORE_ID: undefined,
      },
      async () => {
        const payloadPath = resolveExecutionPayloadPath();
        expect(payloadPath).toBe(join(controlPath, 'execution-payloads'));
        expect(resolveExecutionPayloadStoreId(payloadPath)).toMatch(
          /^payload-[a-f0-9]{55}$/,
        );
        expect(resolveExecutionPayloadStoreId(payloadPath)).toBe(
          resolveExecutionPayloadStoreId(payloadPath),
        );
      },
    );
    await withEnv(
      {
        WHARFIE_EXECUTION_PAYLOAD_PATH: ' /tmp/ignored ',
        WHARFIE_EXECUTION_PAYLOAD_STORE_ID: 'portable-payload-store',
      },
      async () => {
        expect(resolveExecutionPayloadPath()).toBe('/tmp/ignored');
        expect(resolveExecutionPayloadStoreId()).toBe('portable-payload-store');
      },
    );
  });

  test('ledger-service sessions share the configured local control namespace', async () => {
    const controlPath = join(tmpdir(), 'wharfie-control-service-config');
    await withEnv(
      {
        WHARFIE_CONTROL_PATH: controlPath,
        WHARFIE_LEDGER_SERVICE_SESSION_PATH: undefined,
      },
      async () => {
        expect(resolveLedgerServiceSessionPath()).toBe(
          join(controlPath, 'ledger-service-sessions'),
        );
      },
    );
    await withEnv(
      { WHARFIE_LEDGER_SERVICE_SESSION_PATH: ' /tmp/ledger-sessions ' },
      async () => {
        expect(resolveLedgerServiceSessionPath()).toBe('/tmp/ledger-sessions');
      },
    );
  });
});

/**
 * Temporarily applies env var overrides for the duration of the callback.
 *
 * @template T
 * @param {Record<string, string | undefined>} overrides - overrides.
 * @param {() => T | Promise<T>} fn - fn.
 * @returns {Promise<T>} - Result.
 */
async function withEnv(overrides, fn) {
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
    return await fn();
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
