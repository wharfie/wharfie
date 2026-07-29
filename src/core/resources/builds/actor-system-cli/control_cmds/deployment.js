import { isIPv4 } from 'node:net';

import { Command, InvalidArgumentError } from 'commander';

import { assertDomainSeparatedSha256Id } from '../../../../runtime/content-id.js';
import {
  SINGLE_NODE_ACCESS_KIND,
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createHetznerSingleNodeDeploymentProvider,
  createSingleNodeDeploymentIntent,
} from '../../../../runtime/single-node-deployment-intent.js';
import { createSingleNodeDeploymentDesired } from '../../../../runtime/single-node-deployment-desired.js';
import {
  assertSingleNodeDeploymentInstanceId,
  getSingleNodeDeploymentInstanceId,
} from '../../../../runtime/single-node-deployment-identity.js';
import { resolveStableLocalAppDataRoot } from '../../../../runtime/local-app-storage.js';
import { readEmbeddedSingleNodeDeploymentPayload } from '../../../../runtime/single-node-deployment-payload.js';
import { SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX } from '../../../../runtime/single-node-remote-activation.js';
import {
  HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
  HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
  createProductionHetznerSingleNodeApplyCoordinator,
} from '../../../../runtime/providers/hetzner/single-node-apply.js';
import {
  HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
  HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
  createProductionHetznerSingleNodeDestroyCoordinator,
} from '../../../../runtime/providers/hetzner/single-node-destroy.js';
import { readEmbeddedRevisionRuntimePair } from '../../lib/revision-runtime-assets.js';

export const PACKAGED_DEPLOYMENT_APPLY_RECEIPT_SCHEMA_VERSION = 1;
export const PACKAGED_DEPLOYMENT_APPLY_RECEIPT_KIND =
  'wharfie.deployment.apply';
export const PACKAGED_DEPLOYMENT_DESTROY_RECEIPT_SCHEMA_VERSION = 1;
export const PACKAGED_DEPLOYMENT_DESTROY_RECEIPT_KIND =
  'wharfie.deployment.destroy';

/**
 * @typedef PackagedDeploymentCommandOutput
 * @property {(value: Readonly<Record<string, any>>) => void} json - Write one compact JSON result.
 * @property {(message: string) => void} line - Write one compact human result.
 * @property {(error: unknown) => void} failure - Write one safe failure.
 */

/**
 * @typedef PackagedDeploymentCommandProcess
 * @property {number|string|null|undefined} exitCode - Process exit status.
 */

/**
 * Collect one repeated SSH source without interpreting it before the intent
 * authority validates and canonicalizes the complete set.
 * @param {string} value - IPv4 `/32` source.
 * @param {string[]|undefined} previous - Previously supplied sources.
 * @returns {string[]} - Complete supplied source list.
 */
function collectSshSource(value, previous) {
  return [...(previous ?? []), value];
}

/**
 * Reject ambiguous repeated scalar selectors at Commander admission.
 * @param {string} optionName - Public option name.
 * @returns {(value: string, previous: string|undefined) => string} - Scalar parser.
 */
function parseSingleOption(optionName) {
  return (value, previous) => {
    if (previous !== undefined) {
      throw new InvalidArgumentError(
        `${optionName} may be specified only once.`,
      );
    }
    return value;
  };
}

/**
 * @param {Partial<PackagedDeploymentCommandOutput>|undefined} provided - Optional output seams.
 * @returns {PackagedDeploymentCommandOutput} - Complete output boundary.
 */
function resolveOutput(provided) {
  return {
    json:
      provided?.json ||
      ((value) => {
        process.stdout.write(`${JSON.stringify(value)}\n`);
      }),
    line:
      provided?.line ||
      ((message) => {
        process.stdout.write(`${message}\n`);
      }),
    failure:
      provided?.failure ||
      ((error) => {
        const message =
          error instanceof Error
            ? error.message
            : String(error || 'Unknown deployment error');
        console.error(message);
      }),
  };
}

