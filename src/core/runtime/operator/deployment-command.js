import { Command, InvalidArgumentError } from 'commander';

import { validateDeploymentProfile } from '../deployment-profile.js';
import { assertDeploymentInstanceId } from '../deployment-provider-scope.js';
import { cloneJsonObject } from '../json-value.js';
import { assertLogicalId } from '../logical-id.js';
import { readOperatorJsonObjectFile } from './json-document-file.js';

const CONTROL_POLICIES = new Set([
  'require-active',
  'reconcile-existing',
  'bootstrap',
]);
const AWS_REGION_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;
const OPERATION_KEYS = Object.freeze([
  'prepare',
  'apply',
  'applyPrepared',
  'inspect',
  'reconcile',
  'destroy',
]);
const OUTPUT_KEYS = Object.freeze(['json', 'table', 'info', 'failure']);

/**
 * Snapshot an optional adapter override surface without invoking accessors or
 * accepting inherited behavior.
 * @param {unknown} value - Candidate partial lifecycle operation overrides.
 * @returns {Readonly<Record<string, Function>>} - Frozen own-data overrides.
 */
export function snapshotDeploymentOperationOverrides(value) {
  if (value === undefined) return Object.freeze({});
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError(
      'deployment operation overrides must be a plain partial object.',
    );
  }
  const object = /** @type {Record<string, any>} */ (value);
  if (
    OPERATION_KEYS.some((key) => !Object.hasOwn(object, key) && key in object)
  ) {
    throw new TypeError(
      'deployment operation overrides must not inherit lifecycle methods.',
    );
  }
  const ownKeys = Reflect.ownKeys(object);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !OPERATION_KEYS.includes(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(
      'deployment operation overrides contain an unsupported method.',
    );
  }
  /** @type {Record<string, Function>} */
  const snapshot = {};
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `deployment operation override ${String(key)} must be an own enumerable function.`,
      );
    }
    snapshot[/** @type {string} */ (key)] = descriptor.value;
  }
  return Object.freeze(snapshot);
}

/**
 * @typedef DeploymentCommandOutput
 * @property {(value: Record<string, any>) => void} json - Write a machine-readable result.
 * @property {(rows: Record<string, any>[]) => void} table - Write compact human rows.
 * @property {(message: string) => void} info - Write a human instruction.
 * @property {(error: unknown) => void} failure - Write a redacted failure.
 */

/**
 * @typedef DeploymentCommandProcess
 * @property {() => string} [cwd] - Resolve the source default directory.
 * @property {string | number | null | undefined} exitCode - Process exit status.
 */

/**
 * @param {Partial<DeploymentCommandOutput> | undefined} provided - Host output hooks.
 * @returns {DeploymentCommandOutput} - Complete output adapter.
 */
function resolveOutput(provided) {
  /** @type {DeploymentCommandOutput} */
  const defaults = {
    json: (/** @type {Record<string, any>} */ value) => {
      console.log(JSON.stringify(value));
    },
    table: (/** @type {Record<string, any>[]} */ rows) => console.table(rows),
    info: (/** @type {string} */ message) => console.log(message),
    failure: (/** @type {unknown} */ error) => {
      console.error(error instanceof Error ? error.message : String(error));
    },
  };
  if (provided === undefined) return Object.freeze(defaults);
  if (
    provided === null ||
    typeof provided !== 'object' ||
    Array.isArray(provided) ||
    (Object.getPrototypeOf(provided) !== Object.prototype &&
      Object.getPrototypeOf(provided) !== null)
  ) {
    throw new TypeError('deployment command output must be a plain object.');
  }
  const object = /** @type {Record<string, any>} */ (provided);
  if (OUTPUT_KEYS.some((key) => !Object.hasOwn(object, key) && key in object)) {
    throw new TypeError(
      'deployment command output must not inherit output methods.',
    );
  }
  const ownKeys = Reflect.ownKeys(object);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !OUTPUT_KEYS.includes(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(
      'deployment command output contains an unsupported method.',
    );
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(
        `deployment command output.${String(key)} must be an own enumerable function.`,
      );
    }
    /** @type {Record<string, any>} */ (defaults)[/** @type {string} */ (key)] =
      descriptor.value;
  }
  return Object.freeze(defaults);
}

