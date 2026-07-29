/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const scriptPath = path.join(
  repoRoot,
  'scripts',
  'run-steady-file-preview-lima.sh',
);

async function readDriver() {
  return await fsp.readFile(scriptPath, 'utf8');
}

describe('split steady-file preview Lima driver', () => {
  it('preflights the host, disk budget, clean commit, and archive before VM creation', async () => {
    const script = await readDriver();
    const preflight = script.indexOf('AVAILABLE_KIB=');
    const builderCreate = script.indexOf(
      'lima create --tty=false --name "${BUILDER_INSTANCE}"',
    );

    expect(script).toContain('[[ "$(uname -s)" != "Darwin" ]]');
    expect(script).toContain('command -v limactl');
    expect(script).toContain('MINIMUM_FREE_KIB=$((15 * 1024 * 1024))');
    expect(script).toContain('/bin/df -Pk "${TEMP_ROOT}"');
    expect(script).toContain('status --porcelain --untracked-files=all');
    expect(script).toContain(
      'COMMIT="$(git -C "${REPO_ROOT}" rev-parse HEAD)"',
    );
    expect(script).toContain('git -C "${REPO_ROOT}" archive');
    expect(script).toContain('--output="${ARCHIVE_PATH}"');
    expect(preflight).toBeGreaterThan(-1);
    expect(builderCreate).toBeGreaterThan(preflight);
    expect(script.indexOf('LIMA_TOUCHED=1')).toBeGreaterThan(preflight);
    expect(script).toContain(
      '[[ "${CLEANUP_COMPLETE}" -ne 1 && "${LIMA_TOUCHED}" -eq 1 ]]',
    );
  });

  it('isolates all Lima state and assigns distinct configs to builder and target', async () => {
    const script = await readDriver();

    expect(script).toContain(
      'TEMP_ROOT="$(mktemp -d "${TEMP_PARENT%/}/wharfie-steady-file-preview.XXXXXX")"',
    );
    expect(script).toContain('HOST_HOME="${TEMP_ROOT}/home"');
    expect(script).toContain('LIMA_HOME="${TEMP_ROOT}/lima"');
    expect(script).toMatch(
      /lima\(\) \{\n[ ]{2}\/usr\/bin\/env \\\n[ ]{4}"HOME=\$\{HOST_HOME\}" \\\n[ ]{4}"LIMA_HOME=\$\{LIMA_HOME\}"/,
    );
    expect(script).toContain('BUILDER_INSTANCE="${INSTANCE_BASE}-builder"');
    expect(script).toContain('TARGET_INSTANCE="${INSTANCE_BASE}-target"');
    expect(script).toContain(
      'BUILDER_CONFIG="${REPO_ROOT}/test/systemd/lima.yaml"',
    );
    expect(script).toContain(
      'TARGET_CONFIG="${REPO_ROOT}/test/systemd/steady-file-preview-target-lima.yaml"',
    );
    expect(script).not.toContain('KEEP_VM');
  });

  it('builds the exact six-file handoff and destroys the builder before target creation', async () => {
    const script = await readDriver();
    const buildInvocation = script.indexOf(
      'scripts/verify-steady-file-systemd-linux.js',
    );
    const builderDeletion = script.indexOf(
      'delete_and_assert_absent "${BUILDER_INSTANCE}"',
    );
    const targetCreation = script.indexOf(
      'lima create --tty=false --name "${TARGET_INSTANCE}"',
    );

    expect(script).toMatch(
      /HANDOFF_FILES=\(\n[ ]{2}"source\/app"\n[ ]{2}"source\/artifact-record\.json"\n[ ]{2}"target\/app"\n[ ]{2}"target\/artifact-record\.json"\n[ ]{2}"handoff\.json"\n[ ]{2}"SHA256SUMS"\n\)/,
    );
    expect(script).toContain('/usr/local/bin/npm ci --no-audit --no-fund');
    expect(script).toMatch(
      /scripts\/verify-steady-file-systemd-linux\.js \\\n[ ]{2}build \\\n[ ]{2}"\$\{GUEST_REPO\}" \\\n[ ]{2}"\$\{GUEST_HANDOFF_ROOT\}" \\\n[ ]{2}"\$\{GUEST_BUILDER_RECEIPT\}"/,
    );
    expect(script).toContain(
      '"${BUILDER_INSTANCE}:${GUEST_HANDOFF_ROOT}/${relative_path}"',
    );
    expect(buildInvocation).toBeGreaterThan(-1);
    expect(builderDeletion).toBeGreaterThan(buildInvocation);
    expect(targetCreation).toBeGreaterThan(builderDeletion);
  });

  it('gives the clean no-Node target only the handoff and literal input, then uses two host controllers', async () => {
    const script = await readDriver();
    const prepareInvocation = script.indexOf(
      '"${REPO_ROOT}/scripts/verify-steady-file-preview-target.js" \\\n  prepare',
    );
    const verifyInvocation = script.indexOf(
      '"${REPO_ROOT}/scripts/verify-steady-file-preview-target.js" \\\n  verify',
    );

    expect(script).toContain('TARGET_ROOT="/home/wharfie/preview"');
    expect(script).toContain(
      '"${TARGET_INSTANCE}:${TARGET_HANDOFF_ROOT}/${relative_path}"',
    );
    expect(script).toContain(
      '\'literal steady-file systemd proof artifact\' > "${HOST_INPUT_PATH}"',
    );
    expect(script).toContain('/usr/bin/env node --version');
    expect(script).toContain('/usr/bin/env npm --version');
    expect(script).toContain(
      '"${NODE_BIN}" \\\n  "${REPO_ROOT}/scripts/verify-steady-file-preview-target.js"',
    );
    expect(prepareInvocation).toBeGreaterThan(-1);
    expect(verifyInvocation).toBeGreaterThan(prepareInvocation);
    expect(script.slice(prepareInvocation, verifyInvocation)).toContain(
      '"${HOST_PREPARE_RECEIPT}"',
    );
    expect(script.slice(verifyInvocation)).toContain('"${HOST_FINAL_RECEIPT}"');
  });

  it('always deletes both VMs and its isolated cache, publishing only bounded receipts', async () => {
    const script = await readDriver();

    expect(script).toContain('trap cleanup EXIT');
    expect(script).toContain(
      'cleanup_instance_if_present "${TARGET_INSTANCE}"',
    );
    expect(script).toContain(
      'cleanup_instance_if_present "${BUILDER_INSTANCE}"',
    );
    expect(script).toContain('delete_and_assert_absent "${TARGET_INSTANCE}"');
    expect(script).toContain('rm -rf "${TEMP_ROOT}"');
    expect(script).toContain('if [[ -e "${TEMP_ROOT}" || -e "${LIMA_HOME}" ]]');
    expect(script).toContain('receipt_bytes > 1024 * 1024');
    expect(script).toMatch(
      /\/usr\/bin\/shasum -a 256 \\\n[ ]{2}builder\.json \\\n[ ]{2}prepare\.json \\\n[ ]{2}final\.json \\\n[ ]{2}cleanup\.json > SHA256SUMS/,
    );
    expect(script).not.toMatch(/failure_directory|prepare\.log|verify\.log/);
  });
});
