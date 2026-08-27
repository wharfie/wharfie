/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createControlDBClient } from '../../../src/core/lib/config/db.js';
import {
  COORDINATOR_AUTHORITY_ID_DOMAIN,
  COORDINATOR_AUTHORITY_ID_PREFIX,
  COORDINATOR_AUTHORITY_SCHEMA_VERSION,
  CoordinatorAuthorityStatus,
  createCoordinatorAuthority,
  createCoordinatorAuthorityToken,
} from '../../../src/core/lib/db/tables/coordinator-authority.js';
import {
  COORDINATOR_AUTHORITY_INSPECTION_KIND,
  COORDINATOR_AUTHORITY_INSPECTION_SCHEMA_VERSION,
  COORDINATOR_AUTHORITY_TAKEOVER_KIND,
  COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION,
  createCoordinatorAuthorityCommand,
  createCoordinatorAuthorityInspectionDocument,
  createCoordinatorAuthorityOperatorReleaseRequestId,
  inspectCoordinatorAuthority,
  takeoverCoordinatorAuthority,
  validateCoordinatorAuthorityInspectionDocument,
} from '../../../src/core/runtime/operator/coordinator-authority-command.js';
import { createCanonicalJsonSha256Id } from '../../../src/core/runtime/content-id.js';

const APP_ID = 'coordinator-command-app';
const OTHER_APP_ID = 'other-coordinator-command-app';
const TABLE_NAME = 'execution-ledger';
const PREDECESSOR_COORDINATOR_ID = 'coordinator-session-a';
const PREDECESSOR_REQUEST_ID = 'coordinator-acquire-a';
const SUCCESSOR_COORDINATOR_ID = 'coordinator-session-b';
const TAKEOVER_REQUEST_ID = 'coordinator-takeover-b';
const FRESH_COORDINATOR_ID = 'coordinator-session-c';
const FRESH_ACQUIRE_REQUEST_ID = 'coordinator-acquire-c';

afterEach(() => {
  jest.restoreAllMocks();
});

/**
 * @param {Record<string, any>} [overrides] - Snapshot field overrides.
 * @returns {Readonly<Record<string, any>>} - Valid full authority snapshot.
 */
function authoritySnapshot(overrides = {}) {
  const appId = overrides.appId ?? APP_ID;
  const coordinatorId = overrides.coordinatorId ?? PREDECESSOR_COORDINATOR_ID;
  const epoch = overrides.epoch ?? 1;
  const acquisitionRequestId =
    overrides.acquisitionRequestId ?? PREDECESSOR_REQUEST_ID;
  const status = overrides.status ?? CoordinatorAuthorityStatus.ACTIVE;
  const acquiredAt = overrides.acquiredAt ?? 10;
  const updatedAt = overrides.updatedAt ?? acquiredAt;
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
    appId,
    coordinatorId,
    authorityId: createCanonicalJsonSha256Id({
      domain: COORDINATOR_AUTHORITY_ID_DOMAIN,
      prefix: COORDINATOR_AUTHORITY_ID_PREFIX,
      value: {
        schemaVersion: COORDINATOR_AUTHORITY_SCHEMA_VERSION,
        appId,
        coordinatorId,
        epoch,
        requestId: acquisitionRequestId,
      },
    }),
    epoch,
    status,
    recordVersion: overrides.recordVersion ?? 1,
    acquisitionRequestId,
    acquiredAt,
    heartbeatAt: overrides.heartbeatAt ?? acquiredAt,
    releasedAt:
      overrides.releasedAt ??
      (status === CoordinatorAuthorityStatus.RELEASED ? updatedAt : null),
    updatedAt,
    lastRequestId: overrides.lastRequestId ?? acquisitionRequestId,
  });
}

