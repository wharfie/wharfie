/* eslint-disable jsdoc/valid-types -- TypeScript readonly arrays are not understood by the current JSDoc lint parser. */

import { assertSingleNodeDeploymentInstanceId } from '../../single-node-deployment-identity.js';

export const AWS_SINGLE_NODE_OWNERSHIP_MANAGED_BY = 'wharfie';
export const AWS_SINGLE_NODE_OWNERSHIP_SCHEMA = '1';
export const AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS = Object.freeze({
  managedBy: 'wharfie:managed-by',
  schema: 'wharfie:single-node-schema',
  deployment: 'wharfie:deployment-instance-id',
  incarnation: 'wharfie:incarnation-id',
  role: 'wharfie:resource-role',
  action: 'wharfie:created-by-action-id',
  nonce: 'wharfie:ownership-nonce',
  state: 'wharfie:state-digest',
});

/**
 * Build the stable deployment-wide filters used to detect any owned residue
 * before a fresh local journal grants mutation authority.
 * @param {unknown} value - Stable single-node deployment identity.
 * @returns {Readonly<Array<Readonly<{Name: string, Values: readonly string[]}>>>} - Exact EC2 filters.
 */
export function getAwsSingleNodeDeploymentInventoryFilters(value) {
  assertSingleNodeDeploymentInstanceId(
    value,
    'awsSingleNodeOwnership.deploymentInstanceId',
  );
  return Object.freeze([
    Object.freeze({
      Name: `tag:${AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.managedBy}`,
      Values: Object.freeze([AWS_SINGLE_NODE_OWNERSHIP_MANAGED_BY]),
    }),
    Object.freeze({
      Name: `tag:${AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.schema}`,
      Values: Object.freeze([AWS_SINGLE_NODE_OWNERSHIP_SCHEMA]),
    }),
    Object.freeze({
      Name: `tag:${AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS.deployment}`,
      Values: Object.freeze([/** @type {string} */ (value)]),
    }),
  ]);
}

export default {
  AWS_SINGLE_NODE_OWNERSHIP_MANAGED_BY,
  AWS_SINGLE_NODE_OWNERSHIP_SCHEMA,
  AWS_SINGLE_NODE_OWNERSHIP_TAG_KEYS,
  getAwsSingleNodeDeploymentInventoryFilters,
};
