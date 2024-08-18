'use strict';
const AWS = require('@aws-sdk/client-cloudformation');
const { fromNodeProviderChain } = require('@aws-sdk/credential-providers');
const S3 = require('../s3');
const BaseAWS = require('../base');
const { Readable } = require('stream');

/**
 * @typedef CloudformationTemplate
 * @property {string} AWSTemplateFormatVersion -
 * @property {any} Metadata -
 * @property {any} Parameters -
 * @property {any} Mappings -
 * @property {any} Resources -
 * @property {any} Outputs -
 */

/**
 * @typedef wharfieCloudformationClientAdditionalConfig
 * @property {string} artifact_bucket - name of the s3 bucket to use for cloudformation template artifacts
 */

class CloudFormation {
  /**
   * @param {import("@aws-sdk/client-cloudformation").CloudFormationClientConfig} options - CloudFormation sdk options
   * @param {wharfieCloudformationClientAdditionalConfig} wharfie_options -
   */
  constructor(
    options,
    wharfie_options = {
      artifact_bucket:
        process.env.WHARFIE_ARTIFACT_BUCKET ||
        process.env.WHARFIE_SERVICE_BUCKET ||
        '',
    }
  ) {
    const credentials = fromNodeProviderChain();
    this.cloudformation = new AWS.CloudFormation({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
    this.s3 = new S3(S3.formatClientOptions(options));
    this.artifact_bucket = wharfie_options.artifact_bucket;
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
      .filter(
        ({ ResourceStatus, ResourceStatusReason }) =>
          ResourceStatusReason && (ResourceStatus || '').match(/FAILED/)
      )
      .forEach((event) => {
        if (
          (event.Timestamp || new Date()) <=
          ((failureEvent || {}).Timestamp || new Date())
        ) {
          failureEvent = event;
        }
      });
    if (failureEvent) return failureEvent.ResourceStatusReason;
    /** @type {import("@aws-sdk/client-cloudformation").StackEvent | undefined} */
    let rollbackEvent;
    events
      .filter(
        ({ ResourceStatus, ResourceStatusReason }) =>
          ResourceStatusReason && (ResourceStatus || '').match(/ROLLBACK/)
      )
      .forEach((event) => {
        if (
          (event.Timestamp || new Date()) <=
          ((failureEvent || {}).Timestamp || new Date())
        ) {
          rollbackEvent = event;
        }
      });
    if (rollbackEvent) return rollbackEvent.ResourceStatusReason;
    return undefined;
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").CreateStackInput} params - CloudFormation CreateStack params
   */
  async createStack(params) {
    const key = `wharfie-templates/${params.StackName}-${Math.random()
      .toString(36)
      .substring(2, 15)}.json`;
    if (!params.TemplateBody) throw new Error('TemplateBody is required');
    await this.s3.putObject({
      Bucket: this.artifact_bucket,
      Key: key,
      Body: Readable.from(params.TemplateBody),
      ContentLength: params.TemplateBody.length,
    });
    const _params = Object.assign({}, params);
    delete _params.TemplateBody;
    const result = await this.cloudformation.send(
      new AWS.CreateStackCommand({
        ..._params,
        TemplateURL: `https://${this.artifact_bucket}.s3.amazonaws.com/${key}`,
      })
    );
    const StackId = result.StackId;
    const { StackError } = await this.waitForStackStatus({
      StackName: StackId || '',
      StackStatus: 'CREATE_COMPLETE',
    });
    if (StackError) {
      throw new Error(StackError);
    }
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").UpdateStackInput} params - CloudFormation UpdateStack params
   */
  async updateStack(params) {
    const key = `wharfie-templates/${params.StackName}-${Math.random()
      .toString(36)
      .substring(2, 15)}.json`;
    if (!params.TemplateBody) throw new Error('TemplateBody is required');
    await this.s3.putObject({
      Bucket: this.artifact_bucket,
      Key: key,
      Body: Readable.from(params.TemplateBody),
      ContentLength: params.TemplateBody.length,
    });
    let StackId;
    try {
      const _params = Object.assign({}, params);
      delete _params.TemplateBody;
      const result = await this.cloudformation.send(
        new AWS.UpdateStackCommand({
          ..._params,
          TemplateURL: `https://${this.artifact_bucket}.s3.amazonaws.com/${key}`,
        })
      );
      StackId = result.StackId;
    } catch (err) {
      // @ts-ignore
      if (err.message && err.message.includes('No updates are to be performed'))
        return;
      throw err;
    }
    const { StackError } = await this.waitForStackStatus({
      StackName: StackId || '',
      StackStatus: 'UPDATE_COMPLETE',
    });
    if (StackError) {
      throw new Error(StackError);
    }
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").DeleteStackInput} params - CloudFormation DeleteStack params
   */
  async deleteStack(params) {
    await this.cloudformation.send(new AWS.DeleteStackCommand(params));

    const { StackError } = await this.waitForStackStatus({
      StackName: params.StackName || '',
      StackStatus: 'DELETE_COMPLETE',
    });
    if (StackError) {
      throw new Error(StackError);
    }
  }

  /**
   * @typedef waitForStackStatusInput
   * @property {string} StackName -
   * @property {string} StackStatus -
   */

  /**
   * @typedef waitForStackStatusOuput
   * @property {string} [StackError] -
   */

  /**
   * @param {waitForStackStatusInput} params - name of the stack to wait for
   * @returns {Promise<waitForStackStatusOuput>} -
   */
  async waitForStackStatus(params) {
    while (true) {
      let Stack;
      try {
        const { Stacks } = await this.describeStacks({
          StackName: params.StackName,
        });
        Stack = Stacks?.[0];
      } catch (err) {
        if (
          // @ts-ignore
          err.message.includes('does not exist') &&
          params.StackStatus === 'DELETE_COMPLETE'
        ) {
          // cloudformation eventually expires deleted stacks so missing stacks can count as deleted
          return {};
        }
        throw err;
      }
      if (Stack?.StackStatus === params.StackStatus) {
        return {};
      }

      switch (Stack?.StackStatus) {
        case 'CREATE_IN_PROGRESS':
        case 'UPDATE_IN_PROGRESS':
        case 'UPDATE_COMPLETE_CLEANUP_IN_PROGRESS':
        case 'UPDATE_ROLLBACK_IN_PROGRESS':
        case 'ROLLBACK_IN_PROGRESS':
        case 'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS':
        case 'REVIEW_IN_PROGRESS':
        case 'IMPORT_IN_PROGRESS':
        case 'IMPORT_ROLLBACK_IN_PROGRESS':
        case 'DELETE_IN_PROGRESS':
          break;
        case 'CREATE_COMPLETE':
        case 'UPDATE_COMPLETE':
        case 'UPDATE_ROLLBACK_COMPLETE':
        case 'IMPORT_ROLLBACK_COMPLETE':
        case 'DELETE_COMPLETE':
        case 'ROLLBACK_COMPLETE':
        case 'IMPORT_COMPLETE': {
          const failureReason = await this.getFailureReason({
            StackName: params.StackName,
          });
          if (failureReason) {
            return {
              StackError: failureReason,
            };
          }
          return {
            StackError:
              Stack?.StackStatusReason ||
              'failed for unknown reason, check cloudformation console for more details',
          };
        }
        case 'CREATE_FAILED':
        case 'ROLLBACK_FAILED':
        case 'DELETE_FAILED':
        case 'UPDATE_ROLLBACK_FAILED':
        case 'IMPORT_ROLLBACK_FAILED': {
          const failureReason = await this.getFailureReason({
            StackName: params.StackName,
          });
          if (failureReason) {
            return {
              StackError: failureReason,
            };
          }
          return {
            StackError:
              Stack?.StackStatusReason ||
              'failed for unknown reason, check cloudformation console for more details',
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
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
   * @param {import("@aws-sdk/client-cloudformation").DescribeStacksInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudformation").DescribeStacksOutput>} -
   */
  async describeStacks(params) {
    return await this.cloudformation.send(
      new AWS.DescribeStacksCommand(params)
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").CreateChangeSetCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudformation").CreateChangeSetCommandOutput>} -
   * @todo unused
   */
  async createChangeSet(params) {
    return await this.cloudformation.send(
      new AWS.CreateChangeSetCommand(params)
    );
  }

  /**
   * @param {import("@aws-sdk/client-cloudformation").DescribeChangeSetCommandInput} params -
   * @returns {Promise<import("@aws-sdk/client-cloudformation").DescribeChangeSetCommandOutput>} -
   * @todo unused
   */
  async describeChangeSet(params) {
    return await this.cloudformation.send(
      new AWS.DescribeChangeSetCommand(params)
    );
  }
  /**
   * @typedef waitForChangesetStatusInput
   * @property {string} ChangesetName -
   * @property {string} ChangesetStatus -
   * @todo unused
   */

  /**
   * @typedef waitForChangesetStatusOuput
   * @property {string} [ChangesetError] -
   * @todo unused
   */

  /**
   * @param {waitForChangesetStatusInput} params - name of the changeset to wait for
   * @returns {Promise<waitForChangesetStatusOuput>} -
   * @todo unused
   */
  async waitForChangesetStatus(params) {
    while (true) {
      let changeset;
      try {
        changeset = await this.describeChangeSet({
          ChangeSetName: params.ChangesetName,
        });
      } catch (err) {
        if (
          // @ts-ignore
          err.message.includes('does not exist') &&
          params.ChangesetStatus === 'DELETE_COMPLETE'
        ) {
          // cloudformation eventually expires deleted changesets so missing changesets can count as deleted
          return {};
        }
        throw err;
      }
      if (changeset.Status === params.ChangesetStatus) {
        return {};
      }
      switch (changeset.Status) {
        case 'CREATE_PENDING':
        case 'CREATE_IN_PROGRESS':
        case 'DELETE_PENDING':
        case 'DELETE_IN_PROGRESS':
          break;
        case 'CREATE_COMPLETE':
        case 'DELETE_COMPLETE': {
          return {
            ChangesetError:
              changeset.StatusReason ||
              'failed for unknown reason, check cloudformation console for more details',
          };
        }
        case 'DELETE_FAILED':
        case 'FAILED': {
          return {
            ChangesetError:
              changeset.StatusReason ||
              'failed for unknown reason, check cloudformation console for more details',
          };
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

module.exports = CloudFormation;
