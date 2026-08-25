/* eslint-disable jsdoc/valid-types, jsdoc/require-returns-description -- TypeScript assertion signatures are not understood by the current JSDoc lint parser. */

import { randomBytes } from 'node:crypto';

import {
  assertDomainSeparatedSha256Id,
  createCanonicalJsonSha256Id,
  createDomainSeparatedSha256Id,
} from './content-id.js';
import { validateSingleNodeDeploymentIntent } from './single-node-deployment-intent.js';

export const SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_DOMAIN =
  'wharfie:single-node-deployment-instance:v1';
export const SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_PREFIX = 'wsnd1';
export const SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_DOMAIN =
  'wharfie:single-node-deployment-incarnation:v1';
export const SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_PREFIX = 'wsnc1';

/**
 * Derive the stable identity of one human deployment and provider placement.
 * Artifact, target, access-policy, and machine changes preserve this identity.
 * @param {unknown} value - Serialized single-node deployment intent.
 * @returns {string} - Stable deployment instance identity.
 */
export function getSingleNodeDeploymentInstanceId(value) {
  const intent = validateSingleNodeDeploymentIntent(value);
  return createCanonicalJsonSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_PREFIX,
    value: {
      appId: intent.appId,
      deployment: intent.deployment,
      provider: intent.provider,
    },
    valuePath: 'singleNodeDeploymentInstance',
  });
}

/**
 * Assert one stable deployment instance identity.
 * @param {unknown} value - Candidate identity.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertSingleNodeDeploymentInstanceId(
  value,
  valuePath = 'deploymentInstanceId',
) {
  assertDomainSeparatedSha256Id(
    value,
    SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_PREFIX,
    valuePath,
  );
}

/**
 * Create the unpredictable identity of one create-to-destroy lifetime.
 * @param {Buffer|Uint8Array} [entropy] - Testable 256-bit entropy.
 * @returns {string} - Fresh incarnation identity.
 */
export function createSingleNodeDeploymentIncarnationId(
  entropy = randomBytes(32),
) {
  if (!(entropy instanceof Uint8Array) || entropy.byteLength !== 32) {
    throw new TypeError('incarnation entropy must contain exactly 32 bytes.');
  }
  return createDomainSeparatedSha256Id({
    domain: SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_DOMAIN,
    prefix: SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_PREFIX,
    payload: entropy,
  });
}

/**
 * Assert one deployment incarnation identity.
 * @param {unknown} value - Candidate identity.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {asserts value is string}
 */
export function assertSingleNodeDeploymentIncarnationId(
  value,
  valuePath = 'incarnationId',
) {
  assertDomainSeparatedSha256Id(
    value,
    SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_PREFIX,
    valuePath,
  );
}

export default {
  SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_INCARNATION_ID_PREFIX,
  SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_DOMAIN,
  SINGLE_NODE_DEPLOYMENT_INSTANCE_ID_PREFIX,
  assertSingleNodeDeploymentIncarnationId,
  assertSingleNodeDeploymentInstanceId,
  createSingleNodeDeploymentIncarnationId,
  getSingleNodeDeploymentInstanceId,
};
