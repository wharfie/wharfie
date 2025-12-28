import { jest } from '@jest/globals';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { ResourceNotFoundException, ObjectNotFoundException } =
  jest.requireActual('@aws-sdk/client-application-auto-scaling');

class ApplicationAutoScalingMock {
  __setMockState(
    applicationAutoScalingState = {
      targets: [],
      policies: [],
      tags: {},
    },
  ) {
    ApplicationAutoScalingMock.__state = applicationAutoScalingState;
  }

  __getMockState() {
    return ApplicationAutoScalingMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'DescribeScalableTargetsCommand':
        return await this.describeScalableTargets(command.input);
      case 'RegisterScalableTargetCommand':
        return await this.registerScalableTarget(command.input);
      case 'DeregisterScalableTargetCommand':
        return await this.deregisterScalableTarget(command.input);
      case 'DescribeScalingPoliciesCommand':
        return await this.describeScalingPolicies(command.input);
      case 'PutScalingPolicyCommand':
        return await this.putScalingPolicy(command.input);
      case 'DeleteScalingPolicyCommand':
        return await this.deleteScalingPolicy(command.input);
      case 'UntagResourceCommand':
        return await this.untagResource(command.input);
      case 'TagResourceCommand':
        return await this.tagResource(command.input);
      case 'ListTagsForResourceCommand':
        return await this.listTagsForResource(command.input);
    }
  }

  async untagResource(params) {
    const { ResourceARN, TagKeys } = params;
    const tags = ApplicationAutoScalingMock.__state.tags[ResourceARN];
    if (!tags) {
      throw new ObjectNotFoundException({
        message: `Resource with ARN ${ResourceARN} not found.`,
      });
    }
    const newTags = tags.filter((tag) => !TagKeys.includes(tag.Key));
    ApplicationAutoScalingMock.__state.tags[ResourceARN] = newTags;
  }

  async tagResource(params) {
    const { ResourceARN, Tags } = params;
    const tags = ApplicationAutoScalingMock.__state.tags[ResourceARN];
    if (!tags) {
      throw new ObjectNotFoundException({
        message: `Resource with ARN ${ResourceARN} not found.`,
      });
    }
    ApplicationAutoScalingMock.__state.tags[ResourceARN] = [
      ...tags,
      ...Object.keys(Tags).map((key) => ({ Key: key, Value: Tags[key] })),
    ];
  }

  async listTagsForResource(params) {
    const { ResourceARN } = params;
    const tags = ApplicationAutoScalingMock.__state.tags[ResourceARN];
    if (!tags) {
      throw new ObjectNotFoundException({
        message: `Resource with ARN ${ResourceARN} not found.`,
      });
    }
    return {
      Tags: tags.reduce((acc, tag) => {
        acc[tag.key] = tag.value;
        return acc;
      }, {}),
    };
  }

  async describeScalableTargets(params) {
    const { ResourceIds, ServiceNamespace, ScalableDimension } = params;
    const targets = ApplicationAutoScalingMock.__state.targets.filter(
      (target) =>
        target.ResourceId.includes(ResourceIds[0]) &&
        target.ServiceNamespace === ServiceNamespace &&
        target.ScalableDimension === ScalableDimension,
    );
    return {
      ScalableTargets: targets,
    };
  }

  async registerScalableTarget(params) {
    const targetARN = `arn:aws:autoscaling:${params.ServiceNamespace}:${params.ScalableDimension}:target/${params.ResourceId}`;
    ApplicationAutoScalingMock.__state.targets.push({
      ...params,
      ScalableTargetARN: targetARN,
    });
    ApplicationAutoScalingMock.__state.tags[targetARN] = [];
    return {
      ScalableTargetARN: targetARN,
    };
  }

  async deregisterScalableTarget(params) {
    const targetARN = `arn:aws:autoscaling:${params.ServiceNamespace}:${params.ScalableDimension}:target/${params.ResourceId}`;
    const { ResourceId, ScalableDimension, ServiceNamespace } = params;
    const targetIndex = ApplicationAutoScalingMock.__state.targets.findIndex(
      (target) =>
        target.ResourceId === ResourceId &&
        target.ScalableDimension === ScalableDimension &&
        target.ServiceNamespace === ServiceNamespace,
    );
    if (targetIndex === -1) {
      throw new ResourceNotFoundException({
        message: 'The specified resource could not be found.',
      });
    }
    ApplicationAutoScalingMock.__state.targets.splice(targetIndex, 1);
    delete ApplicationAutoScalingMock.__state.tags[targetARN];
  }

  async describeScalingPolicies(params) {
    const { PolicyNames, ServiceNamespace, ResourceId, ScalableDimension } =
      params;
    const policies = ApplicationAutoScalingMock.__state.policies.filter(
      (policy) =>
        PolicyNames.includes(policy.PolicyName) &&
        policy.ServiceNamespace === ServiceNamespace &&
        policy.ResourceId === ResourceId &&
        policy.ScalableDimension === ScalableDimension,
    );
    return {
      ScalingPolicies: policies,
    };
  }

  async putScalingPolicy(params) {
    const { PolicyName, ServiceNamespace, ResourceId, ScalableDimension } =
      params;
    const policyIndex = ApplicationAutoScalingMock.__state.policies.findIndex(
      (policy) =>
        policy.PolicyName === PolicyName &&
        policy.ServiceNamespace === ServiceNamespace &&
        policy.ResourceId === ResourceId &&
        policy.ScalableDimension === ScalableDimension,
    );
    if (policyIndex === -1) {
      ApplicationAutoScalingMock.__state.policies.push(params);
    } else {
      ApplicationAutoScalingMock.__state.policies[policyIndex] = params;
    }
  }

  async deleteScalingPolicy(params) {
    const { PolicyName, ServiceNamespace, ResourceId, ScalableDimension } =
      params;
    const policyIndex = ApplicationAutoScalingMock.__state.policies.findIndex(
      (policy) =>
        policy.PolicyName === PolicyName &&
        policy.ServiceNamespace === ServiceNamespace &&
        policy.ResourceId === ResourceId &&
        policy.ScalableDimension === ScalableDimension,
    );
    if (policyIndex === -1) {
      throw new ObjectNotFoundException({
        message: 'The specified object could not be found.',
      });
    }
    ApplicationAutoScalingMock.__state.policies.splice(policyIndex, 1);
  }
}

/** @type {Object<string, string[]>} */
ApplicationAutoScalingMock.__state = {
  targets: [],
  policies: [],
  tags: {},
};

module.exports = ApplicationAutoScalingMock;
