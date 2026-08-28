import { createHash, randomBytes } from 'node:crypto';
import * as fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

import { sortCanonicalJsonValue } from '../src/core/runtime/canonical-order.js';
import { createCoordinatorAuthorityFence } from '../src/core/lib/db/tables/coordinator-authority.js';
import { createDynamoDBCoordinatorAuthorityProtocol } from '../src/core/lib/db/tables/dynamodb-coordinator-authority.js';

export const DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_SCHEMA_VERSION = 1;
export const DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND =
  'wharfie.dynamodb-rvn-coordinator-authority-live-proof';
export const DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION =
  '--confirm-live-aws';

const DEFAULT_OBSERVATION_WINDOW_MS = 1_500;
const TABLE_WAIT_MILLISECONDS = 2_000;
const MAX_TABLE_WAIT_ATTEMPTS = 90;
const MAX_EVIDENCE_BYTES = 64 * 1024;
const REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z0-9-]+-[0-9]+$/u;
const UNIQUE_SUFFIX_PATTERN = /^[a-z0-9]{8,32}$/u;
const SAFE_ERROR_CODE_PATTERN = /^WHARFIE_[A-Z0-9_]+$/u;
const STALE_MUTATION_SORT_KEY = 'proof/v1/stale-authority-mutation';

/**
 * @typedef {Readonly<{
 *   region: string,
 *   outputPath: string,
 * }>} DynamoDBCoordinatorAuthorityLiveProofRequest
 */

/**
 * @param {unknown} value - Candidate object.
 * @returns {value is Record<string, any>} - Whether the value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {any} value - JSON value.
 * @returns {any} - Recursively frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Parse the deliberately explicit live-AWS invocation.
 * @param {string[]} argv - Node-style argv.
 * @returns {DynamoDBCoordinatorAuthorityLiveProofRequest} - Exact live request.
 */
export function parseDynamoDBCoordinatorAuthorityLiveProofArguments(argv) {
  const usage =
    'Usage: run-dynamodb-coordinator-authority-live-proof.js --confirm-live-aws --region <aws-region> --output <absolute-proof.json>';
  if (!Array.isArray(argv) || argv.length !== 7) {
    throw new TypeError(usage);
  }
  const args = argv.slice(2);
  if (!args.includes(DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION)) {
    throw new TypeError(usage);
  }
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_CONFIRMATION) {
      continue;
    }
    if (argument !== '--region' && argument !== '--output') {
      throw new TypeError(usage);
    }
    if (values.has(argument) || index + 1 >= args.length) {
      throw new TypeError(usage);
    }
    values.set(argument, args[index + 1]);
    index += 1;
  }
  const region = values.get('--region');
  const outputPath = values.get('--output');
  if (
    typeof region !== 'string' ||
    !REGION_PATTERN.test(region) ||
    typeof outputPath !== 'string' ||
    !path.isAbsolute(outputPath) ||
    path.resolve(outputPath) !== outputPath ||
    path.extname(outputPath) !== '.json' ||
    outputPath.includes('\n') ||
    outputPath.includes('\r')
  ) {
    throw new TypeError(usage);
  }
  return Object.freeze({ region, outputPath });
}

/**
 * @param {unknown} error - Candidate provider error.
 * @returns {boolean} - Whether DynamoDB reports an absent table.
 */
function isResourceNotFound(error) {
  return (
    error instanceof Error &&
    (error.name === 'ResourceNotFoundException' ||
      /** @type {{code?: unknown}} */ (error).code ===
        'ResourceNotFoundException')
  );
}

/**
 * @param {unknown} description - DescribeTable response.
 * @param {string} tableName - Exact proof table.
 * @param {string} region - Expected AWS region.
 * @returns {Readonly<Record<string, any>>} - Validated ACTIVE table summary.
 */
