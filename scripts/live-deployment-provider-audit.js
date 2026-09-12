/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- The acceptance audit uses narrow injected provider read ports. */

import path from 'node:path';

import { validateProviderScope } from '../src/core/runtime/deployment-provider-scope.js';
import { createAwsSingleNodeReadAuthority } from '../src/core/runtime/providers/aws/authority.js';
import { getAwsSingleNodeDeploymentInventoryFilters } from '../src/core/runtime/providers/aws/ownership.js';
import {
  HetznerApiError,
  createHetznerStatusApiClient,
} from '../src/core/runtime/providers/hetzner/api-client.js';
import {
  createHetznerCredentialBindingStore,
  validateHetznerCredentialBindingEvidence,
} from '../src/core/runtime/providers/hetzner/credential-binding.js';
import { getHetznerDeploymentLabelSelector } from '../src/core/runtime/providers/hetzner/ownership.js';
import { validateSingleNodeDeploymentJournal } from '../src/core/runtime/single-node-deployment-journal.js';

const MAX_PAGES = 16;
const MAX_RECORDS = 4096;
const READ_TIMEOUT_MS = 30_000;
const AWS_ROLES = Object.freeze([
  {
    role: 'instance',
    method: 'describeInstances',
    collection: 'Reservations',
    id: 'InstanceId',
    filter: 'instance-id',
    pattern: /^i-[0-9a-f]{8,32}$/u,
  },
  {
    role: 'rootVolume',
    method: 'describeVolumes',
    collection: 'Volumes',
    id: 'VolumeId',
    filter: 'volume-id',
    pattern: /^vol-[0-9a-f]{8,32}$/u,
  },
  {
    role: 'securityGroup',
    method: 'describeSecurityGroups',
    collection: 'SecurityGroups',
    id: 'GroupId',
    filter: 'group-id',
    pattern: /^sg-[0-9a-f]{8,32}$/u,
  },
]);
const HETZNER_ROLES = Object.freeze([
  { role: 'server', get: 'getServer', list: 'listServers' },
  { role: 'primaryIp', get: 'getPrimaryIp', list: 'listPrimaryIps' },
  { role: 'firewall', get: 'getFirewall', list: 'listFirewalls' },
]);
const INSTANCE_STATES = new Set([
  'pending',
  'running',
  'shutting-down',
  'terminated',
  'stopping',
  'stopped',
]);

/** A fixed, secret-free audit failure. */
class AuditError extends Error {
  /** @param {string} reason */
  constructor(reason = 'provider-read-failed') {
    super(reason);
    this.reason = reason;
  }
}

