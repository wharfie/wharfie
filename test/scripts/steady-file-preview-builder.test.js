/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const verifierPath = path.join(
  repoRoot,
  'scripts',
  'verify-steady-file-systemd-linux.js',
);

async function readBuildPhase() {
  const source = await fsp.readFile(verifierPath, 'utf8');
  const start = source.indexOf('function buildHandoff(');
  const end = source.indexOf(
    '/**\n * Run ordinary behavior, package A/B',
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return { source, build: source.slice(start, end) };
}

describe('steady-file preview builder boundary', () => {
  it('publishes only staged A/B applications, records, and portable metadata', async () => {
    const { build } = await readBuildPhase();

    expect(build).toContain('packageSteadyFileArtifacts()');
    expect(build).toContain(
      "createPortableArtifactEvidence(packaged.source, 'source')",
    );
    expect(build).toContain(
      "createPortableArtifactEvidence(packaged.target, 'target')",
    );
    expect(build).toContain("'artifact-record.json'");
    expect(build).toContain('chmodSync(appPath, 0o500)');
    expect(build).toContain('chmodSync(recordPath, 0o400)');
    expect(build).toContain('writeSteadyFilePreviewHandoff(handoffRoot, {');
    expect(build).toContain("readFileSync('/etc/machine-id'");
    expect(build).toContain("written.files['handoff.json'].sha256");
  });

  it('rechecks ordinary behavior through both generated executables', async () => {
    const { build } = await readBuildPhase();

    expect(build).toContain(
      'runArtifact(packaged.source.artifactPath, [INPUT_PATH])',
    );
    expect(build).toContain(
      'runArtifact(packaged.target.artifactPath, [INPUT_PATH])',
    );
    expect(build).toContain(
      'assert.deepEqual(sourceOrdinary, packaged.ordinarySource)',
    );
    expect(build).toContain(
      'assert.deepEqual(targetOrdinary, packaged.ordinarySource)',
    );
    expect(build).toContain(
      'const expected = normalizeStableDecision(packaged.ordinarySource)',
    );
  });

  it('does not start work or mutate target service state', async () => {
    const { build } = await readBuildPhase();

    expect(build).not.toContain("'wharfie', 'start'");
    expect(build).not.toContain("'service', 'install'");
    expect(build).not.toContain('/usr/bin/systemctl');
    expect(build).not.toContain('inspectRun(');
    expect(build).not.toContain('readServiceStatus(');
    expect(build).not.toContain('rmSync(handoffRoot');
    expect(build).toContain("'builder handoff root must begin absent'");
  });

  it('exposes an explicit build CLI that requires separate output paths', async () => {
    const { source } = await readBuildPhase();

    expect(source).toContain("if (phase === 'build')");
    expect(source).toContain(
      'build <repo-root> <handoff-root> <builder-receipt>',
    );
    expect(source).toContain(
      'buildHandoff(\n    repoRoot,\n    path.resolve(process.argv[4]),\n    path.resolve(process.argv[5]),',
    );
  });
});
