import { STS as _STS, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';

import BaseAWS from './base.js';

// TODO implement auto-refresh using https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/Credentials.html
class STS {
  /**
   * @param {import("@aws-sdk/client-sts").STSClientConfig} [options] - STS sdk options
   */
  constructor(options) {
    const credentials = fromNodeProviderChain();
    this.sts = new _STS({
      ...BaseAWS.config(),
      credentials,
      ...options,
    });
  }

  /**
   * @typedef Credentials
   * @property {string} accessKeyId - The access key ID that identifies the temporary security credentials.
   * @property {string} secretAccessKey - The secret access key that can be used to sign requests.
   * @property {string} sessionToken - The token that users must pass to the service API to use the temporary credentials.
   * @param {string} RoleArn - The Amazon Resource Name (ARN) of the role to assume.
   * @returns {Promise<Credentials>} - STS assumeRole credentials
   */
  async getCredentials(RoleArn) {
    const active_session = STS._sessions[RoleArn];
    if (
      active_session &&
      active_session.expiration > new Date().getTime() + 1000 * 60 * 15
    ) {
      return active_session.credentials;
    }
    const timestamp = new Date().getTime();
    const params = {
      RoleArn,
      RoleSessionName: `wharfie-${timestamp}`,
    };
    const command = new AssumeRoleCommand(params);
    const data = await this.sts.send(command);
    if (
      !data ||
      !data.Credentials ||
      !data.Credentials.Expiration ||
      !data.Credentials.AccessKeyId ||
      !data.Credentials.SecretAccessKey ||
      !data.Credentials.SessionToken
    )
      throw new Error(`Failed to STS AssumeRole with params ${params}`);

    const credentials = {
      accessKeyId: data.Credentials.AccessKeyId,
      secretAccessKey: data.Credentials.SecretAccessKey,
      sessionToken: data.Credentials.SessionToken,
    };
    STS._sessions[RoleArn] = {
      expiration: data.Credentials.Expiration.getTime(),
      credentials,
    };
    return credentials;
  }

  /**
   * @returns {Promise<import("@aws-sdk/client-sts").GetCallerIdentityCommandOutput>} - STS getCallerIdentity output
   */
  async getCallerIdentity() {
    return await this.sts.getCallerIdentity({});
  }

  /**
   * @param {import("@aws-sdk/client-sts").AssumeRoleCommandInput} params - STS assumeRole params
   * @returns {Promise<import("@aws-sdk/client-sts").AssumeRoleCommandOutput>} - STS assumeRole output
   */
  async assumeRole(params) {
    const command = new AssumeRoleCommand(params);
    return await this.sts.send(command);
  }
}
/**
 * @typedef CachedCredentials
 * @property {number} expiration - expiration.
 * @property {Credentials} credentials - credentials.
 */
/** @type {Object<string, CachedCredentials>} */
STS._sessions = {};

export default STS;
