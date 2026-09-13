/* eslint-disable jsdoc/require-param, jsdoc/require-param-description, jsdoc/require-returns, jsdoc/require-returns-description -- This internal acceptance boundary keeps compact typed helpers beside the injected provider ports. */

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadAwsProviderBindings } from '../src/core/runtime/aws-provider-module.js';
import { createAwsProviderScope } from '../src/core/runtime/deployment-provider-scope.js';
import { readOperatorJsonObjectStdin } from '../src/core/runtime/operator/json-document-stdin.js';
import { createAwsSingleNodeResourceIdentity } from '../src/core/runtime/providers/aws/resource-identity.js';
import { createHetznerStatusApiClient } from '../src/core/runtime/providers/hetzner/api-client.js';
import { createHetznerCredentialBindingStore } from '../src/core/runtime/providers/hetzner/credential-binding.js';
import {
  getSingleNodeDeploymentEffectiveDesired,
  validateSingleNodeDeploymentJournal,
} from '../src/core/runtime/single-node-deployment-journal.js';
import { runLiveDeploymentProcess } from './live-deployment-package.js';

const CHILD = fileURLToPath(import.meta.url);
const REPO = fileURLToPath(new URL('../', import.meta.url));
const FLAG = '--internal-provider-reboot';
const MAX_BYTES = 256 * 1024;
const MAX_DURATION_MS = 120_000;

/**
 * Validate retained acceptance authority before any provider initialization.
 * @param {Record<string, any>} input
 */
