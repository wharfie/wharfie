/* eslint-disable jsdoc/valid-types, jsdoc/require-param, jsdoc/require-returns, jsdoc/require-returns-description -- This narrow publisher keeps its exact authority and recovery ports inline. */

import { isAwsSingleNodeHostActivationRequestAuthorizedByHead } from './deployment-aws-host-activation-authority-contract.js';
import {
  AWS_SINGLE_NODE_HOST_ACTIVATION_CONTEXT_MAX_BYTES,
  createAwsSingleNodeHostActivationRequest,
  validateAwsSingleNodeHostActivationRequest,
} from './deployment-aws-host-agent-contract.js';
import {
  AwsSingleNodeManagedArtifactEvidenceConflictError,
  AwsSingleNodeManagedArtifactEvidenceUnknownError,
  decodeAwsSingleNodeManagedArtifactHead,
  isAwsSingleNodeManagedArtifactCurrentMissingError,
} from './deployment-aws-managed-artifact-evidence.js';
import { validateAwsSingleNodeProviderSpecContext } from './deployment-aws-provider-spec.js';
import { getAwsSingleNodeManagedArtifactObjectLocation } from './deployment-aws-runtime-identity-contract.js';
import { validateDeploymentHead } from './deployment-head.js';
import { validateDeploymentPlanContext } from './deployment-plan.js';
import { validateDeploymentProfile } from './deployment-profile.js';
import { cloneBoundedJsonObject } from './json-value.js';

const FACTORY_KEYS = new Set(['client', 'store']);
const PUBLISH_KEYS = new Set(['plan', 'settledPlan', 'profile', 'head']);
const INVALID_FACTORY =
  'AWS single-node host-activation authority publisher options are invalid.';
const INVALID_CONTEXT =
  'AWS single-node host-activation publication authority is invalid.';
const CONFLICT =
  'AWS single-node host-activation authority publication conflicts with durable state.';
const UNKNOWN =
  'AWS single-node host-activation authority publication outcome is unknown.';

/** A supplied deployment frontier cannot mint host authority. */
export class AwsSingleNodeHostActivationAuthorityPublisherAuthorityError extends Error {
  constructor() {
    super(INVALID_CONTEXT);
    this.name = 'AwsSingleNodeHostActivationAuthorityPublisherAuthorityError';
    this.code = 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_PUBLISHER_AUTHORITY';
  }
}

/** Durable state moved to an incompatible authority lineage. */
export class AwsSingleNodeHostActivationAuthorityPublisherConflictError extends Error {
  constructor() {
    super(CONFLICT);
    this.name = 'AwsSingleNodeHostActivationAuthorityPublisherConflictError';
    this.code = 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_PUBLISHER_CONFLICT';
  }
}

/** Publication could not be proven committed or rejected. */
export class AwsSingleNodeHostActivationAuthorityPublisherUnknownError extends Error {
  constructor() {
    super(UNKNOWN);
    this.name = 'AwsSingleNodeHostActivationAuthorityPublisherUnknownError';
    this.code = 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_PUBLISHER_UNKNOWN';
  }
}

/** @param {unknown} value @returns {value is Record<string, any>} */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {Record<string, any>} value @param {Set<string>} keys @param {string} message @returns {void} */
function assertExactDataObject(value, keys, message) {
  if (!isPlainObject(value)) throw new TypeError(message);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
  ) {
    throw new TypeError(message);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, 'value')
    ) {
      throw new TypeError(message);
    }
  }
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** @param {Readonly<Record<string, any>>} request @param {Readonly<Record<string, any>>} plan @returns {boolean} */
function requestMatchesPlan(request, plan) {
  return (
    request.deploymentInstanceId === plan.deploymentInstanceId &&
    request.incarnationId === plan.incarnationId &&
    request.planId === plan.planId &&
    request.deploymentRevisionId ===
      plan.deploymentRevision.deploymentRevisionId &&
    request.profileRevisionId === plan.deploymentRevision.profileRevisionId &&
    request.providerSpecId === plan.providerSpec.providerSpecId &&
    sameJson(request.providerScope, plan.providerScope)
  );
}

/** @param {Readonly<Record<string, any>>} request @returns {Readonly<Record<string, any>>} */
function stableRequestFields(request) {
  const {
    requestId: _requestId,
    authorizedHeadId: _authorizedHeadId,
    authorizedHeadGeneration: _authorizedHeadGeneration,
    ...stable
  } = request;
  return stable;
}

/** @param {Readonly<Record<string, any>>} left @param {Readonly<Record<string, any>>} right @returns {boolean} */
function sameStableRequest(left, right) {
  return sameJson(stableRequestFields(left), stableRequestFields(right));
}

/**
 * Validate only the stable context needed before a reusable request can be
 * selected. The V65 constructor repeats the complete graph proof before mint.
 * @param {unknown} value - Exact publisher request.
 * @returns {Readonly<Record<string, any>>} - Canonical context.
 */
