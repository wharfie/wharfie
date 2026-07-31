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
import {
  createSingleNodeDeploymentJournalStore,
  validateSingleNodeDeploymentJournal,
} from '../../../../runtime/single-node-deployment-journal.js';
import {
  createSingleNodeDeploymentPreview,
  validateSingleNodeDeploymentPreview,
} from '../../../../runtime/single-node-deployment-preview.js';
import {
  createSingleNodeDeploymentStatus,
  validateSingleNodeDeploymentStatus,
} from '../../../../runtime/single-node-deployment-status.js';
import { resolveStableLocalAppDataRoot } from '../../../../runtime/local-app-storage.js';
import { readEmbeddedSingleNodeDeploymentPayload } from '../../../../runtime/single-node-deployment-payload.js';
import { SINGLE_NODE_REMOTE_ACTIVATION_EVIDENCE_ID_PREFIX } from '../../../../runtime/single-node-remote-activation.js';
import { inspectSingleNodeRemoteStatus } from '../../../../runtime/single-node-remote-status.js';
import { createAwsSingleNodePreview } from '../../../../runtime/providers/aws/single-node-preview.js';
import { inspectAwsSingleNodeStatus } from '../../../../runtime/providers/aws/single-node-status.js';
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
import { createHetznerSingleNodePreview } from '../../../../runtime/providers/hetzner/single-node-preview.js';
import { inspectHetznerSingleNodeStatus } from '../../../../runtime/providers/hetzner/single-node-status.js';
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
 * Select the only location authority accepted by the chosen desired-state
 * operation.
 * @param {Record<string, any>} commandOptions - Commander option snapshot.
 * @param {'preview'|'apply'} operation - Public operation name.
 * @returns {Readonly<Record<string, any>>} - Canonical provider selection.
 */
function createDesiredProvider(commandOptions, operation) {
  const provider = validateProvider(commandOptions.provider);
  if (provider === 'aws') {
    if (commandOptions.region === undefined) {
      throw new TypeError(
        `AWS packaged deployment ${operation} requires --region.`,
      );
    }
    if (commandOptions.location !== undefined) {
      throw new TypeError(
        `AWS packaged deployment ${operation} does not accept --location.`,
      );
    }
    return createAwsSingleNodeDeploymentProvider(commandOptions.region);
  }
  if (commandOptions.location === undefined) {
    throw new TypeError(
      `Hetzner packaged deployment ${operation} requires --location.`,
    );
  }
  if (commandOptions.region !== undefined) {
    throw new TypeError(
      `Hetzner packaged deployment ${operation} does not accept --region.`,
    );
  }
  return createHetznerSingleNodeDeploymentProvider(commandOptions.location);
}

/**
 * Add the one exact desired-state selector surface shared by preview and
 * apply. Every call creates new Commander option instances.
 * @param {Command} command - Fresh desired-state leaf.
 * @returns {Command} - Configured command.
 */
