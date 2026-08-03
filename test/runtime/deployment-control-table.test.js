import { describe, expect, it, jest } from '@jest/globals';

import {
  DEPLOYMENT_CONTROL_TABLE_NAME,
  DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
  DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
  DeploymentControlTableConflictError,
  DeploymentControlTableMissingError,
  DeploymentControlTableUnknownError,
  createDeploymentControlTableLifecycle,
} from '../../src/core/runtime/deployment-control-table.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';

const PROVIDER_SCOPE = createAwsProviderScope({
  partition: 'aws',
  accountId: '123456789012',
  region: 'us-east-1',
});
const TABLE_ARN = `arn:aws:dynamodb:us-east-1:123456789012:table/${DEPLOYMENT_CONTROL_TABLE_NAME}`;
const TABLE_ID = '01234567-89ab-cdef-0123-456789abcdef';
const REQUIRED_TAGS = Object.freeze([
  { Key: 'wharfie:managed-by', Value: 'wharfie' },
  {
    Key: 'wharfie:resource-kind',
    Value: 'deployment-control-table',
  },
  { Key: 'wharfie:retention', Value: 'retain' },
  { Key: 'wharfie:storage-schema-version', Value: '1' },
  {
    Key: 'wharfie:provider-scope-id',
    Value: PROVIDER_SCOPE.providerScopeId,
  },
]);

/** @returns {Error} - AWS-style absence. */
function resourceNotFound() {
  const error = new Error('do not echo provider details');
  error.name = 'ResourceNotFoundException';
  return error;
}

/** @returns {{promise: Promise<any>, resolve: (value: any) => void}} */
function deferred() {
  /** @type {(value: any) => void} */
  let settle = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: settle };
}

/** @param {Record<string, any>} [overrides] @returns {Record<string, any>} */
function tableResponse(overrides = {}) {
  return {
    Table: {
      TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      TableArn: TABLE_ARN,
      TableId: TABLE_ID,
      TableStatus: 'ACTIVE',
      AttributeDefinitions: [
        {
          AttributeName: DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
          AttributeType: 'S',
        },
      ],
      KeySchema: [
        {
          AttributeName: DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
          KeyType: 'HASH',
        },
      ],
      BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
      TableClassSummary: { TableClass: 'STANDARD' },
      DeletionProtectionEnabled: true,
      ...overrides,
    },
  };
}

/** @param {boolean} enabled @param {number} [days] @returns {Record<string, any>} */
function backupResponse(enabled, days = DEPLOYMENT_CONTROL_TABLE_PITR_DAYS) {
  return {
    ContinuousBackupsDescription: {
      ContinuousBackupsStatus: 'ENABLED',
      PointInTimeRecoveryDescription: enabled
        ? {
            PointInTimeRecoveryStatus: 'ENABLED',
            RecoveryPeriodInDays: days,
          }
        : { PointInTimeRecoveryStatus: 'DISABLED' },
    },
  };
}

/** @param {string} [status] @returns {Record<string, any>} */
function ttlResponse(status = 'DISABLED') {
  return { TimeToLiveDescription: { TimeToLiveStatus: status } };
}

/**
 * @param {Record<string, any>} [overrides] - Client method overrides.
 * @returns {Record<string, any>} - Complete low-level DynamoDB double.
 */
function createClient(overrides = {}) {
  return {
    describeTable: jest.fn(
      overrides.describeTable ?? (async () => tableResponse()),
    ),
    listTagsOfResource: jest.fn(
      overrides.listTagsOfResource ??
        (async () => ({ Tags: [...REQUIRED_TAGS] })),
    ),
    describeContinuousBackups: jest.fn(
      overrides.describeContinuousBackups ?? (async () => backupResponse(true)),
    ),
    describeTimeToLive: jest.fn(
      overrides.describeTimeToLive ?? (async () => ttlResponse()),
    ),
    createTable: jest.fn(overrides.createTable ?? (async () => ({}))),
    updateContinuousBackups: jest.fn(
      overrides.updateContinuousBackups ?? (async () => ({})),
    ),
  };
}

