/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  APP_MANIFEST_SCHEMA_VERSION,
  validateAppManifest,
} from '../../src/core/runtime/app-manifest.js';
import { SCHEDULE_MAX_DEFINITIONS } from '../../src/core/runtime/schedule-definition.js';

/** @returns {Record<string, any>} */
function makeManifest(schemaVersion = APP_MANIFEST_SCHEMA_VERSION) {
  return {
    schemaVersion,
    app: { id: 'scheduled-app' },
    cli: {
      entrypoint: { kind: 'node', path: 'src/cli.js', export: 'main' },
    },
    activities: {
      refresh: {
        entrypoint: {
          kind: 'node',
          path: 'src/refresh.js',
          export: 'refresh',
        },
      },
    },
    workflows: {
      refresh: {
        steps: [
          {
            id: 'refresh',
            kind: 'activity',
            activity: 'refresh',
            input: { kind: 'workflow-input' },
          },
        ],
      },
    },
    schedules: {
      'z-nightly': {
        cron: '0 0 * * *',
        workflow: 'refresh',
        input: { source: 'nightly' },
        missed: 'latest',
        overlap: 'allow',
      },
      'a-hourly': {
        cron: '0 * * * *',
        workflow: 'refresh',
        input: { source: 'hourly' },
        missed: 'latest',
        overlap: 'allow',
      },
    },
  };
}

describe('strict manifest V3 schedules', () => {
  it('accepts only canonical workflow schedules and orders independent definitions', () => {
    const authored = makeManifest();
    const manifest = validateAppManifest(authored);

    expect(manifest.schemaVersion).toBe(APP_MANIFEST_SCHEMA_VERSION);
    expect(Object.keys(manifest.schedules)).toEqual(['a-hourly', 'z-nightly']);
    expect(manifest.schedules['a-hourly']).toEqual({
      cron: '0 * * * *',
      workflow: 'refresh',
      input: { source: 'hourly' },
      missed: 'latest',
      overlap: 'allow',
    });

    authored.schedules['a-hourly'].input.source = 'mutated';
    expect(manifest.schedules['a-hourly'].input).toEqual({
      source: 'hourly',
    });
  });

  it('rejects schemaVersion 2 entirely', () => {
    const manifest = makeManifest(2);

    expect(() => validateAppManifest(manifest)).toThrow(
      /manifest\.schemaVersion must be the integer 3/i,
    );
  });

  it('keeps workflows and schedules optional for progressively durable apps', () => {
    const missing = makeManifest();
    delete missing.workflows;
    delete missing.schedules;

    expect(validateAppManifest(missing)).toEqual({
      schemaVersion: 3,
      app: { id: 'scheduled-app' },
      cli: {
        entrypoint: { kind: 'node', path: 'src/cli.js', export: 'main' },
      },
      activities: missing.activities,
    });
  });

  it('requires workflow and schedule maps to be nonempty when declared', () => {
    const emptyWorkflows = makeManifest();
    emptyWorkflows.workflows = {};
    delete emptyWorkflows.schedules;
    expect(() => validateAppManifest(emptyWorkflows)).toThrow(
      /manifest\.workflows must not be empty/i,
    );

    const empty = makeManifest();
    empty.schedules = {};
    expect(() => validateAppManifest(empty)).toThrow(
      /manifest\.schedules must not be empty/i,
    );
  });

  it('requires every schedule to target a workflow in the same manifest', () => {
    const manifest = makeManifest();
    manifest.schedules['a-hourly'].workflow = 'missing';

    expect(() => validateAppManifest(manifest)).toThrow(
      /schedules\.a-hourly\.workflow must reference a workflow declared by this manifest/i,
    );
  });

  it('rejects non-workflow targets and noncanonical schedule policy', () => {
    const directActivity = makeManifest();
    directActivity.schedules['a-hourly'] = {
      cron: '0 * * * *',
      activity: 'refresh',
      input: {},
      missed: 'latest',
      overlap: 'allow',
    };
    expect(() => validateAppManifest(directActivity)).toThrow(
      /schedules\.a-hourly must contain exactly cron, workflow, input, missed, overlap/i,
    );

    const noncanonicalCron = makeManifest();
    noncanonicalCron.schedules['a-hourly'].cron = '*/5 * * * *';
    expect(() => validateAppManifest(noncanonicalCron)).toThrow(
      /must be '\*' or a strictly ascending comma-separated set/i,
    );

    const unsupportedPolicy = makeManifest();
    unsupportedPolicy.schedules['a-hourly'].missed = 'all';
    expect(() => validateAppManifest(unsupportedPolicy)).toThrow(
      /missed must be 'latest'/i,
    );
  });

  it('enforces the shared bounded schedule-definition ceiling', () => {
    const manifest = makeManifest();
    manifest.schedules = Object.fromEntries(
      Array.from({ length: SCHEDULE_MAX_DEFINITIONS + 1 }, (_, index) => [
        `schedule-${index}`,
        {
          cron: '* * * * *',
          workflow: 'refresh',
          input: {},
          missed: 'latest',
          overlap: 'allow',
        },
      ]),
    );

    expect(() => validateAppManifest(manifest)).toThrow(
      `at most ${SCHEDULE_MAX_DEFINITIONS} schedules`,
    );
  });
});