const PREDECESSOR = authoritySnapshot();
const RELEASE_REQUEST_ID = createCoordinatorAuthorityOperatorReleaseRequestId({
  appId: APP_ID,
  coordinatorId: SUCCESSOR_COORDINATOR_ID,
  requestId: TAKEOVER_REQUEST_ID,
});
const TAKEOVER_AUTHORITY = authoritySnapshot({
  coordinatorId: SUCCESSOR_COORDINATOR_ID,
  epoch: 2,
  acquisitionRequestId: TAKEOVER_REQUEST_ID,
  recordVersion: 2,
  acquiredAt: 20,
  heartbeatAt: 20,
  updatedAt: 20,
});
const RESULT_AUTHORITY = authoritySnapshot({
  coordinatorId: SUCCESSOR_COORDINATOR_ID,
  epoch: 2,
  acquisitionRequestId: TAKEOVER_REQUEST_ID,
  status: CoordinatorAuthorityStatus.RELEASED,
  recordVersion: 3,
  acquiredAt: 20,
  heartbeatAt: 20,
  releasedAt: 30,
  updatedAt: 30,
  lastRequestId: RELEASE_REQUEST_ID,
});
const INSPECTION = createCoordinatorAuthorityInspectionDocument(
  APP_ID,
  PREDECESSOR,
);

/**
 * @param {Record<string, any>} [overrides] - Receipt field overrides.
 * @returns {Readonly<Record<string, any>>} - Valid fence-and-release receipt.
 */
function takeoverReceipt(overrides = {}) {
  const takeoverAuthority = overrides.takeoverAuthority ?? TAKEOVER_AUTHORITY;
  const resultAuthority = overrides.resultAuthority ?? RESULT_AUTHORITY;
  return Object.freeze({
    schemaVersion: COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION,
    kind: COORDINATOR_AUTHORITY_TAKEOVER_KIND,
    action: 'takeover-and-release',
    applied: overrides.applied ?? true,
    scope: Object.freeze({ appId: APP_ID }),
    releaseRequestId: RELEASE_REQUEST_ID,
    observedAuthority: PREDECESSOR,
    takeoverAuthority,
    resultAuthority,
  });
}

/** @template T @param {T} value @returns {T} */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function outputHarness() {
  return {
    json: jest.fn(),
    table: jest.fn(),
    info: jest.fn(),
    failure: jest.fn(),
  };
}

/**
 * @param {import('commander').Command} parent - Coordinator parent.
 * @param {string} name - Leaf name.
 * @returns {import('commander').Command} - Required leaf.
 */
function command(parent, name) {
  const found = parent.commands.find((candidate) => candidate.name() === name);
  if (!found) throw new Error(`Missing coordinator ${name} command.`);
  return found;
}

/**
 * @param {import('commander').Command} parent - Coordinator parent.
 * @param {string} name - Leaf name.
 * @returns {string[]} - Exact Commander flags.
 */
function optionFlags(parent, name) {
  return command(parent, name).options.map((option) => option.flags);
}

/**
 * @param {import('commander').Command} parent - Coordinator parent.
 * @param {string} name - Leaf name.
 * @returns {string[]} - Mandatory Commander flags.
 */
function mandatoryFlags(parent, name) {
  return command(parent, name)
    .options.filter((option) => option.mandatory)
    .map((option) => option.flags);
}

/**
 * @param {Record<string, any>} [options] - Harness overrides.
 * @returns {Record<string, any>} - Command and injected seams.
 */
function createHarness(options = {}) {
  const includeAppIdOption = options.includeAppIdOption === true;
  const resolveIdentity =
    options.resolveIdentity ??
    jest.fn(async (/** @type {Record<string, any>} */ selection) => ({
      appId: includeAppIdOption ? selection.appId : APP_ID,
    }));
  const inspectAuthority =
    options.inspectAuthority ?? jest.fn(async () => INSPECTION);
  const takeoverAuthority =
    options.takeoverAuthority ?? jest.fn(async () => takeoverReceipt());
  const readJsonObjectFile =
    options.readJsonObjectFile ?? jest.fn(async () => INSPECTION);
  const output = options.output ?? outputHarness();
  const processRef = options.processRef ?? { exitCode: undefined };
  return {
    parent: createCoordinatorAuthorityCommand({
      includeAppIdOption,
      resolveIdentity,
      inspectAuthority,
      takeoverAuthority,
      readJsonObjectFile,
      output,
      processRef,
    }),
    resolveIdentity,
    inspectAuthority,
    takeoverAuthority,
    readJsonObjectFile,
    output,
    processRef,
  };
}

