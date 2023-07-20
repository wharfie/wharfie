'use strict';

/**
 * @returns {object} Credentials
 */
function fromNodeProviderChain() {
  return {
    CredentialProvider: {
      AccessKeyId: '123',
      SecretAccessKey: '123',
      SessionToken: '123',
      Expiration: new Date(),
    },
  };
}

module.exports = {
  fromNodeProviderChain,
};