function assertDisposableTable(description, tableName, region) {
  if (!isPlainObject(description) || !isPlainObject(description.Table)) {
    throw new Error('DynamoDB proof table description is unavailable.');
  }
  const table = description.Table;
  const keySchema = Array.isArray(table.KeySchema) ? table.KeySchema : [];
  const attributes = Array.isArray(table.AttributeDefinitions)
    ? table.AttributeDefinitions
    : [];
  const exactKeys =
    keySchema.length === 2 &&
    keySchema.some(
      (entry) => entry?.AttributeName === 'run_id' && entry?.KeyType === 'HASH',
    ) &&
    keySchema.some(
      (entry) =>
        entry?.AttributeName === 'sort_key' && entry?.KeyType === 'RANGE',
    ) &&
    attributes.length === 2 &&
    attributes.some(
      (entry) =>
        entry?.AttributeName === 'run_id' && entry?.AttributeType === 'S',
    ) &&
    attributes.some(
      (entry) =>
        entry?.AttributeName === 'sort_key' && entry?.AttributeType === 'S',
    );
  const replicas = table.Replicas;
  const noReplicas =
    replicas === undefined ||
    (Array.isArray(replicas) && replicas.length === 0);
  const arnParts =
    typeof table.TableArn === 'string' ? table.TableArn.split(':') : [];
  const exactArn =
    arnParts.length === 6 &&
    arnParts[2] === 'dynamodb' &&
    arnParts[3] === region &&
    arnParts[5] === `table/${tableName}`;
  if (
    table.TableName !== tableName ||
    table.TableStatus !== 'ACTIVE' ||
    table.BillingModeSummary?.BillingMode !== 'PAY_PER_REQUEST' ||
    !exactKeys ||
    !noReplicas ||
    !exactArn ||
    table.GlobalTableVersion !== undefined
  ) {
    throw new Error(
      'DynamoDB proof table does not match the disposable single-region contract.',
    );
  }
  return Object.freeze({
    billingMode: 'PAY_PER_REQUEST',
    globalTable: false,
    replicas: 0,
  });
}

/**
 * @param {Record<string, any>} admin - Injected DynamoDB administrative client.
 * @param {string} tableName - Exact table.
 * @param {string} region - Expected AWS region.
 * @param {(milliseconds: number, signal?: AbortSignal) => Promise<void>} wait - Bounded waiter.
 * @returns {Promise<Readonly<Record<string, any>>>} - ACTIVE table summary.
 */
async function waitForTableActive(admin, tableName, region, wait) {
  for (let attempt = 0; attempt < MAX_TABLE_WAIT_ATTEMPTS; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop -- provider state is deliberately polled serially.
    const description = await admin.describeTable({ TableName: tableName });
    if (description?.Table?.TableStatus === 'ACTIVE') {
      return assertDisposableTable(description, tableName, region);
    }
    if (!['CREATING', 'UPDATING'].includes(description?.Table?.TableStatus)) {
      throw new Error('DynamoDB proof table entered an unsupported state.');
    }
    // eslint-disable-next-line no-await-in-loop -- bounded provider polling.
    await wait(TABLE_WAIT_MILLISECONDS);
  }
  throw new Error('DynamoDB proof table did not become ACTIVE in time.');
}

/**
 * @param {Record<string, any>} admin - Injected DynamoDB administrative client.
 * @param {string} tableName - Exact table.
 * @param {(milliseconds: number, signal?: AbortSignal) => Promise<void>} wait - Bounded waiter.
 * @returns {Promise<void>} - Resolves once the table is absent.
 */
async function waitForTableDeleted(admin, tableName, wait) {
  for (let attempt = 0; attempt < MAX_TABLE_WAIT_ATTEMPTS; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- provider state is deliberately polled serially.
      await admin.describeTable({ TableName: tableName });
    } catch (error) {
      if (isResourceNotFound(error)) return;
      throw error;
    }
    // eslint-disable-next-line no-await-in-loop -- bounded provider polling.
    await wait(TABLE_WAIT_MILLISECONDS);
  }
  throw new Error('DynamoDB proof table was not deleted in time.');
}

/**
 * @param {string} uniqueSuffix - Non-sensitive random proof suffix.
 * @returns {string} - Valid bounded table name.
 */
export function createDynamoDBCoordinatorAuthorityProofTableName(uniqueSuffix) {
  if (
    typeof uniqueSuffix !== 'string' ||
    !UNIQUE_SUFFIX_PATTERN.test(uniqueSuffix)
  ) {
    throw new TypeError(
      'DynamoDB coordinator proof suffix must contain 8-32 lowercase letters or digits.',
    );
  }
  return `wharfie-rvn-proof-${uniqueSuffix}`;
}

/**
 * @param {(milliseconds: number, signal?: AbortSignal) => Promise<void>} wait - Real/injected waiter.
 * @returns {{started: Promise<void>, wait: (milliseconds: number, signal?: AbortSignal) => Promise<void>}} - First-wait barrier.
 */