/**
 * @param {unknown} provided - Candidate process seam.
 * @param {boolean} requireCwd - Whether source selection requires cwd.
 * @returns {DeploymentCommandProcess} - Valid explicit or real process.
 */
function resolveProcessRef(provided, requireCwd) {
  if (provided === undefined) return process;
  if (provided === process) return process;
  if (
    provided === null ||
    typeof provided !== 'object' ||
    Array.isArray(provided) ||
    (Object.getPrototypeOf(provided) !== Object.prototype &&
      Object.getPrototypeOf(provided) !== null)
  ) {
    throw new TypeError(
      'deployment command processRef must be a plain process object.',
    );
  }
  const object = /** @type {Record<string, any>} */ (provided);
  const exitCode = Object.getOwnPropertyDescriptor(object, 'exitCode');
  if (
    !exitCode ||
    !Object.hasOwn(exitCode, 'value') ||
    !exitCode.writable ||
    (exitCode.value !== undefined &&
      exitCode.value !== null &&
      typeof exitCode.value !== 'number' &&
      typeof exitCode.value !== 'string')
  ) {
    throw new TypeError(
      'deployment command processRef.exitCode must be a writable own data property.',
    );
  }
  const cwd = Object.getOwnPropertyDescriptor(object, 'cwd');
  if (
    (cwd !== undefined &&
      (!cwd.enumerable ||
        !Object.hasOwn(cwd, 'value') ||
        typeof cwd.value !== 'function')) ||
    (cwd === undefined && 'cwd' in object)
  ) {
    throw new TypeError(
      'deployment command processRef.cwd must be an own enumerable function.',
    );
  }
  if (requireCwd && cwd === undefined) {
    throw new TypeError(
      'source deployment command processRef.cwd is required.',
    );
  }
  return /** @type {DeploymentCommandProcess} */ (object);
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
 * @param {unknown} value - Candidate control policy.
 * @param {'bootstrap'|'require-active'|undefined} defaultPolicy - Optional command default.
 * @returns {'require-active'|'reconcile-existing'|'bootstrap'} - Explicit policy.
 */
function resolveControlPolicy(value, defaultPolicy) {
  const policy = value === undefined ? defaultPolicy : value;
  if (typeof policy !== 'string' || !CONTROL_POLICIES.has(policy)) {
    throw new TypeError(
      '--control-policy must be require-active, reconcile-existing, or bootstrap.',
    );
  }
  return /** @type {'require-active'|'reconcile-existing'|'bootstrap'} */ (
    policy
  );
}

/**
 * @param {unknown} value - Candidate AWS region.
 * @returns {string} - Canonical explicit region.
 */
function requireRegion(value) {
  if (
    typeof value !== 'string' ||
    value.length > 63 ||
    !AWS_REGION_PATTERN.test(value)
  ) {
    throw new TypeError('--region must be an explicit canonical AWS region.');
  }
  return value;
}

/**
 * @param {unknown} value - Candidate human deployment id.
 * @returns {Readonly<{id: string}>} - Canonical selection.
 */
function requireDeployment(value) {
  try {
    assertLogicalId(value, 'deployment command deployment');
  } catch {
    throw new TypeError('deployment must be a Wharfie logical id.');
  }
  return Object.freeze({ id: /** @type {string} */ (value) });
}

/**
 * @param {unknown} value - Candidate durable deployment instance id.
 * @returns {string} - Canonical instance id.
 */
function requireDeploymentInstanceId(value) {
  try {
    assertDeploymentInstanceId(
      value,
      'deployment command deploymentInstanceId',
    );
  } catch {
    throw new TypeError(
      'deployment instance must be an exact Wharfie deployment instance id.',
    );
  }
  return /** @type {string} */ (value);
}

/**
 * @param {unknown} value - Lifecycle result.
 * @returns {Record<string, any>} - Compact non-secret human row.
 */
function formatResultRow(value) {
  const result =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? /** @type {Record<string, any>} */ (value)
      : {};
  const plan =
    result.plan !== null &&
    typeof result.plan === 'object' &&
    !Array.isArray(result.plan)
      ? result.plan
      : result.kind === 'deploymentPlan'
        ? result
        : null;
  if (plan) {
    return {
      operation: plan.operation || '',
      deployment_instance: plan.deploymentInstanceId || '',
      plan: plan.planId || '',
      revision: plan.deploymentRevision?.deploymentRevisionId || '',
      actions: Array.isArray(plan.actions) ? plan.actions.length : 0,
    };
  }
  if (result.kind === 'deploymentControllerInspection') {
    return {
      status: result.status || '',
      deployment_instance: result.deploymentInstanceId || '',
      phase: result.head?.phase || 'ABSENT',
      active_plan: result.activePlan?.planId || '',
    };
  }
  return {
    phase: result.phase || result.status || '',
    deployment_instance: result.deploymentInstanceId || '',
    revision:
      result.targetDeploymentRevisionId ||
      result.settledDeploymentRevisionId ||
      '',
    active_operation: result.activeOperation?.operationId || '',
  };
}

/**
 * @param {unknown} result - Exact lifecycle result.
 * @param {boolean} json - Whether full machine output was requested.
 * @param {DeploymentCommandOutput} output - Output adapter.
 * @param {boolean} portablePlan - Whether JSON contains reusable plan evidence.
 * @returns {void}
 */
function writeResult(result, json, output, portablePlan = false) {
  const document = cloneJsonObject(result, 'deployment command result');
  if (json) {
    output.json(document);
    return;
  }
  output.table([formatResultRow(document)]);
  if (portablePlan) {
    output.info('Use --json to write the complete reusable plan document.');
  }
}

/**
 * @param {unknown} value - Candidate exact operation port.
 * @returns {Readonly<Record<string, Function>>} - Captured methods.
 */
function captureOperations(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('deployment command operations must be an object.');
  }
  const object = /** @type {Record<string, any>} */ (value);
  const ownKeys = Reflect.ownKeys(object);
  if (
    ownKeys.some(
      (key) =>
        typeof key !== 'string' ||
        !OPERATION_KEYS.includes(/** @type {string} */ (key)),
    )
  ) {
    throw new TypeError(
      'deployment command operations must expose only the exact lifecycle methods.',
    );
  }
  /** @type {Record<string, Function>} */
  const methods = {};
  for (const key of OPERATION_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'function'
    ) {
      throw new TypeError(`deployment command operations.${key} is required.`);
    }
    methods[key] = descriptor.value;
  }
  if (ownKeys.length !== OPERATION_KEYS.length) {
    throw new TypeError(
      'deployment command operations must expose only the exact lifecycle methods.',
    );
  }
  return Object.freeze(methods);
}

