import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Only the subprocess transport is wrapped. All acceptance, journaling,
// deadline, verification, and destruction logic stays in the pinned checkout.
const config = JSON.parse(fs.readFileSync('/etc/wharfie-soak/campaign.json'));
const base = '/opt/wharfie-soak/harness/scripts/';
const { parseLiveDeploymentArguments, runLiveDeploymentAcceptance } =
  await import(pathToFileURL(base + 'verify-live-deployment.js'));
const { runLiveDeploymentProcess } =
  await import(pathToFileURL(base + 'live-deployment-package.js'));
const options = parseLiveDeploymentArguments(process.argv.slice(2));
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => abort.abort());
const digest = (value) => createHash('sha256').update(value).digest('hex');
/**
 * @param {string} file - Exact run evidence file.
 * @returns {Buffer} - Bytes of a small regular file.
 */
function boundedRead(file) {
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144);
  return fs.readFileSync(file);
}
try {
  const result = await runLiveDeploymentAcceptance({ ...options, signal: abort.signal }, {
    run: async (request) => {
      if (request.phase === 'apply' && options.provider === 'aws') {
        const runDir = options.outputDir;
        assert.match(runDir, /^\/var\/lib\/wharfie-soak\/runs\/(rehearsal|soak)-aws$/);
        const runBytes = boundedRead(runDir + '/run.json');
        const previewBytes = boundedRead(runDir + '/preview.json');
        const run = JSON.parse(runBytes);
        const preview = JSON.parse(previewBytes);
        assert.equal(run.provider, 'aws');
        assert.equal(run.placement, config.region);
        assert.equal(run.allowedIpv4, config.controllerIpv4 + '/32');
        assert.match(run.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.match(run.deploymentInstanceId, /^wsnd1_[A-Za-z0-9_-]{43}$/);
        assert.equal(preview.deployment.deploymentInstanceId, run.deploymentInstanceId);
        assert.equal(run.deploymentId, 'acceptance-' + run.runId);
        assert.equal(preview.status, 'actionable');
        const gate = {
          format: 'wharfie.soak.apply-gate.v1', campaignId: config.campaignId,
          controllerCommit: config.controllerCommit, sourceCommit: config.sourceCommit,
          runId: run.runId, deploymentInstanceId: run.deploymentInstanceId,
          runDir, runSha256: digest(runBytes), previewSha256: digest(previewBytes),
          requestedAt: Date.now(), run, preview,
        };
        fs.writeFileSync(runDir + '/gate-request.json', JSON.stringify(gate), { mode: 0o600, flag: 'wx' });
        const until = performance.now() + 1800000;
        let approved = false;
        while (!abort.signal.aborted && performance.now() < until) {
          const approvalPath = runDir + '/gate-approved.json';
          if (fs.existsSync(approvalPath)) {
            const approval = JSON.parse(boundedRead(approvalPath));
            assert.equal(approval.runId, gate.runId);
            assert.equal(approval.runSha256, gate.runSha256);
            assert.equal(approval.previewSha256, gate.previewSha256);
            assert.equal(approval.deploymentInstanceId, gate.deploymentInstanceId);
            assert.equal(approval.campaignId, config.campaignId);
            assert.equal(digest(boundedRead(runDir + '/run.json')), gate.runSha256);
            assert.equal(digest(boundedRead(runDir + '/preview.json')), gate.previewSha256);
            const probe = spawnSync('/usr/bin/python3', ['/opt/wharfie-soak/ops/gate_probe.py',
              gate.deploymentInstanceId], { timeout: 35000, stdio: 'ignore' });
            if (probe.status === 0) { approved = true; break; }
          }
          await wait(3000, undefined, { signal: abort.signal });
        }
        assert.ok(approved, 'Exact deployment IAM approval did not become available before its deadline.');
      }
      return runLiveDeploymentProcess(request);
    },
  });
  process.exitCode = ['passed', 'running'].includes(result.status) ? 0 : 1;
} catch {
  process.stderr.write('Pinned campaign runner failed; inspect bounded reports.\n');
  process.exitCode = 1;
}