function createObservationWaitBarrier(wait) {
  /** @type {() => void} */
  let announce = () => {};
  let announced = false;
  /** @type {Promise<void>} */
  const started = new Promise((resolve) => {
    announce = () => resolve();
  });
  return {
    started,
    async wait(milliseconds, signal) {
      if (!announced) {
        announced = true;
        announce();
      }
      await wait(milliseconds, signal);
    },
  };
}

/**
 * @param {unknown} value - Candidate nonnegative diagnostic timestamp.
 * @returns {number} - Safe timestamp.
 */
function observedAt(value) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error('DynamoDB proof clock returned an invalid value.');
  }
  return Number(value);
}

/**
 * @param {Array<{status: 'fulfilled', value: any} | {status: 'rejected', reason: any}>} results - Two contender outcomes.
 * @returns {{winner: any, loserCode: string}} - Exact single-winner summary.
 */
function assertSingleTakeoverWinner(results) {
  const winners = results.filter((result) => result.status === 'fulfilled');
  const losers = results.filter((result) => result.status === 'rejected');
  if (winners.length !== 1 || losers.length !== 1) {
    throw new Error(
      'DynamoDB coordinator takeover race did not produce one winner.',
    );
  }
  const loser = /** @type {{status: 'rejected', reason: any}} */ (losers[0])
    .reason;
  const loserCode =
    loser instanceof Error &&
    'code' in loser &&
    typeof (/** @type {{code?: unknown}} */ (loser).code) === 'string' &&
    SAFE_ERROR_CODE_PATTERN.test(/** @type {{code: string}} */ (loser).code)
      ? /** @type {{code: string}} */ (loser).code
      : null;
  if (loserCode !== 'WHARFIE_COORDINATOR_AUTHORITY_CONFLICT') {
    throw new Error(
      'DynamoDB coordinator contender lost without a definite authority conflict.',
    );
  }
  return {
    winner: /** @type {{status: 'fulfilled', value: any}} */ (winners[0]).value,
    loserCode,
  };
}

/**
 * Hold one already-constructed mutation closure until a later takeover wins.
 * @param {() => Promise<void>} execute - Delayed provider submission.
 * @returns {Readonly<{prepared: Promise<void>, release: () => void, result: Promise<void>}>} - Held mutation controls.
 */
function createHeldMutation(execute) {
  /** @type {() => void} */
  let announcePrepared = () => {};
  /** @type {() => void} */
  let releaseMutation = () => {};
  /** @type {Promise<void>} */
  const prepared = new Promise((resolve) => {
    announcePrepared = () => resolve();
  });
  /** @type {Promise<void>} */
  const released = new Promise((resolve) => {
    releaseMutation = () => resolve();
  });
  const result = (async () => {
    announcePrepared();
    await released;
    await execute();
  })();
  return Object.freeze({ prepared, release: releaseMutation, result });
}

/**
 * Create the bounded live-proof driver from provider and timing seams.
 * @param {{
 *   admin: {createTable: (input: Record<string, any>) => Promise<any>, describeTable: (input: Record<string, any>) => Promise<any>, deleteTable: (input: Record<string, any>) => Promise<any>, close?: () => Promise<void> | void},
 *   createDBClient: (label: 'coordinator-a'|'coordinator-b') => Promise<import('../src/core/lib/db/base.js').DBClient>,
 *   createProtocol?: typeof createDynamoDBCoordinatorAuthorityProtocol,
 *   observationWindowMs?: number,
 *   now?: () => number,
 *   uniqueSuffix?: () => string,
 *   wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
 * }} dependencies - Fully injectable live-provider seams.
 * @returns {Readonly<{run: (input: {region: string}) => Promise<Readonly<Record<string, any>>>}>} - Single-use proof driver.
 */