function takeoverArgv({ source = false, confirmation = true } = {}) {
  return [
    'takeover',
    '--inspection-file',
    'inspection.json',
    '--coordinator-id',
    SUCCESSOR_COORDINATOR_ID,
    '--request-id',
    TAKEOVER_REQUEST_ID,
    ...(confirmation ? ['--confirm-authority-replacement'] : []),
    ...(source ? ['--app-id', APP_ID] : []),
    '--json',
  ];
}

describe('coordinator authority inspection documents', () => {
  it('validates and freezes only the exact schema-v1 inspection contract', () => {
    const validated = validateCoordinatorAuthorityInspectionDocument(
      INSPECTION,
      APP_ID,
      { requireActive: true },
    );

    expect(validated).toEqual({
      schemaVersion: COORDINATOR_AUTHORITY_INSPECTION_SCHEMA_VERSION,
      kind: COORDINATOR_AUTHORITY_INSPECTION_KIND,
      authority: 'none',
      authoritative: false,
      integrity: { verified: true },
      scope: { appId: APP_ID },
      observedAuthority: PREDECESSOR,
    });
    expect(Object.keys(validated)).toEqual([
      'schemaVersion',
      'kind',
      'authority',
      'authoritative',
      'integrity',
      'scope',
      'observedAuthority',
    ]);
    expect(Object.keys(validated.observedAuthority)).toEqual([
      'schemaVersion',
      'appId',
      'coordinatorId',
      'authorityId',
      'epoch',
      'status',
      'recordVersion',
      'acquisitionRequestId',
      'acquiredAt',
      'heartbeatAt',
      'releasedAt',
      'updatedAt',
      'lastRequestId',
    ]);
    expect(Object.isFrozen(validated)).toBe(true);
    expect(Object.isFrozen(validated.integrity)).toBe(true);
    expect(Object.isFrozen(validated.scope)).toBe(true);
    expect(Object.isFrozen(validated.observedAuthority)).toBe(true);
  });

  it.each([
    [
      'a different schema version',
      () => ({ ...clone(INSPECTION), schemaVersion: 2 }),
    ],
    ['a different kind', () => ({ ...clone(INSPECTION), kind: 'other' })],
    [
      'an authoritative claim',
      () => ({ ...clone(INSPECTION), authoritative: true }),
    ],
    [
      'an extra top-level field',
      () => ({ ...clone(INSPECTION), privateState: true }),
    ],
    [
      'a missing top-level field',
      () => {
        const value = /** @type {Record<string, any>} */ (clone(INSPECTION));
        delete value.integrity;
        return value;
      },
    ],
    [
      'extra integrity state',
      () => ({ ...clone(INSPECTION), integrity: { verified: true, extra: 1 } }),
    ],
    [
      'a cross-application scope',
      () => ({ ...clone(INSPECTION), scope: { appId: OTHER_APP_ID } }),
    ],
    [
      'a bare stable token instead of the full snapshot',
      () => ({
        ...clone(INSPECTION),
        observedAuthority: createCoordinatorAuthorityToken(PREDECESSOR),
      }),
    ],
  ])('rejects %s', (_label, candidate) => {
    expect(() =>
      validateCoordinatorAuthorityInspectionDocument(candidate(), APP_ID, {
        requireActive: true,
      }),
    ).toThrow();
  });

  it('allows absent and released observations for inspection but not takeover', () => {
    const absent = createCoordinatorAuthorityInspectionDocument(APP_ID, null);
    const released = createCoordinatorAuthorityInspectionDocument(
      APP_ID,
      authoritySnapshot({
        status: CoordinatorAuthorityStatus.RELEASED,
        recordVersion: 2,
        releasedAt: 20,
        updatedAt: 20,
        lastRequestId: 'coordinator-release-a',
      }),
    );

    expect(
      validateCoordinatorAuthorityInspectionDocument(absent, APP_ID),
    ).toEqual(absent);
    expect(
      validateCoordinatorAuthorityInspectionDocument(released, APP_ID),
    ).toEqual(released);
    expect(() =>
      validateCoordinatorAuthorityInspectionDocument(absent, APP_ID, {
        requireActive: true,
      }),
    ).toThrow('exact active predecessor');
    expect(() =>
      validateCoordinatorAuthorityInspectionDocument(released, APP_ID, {
        requireActive: true,
      }),
    ).toThrow('exact active predecessor');
  });
});