function validatePublishContext(value) {
  try {
    const input = cloneBoundedJsonObject(
      value,
      AWS_SINGLE_NODE_HOST_ACTIVATION_CONTEXT_MAX_BYTES,
      'awsSingleNodeHostActivationAuthorityPublisher context',
    );
    assertExactDataObject(input, PUBLISH_KEYS, INVALID_CONTEXT);
    const profile = validateDeploymentProfile(
      input.profile,
      'awsSingleNodeHostActivationAuthorityPublisher profile',
    );
    const plan = validateDeploymentPlanContext(input.plan, { profile });
    const settledPlan =
      input.settledPlan === null
        ? null
        : validateDeploymentPlanContext(input.settledPlan, { profile });
    const providerSpec = validateAwsSingleNodeProviderSpecContext(
      plan.providerSpec,
      { profile, providerScope: plan.providerScope },
    );
    const head = validateDeploymentHead(
      input.head,
      'awsSingleNodeHostActivationAuthorityPublisher head',
    );
    if (
      plan.deploymentInstanceId !== head.deploymentInstanceId ||
      plan.incarnationId !== head.incarnationId ||
      !sameJson(plan.providerScope, head.providerScope)
    ) {
      throw new Error(INVALID_CONTEXT);
    }
    return Object.freeze({
      plan,
      settledPlan,
      profile,
      providerSpec,
      head,
    });
  } catch {
    throw new AwsSingleNodeHostActivationAuthorityPublisherAuthorityError();
  }
}

/** @param {Readonly<Record<string, any>>} context @returns {Readonly<Record<string, any>>} */
function deriveMintAuthority(context) {
  const { plan, head } = context;
  if (
    plan.operation === 'destroy' ||
    head.phase !== 'CONVERGING' ||
    head.activeOperation === null ||
    head.activeOperation.kind === 'destroy' ||
    head.activeOperation.status !== 'running' ||
    head.activeOperation.planId !== plan.planId ||
    head.activeOperation.nextActionIndex !== plan.actions.length ||
    head.activeOperation.intents.length !== plan.actions.length ||
    head.activeOperation.intents.some(
      (/** @type {Readonly<Record<string, any>>} */ intent) =>
        intent.status !== 'settled',
    ) ||
    head.targetDeploymentRevisionId !==
      plan.deploymentRevision.deploymentRevisionId
  ) {
    throw new AwsSingleNodeHostActivationAuthorityPublisherAuthorityError();
  }
  const artifactBinding = head.resourceBindings.find(
    (/** @type {Readonly<Record<string, any>>} */ binding) =>
      binding.resourceKey === 'artifact',
  );
  if (artifactBinding === undefined) {
    throw new AwsSingleNodeHostActivationAuthorityPublisherAuthorityError();
  }
  const location = getAwsSingleNodeManagedArtifactObjectLocation({
    providerScope: plan.providerScope,
    deploymentInstanceId: plan.deploymentInstanceId,
    incarnationId: plan.incarnationId,
  });
  return Object.freeze({
    artifactBinding,
    location,
    evidenceAuthority: Object.freeze({
      providerScope: plan.providerScope,
      artifactStorage: context.providerSpec.capabilities.artifactStorage,
      deploymentInstanceId: plan.deploymentInstanceId,
      incarnationId: plan.incarnationId,
      createdByActionId: artifactBinding.createdByActionId,
      ownershipNonce: artifactBinding.ownershipNonce,
      appId: plan.deploymentRevision.appId,
    }),
  });
}

/**
 * Bind fresh managed-object evidence and one stable control-table pointer to
 * the deployment controller. The store owns strong reads and the atomic
 * head-plus-authority transaction.
 * @param {unknown} options - Exact S3 client and deployment-control store.
 * @returns {Readonly<{publish: (value: unknown) => Promise<Readonly<Record<string, any>>>}>} - Publisher port.
 */
