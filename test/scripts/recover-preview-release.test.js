// @ts-nocheck -- Partial candidates deliberately exercise authorization failures.
/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { jest } from '@jest/globals';

import {
  assertPreviewRecoveryEnvironment,
  parsePreviewRecoveryArgs,
  recoverPreviewRelease,
} from '../../scripts/recover-preview-release.js';

const SOURCE_COMMIT = 'a'.repeat(40);
const WORKFLOW_COMMIT = 'b'.repeat(40);
const OPTIONS = Object.freeze({
  artifactDir: '/tmp/exact-existing-preview',
  tag: 'v0.0.15',
  expectedCommit: SOURCE_COMMIT,
});
const ARGS = [
  '--artifact-dir',
  OPTIONS.artifactDir,
  '--tag',
  OPTIONS.tag,
  '--expected-commit',
  SOURCE_COMMIT,
];
const ENV = Object.freeze({
  WHARFIE_PREVIEW_PUBLISH: '1',
  WHARFIE_PREVIEW_PUBLISH_ENABLED: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REPOSITORY: 'wharfie/wharfie',
  GITHUB_REF: 'refs/heads/master',
  GITHUB_REF_TYPE: 'branch',
  GITHUB_REF_NAME: 'master',
  GITHUB_SHA: WORKFLOW_COMMIT,
  GITHUB_WORKFLOW_SHA: WORKFLOW_COMMIT,
  GITHUB_WORKFLOW_REF:
    'wharfie/wharfie/.github/workflows/recover-preview-release.yml@refs/heads/master',
});

function candidate(overrides = {}) {
  return {
    manifest: {
      tag: OPTIONS.tag,
      source: { commit: SOURCE_COMMIT },
      ...overrides,
    },
  };
}

describe('preview recovery inputs', () => {
  it('accepts only explicit immutable candidate inputs', () => {
    expect(parsePreviewRecoveryArgs(ARGS)).toEqual(OPTIONS);
    expect(Object.isFrozen(parsePreviewRecoveryArgs(ARGS))).toBe(true);
  });

  it.each([
    [],
    ARGS.slice(0, -1),
    [...ARGS, '--tag', OPTIONS.tag],
    [...ARGS, '--defer-finalize'],
    [...ARGS, '--finalize-only'],
    [...ARGS, '--unknown', 'value'],
    ['--artifact-dir', 'relative', ...ARGS.slice(2)],
    ['--artifact-dir', '/tmp/bad\0path', ...ARGS.slice(2)],
    ['--artifact-dir', '--tag', ...ARGS.slice(2)],
  ])('rejects missing, repeated, unsafe, or extra inputs: %j', (...args) => {
    expect(() => parsePreviewRecoveryArgs(args)).toThrow();
  });

  it.each([
    'v00.0.15',
    '0.0.15',
    'v0.0.15-rc.1',
    'v0.0.15+build',
    'v9007199254740992.0.0',
    'v0.0.15/other',
    'v0.0.15\n',
  ])('rejects noncanonical release tag %s', (tag) => {
    expect(() =>
      parsePreviewRecoveryArgs([...ARGS.slice(0, 3), tag, ...ARGS.slice(4)]),
    ).toThrow(/exact vX.Y.Z/u);
  });

  it.each(['a'.repeat(39), 'A'.repeat(40), 'main', `${SOURCE_COMMIT}\n`])(
    'rejects noncanonical source commit %s',
    (sha) => {
      expect(() =>
        parsePreviewRecoveryArgs([...ARGS.slice(0, -1), sha]),
      ).toThrow(/full lowercase Git commit/u);
    },
  );
});