describe('shared coordinator authority command', () => {
  it('creates fresh source- and packaged-shaped trees with exact options', () => {
    const sourceOne = createHarness({ includeAppIdOption: true }).parent;
    const sourceTwo = createHarness({ includeAppIdOption: true }).parent;
    const packaged = createHarness().parent;

    expect(sourceOne.name()).toBe('coordinator');
    expect(
      sourceOne.commands.map(
        (/** @type {import('commander').Command} */ leaf) => leaf.name(),
      ),
    ).toEqual(['inspect', 'takeover']);
    expect(
      packaged.commands.map((/** @type {import('commander').Command} */ leaf) =>
        leaf.name(),
      ),
    ).toEqual(['inspect', 'takeover']);
    expect(sourceTwo).not.toBe(sourceOne);
    for (let index = 0; index < sourceOne.commands.length; index += 1) {
      expect(sourceTwo.commands[index]).not.toBe(sourceOne.commands[index]);
      expect(sourceOne.commands[index].parent).toBe(sourceOne);
      expect(sourceTwo.commands[index].parent).toBe(sourceTwo);
      expect(packaged.commands[index].parent).toBe(packaged);
    }

    expect(optionFlags(sourceOne, 'inspect')).toEqual([
      '--app-id <appId>',
      '--json',
    ]);
    expect(mandatoryFlags(sourceOne, 'inspect')).toEqual(['--app-id <appId>']);
    expect(optionFlags(packaged, 'inspect')).toEqual(['--json']);
    expect(mandatoryFlags(packaged, 'inspect')).toEqual([]);
    expect(optionFlags(sourceOne, 'takeover')).toEqual([
      '--app-id <appId>',
      '--inspection-file <path>',
      '--coordinator-id <coordinatorId>',
      '--request-id <requestId>',
      '--confirm-authority-replacement',
      '--json',
    ]);
    expect(mandatoryFlags(sourceOne, 'takeover')).toEqual([
      '--app-id <appId>',
      '--inspection-file <path>',
      '--coordinator-id <coordinatorId>',
      '--request-id <requestId>',
    ]);
    expect(optionFlags(packaged, 'takeover')).toEqual([
      '--inspection-file <path>',
      '--coordinator-id <coordinatorId>',
      '--request-id <requestId>',
      '--confirm-authority-replacement',
      '--json',
    ]);
    expect(mandatoryFlags(packaged, 'takeover')).toEqual([
      '--inspection-file <path>',
      '--coordinator-id <coordinatorId>',
      '--request-id <requestId>',
    ]);
    expect(sourceOne.helpInformation()).toMatch(/fence[\s\S]*release/i);
    expect(command(sourceOne, 'takeover').helpInformation()).toMatch(
      /fence[\s\S]*release/i,
    );
  });

  it.each([
    {
      mode: 'source',
      source: true,
      argv: ['inspect', '--app-id', APP_ID, '--json'],
      selection: { appId: APP_ID },
    },
    {
      mode: 'packaged',
      source: false,
      argv: ['inspect', '--json'],
      selection: {},
    },
  ])(
    'resolves $mode inspection lazily and dispatches only the inspect seam',
    async ({ source, argv, selection }) => {
      const harness = createHarness({ includeAppIdOption: source });

      harness.parent.helpInformation();
      command(harness.parent, 'inspect').helpInformation();
      expect(harness.resolveIdentity).not.toHaveBeenCalled();
      expect(harness.inspectAuthority).not.toHaveBeenCalled();

      await harness.parent.parseAsync(argv, { from: 'user' });

      expect(harness.resolveIdentity).toHaveBeenCalledWith(selection);
      expect(harness.inspectAuthority).toHaveBeenCalledWith({ appId: APP_ID });
      expect(harness.output.json).toHaveBeenCalledWith(INSPECTION);
      expect(harness.takeoverAuthority).not.toHaveBeenCalled();
      expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
      expect(harness.output.table).not.toHaveBeenCalled();
      expect(harness.output.info).not.toHaveBeenCalled();
      expect(harness.output.failure).not.toHaveBeenCalled();
      expect(harness.processRef.exitCode).toBeUndefined();
    },
  );

  it('requires takeover confirmation before identity, file, or authority seams', async () => {
    const harness = createHarness();

    await harness.parent.parseAsync(takeoverArgv({ confirmation: false }), {
      from: 'user',
    });

    expect(harness.resolveIdentity).not.toHaveBeenCalled();
    expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
    expect(harness.inspectAuthority).not.toHaveBeenCalled();
    expect(harness.takeoverAuthority).not.toHaveBeenCalled();
    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.table).not.toHaveBeenCalled();
    expect(harness.output.info).not.toHaveBeenCalled();
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('--confirm-authority-replacement'),
      }),
    );
    expect(harness.processRef.exitCode).toBe(1);
  });

  it('admits one exact inspection and emits a fence-and-release receipt', async () => {
    const receipt = takeoverReceipt();
    const harness = createHarness({
      takeoverAuthority: jest.fn(async () => receipt),
    });

    await harness.parent.parseAsync(takeoverArgv(), { from: 'user' });

    expect(harness.resolveIdentity).toHaveBeenCalledWith({});
    expect(harness.readJsonObjectFile).toHaveBeenCalledWith(
      'inspection.json',
      'coordinator authority inspection',
    );
    expect(harness.takeoverAuthority).toHaveBeenCalledWith({
      appId: APP_ID,
      coordinatorId: SUCCESSOR_COORDINATOR_ID,
      requestId: TAKEOVER_REQUEST_ID,
      inspection: INSPECTION,
      confirmAuthorityReplacement: true,
    });
    expect(harness.output.json).toHaveBeenCalledTimes(1);
    expect(harness.output.json).toHaveBeenCalledWith(receipt);
    const emitted = harness.output.json.mock.calls[0][0];
    expect(Object.keys(emitted)).toEqual([
      'schemaVersion',
      'kind',
      'action',
      'applied',
      'scope',
      'releaseRequestId',
      'observedAuthority',
      'takeoverAuthority',
      'resultAuthority',
    ]);
    expect(emitted.action).toBe('takeover-and-release');
    expect(emitted.releaseRequestId).toBe(RELEASE_REQUEST_ID);
    expect(emitted.takeoverAuthority).toEqual(TAKEOVER_AUTHORITY);
    expect(emitted.takeoverAuthority.status).toBe(
      CoordinatorAuthorityStatus.ACTIVE,
    );
    expect(emitted.resultAuthority).toEqual(RESULT_AUTHORITY);
    expect(emitted.resultAuthority.status).toBe(
      CoordinatorAuthorityStatus.RELEASED,
    );
    expect(Object.hasOwn(emitted, 'resultAuthority')).toBe(true);
    expect(Object.hasOwn(emitted, 'currentAuthority')).toBe(false);
    expect(harness.inspectAuthority).not.toHaveBeenCalled();
    expect(harness.output.table).not.toHaveBeenCalled();
    expect(harness.output.failure).not.toHaveBeenCalled();
    expect(harness.processRef.exitCode).toBeUndefined();
  });

  it.each([
    [
      'a currentAuthority replacement for resultAuthority',
      () => {
        const { resultAuthority, ...receipt } = takeoverReceipt();
        return { ...receipt, currentAuthority: resultAuthority };
      },
    ],
    [
      'both resultAuthority and currentAuthority',
      () => ({ ...takeoverReceipt(), currentAuthority: RESULT_AUTHORITY }),
    ],
    [
      'an extra private field',
      () => ({ ...takeoverReceipt(), privateState: true }),
    ],
    [
      'a mismatched stable release request',
      () => ({ ...takeoverReceipt(), releaseRequestId: 'wrong-release-id' }),
    ],
  ])('rejects a takeover receipt containing %s', async (_label, result) => {
    const harness = createHarness({
      takeoverAuthority: jest.fn(async () => result()),
    });

    await harness.parent.parseAsync(takeoverArgv(), { from: 'user' });

    expect(harness.output.json).not.toHaveBeenCalled();
    expect(harness.output.table).not.toHaveBeenCalled();
    expect(harness.output.failure).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining(
          'Coordinator authority takeover receipt',
        ),
      }),
    );
    expect(harness.processRef.exitCode).toBe(1);
  });

  it.each([
    ['wrong schema', () => ({ ...clone(INSPECTION), schemaVersion: 2 })],
    [
      'extra state',
      () => ({ ...clone(INSPECTION), privateState: 'not-admitted' }),
    ],
    [
      'wrong application',
      () => ({ ...clone(INSPECTION), scope: { appId: OTHER_APP_ID } }),
    ],
    [
      'no predecessor',
      () => createCoordinatorAuthorityInspectionDocument(APP_ID, null),
    ],
    [
      'released predecessor',
      () =>
        createCoordinatorAuthorityInspectionDocument(
          APP_ID,
          authoritySnapshot({
            status: CoordinatorAuthorityStatus.RELEASED,
            recordVersion: 2,
            releasedAt: 20,
            updatedAt: 20,
            lastRequestId: 'coordinator-release-a',
          }),
        ),
    ],
  ])(
    'rejects an inspection with $label before takeover',
    async (_name, value) => {
      const harness = createHarness({
        readJsonObjectFile: jest.fn(async () => value()),
      });

      await harness.parent.parseAsync(takeoverArgv(), { from: 'user' });

      expect(harness.resolveIdentity).toHaveBeenCalledTimes(1);
      expect(harness.readJsonObjectFile).toHaveBeenCalledTimes(1);
      expect(harness.takeoverAuthority).not.toHaveBeenCalled();
      expect(harness.output.json).not.toHaveBeenCalled();
      expect(harness.output.table).not.toHaveBeenCalled();
      expect(harness.output.failure).toHaveBeenCalledTimes(1);
      expect(harness.processRef.exitCode).toBe(1);
    },
  );

  it.each([
    ['--inspection-file', 'other-inspection.json'],
    ['--coordinator-id', 'other-coordinator-session'],
    ['--request-id', 'other-takeover-request'],
    ['--app-id', OTHER_APP_ID],
  ])(
    'rejects repeated scalar %s before identity, file, or authority seams',
    async (optionName, secondValue) => {
      const harness = createHarness({ includeAppIdOption: true });
      const takeover = command(harness.parent, 'takeover');
      takeover.exitOverride();
      takeover.configureOutput({ writeOut: jest.fn(), writeErr: jest.fn() });

      await expect(
        harness.parent.parseAsync(
          [...takeoverArgv({ source: true }), optionName, secondValue],
          { from: 'user' },
        ),
      ).rejects.toThrow(`${optionName} may be specified only once.`);

      expect(harness.resolveIdentity).not.toHaveBeenCalled();
      expect(harness.readJsonObjectFile).not.toHaveBeenCalled();
      expect(harness.inspectAuthority).not.toHaveBeenCalled();
      expect(harness.takeoverAuthority).not.toHaveBeenCalled();
      expect(harness.output.json).not.toHaveBeenCalled();
      expect(harness.output.failure).not.toHaveBeenCalled();
      expect(harness.processRef.exitCode).toBeUndefined();
    },
  );
});

