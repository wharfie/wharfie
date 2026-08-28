// @ts-nocheck -- intentionally loose injected provider and protocol test doubles.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';
import { createHash } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION,
  DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
  createDynamoDBCoordinatorAuthorityLiveProofDriver,
  createDynamoDBCoordinatorAuthorityProofTableName,
  main,
  parseDynamoDBCoordinatorAuthorityLiveProofArguments,
  publishDynamoDBCoordinatorAuthorityLiveProof,
} from '../../scripts/run-dynamodb-coordinator-authority-live-proof.js';
import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
} from '../../src/core/lib/db/tables/coordinator-authority.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

const REGION = 'us-east-1';
const SUFFIX = 'abcd1234efgh5678';
const OUTPUT = '/private/tmp/dynamodb-rvn-proof.json';

function resourceNotFound() {
  const error = new Error('not found');
  error.name = 'ResourceNotFoundException';
  return error;
}

function activeTable(tableName, overrides = {}) {
  return {
    Table: {
      TableName: tableName,
      TableStatus: 'ACTIVE',
      AttributeDefinitions: [
        { AttributeName: 'run_id', AttributeType: 'S' },
        { AttributeName: 'sort_key', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'run_id', KeyType: 'HASH' },
        { AttributeName: 'sort_key', KeyType: 'RANGE' },
      ],
      BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
      TableArn: `arn:aws:dynamodb:${REGION}:000000000000:table/${tableName}`,
      ...overrides,
    },
  };
}

function authorityId({ appId, coordinatorId, epoch, requestId }) {
  return createCanonicalJsonSha256Id({
    domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
    prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
    value: {
      schemaVersion: 1,
      appId,
      coordinatorId,
      epoch,
      requestId,
    },
    valuePath: 'fake coordinator authority identity',
  });
}

function authoritySnapshot({
  appId,
  coordinatorId,
  requestId,
  epoch,
  recordVersion,
  observedAt,
  status = 'ACTIVE',
}) {
  return {
    schemaVersion: 1,
    appId,
    coordinatorId,
    authorityId: authorityId({
      appId,
      coordinatorId,
      epoch,
      requestId,
    }),
    epoch,
    status,
    recordVersion,
    acquisitionRequestId: requestId,
    acquiredAt: observedAt,
    heartbeatAt: observedAt,
    releasedAt: status === 'RELEASED' ? observedAt : null,
    updatedAt: observedAt,
    lastRequestId: requestId,
  };
}

