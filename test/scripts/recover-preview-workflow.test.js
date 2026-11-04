/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL(
    '../../.github/workflows/recover-preview-release.yml',
    import.meta.url,
  ),
  'utf8',
);
const original = readFileSync(
  new URL('../../.github/workflows/release-preview.yml', import.meta.url),
  'utf8',
);
const header = workflow.split('\njobs:\n')[0];
const expectedJobs = [
  'download',
  'registry-consumer',
  'draft-recipient',
  'finalize',
  'public-recipient',
];
const jobBoundaries = [
  ...workflow.matchAll(/^ {2}([a-z][a-z-]*):\n/gmu),
].filter((match) => match.index > workflow.indexOf('\njobs:\n'));
const jobs = new Map(
  jobBoundaries.map((match, index) => [
    match[1],
    workflow.slice(match.index, jobBoundaries[index + 1]?.index),
  ]),
);

/** @param {string} name */
function job(name) {
  const value = jobs.get(name);
  if (!value) throw new Error(`Missing recovery job ${name}.`);
  return value;
}

/** @param {string} text */
function steps(text) {
  const boundaries = [...text.matchAll(/^ {6}- (?:name:|uses:|run:)/gmu)];
  return boundaries.map((match, index) =>
    text.slice(match.index, boundaries[index + 1]?.index),
  );
}

/** @param {string} text @param {string} needle */
function oneStep(text, needle) {
  const matches = steps(text).filter((step) => step.includes(needle));
  expect(matches).toHaveLength(1);
  return matches[0];
}

/** @param {string} text */
function permissionBlock(text) {
  return text.match(/^ {4}permissions:\n((?: {6}[^\n]+\n)+)/mu)?.[1];
}