export function createAwsSingleNodeHostActivationAuthorityPublisher(options) {
  assertExactDataObject(
    /** @type {Record<string, any>} */ (options),
    FACTORY_KEYS,
    INVALID_FACTORY,
  );
  const { client, store } = /** @type {Record<string, any>} */ (options);
  if (!isPlainObject(client) || !isPlainObject(store)) {
    throw new TypeError(INVALID_FACTORY);
  }
  const headObject = client.headObject;
  const readAuthority = store.readHostActivationAuthority;
  const compareAndSetAuthority = store.compareAndSetHostActivationAuthority;
  const readHead = store.readHead;
  if (
    typeof headObject !== 'function' ||
    typeof readAuthority !== 'function' ||
    typeof compareAndSetAuthority !== 'function' ||
    typeof readHead !== 'function'
  ) {
    throw new TypeError(INVALID_FACTORY);
  }

  /** @param {Readonly<Record<string, any>>} context @param {Readonly<Record<string, any>>} candidate @param {boolean} ambiguousWrite @returns {Promise<Readonly<Record<string, any>>>} */
  async function recoverPublication(
    context,
    candidate,
    ambiguousWrite = false,
  ) {
    let winner;
    let currentHead;
    try {
      winner = await Reflect.apply(readAuthority, store, [
        context.plan.deploymentInstanceId,
      ]);
      currentHead = await Reflect.apply(readHead, store, [
        context.plan.deploymentInstanceId,
      ]);
    } catch {
      throw new AwsSingleNodeHostActivationAuthorityPublisherUnknownError();
    }
    if (winner !== null && currentHead !== null) {
      try {
        const request = validateAwsSingleNodeHostActivationRequest(
          winner,
          'awsSingleNodeHostActivationAuthorityPublisher winner',
        );
        const sameOperation =
          request.deploymentOperationId === candidate.deploymentOperationId &&
          requestMatchesPlan(request, context.plan);
        if (
          sameOperation &&
          sameStableRequest(request, candidate) &&
          isAwsSingleNodeHostActivationRequestAuthorizedByHead(
            request,
            currentHead,
          )
        ) {
          return request;
        }
      } catch {
        // A malformed or superseded winner is never usable authority.
      }
    }
    if (ambiguousWrite) {
      throw new AwsSingleNodeHostActivationAuthorityPublisherUnknownError();
    }
    throw new AwsSingleNodeHostActivationAuthorityPublisherConflictError();
  }

  /** @param {unknown} value @returns {Promise<Readonly<Record<string, any>>>} */
  async function publish(value) {
    const context = validatePublishContext(value);
    const mintAuthority = deriveMintAuthority(context);
    let response;
    try {
      response = await Reflect.apply(headObject, client, [
        Object.freeze({
          Bucket: mintAuthority.location.bucketName,
          Key: mintAuthority.location.key,
          ChecksumMode: 'ENABLED',
          ExpectedBucketOwner: context.plan.providerScope.accountId,
        }),
      ]);
    } catch (error) {
      if (isAwsSingleNodeManagedArtifactCurrentMissingError(error)) {
        throw new AwsSingleNodeManagedArtifactEvidenceConflictError();
      }
      throw new AwsSingleNodeManagedArtifactEvidenceUnknownError();
    }
    const managedArtifact = decodeAwsSingleNodeManagedArtifactHead(
      response,
      mintAuthority.evidenceAuthority,
      undefined,
    );
    let request;
    try {
      request = createAwsSingleNodeHostActivationRequest({
        plan: context.plan,
        settledPlan: context.settledPlan,
        profile: context.profile,
        head: context.head,
        managedArtifact,
      });
    } catch {
      throw new AwsSingleNodeHostActivationAuthorityPublisherAuthorityError();
    }

    let existing;
    try {
      existing = await Reflect.apply(readAuthority, store, [
        context.plan.deploymentInstanceId,
      ]);
    } catch {
      throw new AwsSingleNodeHostActivationAuthorityPublisherUnknownError();
    }
    if (existing !== null) {
      let currentRequest;
      try {
        currentRequest = validateAwsSingleNodeHostActivationRequest(
          existing,
          'awsSingleNodeHostActivationAuthorityPublisher existing request',
        );
      } catch {
        throw new AwsSingleNodeHostActivationAuthorityPublisherConflictError();
      }
      const sameOperation =
        currentRequest.deploymentOperationId ===
          request.deploymentOperationId &&
        requestMatchesPlan(currentRequest, context.plan);
      if (sameOperation) {
        if (!sameStableRequest(currentRequest, request)) {
          throw new AwsSingleNodeHostActivationAuthorityPublisherConflictError();
        }
        return await recoverPublication(context, request, false);
      }
    }

    let result;
    let ambiguousWrite = false;
    try {
      result = await Reflect.apply(compareAndSetAuthority, store, [
        Object.freeze({
          expectedRequest: existing,
          nextRequest: request,
          authorizedHead: context.head,
        }),
      ]);
    } catch {
      ambiguousWrite = true;
    }
    if (!ambiguousWrite && result === true) return request;
    if (!ambiguousWrite && result !== false) {
      throw new AwsSingleNodeHostActivationAuthorityPublisherUnknownError();
    }
    return await recoverPublication(context, request, ambiguousWrite);
  }

  return Object.freeze({ publish });
}

export default {
  AwsSingleNodeHostActivationAuthorityPublisherAuthorityError,
  AwsSingleNodeHostActivationAuthorityPublisherConflictError,
  AwsSingleNodeHostActivationAuthorityPublisherUnknownError,
  createAwsSingleNodeHostActivationAuthorityPublisher,
};
