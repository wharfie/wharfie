/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';

import {
  createApplicationRevision,
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
} from '../../src/core/runtime/application-revision.js';
import { resolveManifestScheduleBindings } from '../../src/core/runtime/manifest-schedule-binding.js';
import { createScheduleDefinitionId } from '../../src/core/lib/ledger/schedule-occurrence.js';
import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';

/** @typedef {import('../../src/core/runtime/durable-activity-host.js').ManifestActivityExecution} ManifestActivityExecution */
/** @typedef {Extract<ManifestActivityExecution, {kind: 'embedded'}>} EmbeddedExecution */

const TARGET = Object.freeze({
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
});

/** @param {string} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

/** @returns {Record<string, any>} */
function makeManifest() {
  return {
    schemaVersion: 3,
    app: { id: 'bound-schedule-app' },
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
      nightly: {
        cron: '0 0 * * *',
        workflow: 'refresh',
        input: { cadence: 'nightly' },
        missed: 'latest',
        overlap: 'allow',
      },
      hourly: {
        cron: '0 * * * *',
        workflow: 'refresh',
        input: { cadence: 'hourly' },
        missed: 'latest',
        overlap: 'allow',
      },
    },
  };
}

/**
 * @param {Record<string, any>} manifest
 * @param {string} [discriminator]
 */
function createRevision(manifest, discriminator = 'one') {
  return createApplicationRevision({
    contract: manifest,
    inputs: {
      source: {
        format: SOURCE_TREE_INPUT_FORMAT,
        digest: digest(`source-${discriminator}`),
      },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: {
        format: RUNTIME_INPUT_FORMAT,
        digest: digest('runtime'),
      },
    },
  });
}

/**
 * @param {Record<string, any>} manifest
 * @param {string} [discriminator]
 */
function createExecution(manifest, discriminator = 'one') {
  const revision = createRevision(manifest, discriminator);
  const execution = /** @type {EmbeddedExecution} */ ({
    kind: 'embedded',
    manifest: { ...manifest, targets: [{ ...TARGET }] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: ARTIFACT_RUNTIME_SCHEMA_VERSION,
        kind: ARTIFACT_RUNTIME_KIND,
        appId: manifest.app.id,
        revisionId: revision.revisionId,
        target: { ...TARGET },
      },
    },
  });
  return {
    revision,
    execution,
  };
}

describe('manifest schedule bindings', () => {
  it('returns no bindings for an application that has not declared schedules', () => {
    const manifest = makeManifest();
    delete manifest.workflows;
    delete manifest.schedules;
    const { execution } = createExecution(manifest, 'cli-only');

    expect(resolveManifestScheduleBindings(execution)).toEqual([]);
  });

  it('deeply freezes canonical bindings to the exact revision and workflow plan', () => {
    const manifest = makeManifest();
    const { revision, execution } = createExecution(manifest);
    const bindings = resolveManifestScheduleBindings(execution);

    expect(bindings.map((binding) => binding.scheduleId)).toEqual([
      'hourly',
      'nightly',
    ]);
    const hourly = bindings[0];
    expect(hourly).toMatchObject({
      appId: manifest.app.id,
      revisionId: revision.revisionId,
      scheduleId: 'hourly',
      workflowId: 'refresh',
      scheduleDefinition: {
        cron: '0 * * * *',
        workflow: 'refresh',
        input: { cadence: 'hourly' },
        missed: 'latest',
        overlap: 'allow',
      },
      workflowPlanPayload: {
        schemaVersion: 1,
        kind: 'workflowPlan',
        appId: manifest.app.id,
        revisionId: revision.revisionId,
        workflowId: 'refresh',
        definition: manifest.workflows.refresh,
      },
    });
    expect(hourly.definitionId).toBe(
      createScheduleDefinitionId({
        appId: hourly.appId,
        revisionId: hourly.revisionId,
        scheduleId: hourly.scheduleId,
        planId: hourly.planId,
        definition: hourly.scheduleDefinition,
      }),
    );
    expect(Object.isFrozen(bindings)).toBe(true);
    expect(Object.isFrozen(hourly)).toBe(true);
    expect(Object.isFrozen(hourly.scheduleDefinition)).toBe(true);
    expect(Object.isFrozen(hourly.scheduleDefinition.input)).toBe(true);
    expect(Object.isFrozen(hourly.workflowPlanPayload)).toBe(true);
    expect(Object.isFrozen(hourly.workflowPlanPayload.definition.steps)).toBe(
      true,
    );
  });

  it('changes both plan and schedule provenance when the sealed workflow revision changes', () => {
    const firstManifest = makeManifest();
    const { execution: firstExecution } = createExecution(
      firstManifest,
      'first',
    );
    const first = resolveManifestScheduleBindings(firstExecution)[0];

    const secondManifest = makeManifest();
    secondManifest.workflows.refresh.steps.push({
      id: 'approved',
      kind: 'signal',
    });
    const { execution: secondExecution } = createExecution(
      secondManifest,
      'second',
    );
    const second = resolveManifestScheduleBindings(secondExecution)[0];

    expect(second.revisionId).not.toBe(first.revisionId);
    expect(second.planId).not.toBe(first.planId);
    expect(second.definitionId).not.toBe(first.definitionId);
  });

  it('makes a schedule-only change part of immutable revision identity', () => {
    const firstManifest = makeManifest();
    const { revision: firstRevision, execution: firstExecution } =
      createExecution(firstManifest, 'same-source');
    const first = resolveManifestScheduleBindings(firstExecution)[0];

    const secondManifest = makeManifest();
    secondManifest.schedules.hourly.cron = '15 * * * *';
    const { revision: secondRevision, execution: secondExecution } =
      createExecution(secondManifest, 'same-source');
    const second = resolveManifestScheduleBindings(secondExecution)[0];

    expect(secondRevision.revisionId).not.toBe(firstRevision.revisionId);
    expect(second.definitionId).not.toBe(first.definitionId);
  });

  it('rejects a schemaVersion 2 manifest before exposing bindings', () => {
    const manifest = makeManifest();
    const { execution } = createExecution(manifest, 'v3-authority');
    execution.manifest.schemaVersion = 2;
    delete execution.manifest.schedules;

    expect(() => resolveManifestScheduleBindings(execution)).toThrow(
      /schemaVersion must be the integer 3/i,
    );
  });

  it('rejects a valid manifest that no longer matches its retained revision contract', () => {
    const manifest = makeManifest();
    const { execution } = createExecution(manifest, 'sealed');
    execution.manifest.schedules.hourly.cron = '15 * * * *';

    expect(() => resolveManifestScheduleBindings(execution)).toThrow(
      /manifest does not match.*revision contract/i,
    );
  });
});
