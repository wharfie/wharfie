'use strict';
const AWS = require('@aws-sdk/client-cloudformation');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const S3 = require('../s3');
const BaseAWS = require('../base');

/**
 * @typedef CloudformationTemplate
 * @property {string} AWSTemplateFormatVersion -
 * @property {any} Metadata -
 * @property {any} Parameters -
 * @property {any} Mappings -
 * @property {any} Resources -
 * @property {any} Outputs -
 */

class CloudFormation {
  /**
   * @param {import("@aws-sdk/client-cloudformation").CloudFormationClientConfig} options - CloudFormation sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.cloudformation = new AWS.CloudFormation({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
    this.s3 = new S3(options);
    this.TEMPLATE_BUCKET = process.env.TEMPLATE_BUCKET || '';
    this.WAITER_MAX_WAIT_TIME_CONFIG = 600;
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").DescribeStackResourcesCommandInput} params - CloudFormation describeStackResources params
   * @returns {Promise<import("@aws-sdk/client-cloudformation").DescribeStackResourcesCommandOutput>} -
   */
  async describeStackResources(params) {
    return await this.cloudformation.send(
      new AWS.DescribeStackResourcesCommand(params)
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").DescribeStackEventsInput} params -
   * @returns {Promise<string | undefined>} -
   */
  async getFailureReason(params) {
    const events = [];

    let response = await this.cloudformation.send(
      new AWS.DescribeStackEventsCommand(params)
    );

    events.push(...(response.StackEvents || []));
    while (response.NextToken) {
      params.NextToken = response.NextToken;
      response = await this.cloudformation.send(
        new AWS.DescribeStackEventsCommand(params)
      );
      events.push(...(response.StackEvents || []));
    }

    /** @type {import("@aws-sdk/client-cloudformation").StackEvent | undefined} */
    let failureEvent;
    events
      .filter(({ ResourceStatus }) => (ResourceStatus || '').match(/FAILED/))
      .forEach((event) => {
        if (
          (event.Timestamp || new Date()) <=
          ((failureEvent || {}).Timestamp || new Date())
        ) {
          failureEvent = event;
        }
      });
    if (!failureEvent)
      throw Error(
        'unable to find failure reason for stack ' + params.StackName
      );
    return failureEvent.ResourceStatusReason;
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").CreateStackInput} params - CloudFormation CreateStack params
   */
  async createStack(params) {
    const key = `wharfie-templates/${params.StackName}-${Math.random()
      .toString(36)
      .substring(2, 15)}.json`;
    await this.s3.putObject({
      Bucket: this.TEMPLATE_BUCKET,
      Key: key,
      Body: params.TemplateBody,
    });
    const _params = Object.assign({}, params);
    delete _params.TemplateBody;
    const result = await this.cloudformation.send(
      new AWS.CreateStackCommand({
        ..._params,
        TemplateURL: `https://${this.TEMPLATE_BUCKET}.s3.amazonaws.com/${key}`,
      })
    );
    const StackId = result.StackId;
    try {
      await AWS.waitUntilStackCreateComplete(
        {
          client: this.cloudformation,
          maxWaitTime: this.WAITER_MAX_WAIT_TIME_CONFIG,
        },
        {
          StackName: StackId,
        }
      );
    } catch (err) {
      const reason = await this.getFailureReason({
        StackName: StackId,
      });
      throw new Error(reason);
    }
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").UpdateStackInput} params - CloudFormation UpdateStack params
   */
  async updateStack(params) {
    const key = `wharfie-templates/${params.StackName}-${Math.random()
      .toString(36)
      .substring(2, 15)}.json`;
    await this.s3.putObject({
      Bucket: this.TEMPLATE_BUCKET,
      Key: key,
      Body: params.TemplateBody,
    });
    let StackId;
    try {
      const _params = Object.assign({}, params);
      delete _params.TemplateBody;
      const result = await this.cloudformation.send(
        new AWS.UpdateStackCommand({
          ..._params,
          TemplateURL: `https://${this.TEMPLATE_BUCKET}.s3.amazonaws.com/${key}`,
        })
      );
      StackId = result.StackId;
    } catch (err) {
      // @ts-ignore
      if (err.message && err.message.includes('No updates are to be performed'))
        return;
      throw err;
    }
    try {
      await AWS.waitUntilStackUpdateComplete(
        {
          client: this.cloudformation,
          maxWaitTime: this.WAITER_MAX_WAIT_TIME_CONFIG,
        },
        {
          StackName: StackId,
        }
      );
    } catch (err) {
      const reason = await this.getFailureReason({
        StackName: StackId,
      });
      throw new Error(reason);
    }
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").DeleteStackInput} params - CloudFormation DeleteStack params
   */
  async deleteStack(params) {
    await this.cloudformation.send(new AWS.DeleteStackCommand(params));
    try {
      await AWS.waitUntilStackDeleteComplete(
        {
          client: this.cloudformation,
          maxWaitTime: this.WAITER_MAX_WAIT_TIME_CONFIG,
        },
        {
          StackName: params.StackName,
        }
      );
    } catch (err) {
      const reason = await this.getFailureReason({
        StackName: params.StackName,
      });
      throw new Error(reason);
    }
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").GetTemplateInput} params - CloudFormation getTemplate params
   * @returns {Promise<import("@aws-sdk/client-cloudformation").GetTemplateOutput>} -
   */
  async getTemplate(params) {
    return await this.cloudformation.send(new AWS.GetTemplateCommand(params));
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").DescribeStacksInput} params - CloudFormation getTemplate params
   * @returns {Promise<import("@aws-sdk/client-cloudformation").DescribeStacksOutput>} -
   */
  async DescribeStacks(params) {
    return await this.cloudformation.send(
      new AWS.DescribeStacksCommand(params)
    );
  }
}

module.exports = CloudFormation;
