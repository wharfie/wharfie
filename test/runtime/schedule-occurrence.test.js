/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';

import {
  SCHEDULE_DEFINITION_ID_PREFIX,
  SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION,
  createScheduleDefinitionId,
  createScheduleOccurrenceId,
  createScheduleRunCause,
  normalizeScheduleRunCause,
} from '../../src/core/lib/ledger/schedule-occurrence.js';
import { createCanonicalJsonSha256Id } from '../../src/core/runtime/content-id.js';

const APP_ID = 'scheduled-app';
const SCHEDULE_ID = 'nightly';
const SCHEDULED_AT = Date.UTC(2026, 6, 28, 2, 0, 0, 0);
const DEFINITION_ID = createCanonicalJsonSha256Id({
  domain: 'wharfie:schedule-definition:v1',
  prefix: SCHEDULE_DEFINITION_ID_PREFIX,
  value: { fixture: true },
});
const REVISION_ID = `wrv1_${createHash('sha256')
  .update('schedule-occurrence-revision')
  .digest('base64url')}`;
const PLAN_ID = `wfp_${createHash('sha256')
  .update('schedule-occurrence-plan')
  .digest('base64url')}`;
const DEFINITION = Object.freeze({
  cron: '0 2 * * *',
  workflow: 'refresh-cache',
  input: { region: 'us-east-1' },
  missed: 'latest',
  overlap: 'allow',
});

describe('schedule occurrence identity', () => {
  it('binds a schedule definition to its exact revision and workflow plan', () => {
    const definitionId = createScheduleDefinitionId({
      appId: APP_ID,
      revisionId: REVISION_ID,
      scheduleId: SCHEDULE_ID,
      planId: PLAN_ID,
      definition: DEFINITION,
    });

    expect(
      createScheduleDefinitionId({
        definition: {
          overlap: 'allow',
          missed: 'latest',
          input: { region: 'us-east-1' },
          workflow: 'refresh-cache',
          cron: '0 2 * * *',
        },
        planId: PLAN_ID,
        scheduleId: SCHEDULE_ID,
        revisionId: REVISION_ID,
        appId: APP_ID,
      }),
    ).toBe(definitionId);
    expect(
      createScheduleDefinitionId({
        appId: APP_ID,
        revisionId: REVISION_ID,
        scheduleId: SCHEDULE_ID,
        planId: PLAN_ID,
        definition: { ...DEFINITION, cron: '0 3 * * *' },
      }),
    ).not.toBe(definitionId);
  });

  it('is stable across object order and changes for logical scope fields', () => {
    const occurrenceId = createScheduleOccurrenceId({
      appId: APP_ID,
      scheduleId: SCHEDULE_ID,
      scheduledAt: SCHEDULED_AT,
    });

    expect(
      createScheduleOccurrenceId({
        scheduledAt: SCHEDULED_AT,
        scheduleId: SCHEDULE_ID,
        appId: APP_ID,
      }),
    ).toBe(occurrenceId);
    expect(
      createScheduleOccurrenceId({
        appId: APP_ID,
        scheduleId: 'hourly',
        scheduledAt: SCHEDULED_AT,
      }),
    ).not.toBe(occurrenceId);
    expect(
      createScheduleOccurrenceId({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
        scheduledAt: SCHEDULED_AT + 60_000,
      }),
    ).not.toBe(occurrenceId);
  });

  it('creates and validates an application-bound authoritative cause', () => {
    const cause = createScheduleRunCause({
      appId: APP_ID,
      scheduleId: SCHEDULE_ID,
      definitionId: DEFINITION_ID,
      scheduledAt: SCHEDULED_AT,
    });

    expect(cause).toEqual({
      schemaVersion: SCHEDULE_OCCURRENCE_CAUSE_SCHEMA_VERSION,
      kind: 'schedule',
      scheduleId: SCHEDULE_ID,
      definitionId: DEFINITION_ID,
      occurrenceId: createScheduleOccurrenceId({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
        scheduledAt: SCHEDULED_AT,
      }),
      scheduledAt: SCHEDULED_AT,
    });
    expect(Object.isFrozen(cause)).toBe(true);
    expect(normalizeScheduleRunCause(cause, { appId: APP_ID })).toEqual(cause);
  });

  it('rejects sub-minute timestamps, moved occurrence IDs, and shape drift', () => {
    expect(() =>
      createScheduleOccurrenceId({
        appId: APP_ID,
        scheduleId: SCHEDULE_ID,
        scheduledAt: SCHEDULED_AT + 1,
      }),
    ).toThrow(/exact minute boundary/i);

    const cause = createScheduleRunCause({
      appId: APP_ID,
      scheduleId: SCHEDULE_ID,
      definitionId: DEFINITION_ID,
      scheduledAt: SCHEDULED_AT,
    });
    expect(() =>
      normalizeScheduleRunCause(cause, { appId: 'another-app' }),
    ).toThrow(/does not bind/i);
    expect(() =>
      normalizeScheduleRunCause({ ...cause, retry: 1 }, { appId: APP_ID }),
    ).toThrow(/must contain exactly/i);
  });
});
