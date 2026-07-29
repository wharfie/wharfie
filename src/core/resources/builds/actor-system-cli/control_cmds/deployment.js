import { isIPv4 } from 'node:net';

import { Command, InvalidArgumentError } from 'commander';

import { assertDomainSeparatedSha256Id } from '../../../../runtime/content-id.js';
import {
  SINGLE_NODE_ACCESS_KIND,
  SINGLE_NODE_DEPLOYMENT_MODE,
  SINGLE_NODE_MACHINE,
  createAwsSingleNodeDeploymentProvider,
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
  AWS_SINGLE_NODE_APPLY_RESULT_KIND,
  AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
  createProductionAwsSingleNodeApplyCoordinator,
} from '../../../../runtime/providers/aws/single-node-apply.js';
import {
  AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
  AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
  createProductionAwsSingleNodeDestroyCoordinator,
} from '../../../../runtime/providers/aws/single-node-destroy.js';
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

const APPLY_RESULT_CONTRACTS = Object.freeze({
  aws: Object.freeze({
    schemaVersion: AWS_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_APPLY_RESULT_KIND,
  }),
  hetzner: Object.freeze({
    schemaVersion: HETZNER_SINGLE_NODE_APPLY_RESULT_SCHEMA_VERSION,
    kind: HETZNER_SINGLE_NODE_APPLY_RESULT_KIND,
  }),
});
const DESTROY_RESULT_CONTRACTS = Object.freeze({
  aws: Object.freeze({
    schemaVersion: AWS_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_DESTROY_RESULT_KIND,
  }),
  hetzner: Object.freeze({
    schemaVersion: HETZNER_SINGLE_NODE_DESTROY_RESULT_SCHEMA_VERSION,
    kind: HETZNER_SINGLE_NODE_DESTROY_RESULT_KIND,
  }),
});

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
 * Admit one closed provider selector before reading embedded or durable
 * deployment authority.
 * @param {unknown} value - Candidate CLI provider.
 * @returns {'aws'|'hetzner'} - Supported provider.
 */
function validateProvider(value) {
  if (value !== 'aws' && value !== 'hetzner') {
    throw new TypeError(
      "Packaged deployment provider must be 'aws' or 'hetzner'.",
    );
  }
  return value;
}

/**
 * Select the only location authority accepted by the chosen apply provider.
 * @param {Record<string, any>} commandOptions - Commander option snapshot.
 * @returns {Readonly<Record<string, any>>} - Canonical provider selection.
 */
