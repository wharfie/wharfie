'use strict';

class STSMock {
  constructor() {
    this.config = {
      region: async () => 'us-west-2',
    };
  }

  __setMockState(stsState = {}) {
    STSMock.__state = stsState;
  }

  __getMockState() {
    return STSMock.__state;
  }

  async send(command) {
    switch (command.constructor.name) {
      case 'AssumeRoleCommand':
        return await this.assumeRole(command.input);
      case 'GetCallerIdentityCommand':
        return await this.getCallerIdentity(command.input);
      case 'GetDefaultRoleAssumerCommand':
        return await this.getDefaultRoleAssumer(command.input);
    }
  }

  async assumeRole(params) {
    if (!params.RoleArn || !params.RoleSessionName)
      throw new Error('Invalid STS assumeRole params');
    if (!STSMock.__state[params.RoleArn]) STSMock.__state[params.RoleArn] = [];
    STSMock.__state[params.RoleArn].push(params.RoleSessionName);
    return {
      Credentials: {
        AccessKeyId: '123',
        SecretAccessKey: '123',
        SessionToken: '123',
        Expiration: new Date(),
      },
    };
  }

  async getDefaultRoleAssumer() {
    return () => ({
      identityProperties: {
        accessKeyId: '123',
        secretAccessKey: '123',
        sessionToken: '123',
      },
    });
  }

  async getCallerIdentity() {
    return {
      UserId: '',
      Account: '',
      Arn: '',
    };
  }
}

/** @type {Object<string, string[]>} */
STSMock.__state = {};

module.exports = STSMock;
