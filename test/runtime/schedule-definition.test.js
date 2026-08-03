/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  SCHEDULE_DEFINITIONS_MAX_BYTES,
  SCHEDULE_INPUT_MAX_BYTES,
  SCHEDULE_MAX_DEFINITIONS,
  SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES,
  findDueScheduleOccurrences,
  validateScheduleDefinition,
  validateScheduleDefinitions,
  validateUtcCronExpression,
} from '../../src/core/runtime/schedule-definition.js';

const MINUTE_MS = 60 * 1000;

function schedule(overrides = {}) {
  return {
    cron: '* * * * *',
    workflow: 'refresh-cache',
    input: { region: 'us-east-1' },
    missed: 'latest',
    overlap: 'allow',
    ...overrides,
  };
}

function occurrenceOptions(overrides = {}) {
  return {
    afterExclusiveMs: 0,
    throughInclusiveMs: 2 * MINUTE_MS,
    minuteScanLimit: 10,
    ...overrides,
  };
}

describe('static schedule definition codec', () => {
  it('normalizes canonical map order and clones static workflow inputs', () => {
    const input = { region: 'us-east-1', shards: [1, 2] };
    const definitions = {
      'z-nightly': schedule({
        cron: '0 0 * * *',
        workflow: 'nightly-backup',
      }),
      'a-refresh': schedule({ input }),
    };

    const normalized = validateScheduleDefinitions(definitions);

    expect(Object.keys(normalized)).toEqual(['a-refresh', 'z-nightly']);
    expect(normalized).toEqual(definitions);
    expect(normalized).not.toBe(definitions);
    expect(normalized['a-refresh'].input).not.toBe(input);
    input.region = 'mutated';
    expect(normalized['a-refresh'].input).toEqual({
      region: 'us-east-1',
      shards: [1, 2],
    });
  });

  it.each([
    '* * * * *',
    '0 0 * * *',
    '0,15,30,45 0,12 1,15,31 1,6,12 0,6',
    '0 0 29 2 *',
  ])('accepts canonical UTC cron expression %s', (cron) => {
    expect(validateUtcCronExpression(cron)).toBe(cron);
  });

  it.each([
    ['non-string input', 1, /canonical UTC cron string/i],
    ['too few fields', '* * * *', /exactly five fields/i],
    ['too many fields', '* * * * * *', /exactly five fields/i],
    ['multiple spaces', '*  * * * *', /exactly five fields/i],
    ['tabs', '*\t* * * *', /exactly five fields/i],
    ['leading zero', '01 * * * *', /canonical decimal integers/i],
    ['range', '0-5 * * * *', /canonical decimal integers/i],
    ['step', '*/5 * * * *', /canonical decimal integers/i],
    ['alias', 'midnight * * * *', /canonical decimal integers/i],
    ['minute above range', '60 * * * *', /between 0 and 59/i],
    ['hour above range', '0 24 * * *', /between 0 and 23/i],
    ['zero day of month', '0 0 0 * *', /between 1 and 31/i],
    ['zero month', '0 0 * 0 *', /between 1 and 12/i],
    ['Sunday alias 7', '0 0 * * 7', /between 0 and 6/i],
    ['duplicate value', '0,0 * * * *', /without duplicates/i],
    ['descending values', '15,0 * * * *', /strictly ascending/i],
    [
      'full day-of-week domain',
      '0 0 * * 0,1,2,3,4,5,6',
      /use '\*' instead of listing its complete domain/i,
    ],
    [
      'unreachable February day',
      '0 0 29,30 2 *',
      /day-of-month value 30 can never occur/i,
    ],
    [
      'unreachable thirty-first',
      '0 0 31 4,6,9,11 *',
      /day-of-month value 31 can never occur/i,
    ],
  ])('rejects %s', (_name, cron, expected) => {
    expect(() => validateUtcCronExpression(cron)).toThrow(expected);
  });

  it('requires the wildcard spelling for every complete numeric domain', () => {
    const everyMinute = Array.from({ length: 60 }, (_, index) => index).join(
      ',',
    );
    expect(() => validateUtcCronExpression(`${everyMinute} * * * *`)).toThrow(
      /minute must use '\*'/i,
    );
  });

  it.each([
    [
      'missing definition fields',
      {
        cron: '* * * * *',
        workflow: 'refresh-cache',
        input: {},
        missed: 'latest',
      },
      /must contain exactly cron, workflow, input, missed, overlap/i,
    ],
    [
      'unknown definition fields',
      { ...schedule(), timezone: 'UTC' },
      /must contain exactly cron, workflow, input, missed, overlap/i,
    ],
    [
      'non-logical workflow ID',
      schedule({ workflow: 'Refresh_Cache' }),
      /workflow must be a canonical logical ID/i,
    ],
    [
      'unsupported missed policy',
      schedule({ missed: 'all' }),
      /missed must be 'latest'/i,
    ],
    [
      'unsupported overlap policy',
      schedule({ overlap: 'skip' }),
      /overlap must be 'allow'/i,
    ],
    [
      'non-JSON input',
      schedule({ input: undefined }),
      /unsupported undefined value/i,
    ],
  ])('rejects %s', (_name, definition, expected) => {
    expect(() => validateScheduleDefinition(definition)).toThrow(expected);
  });

  it('enforces independent static-input and whole-map byte bounds', () => {
    expect(() =>
      validateScheduleDefinition(
        schedule({ input: 'x'.repeat(SCHEDULE_INPUT_MAX_BYTES) }),
      ),
    ).toThrow(`must not exceed ${SCHEDULE_INPUT_MAX_BYTES} bytes`);

    const largeDefinitions = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [
        `schedule-${index}`,
        schedule({ input: 'x'.repeat(220 * 1024) }),
      ]),
    );
    expect(() => validateScheduleDefinitions(largeDefinitions)).toThrow(
      `must not exceed ${SCHEDULE_DEFINITIONS_MAX_BYTES} bytes`,
    );
  });

  it('rejects empty or non-logical schedule map keys', () => {
    expect(() => validateScheduleDefinitions({})).toThrow(
      /must not be empty when provided/i,
    );
    expect(() =>
      validateScheduleDefinitions({
        Not_Canonical: schedule(),
      }),
    ).toThrow(/canonical logical ID/i);
  });

  it('bounds the number of independently reconciled schedules', () => {
    expect(() =>
      validateScheduleDefinitions(
        Object.fromEntries(
          Array.from({ length: SCHEDULE_MAX_DEFINITIONS + 1 }, (_, index) => [
            `schedule-${index}`,
            schedule(),
          ]),
        ),
      ),
    ).toThrow(`at most ${SCHEDULE_MAX_DEFINITIONS} schedules`);
  });
});