export function createDynamoDBCoordinatorAuthorityLiveProofDriver(
  dependencies,
) {
  if (!isPlainObject(dependencies)) {
    throw new TypeError(
      'DynamoDB coordinator live-proof dependencies must be an object.',
    );
  }
  const admin = dependencies.admin;
  if (
    !admin ||
    typeof admin.createTable !== 'function' ||
    typeof admin.describeTable !== 'function' ||
    typeof admin.deleteTable !== 'function' ||
    typeof dependencies.createDBClient !== 'function'
  ) {
    throw new TypeError(
      'DynamoDB coordinator live proof requires admin and DB-client dependencies.',
    );
  }
  const createProtocol =
    dependencies.createProtocol ?? createDynamoDBCoordinatorAuthorityProtocol;
  const observationWindowMs =
    dependencies.observationWindowMs ?? DEFAULT_OBSERVATION_WINDOW_MS;
  const now = dependencies.now ?? Date.now;
  const uniqueSuffix =
    dependencies.uniqueSuffix ?? (() => randomBytes(8).toString('hex'));
  const wait =
    dependencies.wait ??
    (async (milliseconds, signal) => {
      await sleep(milliseconds, undefined, signal ? { signal } : undefined);
    });
  if (
    typeof createProtocol !== 'function' ||
    !Number.isSafeInteger(observationWindowMs) ||
    observationWindowMs < 1 ||
    typeof now !== 'function' ||
    typeof uniqueSuffix !== 'function' ||
    typeof wait !== 'function'
  ) {
    throw new TypeError(
      'DynamoDB coordinator live-proof timing dependencies are invalid.',
    );
  }

  /**
   * @param {{region: string}} input - Exact provider scope.
   * @returns {Promise<Readonly<Record<string, any>>>} - Sanitized proof evidence after cleanup.
   */
  async function run(input) {
    if (
      !isPlainObject(input) ||
      Object.keys(input).length !== 1 ||
      typeof input.region !== 'string' ||
      !REGION_PATTERN.test(input.region)
    ) {
      throw new TypeError(
        'DynamoDB coordinator live proof requires one AWS region.',
      );
    }
    const suffix = uniqueSuffix();
    const tableName = createDynamoDBCoordinatorAuthorityProofTableName(suffix);
    const appId = `dynamodb-rvn-proof-${suffix}`;
    const mutationPartition = `proof/v1/${suffix}`;
    /** @type {import('../src/core/lib/db/base.js').DBClient[]} */
    const clients = [];
    let tableOwned = false;
    let tableDeleted = false;
    /** @type {Readonly<Record<string, any>> | undefined} */
    let proof;
    /** @type {unknown} */
    let primaryError;

    try {
      const creation = await admin.createTable({
        TableName: tableName,
        AttributeDefinitions: [
          { AttributeName: 'run_id', AttributeType: 'S' },
          { AttributeName: 'sort_key', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'run_id', KeyType: 'HASH' },
          { AttributeName: 'sort_key', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
        TableClass: 'STANDARD',
        DeletionProtectionEnabled: false,
        Tags: [
          { Key: 'wharfie:managed-by', Value: 'wharfie-live-proof' },
          { Key: 'wharfie:proof-kind', Value: 'coordinator-rvn' },
        ],
      });
      if (creation?.TableDescription?.TableName !== tableName) {
        throw new Error(
          'DynamoDB did not confirm ownership of the disposable proof table.',
        );
      }
      tableOwned = true;
      const table = await waitForTableActive(
        admin,
        tableName,
        input.region,
        wait,
      );
      const [dbA, dbB] = await Promise.all([
        dependencies.createDBClient('coordinator-a'),
        dependencies.createDBClient('coordinator-b'),
      ]);
      clients.push(dbA, dbB);

      const protocol = (
        /** @type {import('../src/core/lib/db/base.js').DBClient} */ db,
        /** @type {(milliseconds: number, signal?: AbortSignal) => Promise<void>} */ waiter = wait,
      ) =>
        createProtocol({
          db,
          tableName,
          observationWindowMs,
          waitForObservation: waiter,
        });
      const coordinatorA = protocol(dbA);
      const coordinatorB = protocol(dbB);
      const initial = await coordinatorA.acquire({
        appId,
        coordinatorId: `coordinator-a-${suffix}`,
        requestId: `acquire-a-${suffix}`,
        observedAt: observedAt(now()),
      });
      if (!initial.applied || initial.authority.epoch !== 1) {
        throw new Error(
          'DynamoDB coordinator proof initial acquisition was invalid.',
        );
      }

      const renewalBarrier = createObservationWaitBarrier(wait);
      const renewalObservationPromise = protocol(
        dbB,
        renewalBarrier.wait,
      ).observeReplacement({ appId });
      await renewalBarrier.started;
      const renewal = await coordinatorA.renew({
        observedAuthority: initial.authority,
        requestId: `renew-a-${suffix}`,
        observedAt: observedAt(now()),
      });
      const renewalObservation = await renewalObservationPromise;
      if (
        renewalObservation.outcome !== 'changed' ||
        renewalObservation.reason !== 'renewed' ||
        renewalObservation.after.recordVersion !==
          renewal.authority.recordVersion
      ) {
        throw new Error(
          'DynamoDB coordinator renewal did not abort replacement observation.',
        );
      }

      const stable = await coordinatorB.observeReplacement({ appId });
      if (stable.outcome !== 'stable') {
        throw new Error(
          'DynamoDB coordinator proof did not retain a stable observation.',
        );
      }
      const replacement = await stable.takeover({
        coordinatorId: `coordinator-b-${suffix}`,
        requestId: `takeover-b-${suffix}`,
        observedAt: observedAt(now()),
      });
      if (
        !replacement.applied ||
        replacement.authority.epoch !== initial.authority.epoch + 1
      ) {
        throw new Error(
          'DynamoDB coordinator stable takeover did not advance authority.',
        );
      }

      const [contenderObservationA, contenderObservationB] = await Promise.all([
        coordinatorA.observeReplacement({ appId }),
        coordinatorB.observeReplacement({ appId }),
      ]);
      if (
        contenderObservationA.outcome !== 'stable' ||
        contenderObservationB.outcome !== 'stable'
      ) {
        throw new Error(
          'DynamoDB coordinator contenders did not retain the same stable predecessor.',
        );
      }
      const heldStaleMutation = createHeldMutation(async () => {
        await dbA.transactionWrite({
          tableName,
          conditionChecks: [
            createCoordinatorAuthorityFence(replacement.authority),
          ],
          putRequests: [
            {
              keyName: 'run_id',
              sortKeyName: 'sort_key',
              record: {
                run_id: mutationPartition,
                sort_key: STALE_MUTATION_SORT_KEY,
                kind: 'stale-authority-mutation-must-not-commit',
              },
              conditions: [
                {
                  conditionType: 'NOT_EXISTS',
                  propertyName: 'sort_key',
                },
              ],
            },
          ],
        });
      });
      await heldStaleMutation.prepared;
      const contenderResults = await Promise.allSettled([
        contenderObservationA.takeover({
          coordinatorId: `coordinator-a-next-${suffix}`,
          requestId: `takeover-a-next-${suffix}`,
          observedAt: observedAt(now()),
        }),
        contenderObservationB.takeover({
          coordinatorId: `coordinator-b-next-${suffix}`,
          requestId: `takeover-b-next-${suffix}`,
          observedAt: observedAt(now()),
        }),
      ]);
      const race = assertSingleTakeoverWinner(contenderResults);
      if (race.winner.authority.epoch !== replacement.authority.epoch + 1) {
        throw new Error(
          'DynamoDB coordinator contender winner did not advance one epoch.',
        );
      }

      let staleMutationErrorName = '';
      heldStaleMutation.release();
      try {
        await heldStaleMutation.result;
      } catch (error) {
        staleMutationErrorName =
          error instanceof Error ? error.name : 'UnknownProviderError';
      }
      const staleMutation = await dbB.get({
        tableName,
        keyName: 'run_id',
        keyValue: mutationPartition,
        sortKeyName: 'sort_key',
        sortKeyValue: STALE_MUTATION_SORT_KEY,
        consistentRead: true,
      });
      if (
        staleMutationErrorName !== 'ConditionalCheckFailedException' ||
        staleMutation !== undefined
      ) {
        throw new Error(
          'DynamoDB coordinator stale fenced mutation was not rejected.',
        );
      }
      const successorMutationSortKey = 'proof/v1/successor-authority-mutation';
      await dbB.transactionWrite({
        tableName,
        conditionChecks: [
          createCoordinatorAuthorityFence(race.winner.authority),
        ],
        putRequests: [
          {
            keyName: 'run_id',
            sortKeyName: 'sort_key',
            record: {
              run_id: mutationPartition,
              sort_key: successorMutationSortKey,
              kind: 'successor-authority-mutation',
              coordinator_epoch: race.winner.authority.epoch,
            },
            conditions: [
              {
                conditionType: 'NOT_EXISTS',
                propertyName: 'sort_key',
              },
            ],
          },
        ],
      });
      const successorMutation = await dbA.get({
        tableName,
        keyName: 'run_id',
        keyValue: mutationPartition,
        sortKeyName: 'sort_key',
        sortKeyValue: successorMutationSortKey,
        consistentRead: true,
      });
      if (
        successorMutation?.kind !== 'successor-authority-mutation' ||
        successorMutation.coordinator_epoch !== race.winner.authority.epoch
      ) {
        throw new Error(
          'DynamoDB coordinator successor fenced mutation was not retained.',
        );
      }

      proof = deepFreeze({
        schemaVersion: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_SCHEMA_VERSION,
        kind: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
        status: 'passed',
        provider: {
          kind: 'aws-dynamodb',
          region: input.region,
          tableName,
          billingMode: table.billingMode,
          globalTable: table.globalTable,
          replicas: table.replicas,
        },
        protocol: {
          kind: 'record-version-number-observation',
          observationWindowMs,
          stableFence: 'coordinator-authority-active-tuple',
        },
        evidence: {
          initialAcquisition: {
            applied: initial.applied,
            epoch: initial.authority.epoch,
            recordVersion: initial.authority.recordVersion,
          },
          renewalAbortedObservation: {
            outcome: renewalObservation.outcome,
            reason: renewalObservation.reason,
            beforeRecordVersion: renewalObservation.before.recordVersion,
            afterRecordVersion: renewalObservation.after.recordVersion,
          },
          stableTakeover: {
            applied: replacement.applied,
            fromEpoch: stable.observation.authority.epoch,
            toEpoch: replacement.authority.epoch,
            observedRecordVersion: stable.observation.recordVersion,
          },
          contenderRace: {
            contenders: 2,
            winners: 1,
            rejected: 1,
            winnerEpoch: race.winner.authority.epoch,
            loserCode: race.loserCode,
          },
          staleFencedMutation: {
            preparedBeforeTakeover: true,
            releasedAfterTakeover: true,
            rejected: true,
            errorName: staleMutationErrorName,
            retainedMutation: false,
            staleEpoch: replacement.authority.epoch,
            currentEpoch: race.winner.authority.epoch,
          },
          successorFencedMutation: {
            committed: true,
            retained: true,
            coordinatorEpoch: race.winner.authority.epoch,
          },
        },
      });
    } catch (error) {
      primaryError = error;
    }

    /** @type {unknown[]} */
    const cleanupErrors = [];
    const closed = await Promise.allSettled(
      clients.map(async (client) => await client.close()),
    );
    cleanupErrors.push(
      ...closed
        .filter((result) => result.status === 'rejected')
        .map(
          (result) =>
            /** @type {{status: 'rejected', reason: any}} */ (result).reason,
        ),
    );
    if (tableOwned) {
      try {
        let exists = true;
        try {
          await admin.describeTable({ TableName: tableName });
        } catch (error) {
          if (isResourceNotFound(error)) exists = false;
          else throw error;
        }
        if (exists) {
          await admin.deleteTable({ TableName: tableName });
          await waitForTableDeleted(admin, tableName, wait);
        }
        tableDeleted = true;
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (typeof admin.close === 'function') {
      try {
        await admin.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }

    if (primaryError !== undefined || cleanupErrors.length > 0) {
      const errors = [
        ...(primaryError === undefined ? [] : [primaryError]),
        ...cleanupErrors,
      ];
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(
            errors,
            'DynamoDB coordinator live proof or cleanup failed.',
          );
    }
    if (!proof || !tableDeleted) {
      throw new Error('DynamoDB coordinator live proof did not complete.');
    }
    return deepFreeze({
      ...proof,
      cleanup: { tableDeleted: true, tableName },
    });
  }

  return Object.freeze({ run });
}

/**
 * Load the optional AWS companion only after the explicit live confirmation.
 * @param {string} region - AWS region.
 * @returns {Promise<ReturnType<typeof createDynamoDBCoordinatorAuthorityLiveProofDriver>>} - Live driver.
 */
async function createLiveDriver(region) {
  const [{ getAwsSdkBindings }, { default: createDynamoDB }] =
    await Promise.all([
      import('@wharfie/aws'),
      import('../src/core/lib/db/adapters/dynamodb.js'),
    ]);
  const bindings = getAwsSdkBindings();
  const adminClient = new bindings.clientDynamoDB.DynamoDB({ region });
  return createDynamoDBCoordinatorAuthorityLiveProofDriver({
    admin: {
      createTable: async (input) =>
        await adminClient.createTable(/** @type {any} */ (input)),
      describeTable: async (input) =>
        await adminClient.describeTable(/** @type {any} */ (input)),
      deleteTable: async (input) =>
        await adminClient.deleteTable(/** @type {any} */ (input)),
      close: () => adminClient.destroy(),
    },
    createDBClient: async () => createDynamoDB({ region }, bindings),
  });
}

/**
 * Write one new evidence file and adjacent SHA-256 checksum without overwrite.
 * @param {unknown} receipt - Sanitized proof evidence.
 * @param {string} outputPath - Absolute JSON path.
 * @returns {Promise<Readonly<{outputPath: string, checksumPath: string, sha256: string, bytes: number}>>} - Published pair.
 */
export async function publishDynamoDBCoordinatorAuthorityLiveProof(
  receipt,
  outputPath,
) {
  if (
    typeof outputPath !== 'string' ||
    !path.isAbsolute(outputPath) ||
    path.resolve(outputPath) !== outputPath ||
    path.extname(outputPath) !== '.json'
  ) {
    throw new TypeError('DynamoDB coordinator proof output must be absolute.');
  }
  const bytes = Buffer.from(
    `${JSON.stringify(sortCanonicalJsonValue(receipt))}\n`,
    'utf8',
  );
  if (bytes.length < 2 || bytes.length > MAX_EVIDENCE_BYTES) {
    throw new Error('DynamoDB coordinator proof evidence is not bounded.');
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const checksumPath = `${outputPath}.sha256`;
  let outputWritten = false;
  let checksumCreated = false;
  try {
    const output = await fsp.open(outputPath, 'wx', 0o600);
    try {
      await output.writeFile(bytes);
      await output.sync();
    } finally {
      await output.close();
    }
    outputWritten = true;
    const checksum = await fsp.open(checksumPath, 'wx', 0o600);
    checksumCreated = true;
    try {
      await checksum.writeFile(`${sha256}  ${path.basename(outputPath)}\n`);
      await checksum.sync();
    } finally {
      await checksum.close();
    }
  } catch (error) {
    if (checksumCreated) await fsp.rm(checksumPath, { force: true });
    if (outputWritten) await fsp.rm(outputPath, { force: true });
    throw error;
  }
  return Object.freeze({
    outputPath,
    checksumPath,
    sha256,
    bytes: bytes.length,
  });
}

/**
 * Explicit live entry point.
 * @param {string[]} [argv] - Node-style argv.
 * @param {{createDriver?: (region: string) => Promise<{run: (input: {region: string}) => Promise<Record<string, any>>}>, publish?: typeof publishDynamoDBCoordinatorAuthorityLiveProof, stdout?: Pick<NodeJS.WriteStream, 'write'>}} [dependencies] - Test seams.
 * @returns {Promise<Readonly<Record<string, any>>>} - Publication summary.
 */
export async function main(argv = process.argv, dependencies = {}) {
  const request = parseDynamoDBCoordinatorAuthorityLiveProofArguments(argv);
  const createDriver = dependencies.createDriver ?? createLiveDriver;
  const publish =
    dependencies.publish ?? publishDynamoDBCoordinatorAuthorityLiveProof;
  const stdout = dependencies.stdout ?? process.stdout;
  const driver = await createDriver(request.region);
  const receipt = await driver.run({ region: request.region });
  const publication = await publish(receipt, request.outputPath);
  const summary = deepFreeze({
    kind: DYNAMODB_COORDINATOR_AUTHORITY_LIVE_PROOF_KIND,
    status: 'passed',
    outputPath: publication.outputPath,
    checksumPath: publication.checksumPath,
    sha256: publication.sha256,
  });
  stdout.write(`${JSON.stringify(sortCanonicalJsonValue(summary))}\n`);
  return summary;
}

const invokedPath =
  typeof process.argv[1] === 'string'
    ? pathToFileURL(path.resolve(process.argv[1])).href
    : null;
if (invokedPath === import.meta.url) {
  try {
    await main(process.argv);
  } catch {
    process.stderr.write(
      'Disposable DynamoDB coordinator authority live proof failed.\n',
    );
    process.exitCode = 1;
  }
}
