/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import {
  APP_MANIFEST_SCHEMA_VERSION,
  validateAppManifest,
} from '../../src/core/runtime/app-manifest.js';
import { SCHEDULE_MAX_DEFINITIONS } from '../../src/core/runtime/schedule-definition.js';

/** @typedef {[string, (manifest: Record<string, any>) => void, RegExp]} InvalidDurableCliCase */

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

describe('strict manifest V4 workflows, schedules, and durable CLI handoff', () => {
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

  it('rejects schemaVersion 3 entirely', () => {
    const manifest = makeManifest(3);

    expect(() => validateAppManifest(manifest)).toThrow(
      /manifest\.schemaVersion must be the integer 4/i,
    );
  });

  it('keeps workflows and schedules optional for progressively durable apps', () => {
    const missing = makeManifest();
    delete missing.workflows;
    delete missing.schedules;

    expect(validateAppManifest(missing)).toEqual({
      schemaVersion: 4,
      app: { id: 'scheduled-app' },
      cli: {
        entrypoint: { kind: 'node', path: 'src/cli.js', export: 'main' },
      },
      activities: missing.activities,
    });
  });

  it('accepts an exact durable CLI handoff to a declared workflow', () => {
    const authored = makeManifest();
    authored.cli.durable = {
      workflow: 'refresh',
      export: 'toDurableInput',
    };

    const manifest = validateAppManifest(authored);

    expect(manifest.cli.durable).toEqual({
      workflow: 'refresh',
      export: 'toDurableInput',
    });
    authored.cli.durable.export = 'mutated';
    expect(manifest.cli.durable.export).toBe('toDurableInput');
  });

  /** @type {InvalidDurableCliCase[]} */
  const invalidDurableCliCases = [
    [
      'a non-object handoff',
      (manifest) => {
        manifest.cli.durable = 'refresh';
      },
      /manifest\.cli\.durable must be a plain object/i,
    ],
    [
      'an extra handoff field',
      (manifest) => {
        manifest.cli.durable = {
          workflow: 'refresh',
          export: 'toDurableInput',
          input: {},
        };
      },
      /manifest\.cli\.durable\.input is not supported by schemaVersion 4/i,
    ],
    [
      'a non-canonical workflow ID',
      (manifest) => {
        manifest.cli.durable = {
          workflow: ' refresh ',
          export: 'toDurableInput',
        };
      },
      /manifest\.cli\.durable\.workflow must be a canonical logical ID/i,
    ],
    [
      'a non-canonical export',
      (manifest) => {
        manifest.cli.durable = {
          workflow: 'refresh',
          export: '',
        };
      },
      /manifest\.cli\.durable\.export must be a nonempty canonical string/i,
    ],
    [
      'a workflow absent from this manifest',
      (manifest) => {
        manifest.cli.durable = {
          workflow: 'missing',
          export: 'toDurableInput',
        };
      },
      /manifest\.cli\.durable\.workflow must reference a workflow declared by this manifest/i,
    ],
    [
      'a workflow when no workflows are declared',
      (manifest) => {
        manifest.cli.durable = {
          workflow: 'refresh',
          export: 'toDurableInput',
        };
        delete manifest.workflows;
        delete manifest.schedules;
      },
      /manifest\.cli\.durable\.workflow must reference a workflow declared by this manifest/i,
    ],
  ];

  it.each(invalidDurableCliCases)('rejects %s', (_name, mutate, pattern) => {
    const manifest = makeManifest();
    mutate(manifest);

    expect(() => validateAppManifest(manifest)).toThrow(pattern);
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