describe('coordinator authority operator over vanilla control state', () => {
  it('inspects, takes over, replays, and reports the latest durable authority', async () => {
    const controlPath = mkdtempSync(
      join(tmpdir(), 'wharfie-coordinator-command-'),
    );
    const configuration = Object.freeze({
      adapterName: 'vanilla',
      controlPath,
      tableName: TABLE_NAME,
      payloadPath: join(controlPath, 'payloads'),
      payloadStoreId: 'coordinator-command-payloads',
      sessionPath: join(controlPath, 'sessions'),
    });
    let db;
    try {
      db = await createControlDBClient('vanilla', { path: controlPath });
      const store = createCoordinatorAuthority({ db, tableName: TABLE_NAME });
      const acquired = await store.acquire({
        appId: APP_ID,
        coordinatorId: PREDECESSOR_COORDINATOR_ID,
        requestId: PREDECESSOR_REQUEST_ID,
        observedAt: 10,
      });
      await db.close();
      db = undefined;

      const inspection = await inspectCoordinatorAuthority({
        appId: APP_ID,
        configuration,
      });
      expect(inspection).toEqual(
        createCoordinatorAuthorityInspectionDocument(
          APP_ID,
          acquired.authority,
        ),
      );

      const request = {
        appId: APP_ID,
        coordinatorId: SUCCESSOR_COORDINATOR_ID,
        requestId: TAKEOVER_REQUEST_ID,
        inspection,
        confirmAuthorityReplacement: true,
        configuration,
      };
      const applied = await takeoverCoordinatorAuthority(request);
      expect(applied).toMatchObject({
        schemaVersion: COORDINATOR_AUTHORITY_TAKEOVER_SCHEMA_VERSION,
        kind: COORDINATOR_AUTHORITY_TAKEOVER_KIND,
        action: 'takeover-and-release',
        applied: true,
        scope: { appId: APP_ID },
        releaseRequestId: RELEASE_REQUEST_ID,
        observedAuthority: acquired.authority,
        takeoverAuthority: {
          appId: APP_ID,
          coordinatorId: SUCCESSOR_COORDINATOR_ID,
          epoch: 2,
          status: CoordinatorAuthorityStatus.ACTIVE,
          acquisitionRequestId: TAKEOVER_REQUEST_ID,
        },
        resultAuthority: {
          appId: APP_ID,
          coordinatorId: SUCCESSOR_COORDINATOR_ID,
          epoch: 2,
          status: CoordinatorAuthorityStatus.RELEASED,
          acquisitionRequestId: TAKEOVER_REQUEST_ID,
          lastRequestId: RELEASE_REQUEST_ID,
          releasedAt: expect.any(Number),
        },
      });
      expect(Object.hasOwn(applied, 'currentAuthority')).toBe(false);

      const released = await inspectCoordinatorAuthority({
        appId: APP_ID,
        configuration,
      });
      expect(released.observedAuthority).toEqual(applied.resultAuthority);

      db = await createControlDBClient('vanilla', { path: controlPath });
      const freshStore = createCoordinatorAuthority({
        db,
        tableName: TABLE_NAME,
      });
      const fresh = await freshStore.acquire({
        appId: APP_ID,
        coordinatorId: FRESH_COORDINATOR_ID,
        requestId: FRESH_ACQUIRE_REQUEST_ID,
      });
      expect(fresh).toMatchObject({
        applied: true,
        action: 'acquire',
        authority: {
          appId: APP_ID,
          coordinatorId: FRESH_COORDINATOR_ID,
          epoch: 3,
          status: CoordinatorAuthorityStatus.ACTIVE,
          recordVersion: 4,
        },
      });
      await db.close();
      db = undefined;

      const replayed = await takeoverCoordinatorAuthority(request);
      expect(replayed.applied).toBe(false);
      expect(replayed.takeoverAuthority).toEqual(applied.takeoverAuthority);
      expect(replayed.resultAuthority).toEqual(applied.resultAuthority);
      expect(Object.hasOwn(replayed, 'currentAuthority')).toBe(false);

      const latest = await inspectCoordinatorAuthority({
        appId: APP_ID,
        configuration,
      });
      expect(latest.observedAuthority).toEqual(fresh.authority);
      expect(latest.observedAuthority).not.toEqual(replayed.resultAuthority);
    } finally {
      await db?.close?.();
      rmSync(controlPath, { recursive: true, force: true });
    }
  });
});