/** @param {Record<string, any>} client @param {(attempt: number) => Promise<void>} [waitForActive] */
function createLifecycle(client, waitForActive = async () => {}) {
  const lifecycleClient = /** @type {any} */ (client);
  return createDeploymentControlTableLifecycle({
    client: lifecycleClient,
    providerScope: PROVIDER_SCOPE,
    waitForActive,
  });
}

describe('AWS deployment control table lifecycle', () => {
  it('exposes the exact frozen lifecycle and fixed missing error', () => {
    const lifecycle = createLifecycle(createClient());
    const missing = new DeploymentControlTableMissingError();

    expect(Object.keys(lifecycle)).toEqual([
      'inspect',
      'reconcile',
      'bootstrap',
    ]);
    expect(Object.isFrozen(lifecycle)).toBe(true);
    expect(missing).toMatchObject({
      name: 'DeploymentControlTableMissingError',
      message: 'AWS deployment control table is absent.',
      code: 'DEPLOYMENT_CONTROL_TABLE_MISSING',
    });
  });

  it('reports authoritative absence without performing any other operation', async () => {
    const client = createClient({
      describeTable: async () => {
        throw resourceNotFound();
      },
    });

    const state = await createLifecycle(client).inspect();

    expect(state).toEqual({
      schemaVersion: 1,
      kind: 'deploymentControlTableInspection',
      status: 'absent',
      evidence: 'resource-not-found',
      tableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      providerScopeId: PROVIDER_SCOPE.providerScopeId,
      tableArn: null,
      tableId: null,
      pitrEnabled: false,
      pitrRecoveryPeriodDays: null,
      ttlEnabled: false,
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(client.listTagsOfResource).not.toHaveBeenCalled();
    expect(client.describeContinuousBackups).not.toHaveBeenCalled();
    expect(client.describeTimeToLive).not.toHaveBeenCalled();
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('admits only the exact active table while allowing unrelated tags', async () => {
    const client = createClient({
      listTagsOfResource: async () => ({
        Tags: [
          ...REQUIRED_TAGS.slice(0, 2),
          { Key: 'owner', Value: 'platform' },
        ],
        NextToken: 'page-2',
      }),
    });
    client.listTagsOfResource
      .mockImplementationOnce(async () => ({
        Tags: [
          ...REQUIRED_TAGS.slice(0, 2),
          { Key: 'owner', Value: 'platform' },
        ],
        NextToken: 'page-2',
      }))
      .mockImplementationOnce(async () => ({ Tags: REQUIRED_TAGS.slice(2) }));

    const state = await createLifecycle(client).inspect();

    expect(state).toEqual({
      schemaVersion: 1,
      kind: 'deploymentControlTableInspection',
      status: 'active',
      evidence: 'describe-table-tags-backups-and-ttl',
      tableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      providerScopeId: PROVIDER_SCOPE.providerScopeId,
      tableArn: TABLE_ARN,
      tableId: TABLE_ID,
      pitrEnabled: true,
      pitrRecoveryPeriodDays: DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
      ttlEnabled: false,
    });
    expect(client.listTagsOfResource).toHaveBeenNthCalledWith(2, {
      ResourceArn: TABLE_ARN,
      NextToken: 'page-2',
    });
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('waits for every active-table read and reports the first canonical failure', async () => {
    const pendingPitr = deferred();
    const allStarted = deferred();
    const client = createClient({
      listTagsOfResource: async () => ({
        Tags: [
          ...REQUIRED_TAGS,
          { Key: 'wharfie:unexpected', Value: 'unsupported' },
        ],
      }),
      describeContinuousBackups: () => pendingPitr.promise,
      describeTimeToLive: async () => {
        allStarted.resolve(undefined);
        throw new Error('later provider failure');
      },
    });

    const inspection = createLifecycle(client).inspect();
    await allStarted.promise;
    const observed = jest.fn();
    const reported = inspection.then(observed, observed);
    await new Promise((resolve) => setImmediate(resolve));

    expect(client.listTagsOfResource).toHaveBeenCalledTimes(1);
    expect(client.describeContinuousBackups).toHaveBeenCalledTimes(1);
    expect(client.describeTimeToLive).toHaveBeenCalledTimes(1);
    expect(observed).not.toHaveBeenCalled();

    pendingPitr.resolve(backupResponse(true));
    await expect(inspection).rejects.toBeInstanceOf(
      DeploymentControlTableConflictError,
    );
    await reported;
  });

  it.each([
    ['disabled PITR', backupResponse(false), false, null],
    ['shorter PITR', backupResponse(true, 7), true, 7],
  ])(
    'reports bootstrap-required for %s without mutating',
    async (_label, backup, enabled, days) => {
      const client = createClient({
        describeContinuousBackups: async () => backup,
      });

      await expect(createLifecycle(client).inspect()).resolves.toMatchObject({
        status: 'bootstrap-required',
        pitrEnabled: enabled,
        pitrRecoveryPeriodDays: days,
      });
      expect(client.createTable).not.toHaveBeenCalled();
      expect(client.updateContinuousBackups).not.toHaveBeenCalled();
    },
  );

  it('reports creating state without treating incomplete metadata as usable', async () => {
    const client = createClient({
      describeTable: async () => tableResponse({ TableStatus: 'CREATING' }),
    });

    await expect(createLifecycle(client).inspect()).resolves.toMatchObject({
      status: 'creating',
      tableArn: TABLE_ARN,
      tableId: TABLE_ID,
      ttlEnabled: null,
    });
    expect(client.listTagsOfResource).not.toHaveBeenCalled();
    expect(client.describeContinuousBackups).not.toHaveBeenCalled();
    expect(client.describeTimeToLive).not.toHaveBeenCalled();
  });

  it('reconciles an already-active table without mutation or creation', async () => {
    const client = createClient();

    await expect(createLifecycle(client).reconcile()).resolves.toMatchObject({
      status: 'active',
      tableArn: TABLE_ARN,
      tableId: TABLE_ID,
    });
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('reconciles PITR through lost-response readback without creating', async () => {
    let pitrEnabled = false;
    const client = createClient({
      describeContinuousBackups: async () => backupResponse(pitrEnabled),
      updateContinuousBackups: async () => {
        pitrEnabled = true;
        throw new Error('lost backup response');
      },
    });

    await expect(createLifecycle(client).reconcile()).resolves.toMatchObject({
      status: 'active',
      pitrEnabled: true,
      pitrRecoveryPeriodDays: DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
    });
    expect(client.updateContinuousBackups).toHaveBeenCalledTimes(1);
    expect(client.createTable).not.toHaveBeenCalled();
  });

  it('waits for an already-creating table during reconciliation without creating', async () => {
    const descriptions = [
      tableResponse({ TableStatus: 'CREATING' }),
      tableResponse({ TableStatus: 'CREATING' }),
      tableResponse(),
    ];
    const waitForActive = jest.fn(async () => {});
    const client = createClient({
      describeTable: async () => descriptions.shift(),
    });

    await expect(
      createLifecycle(client, waitForActive).reconcile(),
    ).resolves.toMatchObject({
      status: 'active',
      tableArn: TABLE_ARN,
      tableId: TABLE_ID,
    });
    expect(waitForActive).toHaveBeenCalledTimes(1);
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('rejects physical replacement while reconciling an already-creating table', async () => {
    const descriptions = [
      tableResponse({ TableStatus: 'CREATING' }),
      tableResponse({ TableId: 'fedcba98-7654-3210-fedc-ba9876543210' }),
    ];
    const client = createClient({
      describeTable: async () => descriptions.shift(),
    });

    await expect(createLifecycle(client).reconcile()).rejects.toBeInstanceOf(
      DeploymentControlTableConflictError,
    );
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('fails reconciliation with fixed missing evidence on initial absence', async () => {
    const client = createClient({
      describeTable: async () => {
        throw resourceNotFound();
      },
    });

    await expect(createLifecycle(client).reconcile()).rejects.toEqual(
      new DeploymentControlTableMissingError(),
    );
    expect(client.describeTable).toHaveBeenCalledTimes(1);
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('fails reconciliation with fixed missing evidence when the table disappears during PITR readback', async () => {
    let exists = true;
    const client = createClient({
      describeTable: async () => {
        if (!exists) throw resourceNotFound();
        return tableResponse();
      },
      describeContinuousBackups: async () => backupResponse(false),
      updateContinuousBackups: async () => {
        exists = false;
        throw new Error('lost response while the table disappeared');
      },
    });

    await expect(createLifecycle(client).reconcile()).rejects.toEqual(
      new DeploymentControlTableMissingError(),
    );
    expect(client.updateContinuousBackups).toHaveBeenCalledTimes(1);
    expect(client.createTable).not.toHaveBeenCalled();
  });

  it.each([
    [
      'a different key schema',
      { AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }] },
      undefined,
    ],
    [
      'a cross-account ARN',
      {
        TableArn: `arn:aws:dynamodb:us-east-1:999999999999:table/${DEPLOYMENT_CONTROL_TABLE_NAME}`,
      },
      undefined,
    ],
    [
      'a customer-managed encryption key',
      {
        SSEDescription: {
          Status: 'ENABLED',
          SSEType: 'KMS',
          KMSMasterKeyArn: 'arn:aws:kms:us-east-1:123456789012:key/opaque',
        },
      },
      undefined,
    ],
    ['malformed index metadata', { GlobalSecondaryIndexes: {} }, undefined],
    ['malformed replica metadata', { Replicas: {} }, undefined],
    ['time to live', {}, 'ENABLED'],
  ])('rejects an existing table with %s', async (_label, table, ttlStatus) => {
    const client = createClient({
      describeTable: async () => tableResponse(table),
      ...(ttlStatus === undefined
        ? {}
        : { describeTimeToLive: async () => ttlResponse(ttlStatus) }),
    });

    await expect(createLifecycle(client).bootstrap()).rejects.toBeInstanceOf(
      DeploymentControlTableConflictError,
    );
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it.each([
    ['missing required tags', REQUIRED_TAGS.slice(0, REQUIRED_TAGS.length - 1)],
    [
      'an unknown reserved tag',
      [...REQUIRED_TAGS, { Key: 'wharfie:unknown', Value: 'not-admitted' }],
    ],
    [
      'a changed ownership tag',
      REQUIRED_TAGS.map((tag) =>
        tag.Key === 'wharfie:managed-by'
          ? { ...tag, Value: 'someone-else' }
          : tag,
      ),
    ],
  ])('rejects an existing table with %s', async (_label, tags) => {
    const client = createClient({
      listTagsOfResource: async () => ({ Tags: tags }),
    });

    await expect(createLifecycle(client).bootstrap()).rejects.toBeInstanceOf(
      DeploymentControlTableConflictError,
    );
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('turns provider read failures into a fixed unknown-state boundary', async () => {
    const client = createClient({
      describeTable: async () => {
        const error = new Error('secret provider response');
        error.name = 'AccessDeniedException';
        throw error;
      },
    });

    await expect(createLifecycle(client).inspect()).rejects.toEqual(
      new DeploymentControlTableUnknownError(),
    );
  });

  it('bootstraps the fixed retained table and converges after lost write responses', async () => {
    let exists = false;
    let pitrEnabled = false;
    const client = createClient({
      describeTable: async () => {
        if (!exists) throw resourceNotFound();
        return tableResponse();
      },
      describeContinuousBackups: async () => backupResponse(pitrEnabled),
      createTable: async () => {
        exists = true;
        throw new Error('lost create response');
      },
      updateContinuousBackups: async () => {
        pitrEnabled = true;
        throw new Error('lost backup response');
      },
    });

    const state = await createLifecycle(client).bootstrap();

    expect(state).toMatchObject({
      status: 'active',
      pitrEnabled: true,
      pitrRecoveryPeriodDays: DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
      ttlEnabled: false,
    });
    expect(client.createTable).toHaveBeenCalledTimes(1);
    expect(client.createTable).toHaveBeenCalledWith({
      TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      AttributeDefinitions: [
        {
          AttributeName: DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
          AttributeType: 'S',
        },
      ],
      KeySchema: [
        {
          AttributeName: DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
          KeyType: 'HASH',
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
      TableClass: 'STANDARD',
      DeletionProtectionEnabled: true,
      Tags: REQUIRED_TAGS,
    });
    expect(client.createTable.mock.calls[0][0]).not.toHaveProperty(
      'SSESpecification',
    );
    expect(client.createTable.mock.calls[0][0]).not.toHaveProperty(
      'ProvisionedThroughput',
    );
    expect(client.updateContinuousBackups).toHaveBeenCalledWith({
      TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true,
        RecoveryPeriodInDays: DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
      },
    });
  });

  it('bounds post-create tag propagation before admitting the new table', async () => {
    let exists = false;
    let tagReads = 0;
    const waitForActive = jest.fn(async () => {});
    const client = createClient({
      describeTable: async () => {
        if (!exists) throw resourceNotFound();
        return tableResponse();
      },
      createTable: async () => {
        exists = true;
      },
      listTagsOfResource: async () => {
        tagReads += 1;
        return { Tags: tagReads === 1 ? [] : [...REQUIRED_TAGS] };
      },
    });

    await expect(
      createLifecycle(client, waitForActive).bootstrap(),
    ).resolves.toMatchObject({ status: 'active' });
    expect(client.createTable).toHaveBeenCalledTimes(1);
    expect(waitForActive).toHaveBeenCalledTimes(1);
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
  });

  it('waits for the exact PITR recovery period instead of accepting any active table', async () => {
    const pitrResponses = [
      backupResponse(false),
      backupResponse(true, 7),
      backupResponse(true, DEPLOYMENT_CONTROL_TABLE_PITR_DAYS),
    ];
    const waitForActive = jest.fn(async () => {});
    const client = createClient({
      describeContinuousBackups: async () => pitrResponses.shift(),
    });

    const state = await createLifecycle(client, waitForActive).bootstrap();

    expect(state.pitrRecoveryPeriodDays).toBe(
      DEPLOYMENT_CONTROL_TABLE_PITR_DAYS,
    );
    expect(client.updateContinuousBackups).toHaveBeenCalledTimes(1);
    expect(waitForActive).toHaveBeenCalledTimes(1);
  });

  it('refuses a different physical table during PITR response-loss recovery', async () => {
    let replaced = false;
    const client = createClient({
      describeTable: async () =>
        tableResponse({
          TableId: replaced ? 'replacement-table-id' : TABLE_ID,
        }),
      describeContinuousBackups: async () => backupResponse(replaced),
      updateContinuousBackups: async () => {
        replaced = true;
        throw new Error('lost update response after external replacement');
      },
    });

    await expect(createLifecycle(client).bootstrap()).rejects.toBeInstanceOf(
      DeploymentControlTableConflictError,
    );
  });

  it('retries unknown bootstrap reads but keeps one-shot inspection fail-closed', async () => {
    let ttlReads = 0;
    const waitForActive = jest.fn(async () => {});
    const client = createClient({
      describeTimeToLive: async () => {
        ttlReads += 1;
        return ttlResponse(ttlReads === 1 ? 'DISABLING' : 'DISABLED');
      },
    });
    const lifecycle = createLifecycle(client, waitForActive);

    await expect(lifecycle.inspect()).rejects.toBeInstanceOf(
      DeploymentControlTableUnknownError,
    );
    await expect(lifecycle.bootstrap()).resolves.toMatchObject({
      status: 'active',
      ttlEnabled: false,
    });
    expect(waitForActive).not.toHaveBeenCalled();

    ttlReads = 0;
    const retryingClient = createClient({
      describeTimeToLive: async () => {
        ttlReads += 1;
        return ttlResponse(ttlReads === 1 ? 'DISABLING' : 'DISABLED');
      },
    });
    await expect(
      createLifecycle(retryingClient, waitForActive).bootstrap(),
    ).resolves.toMatchObject({ status: 'active', ttlEnabled: false });
    expect(waitForActive).toHaveBeenCalledTimes(1);
    expect(retryingClient.createTable).not.toHaveBeenCalled();
  });

  it('waits for an already-creating exact table without issuing create', async () => {
    const descriptions = [
      tableResponse({ TableStatus: 'CREATING' }),
      tableResponse({ TableStatus: 'CREATING' }),
      tableResponse(),
    ];
    const waitForActive = jest.fn(async () => {});
    const client = createClient({
      describeTable: async () => descriptions.shift(),
    });

    const state = await createLifecycle(client, waitForActive).bootstrap();

    expect(state.status).toBe('active');
    expect(client.createTable).not.toHaveBeenCalled();
    expect(client.updateContinuousBackups).not.toHaveBeenCalled();
    expect(waitForActive).toHaveBeenCalledTimes(1);
  });
});
