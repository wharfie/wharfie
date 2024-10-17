'use strict';
const { ResourceNotFoundException, RuleState } = jest.requireActual(
  '@aws-sdk/client-cloudwatch-events'
);

class CloudWatchEventsMock {
  __setMockState(state = { Rules: {}, Tags: {} }) {
    CloudWatchEventsMock.__state = state;
  }

  __getMockState() {
    return CloudWatchEventsMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'ListTargetsByRuleCommand':
        return await this.listTargetsByRule(command.input);
      case 'PutTargetsCommand':
        return await this.putTargets(command.input);
      case 'RemoveTargetsCommand':
        return await this.removeTargets(command.input);
      case 'DescribeRuleCommand':
        return await this.describeRule(command.input);
      case 'EnableRuleCommand':
        return await this.enableRule(command.input);
      case 'DisableRuleCommand':
        return await this.disableRule(command.input);
      case 'PutRuleCommand':
        return await this.putRule(command.input);
      case 'DeleteRuleCommand':
        return await this.deleteRule(command.input);
      case 'ListTagsForResourceCommand':
        return await this.listTagsForResource(command.input);
      case 'TagResourceCommand':
        return await this.tagResource(command.input);
      case 'UntagResourceCommand':
        return await this.untagResource(command.input);
    }
  }

  async listTargetsByRule(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Rule]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    const Targets =
      CloudWatchEventsMock.__state.Rules[params.Rule].Targets || [];
    return {
      Targets,
    };
  }

  async putTargets(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Rule]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    CloudWatchEventsMock.__state.Rules[params.Rule].Targets = params.Targets;
  }

  async removeTargets(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Rule]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    CloudWatchEventsMock.__state.Rules[params.Rule].Targets =
      CloudWatchEventsMock.__state.Rules[params.Rule].Targets.filter(
        (target) => !params.Ids.includes(target.Id)
      );
  }

  async describeRule(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Name]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    return CloudWatchEventsMock.__state.Rules[params.Name];
  }

  async enableRule(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Name]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    CloudWatchEventsMock.__state.Rules[params.Name].State = RuleState.ENABLED;
  }

  async disableRule(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Name]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    CloudWatchEventsMock.__state.Rules[params.Name].State = RuleState.DISABLED;
  }

  async putRule(params) {
    if (CloudWatchEventsMock.__state.Rules[params.Name]) {
      throw new Error('Rule already exists');
    }
    const RuleArn = `arn:aws:events:us-east-1:123456789012:rule/${params.Name}`;
    CloudWatchEventsMock.__state.Rules[params.Name] = {
      ...params,
      Arn: RuleArn,
      Targets: [],
    };
    return {
      RuleArn,
    };
  }

  async deleteRule(params) {
    if (!CloudWatchEventsMock.__state.Rules[params.Name]) {
      throw new ResourceNotFoundException({
        message: 'Rule not found',
      });
    }
    delete CloudWatchEventsMock.__state.Rules[params.Name];
  }

  async listTagsForResource(params) {
    if (!CloudWatchEventsMock.__state.Tags[params.ResourceARN]) {
      return [];
    }
    return CloudWatchEventsMock.__state.Tags[params.ResourceARN];
  }

  async tagResource(params) {
    if (!CloudWatchEventsMock.__state.Tags[params.ResourceARN]) {
      CloudWatchEventsMock.__state.Tags[params.ResourceARN] = [];
    }

    CloudWatchEventsMock.__state.Tags[params.ResourceARN] = [
      ...CloudWatchEventsMock.__state.Tags[params.ResourceARN],
      ...params.Tags,
    ];
  }

  async untagResource(params) {
    CloudWatchEventsMock.__state.Tags[params.ResourceARN] =
      CloudWatchEventsMock.__state.Tags[params.ResourceARN].filter(
        (tag) => !params.TagKeys.includes(tag.Key)
      );
  }
}

CloudWatchEventsMock.__state = {
  Rules: {},
  Tags: {},
};

module.exports = CloudWatchEventsMock;