/**
 * @param {unknown} value - Candidate coordinator result.
 * @param {{intent: Readonly<Record<string, any>>, desired: Readonly<Record<string, any>>, revision: Readonly<Record<string, any>>, artifactRecord: Readonly<Record<string, any>>}} authority - Command-owned authority.
 * @returns {Readonly<Record<string, any>>} - Compact nonsecret public result.
 */
function createApplyReceipt(value, authority) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hetzner apply returned an invalid result.');
  }
  const result = /** @type {Record<string, any>} */ (value);
  if (
    result.schemaVersion !== HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION ||
    result.kind !== HETZNER_SINGLE_NODE_APPLY_RESULT_KIND ||
    result.provider !== 'hetzner' ||
    result.status !== 'active'
  ) {
    throw new Error('Hetzner apply did not reach active state.');
  }
  const deploymentInstanceId = getSingleNodeDeploymentInstanceId(
    authority.intent,
  );
  if (result.deploymentInstanceId !== deploymentInstanceId) {
    throw new Error(
      'Hetzner apply result does not match the deployment instance.',
    );
  }
  if (result.desiredRevisionId !== authority.desired.desiredRevisionId) {
    throw new Error(
      'Hetzner apply result does not match the exact desired revision.',
    );
  }
  if (!isIPv4(result.publicIpv4)) {
    throw new Error('Hetzner apply returned an invalid public IPv4 address.');
  }
  if (result.artifactId !== authority.artifactRecord.artifactId) {
    throw new Error(
      'Hetzner apply result does not match the embedded deployment artifact.',
    );
  }
  assertDomainSeparatedSha256Id(
    result.activationEvidenceId,
    SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
    'hetznerApplyResult.activationEvidenceId',
  );

  return Object.freeze({
    schemaVersion: PACKAGED_DEPLOYMENT_APPLY_RECEIPT_SCHEMA_VERSION,
    kind: PACKAGED_DEPLOYMENT_APPLY_RECEIPT_KIND,
    provider: 'hetzner',
    status: 'active',
    deploymentId: authority.intent.deployment.id,
    appId: authority.intent.appId,
    revisionId: authority.revision.revisionId,
    artifactId: result.artifactId,
    deploymentInstanceId,
    publicIpv4: result.publicIpv4,
  });
}

/**
 * @param {unknown} value - Candidate coordinator result.
 * @param {{appId: string, deploymentInstanceId: string}} authority - Embedded app and requested durable deployment authority.
 * @returns {Readonly<Record<string, any>>} - Compact nonsecret public result.
 */
function createDestroyReceipt(value, authority) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Hetzner destroy returned an invalid result.');
  }
  const result = /** @type {Record<string, any>} */ (value);
  if (
    result.schemaVersion !==
      HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION ||
    result.kind !== HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND ||
    result.provider !== 'hetzner' ||
    result.status !== 'destroyed' ||
    result.appId !== authority.appId ||
    result.deploymentInstanceId !== authority.deploymentInstanceId
  ) {
    throw new Error(
      'Hetzner destroy result does not match the exact deployment authority.',
    );
  }

  return Object.freeze({
    schemaVersion: PACKAGED_DEPLOYMENT_DESTROY_RECEIPT_SCHEMA_VERSION,
    kind: PACKAGED_DEPLOYMENT_DESTROY_RECEIPT_KIND,
    provider: 'hetzner',
    status: 'destroyed',
    appId: authority.appId,
    deploymentInstanceId: authority.deploymentInstanceId,
  });
}

/**
 * Combine an operation error with a held-source cleanup error without losing
 * either failure.
 * @param {unknown} operationError - Original command failure, if any.
 * @param {unknown} cleanupError - Held-source cleanup failure.
 * @returns {unknown} - One reportable failure.
 */
