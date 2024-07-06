'use strict';

const { NoSuchEntityException } = jest.requireActual('@aws-sdk/client-iam');

class IAMMock {
  __setMockState(
    iamState = {
      roles: {},
      policies: {},
    }
  ) {
    IAMMock.__state = iamState;
  }

  __getMockState() {
    return IAMMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'GetRoleCommand':
        return await this.getRole(command.input);
      case 'GetPolicyCommand':
        return await this.getPolicy(command.input);
      case 'CreatePolicyCommand':
        return await this.createPolicy(command.input);
      case 'ListEntitiesForPolicyCommand':
        return await this.listEntitiesForPolicy(command.input);
      case 'DeletePolicyCommand':
        return await this.deletePolicy(command.input);
      case 'CreateRoleCommand':
        return await this.createRole(command.input);
      case 'PutRolePolicyCommand':
        return await this.putRolePolicy(command.input);
      case 'AttachRolePolicyCommand':
        return await this.attachRolePolicy(command.input);
      case 'ListAttachedRolePoliciesCommand':
        return await this.listAttachedRolePolicies(command.input);
      case 'DetachRolePolicyCommand':
        return await this.detachRolePolicy(command.input);
      case 'ListRolePoliciesCommand':
        return await this.listRolePolicies(command.input);
      case 'DeleteRolePolicyCommand':
        return await this.deleteRolePolicy(command.input);
      case 'DeleteRoleCommand':
        return await this.deleteRole(command.input);
    }
  }

  async getRole(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });
    return {
      Role: IAMMock.__state.roles[params.RoleName],
    };
  }

  async getPolicy(params) {
    const policyName = params.PolicyArn.split('/').pop();
    if (!IAMMock.__state.policies[policyName])
      throw new NoSuchEntityException({
        message: `policy ${policyName} does not exist`,
      });
    return {
      Policy: IAMMock.__state.policies[policyName],
    };
  }

  async createPolicy(params) {
    if (IAMMock.__state.policies[params.PolicyName])
      throw new Error('policy already exists');
    IAMMock.__state.policies[params.PolicyName] = {
      Arn: params.PolicyName,
      PolicyName: params.PolicyName,
      PolicyDocument: params.PolicyDocument,
      Description: params.Description,
    };
    return {
      Policy: IAMMock.__state.policies[params.PolicyName],
    };
  }

  async listEntitiesForPolicy(params) {
    const policyName = params.PolicyArn.split('/').pop();
    if (!IAMMock.__state.policies[policyName])
      throw new NoSuchEntityException({
        message: `policy ${policyName} does not exist`,
      });
    const policyRoles = Object.values(IAMMock.__state.roles).filter(
      (role) =>
        role.AttachedPolicies.find(
          (policy) => policy.PolicyName === policyName
        ) !== undefined
    );

    return {
      PolicyRoles: policyRoles,
    };
  }

  async deletePolicy(params) {
    const policyName = params.PolicyArn.split('/').pop();
    if (!IAMMock.__state.policies[policyName])
      throw new NoSuchEntityException({
        message: `policy ${policyName} does not exist`,
      });
    if ((await this.listEntitiesForPolicy(params)).PolicyRoles.length > 0)
      throw new Error('policy is attached to a role');
    delete IAMMock.__state.policies[policyName];
  }

  async createRole(params) {
    if (IAMMock.__state.roles[params.RoleName])
      throw new Error('role already exists');
    IAMMock.__state.roles[params.RoleName] = {
      Arn: `arn:aws:iam::123456789012:role/${params.RoleName}`,
      RoleName: params.RoleName,
      AssumeRolePolicyDocument: params.AssumeRolePolicyDocument,
      Policies: [],
      AttachedPolicies: [],
      Description: params.Description,
    };
    return {
      Role: IAMMock.__state.roles[params.RoleName],
    };
  }

  async putRolePolicy(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });
    IAMMock.__state.roles[params.RoleName].Policies.push({
      PolicyName: params.PolicyName,
      PolicyDocument: params.PolicyDocument,
    });
  }

  async attachRolePolicy(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });
    if (!IAMMock.__state.policies[params.PolicyArn])
      throw new NoSuchEntityException({
        message: `policy ${params.PolicyArn} does not exist`,
      });
    IAMMock.__state.roles[params.RoleName].AttachedPolicies.push(
      params.PolicyArn
    );
  }

  async listAttachedRolePolicies(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });
    return {
      AttachedPolicies: IAMMock.__state.roles[
        params.RoleName
      ].AttachedPolicies.map((policyArn) => {
        return {
          PolicyArn: policyArn,
        };
      }),
    };
  }

  async detachRolePolicy(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });

    IAMMock.__state.roles[params.RoleName].AttachedPolicies =
      IAMMock.__state.roles[params.RoleName].AttachedPolicies.filter(
        (policyArn) => {
          return policyArn !== params.PolicyArn;
        }
      );
  }

  async listRolePolicies(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });
    return {
      PolicyNames: IAMMock.__state.roles[params.RoleName].Policies.map(
        (policy) => policy.PolicyName
      ),
    };
  }

  async deleteRolePolicy(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });

    IAMMock.__state.roles[params.RoleName].Policies = IAMMock.__state.roles[
      params.RoleName
    ].Policies.filter((policy) => {
      return policy.PolicyName !== params.PolicyName;
    });
  }

  async deleteRole(params) {
    if (!IAMMock.__state.roles[params.RoleName])
      throw new NoSuchEntityException({
        message: `role ${params.RoleName} does not exist`,
      });
    if (IAMMock.__state.roles[params.RoleName].Policies.length !== 0)
      throw new Error('policies on role');
    if (IAMMock.__state.roles[params.RoleName].AttachedPolicies.length !== 0)
      throw new Error('attached policies on role');

    delete IAMMock.__state.roles[params.RoleName];
  }
}

IAMMock.__state = {
  roles: {},
  policies: {},
};

module.exports = IAMMock;