function addDesiredStateOptions(command) {
  return command
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
    .option('--json', 'Output compact JSON');
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
 * @param {'preview'|'apply'} operation - Public operation name.
 * @returns {unknown} - One reportable failure.
 */
function combineCleanupError(operationError, cleanupError, operation) {
  if (operationError === undefined) return cleanupError;
  return new AggregateError(
    [operationError, cleanupError],
    `Packaged deployment ${operation} failed and embedded payload cleanup was incomplete.`,
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
 *   createPreviewByProvider?: Partial<{aws: typeof createAwsSingleNodePreview, hetzner: typeof createHetznerSingleNodePreview}>,
 *   inspectStatusByProvider?: Partial<{aws: typeof inspectAwsSingleNodeStatus, hetzner: typeof inspectHetznerSingleNodeStatus}>,
 *   createApplyCoordinatorByProvider?: Partial<{aws: typeof createProductionAwsSingleNodeApplyCoordinator, hetzner: typeof createProductionHetznerSingleNodeApplyCoordinator}>,
 *   createDestroyCoordinatorByProvider?: Partial<{aws: typeof createProductionAwsSingleNodeDestroyCoordinator, hetzner: typeof createProductionHetznerSingleNodeDestroyCoordinator}>,
 *   createJournalStore?: typeof createSingleNodeDeploymentJournalStore,
 *   createPreviewReceipt?: typeof createSingleNodeDeploymentPreview,
 *   createStatusReceipt?: typeof createSingleNodeDeploymentStatus,
 *   inspectRemoteStatus?: typeof inspectSingleNodeRemoteStatus,
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
  const createPreviewByProvider = Object.freeze({
    aws: options.createPreviewByProvider?.aws || createAwsSingleNodePreview,
    hetzner:
      options.createPreviewByProvider?.hetzner ||
      createHetznerSingleNodePreview,
  });
  const inspectStatusByProvider = Object.freeze({
    aws: options.inspectStatusByProvider?.aws || inspectAwsSingleNodeStatus,
    hetzner:
      options.inspectStatusByProvider?.hetzner ||
      inspectHetznerSingleNodeStatus,
  });
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
  const createJournalStore =
    options.createJournalStore || createSingleNodeDeploymentJournalStore;
  const createPreviewReceipt =
    options.createPreviewReceipt || createSingleNodeDeploymentPreview;
  const createStatusReceipt =
    options.createStatusReceipt || createSingleNodeDeploymentStatus;
  const inspectRemoteStatus =
    options.inspectRemoteStatus || inspectSingleNodeRemoteStatus;
  const output = resolveOutput(options.output);
  const processRef = options.processRef || process;

  /**
   * Authenticate the embedded Linux payload and derive the exact desired state
   * shared by preview and apply. If derivation fails after opening the held
   * source, this helper closes it before propagating the failure.
   * @param {Record<string, any>} commandOptions - Commander option snapshot.
   * @param {'preview'|'apply'} operation - Public operation name.
   * @returns {Promise<Readonly<{
   *   provider: 'aws'|'hetzner',
   *   pair: Readonly<Record<string, any>>,
   *   payload: Readonly<Record<string, any>>,
   *   source: Readonly<Record<string, any>>,
   *   intent: Readonly<Record<string, any>>,
   *   desired: Readonly<Record<string, any>>,
   *   dataRoot: string
   * }>>} - Held desired authority.
   */
  async function readDesiredAuthority(commandOptions, operation) {
    /** @type {Readonly<Record<string, any>>|undefined} */
    let source;
    try {
      const providerSelection = createDesiredProvider(
        commandOptions,
        operation,
      );
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
      return Object.freeze({
        provider,
        pair,
        payload,
        source,
        intent,
        desired,
        dataRoot: commandOptions.dataRoot ?? resolveDataRoot(),
      });
    } catch (error) {
      if (source === undefined) throw error;
      try {
        await source.close();
      } catch (cleanupError) {
        throw combineCleanupError(error, cleanupError, operation);
      }
      throw error;
    }
  }

  /**
   * Refuse any preview receipt that escapes the exact embedded desired
   * authority, even when a host supplies an alternate receipt constructor.
   * @param {unknown} value - Candidate generic preview receipt.
   * @param {Readonly<Record<string, any>>} desired - Command-owned authority.
   * @param {'aws'|'hetzner'} provider - Selected provider.
   * @returns {Readonly<Record<string, any>>} - Bound receipt.
   */
  function bindPreviewReceipt(value, desired, provider) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(
        'Packaged deployment preview returned an invalid result.',
      );
    }
    const receipt = /** @type {Readonly<Record<string, any>>} */ (value);
    const deployment = receipt.deployment;
    if (
      receipt.provider !== provider ||
      deployment === null ||
      typeof deployment !== 'object' ||
      Array.isArray(deployment) ||
      deployment.appId !== desired.intent.appId ||
      deployment.deploymentId !== desired.intent.deployment.id ||
      deployment.deploymentInstanceId !== desired.deploymentInstanceId ||
      deployment.revisionId !== desired.artifact.revisionId ||
      deployment.desiredRevisionId !== desired.desiredRevisionId ||
      deployment.artifact?.artifactId !== desired.artifact.artifactId ||
      deployment.artifact?.size !== desired.artifact.size
    ) {
      throw new Error(
        'Packaged deployment preview result does not match the exact embedded authority.',
      );
    }
    return receipt;
  }

  const preview = addDesiredStateOptions(
    new Command('preview').description(
      'Read provider and local state without creating deployment authority',
    ),
  ).action(async (commandOptions) => {
    /** @type {Readonly<Record<string, any>>|undefined} */
    let source;
    /** @type {Readonly<Record<string, any>>|undefined} */
    let receipt;
    /** @type {unknown} */
    let operationError;

    try {
      const authority = await readDesiredAuthority(commandOptions, 'preview');
      source = authority.source;
      const journalStore = Reflect.apply(createJournalStore, undefined, [
        {
          appId: authority.desired.intent.appId,
          deploymentInstanceId: authority.desired.deploymentInstanceId,
          dataRoot: authority.dataRoot,
        },
      ]);
      const readJournal = Object.getOwnPropertyDescriptor(journalStore, 'read');
      if (
        !readJournal ||
        !readJournal.enumerable ||
        !Object.hasOwn(readJournal, 'value') ||
        typeof readJournal.value !== 'function'
      ) {
        throw new TypeError(
          'Packaged deployment preview journal store is invalid.',
        );
      }
      const journal = await Reflect.apply(readJournal.value, journalStore, []);
      const providerPlan = await Reflect.apply(
        createPreviewByProvider[authority.provider],
        undefined,
        [{ desired: authority.desired }],
      );
      receipt = bindPreviewReceipt(
        Reflect.apply(validateSingleNodeDeploymentPreview, undefined, [
          Reflect.apply(createPreviewReceipt, undefined, [
            {
              desired: authority.desired,
              providerPlan,
              journal,
            },
          ]),
        ]),
        authority.desired,
        authority.provider,
      );
    } catch (error) {
      operationError = error;
    }

    if (source !== undefined) {
      try {
        await source.close();
      } catch (cleanupError) {
        operationError = combineCleanupError(
          operationError,
          cleanupError,
          'preview',
        );
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
      const journalPhase = result.journal?.phase || 'absent';
      const actionCount = Array.isArray(result.actions)
        ? result.actions.length
        : 0;
      const managedCount = Array.isArray(result.resources?.managed)
        ? result.resources.managed.length
        : 0;
      const referencedCount = Array.isArray(result.resources?.referenced)
        ? result.resources.referenced.length
        : 0;
      const placement =
        result.provider === 'aws'
          ? result.providerSpec.scope.region
          : result.providerSpec.location.name;
      const machineType =
        result.provider === 'aws'
          ? result.providerSpec.machineType
          : result.providerSpec.machineType.name;
      output.line(
        `${result.deployment.deploymentId} preview is ${result.status} on ${result.provider}/${placement} with ${machineType}; ${managedCount} managed roles, ${referencedCount} references; journal ${journalPhase}; ${actionCount} semantic actions (${result.deployment.deploymentInstanceId})`,
      );
    }
  });

  const apply = addDesiredStateOptions(
    new Command('apply').description(
      'Create or recover one cloud node from this self-deployable SEA',
    ),
  ).action(async (commandOptions) => {
    /** @type {Readonly<Record<string, any>>|undefined} */
    let source;
    /** @type {Readonly<Record<string, any>>|undefined} */
    let receipt;
    /** @type {unknown} */
    let operationError;

    try {
      const authority = await readDesiredAuthority(commandOptions, 'apply');
      source = authority.source;
      const coordinator = Reflect.apply(
        createApplyCoordinatorByProvider[authority.provider],
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
        intent: authority.intent,
        revision: authority.pair.revision,
        artifactRecord: authority.payload.artifactRecord,
        observation: authority.source.observation,
        artifactSource: authority.source,
        dataRoot: authority.dataRoot,
      });
      receipt = createApplyReceipt(result, {
        intent: authority.intent,
        desired: authority.desired,
        revision: authority.pair.revision,
        artifactRecord: authority.payload.artifactRecord,
      });
    } catch (error) {
      operationError = error;
    }

    if (source !== undefined) {
      try {
        await source.close();
      } catch (cleanupError) {
        operationError = combineCleanupError(
          operationError,
          cleanupError,
          'apply',
        );
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

  const status = new Command('status')
    .description(
      'Inspect exact local, provider, and guest state without mutation',
    )
    .requiredOption(
      '--deployment-instance <instance-id>',
      'Exact durable deployment instance identity',
      parseSingleOption('--deployment-instance'),
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
        assertSingleNodeDeploymentInstanceId(
          commandOptions.deploymentInstance,
          'packagedDeploymentStatus.deploymentInstanceId',
        );
        const pair = await readRevisionRuntimePair();
        const appId = pair.runtime.appId;
        const dataRoot = commandOptions.dataRoot ?? resolveDataRoot();
        const journalStore = Reflect.apply(createJournalStore, undefined, [
          {
            appId,
            deploymentInstanceId: commandOptions.deploymentInstance,
            dataRoot,
          },
        ]);
        const readJournal = Object.getOwnPropertyDescriptor(
          journalStore,
          'read',
        );
        if (
          !readJournal ||
          !readJournal.enumerable ||
          !Object.hasOwn(readJournal, 'value') ||
          typeof readJournal.value !== 'function'
        ) {
          throw new TypeError(
            'Packaged deployment status journal store is invalid.',
          );
        }
        const journalValue = await Reflect.apply(
          readJournal.value,
          journalStore,
          [],
        );
        if (journalValue === null) {
          throw new Error(
            'Packaged deployment status requires existing local deployment authority.',
          );
        }
        const journal = validateSingleNodeDeploymentJournal(
          journalValue,
          'packagedDeploymentStatus.journal',
        );
        if (
          journal.desired.intent.appId !== appId ||
          journal.deploymentInstanceId !== commandOptions.deploymentInstance
        ) {
          throw new Error(
            'Packaged deployment status journal does not match the embedded application authority.',
          );
        }
        const provider = validateProvider(journal.providerIntent.provider);
        const providerObservation = await Reflect.apply(
          inspectStatusByProvider[provider],
          undefined,
          [provider === 'aws' ? { journal } : { journal, dataRoot }],
        );
        const guestObservation =
          providerObservation?.status === 'exact'
            ? await Reflect.apply(inspectRemoteStatus, undefined, [
                { journal, dataRoot },
              ])
            : {
                state: ['destroying', 'destroyed'].includes(journal.phase)
                  ? 'not-applicable'
                  : 'not-ready',
                address: ['destroying', 'destroyed'].includes(journal.phase)
                  ? null
                  : (journal.sshHost?.address ?? null),
                hostKeyFingerprint: ['destroying', 'destroyed'].includes(
                  journal.phase,
                )
                  ? null
                  : (journal.sshHost?.fingerprint ?? null),
                service: null,
              };
        receipt = validateSingleNodeDeploymentStatus(
          Reflect.apply(createStatusReceipt, undefined, [
            { journal, providerObservation, guestObservation },
          ]),
        );
        if (
          receipt.provider !== provider ||
          receipt.deployment.appId !== appId ||
          receipt.deployment.deploymentId !==
            journal.desired.intent.deployment.id ||
          receipt.deployment.deploymentInstanceId !==
            commandOptions.deploymentInstance ||
          receipt.deployment.desiredRevisionId !==
            journal.desired.desiredRevisionId ||
          receipt.deployment.revisionId !==
            journal.desired.artifact.revisionId ||
          receipt.deployment.artifact.artifactId !==
            journal.desired.artifact.artifactId ||
          receipt.journal.journalId !== journal.journalId ||
          receipt.journal.generation !== journal.generation ||
          receipt.journal.incarnationId !== journal.incarnationId ||
          receipt.journal.phase !== journal.phase
        ) {
          throw new Error(
            'Packaged deployment status result does not match exact durable authority.',
          );
        }
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
          `${result.deployment.deploymentId} is ${result.status} on ${result.provider}; journal ${result.journal.phase}; provider ${result.providerState.status}; guest ${result.guest.state}; next ${result.nextAction} (${result.deployment.deploymentInstanceId})`,
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
    .addCommand(preview)
    .addCommand(apply)
    .addCommand(status)
    .addCommand(destroy);
}

export default createPackagedDeploymentCommand;
