/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const GUARD_PATH = path.join(
  process.cwd(),
  'scripts',
  'assert-preview-publish.js',
);
const GUARDED_KEYS = [
  'WHARFIE_PREVIEW_PUBLISH',
  'WHARFIE_PREVIEW_PUBLISH_ENABLED',
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'GITHUB_REPOSITORY',
  'GITHUB_REF',
  'GITHUB_REF_TYPE',
  'GITHUB_REF_NAME',
  'GITHUB_SHA',
  'GITHUB_WORKFLOW_REF',
];

const AUTHORIZED_ENVIRONMENT = Object.freeze({
  WHARFIE_PREVIEW_PUBLISH: '1',
  WHARFIE_PREVIEW_PUBLISH_ENABLED: 'true',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: 'push',
  GITHUB_REPOSITORY: 'wharfie/wharfie',
  GITHUB_REF: 'refs/tags/v0.0.15',
  GITHUB_REF_TYPE: 'tag',
  GITHUB_REF_NAME: 'v0.0.15',
  GITHUB_SHA: 'a'.repeat(40),
  GITHUB_WORKFLOW_REF:
    'wharfie/wharfie/.github/workflows/release-preview.yml@refs/tags/v0.0.15',
});

function runGuard(overrides = {}) {
  const env = { ...process.env };
  for (const key of GUARDED_KEYS) delete env[key];
  Object.assign(env, overrides);
  return spawnSync(process.execPath, [GUARD_PATH], {
    env,
    encoding: 'utf8',
  });
}

describe('preview publication guard', () => {
  it('fails closed outside the exact release context', () => {
    const result = runGuard();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Wharfie preview publication is disabled');
    expect(result.stderr).toContain('WHARFIE_PREVIEW_PUBLISH');
    expect(result.stderr).toContain('GITHUB_REF_NAME');
  });

  it('admits only the exact repository tag with the explicit feature flag', () => {
    const result = runGuard(AUTHORIZED_ENVIRONMENT);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Preview publication authorized for v0.0.15',
    );
  });

  it.each([
    ['GITHUB_EVENT_NAME', 'pull_request'],
    ['GITHUB_REF', 'refs/heads/master'],
    ['GITHUB_SHA', 'not-a-commit'],
    [
      'GITHUB_WORKFLOW_REF',
      'wharfie/wharfie/.github/workflows/ci.yml@refs/tags/v0.0.15',
    ],
  ])('rejects an unauthorized %s', (key, value) => {
    const result = runGuard({ ...AUTHORIZED_ENVIRONMENT, [key]: value });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(key);
  });
});