function createApplyProvider(commandOptions) {
  const provider = validateProvider(commandOptions.provider);
  if (provider === 'aws') {
    if (commandOptions.region === undefined) {
      throw new TypeError('AWS packaged deployment apply requires --region.');
    }
    if (commandOptions.location !== undefined) {
      throw new TypeError(
        'AWS packaged deployment apply does not accept --location.',
      );
    }
    return createAwsSingleNodeDeploymentProvider(commandOptions.region);
  }
  if (commandOptions.location === undefined) {
    throw new TypeError(
      'Hetzner packaged deployment apply requires --location.',
    );
  }
  if (commandOptions.region !== undefined) {
    throw new TypeError(
      'Hetzner packaged deployment apply does not accept --region.',
    );
  }
  return createHetznerSingleNodeDeploymentProvider(commandOptions.location);
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
    throw new Error('Packaged deployment apply returned an invalid result.');
  }
  const result = /** @type {Record<string, any>} */ (value);
  const provider = validateProvider(authority.intent.provider.kind);
  const contract = APPLY_RESULT_CONTRACTS[provider];
  if (
    result.schemaVersion !== contract.schemaVersion ||
    result.kind !== contract.kind ||
    result.provider !== provider ||
    result.status !== 'active'
  ) {
    throw new Error('Packaged deployment apply did not reach active state.');
  }
  const deploymentInstanceId = getSingleNodeDeploymentInstanceId(
    authority.intent,
  );
  if (result.deploymentInstanceId !== deploymentInstanceId) {
    throw new Error(
      'Packaged deployment apply result does not match the deployment instance.',
    );
  }
  if (result.desiredRevisionId !== authority.desired.desiredRevisionId) {
    throw new Error(
      'Packaged deployment apply result does not match the exact desired revision.',
    );
  }
  if (!isIPv4(result.publicIpv4)) {
    throw new Error(
      'Packaged deployment apply returned an invalid public IPv4 address.',
    );
  }
  if (result.artifactId !== authority.artifactRecord.artifactId) {
    throw new Error(
      'Packaged deployment apply result does not match the embedded deployment artifact.',
    );
  }
  assertDomainSeparatedSha256Id(
    result.activationEvidenceId,
    SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX,
    'packagedDeploymentApplyResult.activationEvidenceId',
  );

  return Object.freeze({
    schemaVersion: PACKAGED_DEPLOYMENT_APPLY_RECEIPT_SCHEMA_VERSION,
    kind: PACKAGED_DEPLOYMENT_APPLY_RECEIPT_KIND,
    provider,
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
 * @param {{provider: 'aws'|'hetzner', appId: string, deploymentInstanceId: string}} authority - Embedded app and requested durable deployment authority.
 * @returns {Readonly<Record<string, any>>} - Compact nonsecret public result.
 */
function createDestroyReceipt(value, authority) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Packaged deployment destroy returned an invalid result.');
  }
  const result = /** @type {Record<string, any>} */ (value);
  const contract = DESTROY_RESULT_CONTRACTS[authority.provider];
  if (
    result.schemaVersion !== contract.schemaVersion ||
    result.kind !== contract.kind ||
    result.provider !== authority.provider ||
    result.status !== 'destroyed' ||
    result.appId !== authority.appId ||
    result.deploymentInstanceId !== authority.deploymentInstanceId
  ) {
    throw new Error(
      'Packaged deployment destroy result does not match the exact deployment authority.',
    );
  }

  return Object.freeze({
    schemaVersion: PACKAGED_DEPLOYMENT_DESTROY_RECEIPT_SCHEMA_VERSION,
    kind: PACKAGED_DEPLOYMENT_DESTROY_RECEIPT_KIND,
    provider: authority.provider,
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
 * provider credentials; production coordinators use only ambient provider
 * credential authority.
 * @param {{
 *   readRevisionRuntimePair?: typeof readEmbeddedRevisionRuntimePair,
 *   readDeploymentPayload?: typeof readEmbeddedSingleNodeDeploymentPayload,
 *   createApplyCoordinator?: typeof createProductionHetznerSingleNodeApplyCoordinator,
 *   createDestroyCoordinator?: typeof createProductionHetznerSingleNodeDestroyCoordinator,
 *   createApplyCoordinatorByProvider?: Partial<{aws: typeof createProductionAwsSingleNodeApplyCoordinator, hetzner: typeof createProductionHetznerSingleNodeApplyCoordinator}>,
 *   createDestroyCoordinatorByProvider?: Partial<{aws: typeof createProductionAwsSingleNodeDestroyCoordinator, hetzner: typeof createProductionHetznerSingleNodeDestroyCoordinator}>,
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
  const createApplyCoordinatorByProvider = Object.freeze({
    aws:
      options.createApplyCoordinatorByProvider?.aws ||
      createProductionAwsSingleNodeApplyCoordinator,
    hetzner:
      options.createApplyCoordinatorByProvider?.hetzner ||
      options.createApplyCoordinator ||
      createProductionHetznerSingleNodeApplyCoordinator,
  });
  const createDestroyCoordinatorByProvider = Object.freeze({
    aws:
      options.createDestroyCoordinatorByProvider?.aws ||
      createProductionAwsSingleNodeDestroyCoordinator,
    hetzner:
      options.createDestroyCoordinatorByProvider?.hetzner ||
      options.createDestroyCoordinator ||
      createProductionHetznerSingleNodeDestroyCoordinator,
  });
  const resolveDataRoot =
    options.resolveDataRoot || resolveStableLocalAppDataRoot;
  const output = resolveOutput(options.output);
  const processRef = options.processRef || process;

  const apply = new Command('apply')
    .description(
      'Create or recover one cloud node from this self-deployable SEA',
    )
    .requiredOption(
      '--deployment <logical-id>',
      'Logical deployment identity',
      parseSingleOption('--deployment'),
    )
    .requiredOption(
      '--provider <provider>',
      'Cloud provider (aws or hetzner)',
      parseSingleOption('--provider'),
    )
    .option(
      '--location <name>',
      'Hetzner location',
      parseSingleOption('--location'),
    )
    .option('--region <name>', 'AWS region', parseSingleOption('--region'))
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
        const providerSelection = createApplyProvider(commandOptions);
        const provider = validateProvider(providerSelection.kind);
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
          provider: providerSelection,
        });
        const desired = createSingleNodeDeploymentDesired({
          intent,
          revision: pair.revision,
          artifactRecord: payload.artifactRecord,
          observation: source.observation,
        });
        const coordinator = Reflect.apply(
          createApplyCoordinatorByProvider[provider],
          undefined,
          [],
        );
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
      'Destroy or recover destruction of one locally authorized cloud node',
    )
    .requiredOption(
      '--deployment-instance <instance-id>',
      'Exact durable deployment instance identity',
      parseSingleOption('--deployment-instance'),
    )
    .requiredOption(
      '--provider <provider>',
      'Cloud provider (aws or hetzner)',
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
        const provider = validateProvider(commandOptions.provider);
        assertSingleNodeDeploymentInstanceId(
          commandOptions.deploymentInstance,
          'packagedDeploymentDestroy.deploymentInstanceId',
        );
        const pair = await readRevisionRuntimePair();
        const appId = pair.runtime.appId;
        const coordinator = Reflect.apply(
          createDestroyCoordinatorByProvider[provider],
          undefined,
          [],
        );
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
          provider,
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
