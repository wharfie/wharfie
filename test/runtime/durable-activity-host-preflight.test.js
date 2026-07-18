/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  ARTIFACT_RUNTIME_KIND,
  ARTIFACT_RUNTIME_SCHEMA_VERSION,
} from '../../src/core/resources/builds/lib/revision-runtime-assets.js';
import {
  DEPENDENCY_LOCK_INPUT_FORMAT,
  RUNTIME_INPUT_FORMAT,
  SOURCE_TREE_INPUT_FORMAT,
  createApplicationRevision,
} from '../../src/core/runtime/application-revision.js';
import { runLocalDurableManifestActivity } from '../../src/core/runtime/durable-activity-host.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

function digest(/** @type {string} */ value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

function makeEmbeddedExecution() {
  const target = {
    nodeVersion: '24.13.1',
    platform: /** @type {const} */ ('linux'),
    architecture: /** @type {const} */ ('x64'),
    libc: /** @type {const} */ ('glibc'),
  };
  const contract = {
    schemaVersion: 2,
    app: { id: 'durable-host-preflight' },
    cli: {
      entrypoint: { kind: 'node', path: 'cli.js', export: 'main' },
    },
    activities: {
      echo: {
        entrypoint: {
          kind: 'node',
          path: 'activities/echo.js',
          export: 'echo',
        },
      },
    },
  };
  const revision = createApplicationRevision({
    contract,
    inputs: {
      source: { format: SOURCE_TREE_INPUT_FORMAT, digest: digest('source') },
      dependencies: {
        format: DEPENDENCY_LOCK_INPUT_FORMAT,
        digest: digest('dependencies'),
      },
      runtime: { format: RUNTIME_INPUT_FORMAT, digest: digest('runtime') },
    },
  });
  return {
    kind: /** @type {const} */ ('embedded'),
    manifest: { ...contract, targets: [target] },
    embeddedRevision: {
      revision,
      runtime: {
        schemaVersion: /** @type {1} */ (ARTIFACT_RUNTIME_SCHEMA_VERSION),
        kind: /** @type {'artifactRuntime'} */ (ARTIFACT_RUNTIME_KIND),
        appId: contract.app.id,
        revisionId: revision.revisionId,
        target,
      },
    },
  };
}

describe('local durable activity host preflight', () => {
  it.each([
    ['signal', { signal: {} }, /must be an AbortSignal/i],
    [
      'actor',
      { actor: { kind: 'incomplete' } },
      /requires exactly kind and id/i,
    ],
    ['input', { input: { invalid: undefined } }, /unsupported undefined/i],
    ['caller metadata', { callerMetadata: [] }, /must be a JSON object/i],
    ['activity', { activityName: 'missing' }, /Unknown activity 'missing'/i],
  ])(
    'rejects invalid %s before opening control, application, or ownership state',
    async (_label, override, expected) => {
      const root = mkdtempSync(
        path.join(os.tmpdir(), 'wharfie-durable-host-preflight-'),
      );
      const controlPath = path.join(root, 'control');
      const applicationStatePath = path.join(root, 'application-state');
      const sessionPath = path.join(root, 'sessions');
      process.env.WHARFIE_CONTROL_ADAPTER = 'lmdb';
      process.env.WHARFIE_CONTROL_PATH = controlPath;
      process.env.WHARFIE_EXECUTION_PAYLOAD_PATH = path.join(
        controlPath,
        'payloads',
      );
      process.env.WHARFIE_LEDGER_SERVICE_SESSION_PATH = sessionPath;
      process.env.WHARFIE_APPLICATION_STATE_ADAPTER = 'lmdb';
      process.env.WHARFIE_APPLICATION_STATE_PATH = applicationStatePath;

      try {
        await expect(
          runLocalDurableManifestActivity(
            /** @type {any} */ ({
              execution: makeEmbeddedExecution(),
              activityName: 'echo',
              idempotencyKey: 'invalid-request-must-not-own',
              ...override,
            }),
          ),
        ).rejects.toThrow(expected);
        expect(existsSync(controlPath)).toBe(false);
        expect(existsSync(applicationStatePath)).toBe(false);
        expect(existsSync(sessionPath)).toBe(false);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('rejects an embedded manifest/revision mismatch before opening state', async () => {
    const root = mkdtempSync(
      path.join(os.tmpdir(), 'wharfie-durable-host-identity-'),
    );
    const controlPath = path.join(root, 'control');
    const applicationStatePath = path.join(root, 'application-state');
    process.env.WHARFIE_CONTROL_ADAPTER = 'lmdb';
    process.env.WHARFIE_CONTROL_PATH = controlPath;
    process.env.WHARFIE_APPLICATION_STATE_ADAPTER = 'lmdb';
    process.env.WHARFIE_APPLICATION_STATE_PATH = applicationStatePath;
    const execution = makeEmbeddedExecution();
    execution.manifest.app.id = 'different-app';

    try {
      await expect(
        runLocalDurableManifestActivity({
          execution,
          activityName: 'echo',
          idempotencyKey: 'mismatched-identity',
        }),
      ).rejects.toThrow(/does not match.*revision contract/i);
      expect(existsSync(controlPath)).toBe(false);
      expect(existsSync(applicationStatePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