describe('bounded UTC schedule occurrence evaluation', () => {
  it('uses an exclusive lower boundary and inclusive upper boundary', () => {
    expect(
      findDueScheduleOccurrences(
        schedule(),
        occurrenceOptions({
          afterExclusiveMs: MINUTE_MS,
          throughInclusiveMs: 3 * MINUTE_MS,
        }),
      ),
    ).toEqual({
      occurrences: [3 * MINUTE_MS],
      skipped: {
        count: 1,
        firstScheduledAtMs: 2 * MINUTE_MS,
        lastScheduledAtMs: 2 * MINUTE_MS,
      },
      scannedMinuteCount: 2,
    });

    expect(
      findDueScheduleOccurrences(
        schedule(),
        occurrenceOptions({
          afterExclusiveMs: 1,
          throughInclusiveMs: MINUTE_MS - 1,
        }),
      ),
    ).toEqual({
      occurrences: [],
      skipped: null,
      scannedMinuteCount: 0,
    });
  });

  it('returns only the newest due minute and the exact skipped due range', () => {
    const result = findDueScheduleOccurrences(
      schedule(),
      occurrenceOptions({
        afterExclusiveMs: 30 * 1000,
        throughInclusiveMs: 3 * MINUTE_MS + 999,
      }),
    );

    expect(result).toEqual({
      occurrences: [3 * MINUTE_MS],
      skipped: {
        count: 2,
        firstScheduledAtMs: MINUTE_MS,
        lastScheduledAtMs: 2 * MINUTE_MS,
      },
      scannedMinuteCount: 3,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.occurrences)).toBe(true);
    expect(Object.isFrozen(result.skipped)).toBe(true);
  });

  it('matches only UTC calendar fields and treats restricted DOM/DOW as OR', () => {
    const mondayInFebruary = Date.UTC(2024, 1, 5, 12, 30);
    expect(
      findDueScheduleOccurrences(
        schedule({ cron: '30 12 29 2 1' }),
        occurrenceOptions({
          afterExclusiveMs: mondayInFebruary - 1,
          throughInclusiveMs: mondayInFebruary,
          minuteScanLimit: 1,
        }),
      ),
    ).toEqual({
      occurrences: [mondayInFebruary],
      skipped: null,
      scannedMinuteCount: 1,
    });

    const leapDay = Date.UTC(2024, 1, 29, 0, 0);
    expect(
      findDueScheduleOccurrences(
        schedule({ cron: '0 0 29 2 *' }),
        occurrenceOptions({
          afterExclusiveMs: leapDay - 1,
          throughInclusiveMs: leapDay,
          minuteScanLimit: 1,
        }),
      ).occurrences,
    ).toEqual([leapDay]);
  });

  it('reports a complete bounded scan even when no minute is due', () => {
    const julyMinute = Date.UTC(2024, 6, 1, 0, 0);
    expect(
      findDueScheduleOccurrences(
        schedule({ cron: '0 0 1 1 *' }),
        occurrenceOptions({
          afterExclusiveMs: julyMinute - 1,
          throughInclusiveMs: julyMinute + 2 * MINUTE_MS,
          minuteScanLimit: 3,
        }),
      ),
    ).toEqual({
      occurrences: [],
      skipped: null,
      scannedMinuteCount: 3,
    });
  });

  it('rejects an over-limit window before scanning it', () => {
    expect(() =>
      findDueScheduleOccurrences(
        schedule(),
        occurrenceOptions({
          throughInclusiveMs: 3 * MINUTE_MS,
          minuteScanLimit: 2,
        }),
      ),
    ).toThrow(/contains 3 UTC minute boundaries, exceeding minuteScanLimit 2/i);
  });

  it.each([
    [
      'a non-integer lower boundary',
      occurrenceOptions({ afterExclusiveMs: 0.5 }),
      /afterExclusiveMs must be a nonnegative safe integer/i,
    ],
    [
      'a string upper boundary',
      occurrenceOptions({ throughInclusiveMs: '60000' }),
      /throughInclusiveMs must be a nonnegative safe integer/i,
    ],
    [
      'reversed boundaries',
      occurrenceOptions({
        afterExclusiveMs: MINUTE_MS,
        throughInclusiveMs: 0,
      }),
      /must be greater than or equal to afterExclusiveMs/i,
    ],
    [
      'a zero caller limit',
      occurrenceOptions({ minuteScanLimit: 0 }),
      /minuteScanLimit must be a positive safe integer/i,
    ],
    [
      'a caller limit above the hard cap',
      occurrenceOptions({
        minuteScanLimit: SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES + 1,
      }),
      new RegExp(
        `no greater than ${SCHEDULE_OCCURRENCE_MAX_SCAN_MINUTES}`,
        'i',
      ),
    ],
    [
      'unknown options',
      { ...occurrenceOptions(), timezone: 'UTC' },
      /must contain exactly afterExclusiveMs, throughInclusiveMs, minuteScanLimit/i,
    ],
  ])('rejects %s', (_name, options, expected) => {
    expect(() => findDueScheduleOccurrences(schedule(), options)).toThrow(
      expected,
    );
  });
});
