import path from 'node:path';
import { fileURLToPath } from 'node:url';

import packageMetadata from '../package.json' with { type: 'json' };

/**
 * @param {NodeJS.ProcessEnv} [env] - Candidate publication environment.
 * @returns {string} Authorized version tag.
 */
export function assertPreviewPublishEnvironment(env = process.env) {
  const expectedTag = `v${packageMetadata.version}`;
  const failures = [];

  if (env.WHARFIE_PREVIEW_PUBLISH !== '1') {
    failures.push('WHARFIE_PREVIEW_PUBLISH must be exactly 1');
  }
  if (env.GITHUB_ACTIONS !== 'true') {
    failures.push('GITHUB_ACTIONS must be exactly true');
  }
  if (env.GITHUB_EVENT_NAME !== 'push') {
    failures.push('GITHUB_EVENT_NAME must be exactly push');
  }
  if (env.GITHUB_REPOSITORY !== 'wharfie/wharfie') {
    failures.push('GITHUB_REPOSITORY must be exactly wharfie/wharfie');
  }
  if (env.GITHUB_REF_TYPE !== 'tag') {
    failures.push('GITHUB_REF_TYPE must be exactly tag');
  }
  if (env.GITHUB_REF_NAME !== expectedTag) {
    failures.push(`GITHUB_REF_NAME must be exactly ${expectedTag}`);
  }
  if (env.GITHUB_REF !== `refs/tags/${expectedTag}`) {
    failures.push(`GITHUB_REF must be exactly refs/tags/${expectedTag}`);
  }
  if (
    env.GITHUB_WORKFLOW_REF !==
    `wharfie/wharfie/.github/workflows/release-preview.yml@refs/tags/${expectedTag}`
  ) {
    failures.push(
      `GITHUB_WORKFLOW_REF must identify release-preview.yml at refs/tags/${expectedTag}`,
    );
  }
  if (!/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA || '')) {
    failures.push('GITHUB_SHA must be a full lowercase Git commit ID');
  }
  if (env.WHARFIE_PREVIEW_PUBLISH_ENABLED !== 'true') {
    failures.push('WHARFIE_PREVIEW_PUBLISH_ENABLED must be exactly true');
  }

  if (failures.length > 0) {
    throw new Error(
      `Wharfie preview publication is disabled:\n- ${failures.join('\n- ')}`,
    );
  }
  return expectedTag;
}

/** @returns {void} */
export function main() {
  const expectedTag = assertPreviewPublishEnvironment();
  process.stdout.write(`Preview publication authorized for ${expectedTag}.\n`);
}

const isDirect =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main();
}
