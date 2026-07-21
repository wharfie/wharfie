/**
 * Provider identities used to bind one EC2 resident node to its exact IAM
 * runtime role. These are immutable AWS-assigned identities, not mutable
 * names or ARNs.
 */

export const AWS_IAM_ROLE_ID_PATTERN = /^AROA[A-Z0-9]{12,124}$/;
export const AWS_EC2_INSTANCE_ID_PATTERN = /^i-[0-9a-f]{17}$/;

/**
 * @param {unknown} value - Candidate immutable IAM role unique ID.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {void} - Throws unless this is one role-prefixed IAM RoleId.
 */
export function assertAwsIamRoleId(value, valuePath = 'iamRoleId') {
  if (typeof value !== 'string' || !AWS_IAM_ROLE_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be a 16-128 character AWS IAM RoleId beginning with AROA followed by uppercase alphanumeric characters.`,
    );
  }
}

/**
 * @param {unknown} value - Candidate immutable EC2 instance ID.
 * @param {string} [valuePath] - Human-readable value path.
 * @returns {void} - Throws unless this is one current long-format instance ID.
 */
export function assertAwsEc2InstanceId(value, valuePath = 'instanceId') {
  if (typeof value !== 'string' || !AWS_EC2_INSTANCE_ID_PATTERN.test(value)) {
    throw new TypeError(
      `${valuePath} must be a lowercase long-format AWS EC2 instance ID.`,
    );
  }
}

export default {
  AWS_EC2_INSTANCE_ID_PATTERN,
  AWS_IAM_ROLE_ID_PATTERN,
  assertAwsEc2InstanceId,
  assertAwsIamRoleId,
};