function combineCleanupError(operationError, cleanupError) {
  if (operationError === undefined) return cleanupError;
  return new AggregateError(
    [operationError, cleanupError],
    'Packaged deployment apply failed and embedded payload cleanup was incomplete.',
  );
}

/**
 * Create the intentionally narrow self-deployable SEA command. It accepts no
 * provider credentials; the production coordinator reads `HCLOUD_TOKEN` from
 * its ambient process authority.
 * @param {{
 *   readRevisionRuntimePair?: typeof readEmbeddedRevisionRuntimePair,
 *   readDeploymentPayload?: typeof readEmbeddedSingleNodeDeploymentPayload,
 *   createApplyCoordinator?: typeof createProductionHetznerSingleNodeApplyCoordinator,
 *   createDestroyCoordinator?: typeof createProductionHetznerSingleNodeDestroyCoordinator,
 *   resolveDataRoot?: typeof resolveStableLocalAppDataRoot,
 *   output?: Partial<PackagedDeploymentCommandOutput>,
 *   processRef?: PackagedDeploymentCommandProcess
 * }} [options] - Test and host seams.
 * @returns {Command} - Fresh packaged deployment command.
 */
export function createPackagedDeploymentCommand(options = {}) {
  const readRevisionRuntimePair =
    options.readRevisionRuntimePair || readEmbeddedRevisionRuntimePair;
  const readDeploymentPayload =
    options.readDeploymentPayload || readEmbeddedSingleNodeDeploymentPayload;
  const createApplyCoordinator =
    options.createApplyCoordinator ||
    createProductionHetznerSingleNodeApplyCoordinator;
  const createDestroyCoordinator =
    options.createDestroyCoordinator ||
    createProductionHetznerSingleNodeDestroyCoordinator;
  const resolveDataRoot =
    options.resolveDataRoot || resolveStableLocalAppDataRoot;
  const output = resolveOutput(options.output);
  const processRef = options.processRef || process;

  const apply = new Command('apply')
    .description(
      'Create or recover one Hetzner node from this self-deployable SEA',
    )
    .requiredOption(
      '--deployment <logical-id>',
      'Logical deployment identity',
      parseSingleOption('--deployment'),
    )
    .requiredOption(
      '--provider <provider>',
      'Cloud provider (hetzner)',
      parseSingleOption('--provider'),
    )
    .requiredOption(
      '--location <name>',
      'Hetzner location',
      parseSingleOption('--location'),
    )
    .requiredOption(
      '--allow-ssh-from <ipv4/32>',
      'IPv4 /32 allowed to reach SSH (repeatable)',
      collectSshSource,
    )
    .option(
      '--data-root <absolute>',
      'Stable local deployment authority root',
      parseSingleOption('--data-root'),
    )
    .option('--json', 'Output compact JSON')
    .action(async (commandOptions) => {
      /** @type {Readonly<Record<string, any>>|undefined} */
      let source;
      /** @type {Readonly<Record<string, any>>|undefined} */
      let receipt;
      /** @type {unknown} */
      let operationError;

      try {
        if (commandOptions.provider !== 'hetzner') {
          throw new TypeError(
            "Packaged deployment provider must be 'hetzner'.",
          );
        }
        const pair = await readRevisionRuntimePair();
        const payload = await readDeploymentPayload({
          revision: pair.revision,
        });
        source = payload.source;
        const intent = createSingleNodeDeploymentIntent({
          deployment: { id: commandOptions.deployment },
          appId: pair.runtime.appId,
          target: payload.artifactRecord.target,
          mode: SINGLE_NODE_DEPLOYMENT_MODE,
          machine: SINGLE_NODE_MACHINE,
          access: {
            kind: SINGLE_NODE_ACCESS_KIND,
            allowedIpv4: commandOptions.allowSshFrom,
          },
          provider: createHetznerSingleNodeDeploymentProvider(
            commandOptions.location,
          ),
        });
        const desired = createSingleNodeDeploymentDesired({
          intent,
          revision: pair.revision,
          artifactRecord: payload.artifactRecord,
          observation: source.observation,
        });
        const coordinator = createApplyCoordinator();
        if (
          coordinator === null ||
          typeof coordinator !== 'object' ||
          typeof coordinator.apply !== 'function'
        ) {
          throw new TypeError(
            'Packaged deployment apply coordinator is invalid.',
          );
        }
        const result = await coordinator.apply({
          intent,
          revision: pair.revision,
          artifactRecord: payload.artifactRecord,
          observation: source.observation,
          artifactSource: source,
          dataRoot: commandOptions.dataRoot ?? resolveDataRoot(),
        });
        receipt = createApplyReceipt(result, {
          intent,
          desired,
          revision: pair.revision,
          artifactRecord: payload.artifactRecord,
        });
      } catch (error) {
        operationError = error;
      }

      if (source !== undefined) {
        try {
          await source.close();
        } catch (cleanupError) {
          operationError = combineCleanupError(operationError, cleanupError);
        }
      }
      if (operationError !== undefined) {
        output.failure(operationError);
        processRef.exitCode = 1;
        return;
      }

      const result = /** @type {Readonly<Record<string, any>>} */ (receipt);
      if (commandOptions.json) {
        output.json(result);
      } else {
        output.line(
          `${result.deploymentId} is active at ${result.publicIpv4} (${result.deploymentInstanceId})`,
        );
      }
    });

  const destroy = new Command('destroy')
    .description(
      'Destroy or recover destruction of one locally authorized Hetzner node',
    )
    .requiredOption(
      '--deployment-instance <instance-id>',
      'Exact durable deployment instance identity',
      parseSingleOption('--deployment-instance'),
    )
    .requiredOption(
      '--provider <provider>',
      'Cloud provider (hetzner)',
      parseSingleOption('--provider'),
    )
    .option(
      '--data-root <absolute>',
      'Stable local deployment authority root',
      parseSingleOption('--data-root'),
    )
    .option('--json', 'Output compact JSON')
    .action(async (commandOptions) => {
      /** @type {Readonly<Record<string, any>>|undefined} */
      let receipt;
      /** @type {unknown} */
      let operationError;

      try {
        if (commandOptions.provider !== 'hetzner') {
          throw new TypeError(
            "Packaged deployment provider must be 'hetzner'.",
          );
        }
        assertSingleNodeDeploymentInstanceId(
          commandOptions.deploymentInstance,
          'packagedDeploymentDestroy.deploymentInstanceId',
        );
        const pair = await readRevisionRuntimePair();
        const appId = pair.runtime.appId;
        const coordinator = createDestroyCoordinator();
        if (
          coordinator === null ||
          typeof coordinator !== 'object' ||
          typeof coordinator.destroy !== 'function'
        ) {
          throw new TypeError(
            'Packaged deployment destroy coordinator is invalid.',
          );
        }
        const result = await coordinator.destroy({
          appId,
          deploymentInstanceId: commandOptions.deploymentInstance,
          dataRoot: commandOptions.dataRoot ?? resolveDataRoot(),
        });
        receipt = createDestroyReceipt(result, {
          appId,
          deploymentInstanceId: commandOptions.deploymentInstance,
        });
      } catch (error) {
        operationError = error;
      }

      if (operationError !== undefined) {
        output.failure(operationError);
        processRef.exitCode = 1;
        return;
      }

      const result = /** @type {Readonly<Record<string, any>>} */ (receipt);
      if (commandOptions.json) {
        output.json(result);
      } else {
        output.line(
          `${result.deploymentInstanceId} is destroyed for ${result.appId}`,
        );
      }
    });

  return new Command('deployment')
    .description('Deploy this embedded application payload')
    .addCommand(apply)
    .addCommand(destroy);
}

export default createPackagedDeploymentCommand;