function checkedInput(input) {
  assert.ok(input && typeof input === 'object' && !Array.isArray(input));
  assert.deepEqual(Object.keys(input).sort(), ['dataRoot', 'journal']);
  assert.ok(path.isAbsolute(input.dataRoot));
  assert.equal(path.normalize(input.dataRoot), input.dataRoot);
  const journal = validateSingleNodeDeploymentJournal(input.journal);
  assert.equal(journal.phase, 'active');
  assert.ok(journal.sshHost);
  const desired = getSingleNodeDeploymentEffectiveDesired(journal);
  assert.match(
    desired.intent.deployment.id,
    /^acceptance-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  return { journal, dataRoot: input.dataRoot };
}

/**
 * Project a request receipt; observing a new boot remains the caller's job.
 * @param {Record<string, any>} journal
 */
function receipt(journal) {
  const provider = journal.providerIntent.provider;
  const role = provider === 'aws' ? 'instance' : 'server';
  const resources = journal.resources.filter(
    (/** @type {Record<string, any>} */ entry) => entry.role === role,
  );
  assert.equal(resources.length, 1);
  return {
    schemaVersion: 1,
    kind: 'wharfie.live-deployment.reboot',
    provider,
    deploymentInstanceId: journal.deploymentInstanceId,
    resourceId: resources[0].providerResourceId,
    action: 'reboot-requested',
  };
}

/**
 * One frozen credential snapshot binds STS, exact inventory, and mutation.
 * @param {string} region
 */
async function awsPorts(region) {
  const bindings = await loadAwsProviderBindings();
  const credentials = Object.freeze({
    ...(await bindings.credentialProviders.fromNodeProviderChain({
      clientConfig: { region },
    })()),
  });
  const config = { region, credentials, maxAttempts: 1 };
  const sts = new bindings.clientSTS.STSClient(config);
  const ec2 = new bindings.clientEC2.EC2Client(config);
  return {
    scope: async () => {
      const caller = await sts.send(
        new bindings.clientSTS.GetCallerIdentityCommand({}),
      );
      const arn = /^arn:(aws(?:-[a-z0-9]+)*):(?:sts|iam)::([0-9]{12}):/.exec(
        caller.Arn ?? '',
      );
      assert.ok(arn && arn[2] === caller.Account);
      return createAwsProviderScope({
        partition: arn[1],
        accountId: arn[2],
        region,
      });
    },
    describe: async (/** @type {string} */ instanceId) =>
      await ec2.send(
        new bindings.clientEC2.DescribeInstancesCommand({
          InstanceIds: [instanceId],
        }),
      ),
    reboot: async (/** @type {string} */ instanceId) => {
      await ec2.send(
        new bindings.clientEC2.RebootInstancesCommand({
          InstanceIds: [instanceId],
        }),
      );
    },
    close: () => {
      sts.destroy();
      ec2.destroy();
    },
  };
}

/**
 * Read only one bounded successful provider action document.
 * @param {string} token
 * @param {number} id
 * @param {AbortSignal} signal
 */
async function rebootHetzner(token, id, signal) {
  // https://docs.hetzner.cloud/reference/cloud#server-actions-reboot-a-server
  const response = await fetch(
    `https://api.hetzner.cloud/v1/servers/${id}/actions/reboot`,
    {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}` },
      signal,
    },
  );
  assert.ok(response.ok && response.body);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      assert.ok(size <= 16 * 1024);
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel();
  }
  const { action } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.ok(Number.isSafeInteger(action?.id) && action.id > 0);
  assert.equal(action.command, 'reboot_server');
  assert.ok(['running', 'success'].includes(action.status));
  assert.equal(action.error, null);
  assert.deepEqual(action.resources, [{ id, type: 'server' }]);
}

/**
 * Re-observe all recorded ownership fields before a single exact host reboot.
 * Only the child entrypoint executes this against production providers.
 * @param {Record<string, any>} input
 * @param {Record<string, any>} [dependencies]
 */
export async function rebootLiveDeploymentProvider(input, dependencies = {}) {
  const { journal, dataRoot } = checkedInput(input);
  const result = receipt(journal);
  const intent = journal.providerIntent.intent;
  if (result.provider === 'aws') {
    const expectedScope = intent.plan.providerSpec.providerScope;
    const api = await (dependencies.awsPorts ?? awsPorts)(expectedScope.region);
    try {
      const scope = await api.scope();
      assert.equal(scope.providerScopeId, expectedScope.providerScopeId);
      const response = await api.describe(result.resourceId);
      assert.ok(Array.isArray(response.Reservations));
      assert.ok(response.Reservations.length <= 1 && !response.NextToken);
      const instances = response.Reservations.flatMap(
        (/** @type {Record<string, any>} */ entry) => entry.Instances,
      );
      assert.equal(instances.length, 1);
      const instance = instances[0];
      assert.equal(instance.InstanceId, result.resourceId);
      assert.equal(instance.State?.Name, 'running');
      assert.equal(instance.PublicIpAddress, journal.sshHost.address);
      const expected = createAwsSingleNodeResourceIdentity(intent, 'instance');
      assert.ok(Array.isArray(instance.Tags) && instance.Tags.length <= 64);
      const tags = instance.Tags.filter(
        (/** @type {Record<string, any>} */ entry) =>
          entry.Key === 'Name' || entry.Key?.startsWith('wharfie:'),
      ).sort(
        (
          /** @type {Record<string, any>} */ a,
          /** @type {Record<string, any>} */ b,
        ) => a.Key.localeCompare(b.Key, 'en'),
      );
      assert.deepEqual(
        JSON.parse(JSON.stringify(tags)),
        JSON.parse(
          JSON.stringify(
            [...expected.tags].sort((a, b) => a.Key.localeCompare(b.Key, 'en')),
          ),
        ),
      );
      await api.reboot(result.resourceId);
    } finally {
      await api.close();
    }
  } else {
    const token = (
      dependencies.readHetznerToken ?? (() => process.env.HCLOUD_TOKEN)
    )();
    assert.ok(
      typeof token === 'string' && token.length > 0 && token.length <= 512,
    );
    const binding = await (
      dependencies.requireHetznerBinding ??
      (async (/** @type {Record<string, any>} */ value) =>
        await createHetznerCredentialBindingStore({
          root: path.join(value.dataRoot, 'single-node-deployment-credentials'),
        }).requireBinding({
          deploymentInstanceId: value.deploymentInstanceId,
          token: value.token,
        }))
    )({ dataRoot, deploymentInstanceId: journal.deploymentInstanceId, token });
    assert.equal(binding.deploymentInstanceId, journal.deploymentInstanceId);
    const cancellation = new AbortController();
    const timer = setTimeout(() => cancellation.abort(), 60_000);
    try {
      const api = (
        dependencies.hetznerReadClient ?? createHetznerStatusApiClient
      )({ token, signal: cancellation.signal });
      const server = await api.getServer(result.resourceId);
      const ownership = intent.resources.server.ownership;
      assert.equal(server.id, result.resourceId);
      assert.equal(server.status, 'running');
      assert.equal(server.name, ownership.name);
      assert.deepEqual(
        JSON.parse(JSON.stringify(server.labels)),
        JSON.parse(JSON.stringify(ownership.labels)),
      );
      assert.equal(server.publicIpv4?.ip, journal.sshHost.address);
      await (dependencies.hetznerReboot ?? rebootHetzner)(
        token,
        result.resourceId,
        cancellation.signal,
      );
    } finally {
      clearTimeout(timer);
      cancellation.abort();
    }
  }
  return result;
}

/**
 * A hard process group deadline includes AWS credential helpers and STS.
 * @param {Record<string, any>} input
 * @param {Record<string, any>} [dependencies]
 */
export async function rebootLiveDeploymentInChild(input, dependencies = {}) {
  const checked = checkedInput({
    journal: input.journal,
    dataRoot: input.dataRoot,
  });
  const stdin = JSON.stringify(checked);
  assert.ok(Buffer.byteLength(stdin) <= MAX_BYTES);
  const result = await (dependencies.run ?? runLiveDeploymentProcess)({
    file: process.execPath,
    args: [CHILD, FLAG],
    cwd: REPO,
    env: input.env,
    stdin,
    timeoutMs: MAX_DURATION_MS,
    signal: input.signal,
    phase: 'host-reboot',
  });
  assert.ok(Buffer.byteLength(result.stdout) <= 4096);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report, receipt(checked.journal));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === CHILD) {
  try {
    assert.deepEqual(process.argv.slice(2), [FLAG]);
    const input = await readOperatorJsonObjectStdin(
      MAX_BYTES,
      'Provider reboot',
    );
    const report = await rebootLiveDeploymentProvider(input);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch {
    process.stderr.write('Live deployment host reboot failed.\n');
    process.exitCode = 1;
  }
}