describe('preview recovery authority', () => {
  it('accepts the real master dispatch while keeping the older source distinct', () => {
    expect(SOURCE_COMMIT).not.toBe(WORKFLOW_COMMIT);
    expect(() => assertPreviewRecoveryEnvironment(ENV)).not.toThrow();
  });

  it.each(Object.keys(ENV))('rejects a missing %s', (key) => {
    const env = { ...ENV };
    delete env[key];
    expect(() => assertPreviewRecoveryEnvironment(env)).toThrow(key);
  });

  it.each([
    ['WHARFIE_PREVIEW_PUBLISH', 'true'],
    ['WHARFIE_PREVIEW_PUBLISH_ENABLED', '1'],
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_EVENT_NAME', 'push'],
    ['GITHUB_EVENT_NAME', 'pull_request_target'],
    ['GITHUB_REPOSITORY', 'fork/wharfie'],
    ['GITHUB_REF', 'refs/tags/v0.0.15'],
    ['GITHUB_REF_TYPE', 'tag'],
    ['GITHUB_REF_NAME', 'other-branch'],
    ['GITHUB_SHA', 'not-a-sha'],
    ['GITHUB_SHA', `${WORKFLOW_COMMIT}\n`],
    ['GITHUB_WORKFLOW_SHA', SOURCE_COMMIT],
    ['GITHUB_WORKFLOW_SHA', 'B'.repeat(40)],
    [
      'GITHUB_WORKFLOW_REF',
      'wharfie/wharfie/.github/workflows/release-preview.yml@refs/heads/master',
    ],
    [
      'GITHUB_WORKFLOW_REF',
      'wharfie/wharfie/.github/workflows/recover-preview-release.yml@refs/tags/v0.0.15',
    ],
  ])('rejects incorrect %s=%s', (key, value) => {
    expect(() =>
      assertPreviewRecoveryEnvironment({ ...ENV, [key]: value }),
    ).toThrow(key);
  });

  it('refuses unauthorized entry before invoking the existing publisher', async () => {
    const publish = jest.fn();
    await expect(
      recoverPreviewRelease(OPTIONS, { env: {}, publish }),
    ).rejects.toThrow(/recovery is disabled/u);
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects programmatic options attempting to add publication authority', async () => {
    const publish = jest.fn();
    await expect(
      recoverPreviewRelease(
        { ...OPTIONS, deferFinalize: true },
        { env: ENV, publish },
      ),
    ).rejects.toThrow(/requires only/u);
    expect(publish).not.toHaveBeenCalled();
  });

  it('delegates only finalization with explicit source binding and no forged environment', async () => {
    const publish = jest.fn(async (options, dependencies) => {
      expect(options).toEqual({
        artifactDir: OPTIONS.artifactDir,
        finalizeOnly: true,
      });
      expect(Object.keys(dependencies).sort()).toEqual([
        'authorize',
        'expectedCommit',
      ]);
      expect(dependencies.expectedCommit).toBe(SOURCE_COMMIT);
      await dependencies.authorize(candidate());
      return { tag: OPTIONS.tag, published: true, finalized: true };
    });
    await expect(
      recoverPreviewRelease(OPTIONS, { env: ENV, publish }),
    ).resolves.toMatchObject({ tag: OPTIONS.tag, finalized: true });
    expect(publish).toHaveBeenCalledTimes(1);
    expect(ENV.GITHUB_SHA).toBe(WORKFLOW_COMMIT);
  });

  it.each([{ tag: 'v0.0.16' }, { source: { commit: WORKFLOW_COMMIT } }])(
    'rejects a loaded candidate outside the exact requested identity: %j',
    async (overrides) => {
      const publish = jest.fn(async (_options, dependencies) => {
        await dependencies.authorize(candidate(overrides));
        throw new Error('Must not reach a publication action');
      });
      await expect(
        recoverPreviewRelease(OPTIONS, { env: ENV, publish }),
      ).rejects.toThrow(/exact requested tag and source commit/u);
    },
  );

  it('rechecks workflow authority when the publisher authorizes the loaded candidate', async () => {
    const env = { ...ENV };
    const publish = jest.fn(async (_options, dependencies) => {
      env.GITHUB_WORKFLOW_SHA = SOURCE_COMMIT;
      await dependencies.authorize(candidate());
      throw new Error('Must not reach a publication action');
    });
    await expect(
      recoverPreviewRelease(OPTIONS, { env, publish }),
    ).rejects.toThrow(/GITHUB_WORKFLOW_SHA/u);
  });

  it('keeps the original requested identity while the candidate loads', async () => {
    const options = { ...OPTIONS };
    const publish = jest.fn(async (_options, dependencies) => {
      options.tag = 'v0.0.16';
      options.expectedCommit = WORKFLOW_COMMIT;
      await dependencies.authorize(
        candidate({ tag: options.tag, source: { commit: WORKFLOW_COMMIT } }),
      );
      throw new Error('Must not reach a publication action');
    });
    await expect(
      recoverPreviewRelease(options, { env: ENV, publish }),
    ).rejects.toThrow(/exact requested tag and source commit/u);
  });

  it('propagates existing integrity and finalization failures without fallback', async () => {
    const failure = new Error(
      'Existing preview dist-tag or provenance mismatch',
    );
    const publish = jest.fn(async () => {
      throw failure;
    });
    await expect(
      recoverPreviewRelease(OPTIONS, { env: ENV, publish }),
    ).rejects.toBe(failure);
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
