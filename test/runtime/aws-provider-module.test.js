/* eslint-env jest */

import * as providerNamespace from '@wharfie/aws';

import {
  AWS_PROVIDER_CONTRACT_VERSION,
  AWS_PROVIDER_PACKAGE_VERSION,
  AwsProviderUnavailableError,
  classifyAwsProviderImportFailure,
  getRegisteredAwsProviderBindings,
  registerAwsProviderModule,
  validateAwsProviderModule,
} from '../../src/core/runtime/aws-provider-module.js';

const INCOMPATIBLE_MESSAGE =
  "AWS deployment support is incompatible. Install matching '@wharfie/aws@0.0.15' and '@wharfie/wharfie@0.0.15' packages and retry.";
const MISSING_MESSAGE =
  "AWS deployment support is not installed. Install '@wharfie/aws@0.0.15' next to '@wharfie/wharfie@0.0.15' and retry.";

/** @returns {ReturnType<typeof providerNamespace.getAwsSdkBindings>} */
function actualBindings() {
  return providerNamespace.getAwsSdkBindings();
}

/** @param {Record<string, any>} replacements @returns {Record<string, any>} */
function providerWith(replacements = {}) {
  return {
    WHARFIE_AWS_PROVIDER_PACKAGE_VERSION: AWS_PROVIDER_PACKAGE_VERSION,
    WHARFIE_AWS_PROVIDER_CONTRACT_VERSION: AWS_PROVIDER_CONTRACT_VERSION,
    getAwsSdkBindings: actualBindings,
    ...replacements,
  };
}

/** @param {string} message @returns {Error & {code: string}} */
function moduleNotFound(message) {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('AWS provider module boundary', () => {
  test('accepts and registers the exact fixed provider surface', () => {
    const bindings = actualBindings();

    expect(validateAwsProviderModule(providerNamespace)).toBe(bindings);
    expect(registerAwsProviderModule(providerNamespace)).toBe(bindings);
    expect(getRegisteredAwsProviderBindings()).toBe(bindings);
  });

  test.each([
    ['missing namespace', undefined],
    [
      'wrong package version',
      providerWith({ WHARFIE_AWS_PROVIDER_PACKAGE_VERSION: '0.0.14' }),
    ],
    [
      'wrong contract',
      providerWith({ WHARFIE_AWS_PROVIDER_CONTRACT_VERSION: 2 }),
    ],
    [
      'mutable bindings',
      providerWith({
        getAwsSdkBindings: () => ({ ...actualBindings() }),
      }),
    ],
    [
      'extra binding',
      providerWith({
        getAwsSdkBindings: () =>
          Object.freeze({ ...actualBindings(), arbitraryProviderHook: {} }),
      }),
    ],
    [
      'missing required constructor',
      providerWith({
        getAwsSdkBindings: () =>
          Object.freeze({
            ...actualBindings(),
            clientSTS: Object.freeze({
              ...actualBindings().clientSTS,
              STSClient: undefined,
            }),
          }),
      }),
    ],
    [
      'invalid ReturnValue.NONE',
      providerWith({
        getAwsSdkBindings: () =>
          Object.freeze({
            ...actualBindings(),
            clientDynamoDB: Object.freeze({
              ...actualBindings().clientDynamoDB,
              ReturnValue: Object.freeze({
                ...actualBindings().clientDynamoDB.ReturnValue,
                NONE: 'NOT_NONE',
              }),
            }),
          }),
      }),
    ],
    [
      'missing DynamoDBDocument.from',
      providerWith({
        getAwsSdkBindings: () =>
          Object.freeze({
            ...actualBindings(),
            libDynamoDB: Object.freeze({
              ...actualBindings().libDynamoDB,
              DynamoDBDocument: function DynamoDBDocument() {},
            }),
          }),
      }),
    ],
    [
      'missing DynamoDBDocumentClient.from',
      providerWith({
        getAwsSdkBindings: () =>
          Object.freeze({
            ...actualBindings(),
            libDynamoDB: Object.freeze({
              ...actualBindings().libDynamoDB,
              DynamoDBDocumentClient: function DynamoDBDocumentClient() {},
            }),
          }),
      }),
    ],
  ])('rejects %s before registration', (_label, namespace) => {
    expect(() => validateAwsProviderModule(namespace)).toThrow(
      expect.objectContaining({
        name: 'AwsProviderUnavailableError',
        code: 'WHARFIE_AWS_PROVIDER_INCOMPATIBLE',
        reason: 'incompatible',
        message: INCOMPATIBLE_MESSAGE,
      }),
    );
    expect(() => validateAwsProviderModule(namespace)).toThrow(
      AwsProviderUnavailableError,
    );
  });

  test('classifies only an exact missing companion target as absent', () => {
    const missing = classifyAwsProviderImportFailure(
      moduleNotFound(
        "Cannot find package '@wharfie/aws' imported from /consumer/loader.js",
      ),
    );
    const missingTransitive = classifyAwsProviderImportFailure(
      moduleNotFound(
        "Cannot find package '@aws-sdk/client-sts' imported from /consumer/node_modules/@wharfie/aws/src/index.js",
      ),
    );

    expect(missing).toMatchObject({
      code: 'WHARFIE_AWS_PROVIDER_UNAVAILABLE',
      reason: 'missing',
      message: MISSING_MESSAGE,
    });
    expect(missingTransitive).toMatchObject({
      code: 'WHARFIE_AWS_PROVIDER_INCOMPATIBLE',
      reason: 'incompatible',
      message: INCOMPATIBLE_MESSAGE,
    });
  });
});