/**
 * @template T
 * @param {Promise<T>} pending
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 */
async function bounded(pending, timeoutMs) {
  /** @type {NodeJS.Timeout|undefined} */
  let timer;
  try {
    return await Promise.race([
      pending,
      new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new AuditError('provider-read-timeout')),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {unknown} value @returns {Record<string, any>} */
function object(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new AuditError();
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @returns {any[]} */
function records(value) {
  if (!Array.isArray(value) || value.length > MAX_RECORDS)
    throw new AuditError();
  return value;
}

/**
 * Read exact ID filters separately from ownership filters. EC2 ID filters
 * return empty collections for missing resources, avoiding any dependence on
 * error-text classification or ownership tags still being present.
 * @param {Record<string, Function>} api
 * @param {(typeof AWS_ROLES)[number]} role
 * @param {ReadonlyArray<Readonly<{Name: string, Values: readonly string[]}>>} filters
 * @returns {Promise<Record<string, any>[]>}
 */
async function awsRecords(api, role, filters) {
  /** @type {Record<string, any>[]} */
  const result = [];
  const tokens = new Set();
  const ids = new Set();
  let nextToken;
  let outerCount = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const response = object(
      await api[role.method]({
        Filters: filters,
        MaxResults: 500,
        ...(nextToken === undefined ? {} : { NextToken: nextToken }),
      }),
    );
    const outer = records(response[role.collection]);
    outerCount += outer.length;
    if (outerCount > MAX_RECORDS) throw new AuditError();
    const items =
      role.role === 'instance'
        ? outer.flatMap((reservation) => records(object(reservation).Instances))
        : outer;
    for (const value of items) {
      const item = object(value);
      const id = item[role.id];
      if (typeof id !== 'string' || !role.pattern.test(id) || ids.has(id))
        throw new AuditError();
      if (
        role.role === 'instance' &&
        !INSTANCE_STATES.has(object(item.State).Name)
      )
        throw new AuditError();
      ids.add(id);
      result.push(item);
      if (result.length > MAX_RECORDS) throw new AuditError();
    }
    if (response.NextToken === undefined || response.NextToken === null)
      return result;
    if (
      typeof response.NextToken !== 'string' ||
      response.NextToken.length === 0 ||
      response.NextToken.length > 4096 ||
      tokens.has(response.NextToken)
    )
      throw new AuditError();
    tokens.add(response.NextToken);
    nextToken = response.NextToken;
  }
  throw new AuditError('provider-pagination-limit');
}

/** @param {Record<string, any>} journal @param {string} role @returns {string|number|null} */
function resourceId(journal, role) {
  return (
    journal.resources.find(
      (/** @type {Record<string, any>} */ entry) => entry.role === role,
    )?.providerResourceId ?? null
  );
}

/** @param {Record<string, any>} report @returns {Record<string, any>} */
function finish(report) {
  const states = [...report.resources, ...report.inventory].map(
    (entry) => entry.status,
  );
  report.status =
    report.reason !== null || states.includes('unknown')
      ? 'unknown'
      : states.includes('present')
        ? 'present'
        : 'absent';
  return report;
}

/**
 * @param {Record<string, any>} journal
 * @param {Record<string, any>} report
 * @param {Record<string, any>} ports
 * @returns {Promise<void>}
 */
async function auditAws(journal, report, ports) {
  const expected = validateProviderScope(
    journal.providerIntent.intent.plan.providerSpec.providerScope,
  );
  let expired = false;
  const opening = Promise.resolve().then(() =>
    ports.createAwsReadAuthority({ region: expected.region }),
  );
  // If initialization finishes after its deadline, release those late clients.
  opening
    .then(async (authority) => {
      if (expired) await authority.close();
    })
    .catch(() => {});
  let authority;
  try {
    authority = await bounded(opening, ports.timeoutMs);
  } catch (error) {
    expired = true;
    throw error;
  }
  let readError;
  try {
    const pinned = validateProviderScope(authority.providerScope);
    const observed = validateProviderScope(
      await bounded(
        Promise.resolve().then(() => authority.resolveScope()),
        ports.timeoutMs,
      ),
    );
    if (
      pinned.providerScopeId !== expected.providerScopeId ||
      observed.providerScopeId !== expected.providerScopeId
    )
      throw new AuditError('provider-scope-mismatch');
    const filters = getAwsSingleNodeDeploymentInventoryFilters(
      journal.deploymentInstanceId,
    );
    const checks = AWS_ROLES.flatMap((role, index) => {
      const id = resourceId(journal, role.role);
      return [
        async () => {
          const found = await awsRecords(authority.api, role, filters);
          const present = found.filter(
            (entry) =>
              role.role !== 'instance' || entry.State.Name !== 'terminated',
          );
          report.inventory[index] = {
            role: role.role,
            status: present.length === 0 ? 'absent' : 'present',
            count: present.length,
          };
        },
        async () => {
          if (id === null) {
            report.resources[index] = {
              role: role.role,
              id: null,
              status: 'unrecorded',
            };
            return;
          }
          const found = await awsRecords(authority.api, role, [
            { Name: role.filter, Values: [String(id)] },
          ]);
          if (found.some((entry) => entry[role.id] !== id) || found.length > 1)
            throw new AuditError();
          const absent =
            found.length === 0 ||
            (role.role === 'instance' && found[0].State.Name === 'terminated');
          report.resources[index] = {
            role: role.role,
            id,
            status: absent ? 'absent' : 'present',
          };
        },
      ];
    });
    const outcomes = await bounded(
      Promise.allSettled(checks.map((check) => check())),
      ports.timeoutMs,
    );
    const failed = outcomes.find((entry) => entry.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  } catch (error) {
    readError = error;
  }
  try {
    await bounded(
      Promise.resolve().then(() => authority.close()),
      ports.timeoutMs,
    );
  } catch {
    throw new AuditError('authority-close-failed');
  }
  if (readError !== undefined) throw readError;
}

/**
 * @param {Record<string, any>} journal
 * @param {string} dataRoot
 * @param {Record<string, any>} report
 * @param {Record<string, any>} ports
 * @returns {Promise<void>}
 */
async function auditHetzner(journal, dataRoot, report, ports) {
  let api;
  try {
    if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot))
      throw new AuditError();
    const token = ports.readHetznerToken();
    if (
      typeof token !== 'string' ||
      token.length === 0 ||
      token.trim() !== token
    )
      throw new AuditError();
    const evidence = validateHetznerCredentialBindingEvidence(
      await bounded(
        Promise.resolve().then(() =>
          ports.requireHetznerBinding({
            dataRoot,
            deploymentInstanceId: journal.deploymentInstanceId,
            token,
          }),
        ),
        ports.timeoutMs,
      ),
    );
    if (evidence.deploymentInstanceId !== journal.deploymentInstanceId)
      throw new AuditError();
    api = ports.createHetznerReadClient({ token });
  } catch {
    throw new AuditError('credential-binding-failed');
  }
  const labelSelector = getHetznerDeploymentLabelSelector(
    journal.deploymentInstanceId,
  );
  const checks = HETZNER_ROLES.flatMap((role, index) => {
    const id = resourceId(journal, role.role);
    return [
      async () => {
        const found = records(await api[role.list]({ labelSelector }));
        for (const entry of found) {
          const value = object(entry).id;
          if (!Number.isSafeInteger(value) || value < 1) throw new AuditError();
        }
        report.inventory[index] = {
          role: role.role,
          status: found.length === 0 ? 'absent' : 'present',
          count: found.length,
        };
      },
      async () => {
        if (id === null) {
          report.resources[index] = {
            role: role.role,
            id: null,
            status: 'unrecorded',
          };
          return;
        }
        try {
          const found = object(await api[role.get](id));
          if (found.id !== id) throw new AuditError();
          report.resources[index] = { role: role.role, id, status: 'present' };
        } catch (error) {
          if (!(error instanceof HetznerApiError) || error.status !== 404)
            throw error;
          report.resources[index] = { role: role.role, id, status: 'absent' };
        }
      },
    ];
  });
  const outcomes = await bounded(
    Promise.allSettled(checks.map((check) => check())),
    ports.timeoutMs,
  );
  const failed = outcomes.find((entry) => entry.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}

/**
 * Create an independent read-only cloud cleanup auditor. It checks both exact
 * durable IDs and deployment-wide ownership inventory, including creates that
 * never returned a resource ID. The caller owns polling and retains recovery
 * authority whenever this observation is present or unknown.
 * @param {{createAwsReadAuthority?: Function, readHetznerToken?: Function, requireHetznerBinding?: Function, createHetznerReadClient?: Function, timeoutMs?: number}} [dependencies]
 * @returns {(input: {journal: unknown, dataRoot?: string}) => Promise<Record<string, any>>}
 */
export function createLiveDeploymentCleanupAuditor(dependencies = {}) {
  const ports = {
    createAwsReadAuthority: createAwsSingleNodeReadAuthority,
    readHetznerToken: () => process.env.HCLOUD_TOKEN,
    requireHetznerBinding: async (/** @type {Record<string, any>} */ input) =>
      await createHetznerCredentialBindingStore({
        root: path.join(input.dataRoot, 'single-node-deployment-credentials'),
      }).requireBinding({
        deploymentInstanceId: input.deploymentInstanceId,
        token: input.token,
      }),
    createHetznerReadClient: createHetznerStatusApiClient,
    timeoutMs: READ_TIMEOUT_MS,
    ...dependencies,
  };
  if (
    !Number.isSafeInteger(ports.timeoutMs) ||
    ports.timeoutMs < 1 ||
    ports.timeoutMs > READ_TIMEOUT_MS
  )
    throw new TypeError(
      'Cleanup audit timeout must be between 1 and 30000 milliseconds.',
    );

  return async ({ journal: input, dataRoot }) => {
    const journal = validateSingleNodeDeploymentJournal(input);
    const provider = journal.providerIntent.provider;
    const roles = provider === 'aws' ? AWS_ROLES : HETZNER_ROLES;
    const report = {
      schemaVersion: 1,
      kind: 'wharfie.live-deployment.cleanup',
      provider,
      deploymentInstanceId: journal.deploymentInstanceId,
      status: 'unknown',
      resources: roles.map(({ role }) => ({
        role,
        id: resourceId(journal, role),
        status: 'unknown',
      })),
      inventory: roles.map(({ role }) => ({
        role,
        status: 'unknown',
        count: null,
      })),
      reason: /** @type {string|null} */ (null),
    };
    try {
      if (provider === 'aws') await auditAws(journal, report, ports);
      else
        await auditHetzner(
          journal,
          /** @type {string} */ (dataRoot),
          report,
          ports,
        );
    } catch (error) {
      report.reason =
        error instanceof AuditError ? error.reason : 'provider-read-failed';
    }
    // In-flight reads cannot revise evidence already returned to the caller.
    return structuredClone(finish(report));
  };
}

export const auditLiveDeploymentCleanup = createLiveDeploymentCleanupAuditor();