function clone(value) {
  return value === null || value === undefined
    ? value
    : JSON.parse(JSON.stringify(value));
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function conflict() {
  const error = new Error('authority conflict');
  error.name = 'CoordinatorAuthorityConflictError';
  error.code = 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT';
  return error;
}

function createFakeProtocolFamily() {
  const state = { authority: null };

  function createProtocol(options) {
    const waitForObservation = options.waitForObservation;
    return {
      async get() {
        return clone(state.authority);
      },
      async acquire(input) {
        if (state.authority?.status === 'ACTIVE') throw conflict();
        const epoch = state.authority ? state.authority.epoch + 1 : 1;
        state.authority = authoritySnapshot({
          appId: input.appId,
          coordinatorId: input.coordinatorId,
          requestId: input.requestId,
          epoch,
          recordVersion: state.authority
            ? state.authority.recordVersion + 1
            : 1,
          observedAt: input.observedAt,
        });
        return {
          applied: true,
          action: 'acquire',
          authority: clone(state.authority),
        };
      },
      async renew(input) {
        if (!same(state.authority, input.observedAuthority)) throw conflict();
        state.authority = {
          ...clone(state.authority),
          recordVersion: state.authority.recordVersion + 1,
          heartbeatAt: input.observedAt,
          updatedAt: input.observedAt,
          lastRequestId: input.requestId,
        };
        return { applied: true, authority: clone(state.authority) };
      },
      async release(input) {
        if (!same(state.authority, input.authority)) throw conflict();
        state.authority = {
          ...clone(state.authority),
          status: 'RELEASED',
          recordVersion: state.authority.recordVersion + 1,
          releasedAt: input.observedAt,
          updatedAt: input.observedAt,
          lastRequestId: input.requestId,
        };
        return {
          applied: true,
          action: 'release',
          authority: clone(state.authority),
        };
      },
      async observeReplacement(input) {
        const before = clone(state.authority);
        if (!before || before.status === 'RELEASED') {
          return { outcome: 'inactive', authority: before };
        }
        await waitForObservation(options.observationWindowMs);
        const after = clone(state.authority);
        if (!same(before, after)) {
          const sameIdentity =
            before.authorityId === after.authorityId &&
            before.epoch === after.epoch;
          return {
            outcome: 'changed',
            reason: sameIdentity
              ? after.status === 'RELEASED'
                ? 'released'
                : 'renewed'
              : 'replaced',
            before,
            after,
          };
        }
        const observation = {
          schemaVersion: 1,
          kind: 'dynamodb-coordinator-authority-rvn-observation',
          tableName: options.tableName,
          appId: input.appId,
          observationWindowMs: options.observationWindowMs,
          elapsedNanoseconds: String(options.observationWindowMs * 1_000_000),
          recordVersion: before.recordVersion,
          authority: before,
        };
        return {
          outcome: 'stable',
          observation,
          async takeover(takeoverInput) {
            if (!same(state.authority, before)) throw conflict();
            state.authority = authoritySnapshot({
              appId: before.appId,
              coordinatorId: takeoverInput.coordinatorId,
              requestId: takeoverInput.requestId,
              epoch: before.epoch + 1,
              recordVersion: before.recordVersion + 1,
              observedAt: takeoverInput.observedAt,
            });
            return {
              applied: true,
              observation,
              authority: clone(state.authority),
            };
          },
        };
      },
    };
  }

  return { createProtocol, state };
}

function createHarness({
  tableOverrides = {},
  createFailure,
  createClientFailure,
  observeFailure,
} = {}) {
  const calls = [];
  let tableName;
  let exists = false;
  const family = createFakeProtocolFamily();
  const records = new Map();
  const clients = [];
  const admin = {
    async createTable(input) {
      calls.push(['createTable', clone(input)]);
      if (createFailure) throw createFailure;
      tableName = input.TableName;
      exists = true;
      return {
        TableDescription: activeTable(tableName, tableOverrides).Table,
      };
    },
    async describeTable(input) {
      calls.push(['describeTable', clone(input)]);
      if (!exists) throw resourceNotFound();
      return activeTable(tableName, tableOverrides);
    },
    async deleteTable(input) {
      calls.push(['deleteTable', clone(input)]);
      exists = false;
      return {};
    },
    async close() {
      calls.push(['closeAdmin']);
    },
  };
  async function createDBClient(label) {
    calls.push(['createDBClient', label]);
    if (createClientFailure?.label === label) {
      throw createClientFailure.error;
    }
    const client = {
      async transactionWrite(params) {
        const epochCondition = params.conditionChecks
          ?.flatMap((check) => check.conditions || [])
          .find((condition) => condition.propertyName === 'epoch');
        if (epochCondition?.propertyValue !== family.state.authority?.epoch) {
          const error = new Error('conditional check failed');
          error.name = 'ConditionalCheckFailedException';
          throw error;
        }
        for (const put of params.putRequests || []) {
          records.set(
            `${put.record.run_id}\0${put.record.sort_key}`,
            clone(put.record),
          );
        }
      },
      async get(input) {
        return clone(records.get(`${input.keyValue}\0${input.sortKeyValue}`));
      },
      async close() {
        calls.push(['closeDB', label]);
      },
    };
    clients.push(client);
    return client;
  }
  const driver = createDynamoDBCoordinatorAuthorityLiveProofDriver({
    admin,
    createDBClient,
    createProtocol(options) {
      const protocol = family.createProtocol(options);
      return observeFailure
        ? {
            ...protocol,
            async observeReplacement() {
              throw observeFailure;
            },
          }
        : protocol;
    },
    observationWindowMs: 10,
    now: (() => {
      let value = 100;
      return () => value++;
    })(),
    uniqueSuffix: () => SUFFIX,
    wait: async () => {
      await new Promise((resolve) => setImmediate(resolve));
    },
  });
  return {
    admin,
    calls,
    clients,
    driver,
    family,
    records,
    tableExists: () => exists,
  };
}

describe('DynamoDB coordinator authority live-proof CLI', () => {
  test('requires explicit confirmation, region, and canonical absolute output', () => {
    const request = parseDynamoDBCoordinatorAuthorityLiveProofArguments([
      'node',
      'script',
      '--output',
      OUTPUT,
      DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION,
      '--region',
      REGION,
    ]);
    expect(request).toEqual({ region: REGION, outputPath: OUTPUT });
    expect(Object.isFrozen(request)).toBe(true);
  });

  test.each([
    ['missing confirmation', ['--region', REGION, '--output', OUTPUT]],
    [
      'relative output',
      [
        DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION,
        '--region',
        REGION,
        '--output',
        'proof.json',
      ],
    ],
    [
      'invalid region',
      [
        DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION,
        '--region',
        'local',
        '--output',
        OUTPUT,
      ],
    ],
    [
      'extra flag',
      [
        DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION,
        '--region',
        REGION,
        '--output',
        OUTPUT,
        '--extra',
      ],
    ],
  ])('rejects %s before loading AWS', async (_label, args) => {
    const createDriver = jest.fn();
    await expect(
      main(['node', 'script', ...args], { createDriver }),
    ).rejects.toThrow(/Usage: run-dynamodb-coordinator-authority/u);
    expect(createDriver).not.toHaveBeenCalled();
  });

  test('builds only bounded proof table names', () => {
    expect(createDynamoDBCoordinatorAuthorityProofTableName(SUFFIX)).toBe(
      `wharfie-rvn-proof-${SUFFIX}`,
    );
    expect(() =>
      createDynamoDBCoordinatorAuthorityProofTableName('BAD'),
    ).toThrow(/suffix/u);
  });
});

describe('DynamoDB coordinator authority live-proof driver', () => {
  test('proves renewal abort, stable takeover, one race winner, stale fencing, and cleanup', async () => {
    const harness = createHarness();
    const receipt = await harness.driver.run({ region: REGION });

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
      status: 'passed',
      provider: {
        kind: 'aws-dynamodb',
        region: REGION,
        tableName: `wharfie-rvn-proof-${SUFFIX}`,
        billingMode: 'PAY_PER_REQUEST',
        globalTable: false,
        replicas: 0,
      },
      evidence: {
        initialAcquisition: { applied: true, epoch: 1, recordVersion: 1 },
        renewalAbortedObservation: {
          outcome: 'changed',
          reason: 'renewed',
          beforeRecordVersion: 1,
          afterRecordVersion: 2,
        },
        stableTakeover: { applied: true, fromEpoch: 1, toEpoch: 2 },
        contenderRace: {
          contenders: 2,
          winners: 1,
          rejected: 1,
          winnerEpoch: 3,
          loserCode: 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT',
        },
        staleFencedMutation: {
          preparedBeforeTakeover: true,
          releasedAfterTakeover: true,
          rejected: true,
          errorName: 'ConditionalCheckFailedException',
          retainedMutation: false,
          staleEpoch: 2,
          currentEpoch: 3,
        },
        successorFencedMutation: {
          committed: true,
          retained: true,
          coordinatorEpoch: 3,
        },
      },
      cleanup: {
        tableDeleted: true,
        tableName: `wharfie-rvn-proof-${SUFFIX}`,
      },
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(harness.tableExists()).toBe(false);
    expect(harness.records.size).toBe(1);
    expect([...harness.records.values()]).toEqual([
      expect.objectContaining({
        kind: 'successor-authority-mutation',
        coordinator_epoch: 3,
      }),
    ]);
    expect(harness.calls.filter(([name]) => name === 'createDBClient')).toEqual(
      [
        ['createDBClient', 'coordinator-a'],
        ['createDBClient', 'coordinator-b'],
      ],
    );
    const create = harness.calls.find(([name]) => name === 'createTable')[1];
    expect(create).toMatchObject({
      BillingMode: 'PAY_PER_REQUEST',
      DeletionProtectionEnabled: false,
      KeySchema: [
        { AttributeName: 'run_id', KeyType: 'HASH' },
        { AttributeName: 'sort_key', KeyType: 'RANGE' },
      ],
    });
    expect(harness.calls.some(([name]) => name === 'deleteTable')).toBe(true);
    expect(harness.calls.slice(-1)).toEqual([['closeAdmin']]);
  });

  test.each([
    ['replica', { Replicas: [{ RegionName: 'us-west-2' }] }],
    ['global table', { GlobalTableVersion: '2019.11.21' }],
  ])(
    'rejects a %s and still deletes the proof table',
    async (_label, drift) => {
      const harness = createHarness({ tableOverrides: drift });
      await expect(harness.driver.run({ region: REGION })).rejects.toThrow(
        /single-region contract/u,
      );
      expect(harness.tableExists()).toBe(false);
      expect(harness.calls.some(([name]) => name === 'deleteTable')).toBe(true);
      expect(harness.calls.some(([name]) => name === 'createDBClient')).toBe(
        false,
      );
    },
  );

  test('never deletes a table when CreateTable ownership was not confirmed', async () => {
    const collision = new Error('table already exists');
    collision.name = 'ResourceInUseException';
    const harness = createHarness({ createFailure: collision });
    await expect(harness.driver.run({ region: REGION })).rejects.toBe(
      collision,
    );
    expect(harness.calls.some(([name]) => name === 'deleteTable')).toBe(false);
    expect(harness.calls.slice(-1)).toEqual([['closeAdmin']]);
  });

  test('joins an observation failure before its wait barrier and still cleans up', async () => {
    const failure = new Error('strong read failed before observation wait');
    const harness = createHarness({ observeFailure: failure });

    await expect(harness.driver.run({ region: REGION })).rejects.toBe(failure);

    expect(harness.tableExists()).toBe(false);
    expect(harness.calls.filter(([name]) => name === 'closeDB')).toEqual([
      ['closeDB', 'coordinator-a'],
      ['closeDB', 'coordinator-b'],
    ]);
    expect(harness.calls.some(([name]) => name === 'deleteTable')).toBe(true);
    expect(harness.calls.slice(-1)).toEqual([['closeAdmin']]);
  });

  test('closes the first client when creation of the second client fails', async () => {
    const failure = new Error('second client failed');
    const harness = createHarness({
      createClientFailure: { label: 'coordinator-b', error: failure },
    });

    await expect(harness.driver.run({ region: REGION })).rejects.toBe(failure);

    expect(harness.tableExists()).toBe(false);
    expect(harness.calls.filter(([name]) => name === 'closeDB')).toEqual([
      ['closeDB', 'coordinator-a'],
    ]);
    expect(harness.calls.some(([name]) => name === 'deleteTable')).toBe(true);
    expect(harness.calls.slice(-1)).toEqual([['closeAdmin']]);
  });
});

describe('DynamoDB coordinator authority proof publication', () => {
  let directory;

  afterEach(async () => {
    if (directory) await fsp.rm(directory, { recursive: true, force: true });
    directory = undefined;
  });

  test('writes one bounded canonical JSON file and adjacent checksum without overwrite', async () => {
    directory = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-rvn-proof-'));
    const outputPath = path.join(directory, 'proof.json');
    const receipt = {
      status: 'passed',
      kind: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
      schemaVersion: 1,
    };
    const publication = await publishDynamoDBCoordinatorAuthorityLiveProof(
      receipt,
      outputPath,
    );
    const bytes = await fsp.readFile(outputPath);
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(bytes.toString('utf8')).toBe(
      `${JSON.stringify({
        kind: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
        schemaVersion: 1,
        status: 'passed',
      })}\n`,
    );
    expect(publication.sha256).toBe(digest);
    expect(await fsp.readFile(`${outputPath}.sha256`, 'utf8')).toBe(
      `${digest}  proof.json\n`,
    );
    await expect(
      publishDynamoDBCoordinatorAuthorityLiveProof(receipt, outputPath),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  test('removes its new JSON if a pre-existing checksum blocks pair publication', async () => {
    directory = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-rvn-proof-'));
    const outputPath = path.join(directory, 'proof.json');
    await fsp.writeFile(`${outputPath}.sha256`, 'pre-existing\n');
    await expect(
      publishDynamoDBCoordinatorAuthorityLiveProof(
        { schemaVersion: 1, status: 'passed' },
        outputPath,
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    await expect(fsp.stat(outputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fsp.readFile(`${outputPath}.sha256`, 'utf8')).toBe(
      'pre-existing\n',
    );
  });

  test('removes a partial JSON when writing fails after exclusive creation', async () => {
    directory = await fsp.mkdtemp(path.join(tmpdir(), 'wharfie-rvn-proof-'));
    const outputPath = path.join(directory, 'proof.json');
    const failure = new Error('simulated receipt write failure');
    const fsOps = {
      open: async (target, flags, mode) => {
        const handle = await fsp.open(target, flags, mode);
        if (target !== outputPath) return handle;
        return {
          async writeFile(bytes) {
            await handle.writeFile(Buffer.from(bytes).subarray(0, 1));
            throw failure;
          },
          async sync() {
            await handle.sync();
          },
          async close() {
            await handle.close();
          },
        };
      },
      rm: fsp.rm,
    };

    await expect(
      publishDynamoDBCoordinatorAuthorityLiveProof(
        { schemaVersion: 1, status: 'passed' },
        outputPath,
        fsOps,
      ),
    ).rejects.toBe(failure);
    await expect(fsp.stat(outputPath)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(fsp.stat(`${outputPath}.sha256`)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  test('main publishes injected evidence without loading or calling AWS', async () => {
    const receipt = {
      schemaVersion: 1,
      kind: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
      status: 'passed',
    };
    const run = jest.fn(async () => receipt);
    const createDriver = jest.fn(async () => ({ run }));
    const publish = jest.fn(async () => ({
      outputPath: OUTPUT,
      checksumPath: `${OUTPUT}.sha256`,
      sha256: 'a'.repeat(64),
      bytes: 100,
    }));
    const write = jest.fn();

    await expect(
      main(
        [
          'node',
          'script',
          DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION,
          '--region',
          REGION,
          '--output',
          OUTPUT,
        ],
        { createDriver, publish, stdout: { write } },
      ),
    ).resolves.toMatchObject({ status: 'passed', outputPath: OUTPUT });
    expect(createDriver).toHaveBeenCalledWith(REGION);
    expect(run).toHaveBeenCalledWith({ region: REGION });
    expect(publish).toHaveBeenCalledWith(receipt, OUTPUT);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