/**
 * Create a fresh source or packaged deployment command tree. The command
 * owns only file admission and presentation; injected operations own artifact
 * authority and AWS lifecycle semantics.
 * @param {{operations: Record<string, Function>, includeSourceOptions?: boolean, output?: Partial<DeploymentCommandOutput>, processRef?: DeploymentCommandProcess, readJsonObjectFile?: typeof readOperatorJsonObjectFile}} options - Host behavior.
 * @returns {Command} - Fresh `deployment` command.
 */
export function createDeploymentCommand(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('createDeploymentCommand options are invalid.');
  }
  const operationsOwner = options.operations;
  const operations = captureOperations(operationsOwner);
  const includeSourceOptions = options.includeSourceOptions === true;
  const output = resolveOutput(options.output);
  const processRef = resolveProcessRef(
    options.processRef,
    includeSourceOptions,
  );
  const readJsonObjectFile =
    options.readJsonObjectFile === undefined
      ? readOperatorJsonObjectFile
      : options.readJsonObjectFile;
  if (typeof readJsonObjectFile !== 'function') {
    throw new TypeError(
      'createDeploymentCommand readJsonObjectFile must be a function.',
    );
  }

  /**
   * @param {string} method - Captured lifecycle operation.
   * @param {Record<string, any>} input - Exact command input.
   * @returns {Promise<any>} - Operation result.
   */
  async function invoke(method, input) {
    return await Reflect.apply(operations[method], operationsOwner, [input]);
  }

  /**
   * @param {unknown} filePath - Profile document path.
   * @returns {Promise<Readonly<Record<string, any>>>} - Canonical profile.
   */
  async function readProfile(filePath) {
    const value = await readJsonObjectFile(filePath, 'deployment profile');
    return validateDeploymentProfile(value, 'deployment command profile');
  }

  /**
   * @param {unknown} deploymentValue - Human deployment id.
   * @param {Record<string, any>} commandOptions - Commander options.
   * @param {'bootstrap'|undefined} defaultPolicy - Optional direct-command default.
   * @returns {Promise<Record<string, any>>} - Direct plan/apply input.
   */
  async function createDirectInput(
    deploymentValue,
    commandOptions,
    defaultPolicy,
  ) {
    const deployment = requireDeployment(deploymentValue);
    const controlPolicy = resolveControlPolicy(
      commandOptions.controlPolicy,
      defaultPolicy,
    );
    const input = {
      deployment,
      profile: await readProfile(commandOptions.profile),
      controlPolicy,
    };
    if (!includeSourceOptions) return input;
    const dir =
      typeof commandOptions.dir === 'string'
        ? commandOptions.dir
        : typeof processRef.cwd === 'function'
          ? processRef.cwd()
          : process.cwd();
    return {
      ...input,
      dir,
      ...(commandOptions.outputDir === undefined
        ? {}
        : { outputDir: commandOptions.outputDir }),
    };
  }

  /**
   * Run one action and convert its failure into the normal operator exit.
   * @param {() => Promise<void>} action - Action body.
   * @returns {Promise<void>} - Settled action.
   */
  async function runAction(action) {
    try {
      await action();
    } catch (error) {
      output.failure(error);
      processRef.exitCode = 1;
    }
  }

  const plan = new Command('plan')
    .description(
      'Prepare an exact plan; source mode stages a SEA and bootstrap may create control state',
    )
    .argument('<deployment>', 'Stable human deployment id')
    .requiredOption(
      '--profile <file>',
      'Exact DeploymentProfile JSON file',
      parseSingleOption('--profile'),
    )
    .requiredOption(
      '--control-policy <policy>',
      'Required control state policy: require-active, reconcile-existing, or bootstrap',
      parseSingleOption('--control-policy'),
    )
    .option('--json', 'Write the complete reusable plan JSON');
  if (includeSourceOptions) {
    plan
      .option(
        '--dir <dir>',
        'Directory containing wharfie.app.js',
        parseSingleOption('--dir'),
      )
      .option(
        '--output-dir <dir>',
        'Package output directory',
        parseSingleOption('--output-dir'),
      );
  }
  plan.action((deployment, commandOptions) =>
    runAction(async () => {
      const result = await invoke(
        'prepare',
        await createDirectInput(deployment, commandOptions, undefined),
      );
      writeResult(result, commandOptions.json === true, output, true);
    }),
  );

  const apply = new Command('apply')
    .description('Converge a new deployment revision')
    .argument('[deployment]', 'Stable human deployment id')
    .option(
      '--profile <file>',
      'Exact DeploymentProfile JSON file',
      parseSingleOption('--profile'),
    )
    .option(
      '--plan <file>',
      'Complete JSON emitted by deployment plan',
      parseSingleOption('--plan'),
    )
    .option(
      '--control-policy <policy>',
      'Control state policy (direct default: bootstrap; --plan default: require-active)',
      parseSingleOption('--control-policy'),
    )
    .option('--json', 'Write the complete settled deployment head JSON');
  if (includeSourceOptions) {
    apply
      .option(
        '--dir <dir>',
        'Directory containing wharfie.app.js',
        parseSingleOption('--dir'),
      )
      .option(
        '--output-dir <dir>',
        'Package output directory',
        parseSingleOption('--output-dir'),
      );
  }
  apply.action((deployment, commandOptions) =>
    runAction(async () => {
      let result;
      if (commandOptions.plan !== undefined) {
        if (deployment !== undefined || commandOptions.profile !== undefined) {
          throw new Error(
            'deployment apply --plan cannot be combined with deployment or --profile.',
          );
        }
        if (
          includeSourceOptions &&
          (commandOptions.dir !== undefined ||
            commandOptions.outputDir !== undefined)
        ) {
          throw new Error(
            'deployment apply --plan cannot be combined with --dir or --output-dir.',
          );
        }
        const controlPolicy = resolveControlPolicy(
          commandOptions.controlPolicy,
          'require-active',
        );
        const prepared = await readJsonObjectFile(
          commandOptions.plan,
          'deployment plan',
        );
        result = await invoke('applyPrepared', {
          prepared,
          controlPolicy,
        });
      } else {
        if (deployment === undefined || commandOptions.profile === undefined) {
          throw new Error(
            'deployment apply requires deployment and --profile, or --plan.',
          );
        }
        result = await invoke(
          'apply',
          await createDirectInput(deployment, commandOptions, 'bootstrap'),
        );
      }
      writeResult(result, commandOptions.json === true, output);
    }),
  );

  const inspect = new Command('inspect')
    .description('Inspect one durable deployment and its provider resources')
    .argument('<deployment-instance>', 'Exact durable deployment instance id')
    .requiredOption(
      '--region <region>',
      'AWS region containing control state',
      parseSingleOption('--region'),
    )
    .option(
      '--control-policy <policy>',
      'Control state policy (default: require-active)',
      parseSingleOption('--control-policy'),
    )
    .option('--json', 'Write the complete inspection JSON')
    .action((deploymentInstanceId, commandOptions) =>
      runAction(async () => {
        const result = await invoke('inspect', {
          deploymentInstanceId:
            requireDeploymentInstanceId(deploymentInstanceId),
          region: requireRegion(commandOptions.region),
          controlPolicy: resolveControlPolicy(
            commandOptions.controlPolicy,
            'require-active',
          ),
        });
        writeResult(result, commandOptions.json === true, output);
      }),
    );

  const reconcile = new Command('reconcile')
    .description('Restore the exact settled deployment or resume its operation')
    .argument('<deployment-instance>', 'Exact durable deployment instance id')
    .requiredOption(
      '--region <region>',
      'AWS region containing control state',
      parseSingleOption('--region'),
    )
    .option(
      '--confirm-coordinator-stopped',
      'Assert the prior coordinator cannot continue before claiming recovery',
    )
    .option(
      '--control-policy <policy>',
      'Control state policy (default: require-active)',
      parseSingleOption('--control-policy'),
    )
    .option('--json', 'Write the complete settled deployment head JSON')
    .action((deploymentInstanceId, commandOptions) =>
      runAction(async () => {
        const result = await invoke('reconcile', {
          deploymentInstanceId:
            requireDeploymentInstanceId(deploymentInstanceId),
          region: requireRegion(commandOptions.region),
          controlPolicy: resolveControlPolicy(
            commandOptions.controlPolicy,
            'require-active',
          ),
          confirmCoordinatorStopped:
            commandOptions.confirmCoordinatorStopped === true,
        });
        writeResult(result, commandOptions.json === true, output);
      }),
    );

  const destroy = new Command('destroy')
    .description('Destroy managed resources while retaining retained state')
    .argument('<deployment-instance>', 'Exact durable deployment instance id')
    .requiredOption(
      '--region <region>',
      'AWS region containing control state',
      parseSingleOption('--region'),
    )
    .option(
      '--control-policy <policy>',
      'Control state policy (default: require-active)',
      parseSingleOption('--control-policy'),
    )
    .option('--json', 'Write the complete destroyed deployment head JSON')
    .action((deploymentInstanceId, commandOptions) =>
      runAction(async () => {
        const result = await invoke('destroy', {
          deploymentInstanceId:
            requireDeploymentInstanceId(deploymentInstanceId),
          region: requireRegion(commandOptions.region),
          controlPolicy: resolveControlPolicy(
            commandOptions.controlPolicy,
            'require-active',
          ),
        });
        writeResult(result, commandOptions.json === true, output);
      }),
    );

  return new Command('deployment')
    .description('Provider-backed single-node deployment lifecycle')
    .addCommand(plan)
    .addCommand(apply)
    .addCommand(inspect)
    .addCommand(reconcile)
    .addCommand(destroy);
}

export default { createDeploymentCommand };
