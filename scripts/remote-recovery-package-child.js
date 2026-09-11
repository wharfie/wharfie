import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Compare complete validated artifact JSON. Payload validation intentionally
 * uses null-prototype objects; object prototypes are not artifact evidence.
 * @param {unknown} embedded - Validated embedded payload artifact record.
 * @param {unknown} guest - Validated separately packaged guest record.
 * @returns {void} - Throws on any difference in serialized record fields.
 */
export function assertMatchingRemoteRecoveryPayloadRecords(embedded, guest) {
  assert.deepEqual(
    JSON.parse(JSON.stringify(embedded)),
    JSON.parse(JSON.stringify(guest)),
  );
}

/**
 * Package one proof pass in an independent process so builder memory and module
 * state cannot leak into the next pass or hide its process termination.
 * @param {string[]} args - Pass kind and exact proof-owned package paths.
 * @returns {Promise<void>} - Publishes one bounded private result.
 */
export async function packageRemoteRecoveryPass(args) {
  assert.equal(args.length, 5);
  const [pass, installed, fixture, outputDir, resultPath] = args;
  assert.ok(['guest', 'controller'].includes(pass));
  for (const selected of [installed, fixture, outputDir, resultPath]) {
    assert.ok(path.isAbsolute(selected));
    assert.ok(selected.startsWith('/var/tmp/wharfie-systemd-proof/'));
  }
  /** @param {{phase: string}} progress - Bounded package progress. */
  const onProgress = ({ phase }) => {
    const bytes = `${JSON.stringify({ pass, phase, rssBytes: process.memoryUsage().rss })}\n`;
    // This mutable diagnostic checkpoint is deliberately separate from the
    // immutable successful package result; the parent survives builder death.
    writeFileSync(
      path.join(path.dirname(resultPath), 'package-progress.json'),
      bytes,
      { mode: 0o600 },
    );
    process.stdout.write(bytes);
  };
  const modulePath =
    pass === 'guest'
      ? 'src/cli/app/local-app.js'
      : 'src/cli/app/single-node-self-deployable-package.js';
  const api = await import(
    pathToFileURL(path.join(installed, modulePath)).href
  );
  const packageApplication =
    pass === 'guest'
      ? api.packageLocalApp
      : api.packageSingleNodeSelfDeployableApp;
  const result =
    /** @type {{revision: unknown, artifacts: {path: string, record: unknown, target: unknown}[], deploymentPayload?: unknown}} */ (
      await packageApplication({
        dir: fixture,
        outputDir,
        targetFilters: [
          `linux/${pass === 'guest' ? 'x64' : process.arch}/glibc`,
        ],
        onProgress,
      })
    );
  const bytes = `${JSON.stringify({
    revision: result.revision,
    artifacts: result.artifacts.map(
      ({ path: artifactPath, record, target }) => ({
        path: artifactPath,
        record,
        target,
      }),
    ),
    ...(pass === 'controller'
      ? { deploymentPayload: result.deploymentPayload }
      : {}),
  })}\n`;
  assert.ok(Buffer.byteLength(bytes) <= 1024 * 1024);
  writeFileSync(resultPath, bytes, { flag: 'wx', mode: 0o600 });
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await packageRemoteRecoveryPass(process.argv.slice(2));
}