describe('preview recovery workflow contract', () => {
  it('accepts an explicit dispatch and shares the original publication lock', () => {
    expect([...jobs.keys()]).toEqual(expectedJobs);
    expect(header).toMatch(/^on:\n {2}workflow_dispatch:\n/mu);
    expect(header).not.toMatch(
      /^ {2}(?:push|pull_request|workflow_run|workflow_call):/mu,
    );
    expect(header).toMatch(
      / {6}tag:\n[^]*? {8}required: true\n {8}type: string/u,
    );
    expect(header).toMatch(
      / {6}source_commit:\n[^]*? {8}required: true\n {8}type: string/u,
    );
    expect(header).toContain('RECOVERY_TAG: ${{ inputs.tag }}');
    expect(header).toContain('RECOVERY_COMMIT: ${{ inputs.source_commit }}');
    const concurrency =
      'concurrency:\n  group: wharfie-preview-release\n  cancel-in-progress: false';
    expect(header).toContain(concurrency);
    expect(original).toContain(concurrency);
    expect(header).toContain('permissions:\n  contents: read');
    expect(workflow).not.toMatch(/\bid-token\s*:/u);
  });

  it.each(['download', 'finalize'])(
    'guards %s on canonical master and the exact enable switch',
    (name) => {
      const guard = job(name).split('    runs-on:')[0];
      expect(guard).toContain("github.repository == 'wharfie/wharfie'");
      expect(guard).toContain("github.ref == 'refs/heads/master'");
      expect(guard).toContain("vars.WHARFIE_PREVIEW_PUBLISH_ENABLED == 'true'");
      expect(guard).not.toMatch(/always\(|\|\|/u);
    },
  );

  it.each(expectedJobs)(
    'pins %s checkout to the reviewed dispatch SHA without persisted credentials',
    (name) => {
      const checkout = oneStep(job(name), 'uses: actions/checkout@');
      expect(checkout).toMatch(/uses: actions\/checkout@[a-f0-9]{40}\b/u);
      expect(checkout).toContain('ref: ${{ github.sha }}');
      expect(checkout).toContain('persist-credentials: false');
      expect(checkout).not.toContain('inputs.');
      expect(job(name)).toMatch(/ {4}timeout-minutes: [1-9]\d*\n/u);
      for (const action of job(name).matchAll(/uses: ([^\s#]+)/gu)) {
        expect(action[1]).toMatch(/^actions\/[a-z-]+@[a-f0-9]{40}$/u);
      }
    },
  );

  it('gives draft visibility only to a downloader that verifies bytes without running them', () => {
    const download = job('download');
    expect(permissionBlock(download)).toBe('      contents: write\n');
    expect(download).not.toMatch(/npm (?:ci|install|exec|run)|npx\b/u);
    expect(download).not.toMatch(
      /verify-preview-recipient\.js|verifyPreviewRecipientStandalone|buildPreviewRecipientApplication|child_process|\b(?:exec|spawn|eval)\s*\(/u,
    );
    const source = oneStep(download, 'downloadPreviewRecipientRelease({');
    expect(source).toContain('GH_TOKEN: ${{ github.token }}');
    expect(source).toContain(
      "import { downloadPreviewRecipientRelease } from './scripts/preview-recipient-download.js';",
    );
    expect(source).toContain('tag: process.env.RECOVERY_TAG');
    expect(source).toContain('expectedCommit: process.env.RECOVERY_COMMIT');
    expect(source).toContain('draft: true');
    expect(source).toContain('token: process.env.GH_TOKEN');
    expect(source).toContain(
      "directory: path.join(process.env.RUNNER_TEMP, 'wharfie-recovery-assets')",
    );
    expect(source).not.toContain('${{ inputs.');
    expect(
      steps(download).filter((step) => /^ {8}run:/mu.test(step)),
    ).toHaveLength(2);
  });

  it('propagates the producing run and attempt identity to every artifact consumer', () => {
    const download = job('download');
    expect(download).toContain(
      'assets_name: ${{ steps.identity.outputs.assets_name }}',
    );
    const identity = oneStep(download, 'id: identity');
    expect(identity).toContain(
      'assets_name=wharfie-recovery-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}-assets',
    );
    expect(identity).toContain('>> "$GITHUB_OUTPUT"');
    const upload = oneStep(
      download,
      'path: ${{ runner.temp }}/wharfie-recovery-assets/*',
    );
    expect(upload).toContain('name: ${{ steps.identity.outputs.assets_name }}');
    expect(upload).toContain('if-no-files-found: error');
    for (const name of ['registry-consumer', 'draft-recipient', 'finalize']) {
      const artifact = oneStep(job(name), 'uses: actions/download-artifact@');
      expect(artifact).toContain(
        'name: ${{ needs.download.outputs.assets_name }}',
      );
      expect(artifact).not.toContain('github.run_attempt');
      expect(artifact).not.toMatch(
        /\b(?:pattern|merge-multiple|run-id|github-token):/u,
      );
      expect(job(name).split('    steps:')[0]).toMatch(
        /needs: (?:download|\[download,)/u,
      );
    }
  });

  it('retains bounded download failures while keeping failed downloads fatal', () => {
    const download = job('download');
    const source = oneStep(download, 'downloadPreviewRecipientRelease({');
    expect(source).toContain('catch (error)');
    expect(source).toContain(
      "kind: 'wharfie.preview.recipient-download-failure'",
    );
    expect(source).toContain('diagnostic: error.diagnostic ?? null');
    expect(source).toContain("{ mode: 0o600, flag: 'wx' }");
    expect(source).toContain('throw error;');
    expect(source).not.toMatch(
      /JSON\.stringify\(error\)|error\.(?:message|stack|stdout|stderr)/u,
    );
    const evidence = oneStep(
      download,
      'path: ${{ runner.temp }}/wharfie-recovery-download.json',
    );
    expect(evidence).toContain('if: ${{ always() }}');
    expect(evidence).toContain(
      'name: ${{ steps.identity.outputs.assets_name }}-download-proof',
    );
    expect(download).not.toContain('continue-on-error');
  });

  it('runs both actual npm registry consumers against the verified candidate manifest', () => {
    const registry = job('registry-consumer');
    expect(registry).toContain("node-version: ['24.13.1', '24.x']");
    expect(registry).toContain('fail-fast: false');
    expect(registry).toContain('node-version: ${{ matrix.node-version }}');
    expect(permissionBlock(registry)).toBeUndefined();
    expect(registry).not.toMatch(/GH_TOKEN:|GITHUB_TOKEN:|NODE_AUTH_TOKEN:/u);
    const proof = oneStep(
      registry,
      'node ./scripts/verify-preview-consumer.js',
    );
    expect(proof).toContain('--registry-manifest');
    expect(proof).toContain(
      '"$GITHUB_WORKSPACE/dist/preview-release/preview-release.json"',
    );
    expect(proof).not.toContain('continue-on-error');
  });

  it('executes the full recipient proof with read permission and always removes its owned account', () => {
    const recipient = job('draft-recipient');
    expect(permissionBlock(recipient)).toBe('      contents: read\n');
    expect(recipient).not.toMatch(
      /GH_TOKEN:|GITHUB_TOKEN:|NODE_AUTH_TOKEN:|\$\{\{ github\.token \}\}/u,
    );
    const proof = oneStep(
      recipient,
      'node ./scripts/verify-preview-recipient.js',
    );
    expect(proof).toContain(
      'WHARFIE_PREVIEW_RECIPIENT_DISPOSABLE: github-actions',
    );
    expect(proof).toContain(
      '--artifact-dir "$RUNNER_TEMP/wharfie-recovery-assets"',
    );
    expect(proof).toContain('--expected-commit "$RECOVERY_COMMIT"');
    expect(proof).not.toMatch(/--(?:download-only|draft|tag)\b/u);
    expect(recipient).toContain(
      'chmod 0700 "$RUNNER_TEMP/wharfie-recovery-assets"',
    );
    const cleanup = oneStep(
      recipient,
      '--cleanup "$RUNNER_TEMP/wharfie-recipient-account-cleanup.json"',
    );
    expect(cleanup).toContain('if: ${{ always() }}');
    expect(cleanup).toContain(
      'bash scripts/prepare-preview-recipient-github-linux.sh',
    );
    expect(recipient.indexOf(cleanup)).toBeGreaterThan(
      recipient.indexOf(proof),
    );
    const receipt = oneStep(recipient, 'uses: actions/upload-artifact@');
    expect(receipt).toContain('if: ${{ always() }}');
    expect(receipt).toContain(
      '${{ runner.temp }}/wharfie-draft-recipient.json',
    );
    expect(receipt).toContain(
      '${{ runner.temp }}/wharfie-recipient-account-cleanup.json',
    );
    expect(recipient).not.toContain('continue-on-error');
  });

  it('requires every gate and protected promotion approval before the narrow finalizer', () => {
    const finalize = job('finalize');
    expect(finalize).toContain(
      'needs: [download, registry-consumer, draft-recipient]',
    );
    expect(finalize).toContain('environment: npm-preview-promotion');
    expect(permissionBlock(finalize)).toBe('      contents: write\n');
    const guard = oneStep(finalize, 'assertPreviewRecoveryEnvironment();');
    expect(guard).toContain("WHARFIE_PREVIEW_PUBLISH: '1'");
    expect(guard).toContain(
      'WHARFIE_PREVIEW_PUBLISH_ENABLED: ${{ vars.WHARFIE_PREVIEW_PUBLISH_ENABLED }}',
    );
    expect(finalize.indexOf(guard)).toBeLessThan(
      finalize.indexOf('npm install --global'),
    );
    const finalizer = oneStep(
      finalize,
      'node ./scripts/recover-preview-release.js',
    );
    expect(finalizer).toContain(
      '--artifact-dir "$GITHUB_WORKSPACE/dist/preview-release"',
    );
    expect(finalizer).toContain('--tag "$RECOVERY_TAG"');
    expect(finalizer).toContain('--expected-commit "$RECOVERY_COMMIT"');
    expect(finalizer).toContain('GH_TOKEN: ${{ github.token }}');
    expect(finalizer).toContain("WHARFIE_PREVIEW_PUBLISH: '1'");
    expect(finalize).not.toMatch(
      /npm (?:publish|dist-tag)|gh release (?:create|upload)|--defer-finalize|publish-preview-release\.js/u,
    );
    expect(finalize).not.toContain('continue-on-error');
    expect(finalize).not.toMatch(
      /GITHUB_(?:SHA|WORKFLOW_SHA|WORKFLOW_REF|EVENT_NAME|REF):/u,
    );
  });

  it('checks the finalized public download anonymously and retains the bounded receipt', () => {
    const publicRecipient = job('public-recipient');
    expect(publicRecipient).toContain('needs: finalize');
    expect(permissionBlock(publicRecipient)).toBe('      contents: read\n');
    expect(publicRecipient).not.toMatch(
      /GH_TOKEN:|GITHUB_TOKEN:|NODE_AUTH_TOKEN:/u,
    );
    const proof = oneStep(
      publicRecipient,
      'node ./scripts/verify-preview-recipient.js',
    );
    expect(proof).toContain('env -u GH_TOKEN -u GITHUB_TOKEN');
    expect(proof).toContain('--tag "$RECOVERY_TAG" --download-only');
    expect(proof).toContain('--expected-commit "$RECOVERY_COMMIT"');
    expect(proof).not.toMatch(/--draft\b|--artifact-dir/u);
    const receipt = oneStep(publicRecipient, 'uses: actions/upload-artifact@');
    expect(receipt).toContain('if: ${{ always() }}');
    expect(receipt).toContain(
      'path: ${{ runner.temp }}/wharfie-public-recipient.json',
    );
    expect(publicRecipient).not.toContain('continue-on-error');
  });
});
