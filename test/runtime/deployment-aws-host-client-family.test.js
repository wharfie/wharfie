import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { createAwsSingleNodeHostActivationAuthorityRecord } from '../../src/core/runtime/deployment-aws-host-activation-authority-contract.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import {
  DEPLOYMENT_CONTROL_TABLE_NAME,
  DEPLOYMENT_CONTROL_TABLE_RECORD_KEY,
  getDeploymentControlHeadRecordKey,
} from '../../src/core/runtime/deployment-control-table.js';
import { createAwsProviderScope } from '../../src/core/runtime/deployment-provider-scope.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
} from './fixtures/deployment-aws-host-activation.js';

const HOST_CLIENT_FAMILY_IMPORT =
  '../../src/core/runtime/deployment-aws-host-client-family.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @type {jest.Mock<(...args: any[]) => any>} */
const credentialProvider = jest.fn();
/** @type {jest.Mock<() => AnyRecord>} */
const openCredentialSource = jest.fn();
/** @type {jest.Mock<() => unknown>} */
const credentialSourceClose = jest.fn();
/** @type {jest.Mock<(config: AnyRecord) => AnyRecord>} */
const STSClient = jest.fn();
/** @type {jest.Mock<(input: AnyRecord) => AnyRecord>} */
const GetCallerIdentityCommand = jest.fn();
/** @type {jest.Mock<(config: AnyRecord) => AnyRecord>} */
const DynamoDBClient = jest.fn();
/** @type {jest.Mock<(input: AnyRecord) => AnyRecord>} */
const GetCommand = jest.fn();
/** @type {jest.Mock<(client: AnyRecord, config: AnyRecord) => AnyRecord>} */
const documentClientFrom = jest.fn();

/** @type {AnyRecord[]} */
let rawClients;
/** @type {AnyRecord[]} */
let rawDynamoClients;
/** @type {AnyRecord[]} */
let documentClients;
/** @type {unknown[]} */
let identities;
/** @type {unknown[]} */
let controlResponses;
/** @type {unknown} */
let credentialSourceConstructionFailure;
/** @type {unknown} */
let stsConstructionFailure;
/** @type {unknown} */
let dynamoConstructionFailure;
/** @type {unknown} */
let documentConstructionFailure;
/** @type {AnyRecord|undefined} */
let credentialSource;
/** @type {((source: AnyRecord) => AnyRecord)|undefined} */
let transformCredentialSource;
/** @type {((this: AnyRecord) => unknown)|undefined} */
let credentialSourceCloseImplementation;
/** @type {((client: AnyRecord) => AnyRecord)|undefined} */
let transformRawClient;
/** @type {((this: AnyRecord, command: AnyRecord, options: AnyRecord) => unknown)|undefined} */
let sendImplementation;
/** @type {((this: AnyRecord) => unknown)|undefined} */
let destroyImplementation;
/** @type {((this: AnyRecord, command: AnyRecord, options: AnyRecord) => unknown)|undefined} */
let dynamoSendImplementation;
/** @type {((this: AnyRecord) => unknown)|undefined} */
let dynamoDestroyImplementation;

jest.unstable_mockModule(
  '../../src/core/runtime/deployment-aws-host-instance-credentials.js',
  () => ({
    openAwsSingleNodeHostInstanceCredentialSource: openCredentialSource,
  }),
);
jest.unstable_mockModule('@aws-sdk/client-sts', () => ({
  GetCallerIdentityCommand,
  STSClient,
}));
jest.unstable_mockModule('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient,
}));
jest.unstable_mockModule('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: Object.freeze({ from: documentClientFrom }),
  GetCommand,
}));

const {
  AwsSingleNodeHostClientFamilyCloseError,
  AwsSingleNodeHostClientFamilyClosedError,
  AwsSingleNodeHostClientFamilyInitializationError,
  openAwsSingleNodeHostClientFamily,
} = await import(HOST_CLIENT_FAMILY_IMPORT);

/** @returns {{promise: Promise<any>, resolve: (value: any) => void, reject: (reason: unknown) => void}} */
function deferred() {
  /** @type {(value: any) => void} */
  let settle = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  /** @type {(reason: unknown) => void} */
  let fail = () => {
    throw new Error('Deferred promise was not initialized.');
  };
  const promise = new Promise((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, resolve: settle, reject: fail };
}

/** @param {AnyRecord} value @returns {Readonly<AnyRecord>} */
function deepFreeze(value) {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') {
      deepFreeze(/** @type {AnyRecord} */ (child));
    }
  }
  return Object.freeze(value);
}

/** @returns {{request: Readonly<AnyRecord>, context: Readonly<AnyRecord>}} */
function makeActivation() {
  const request = createAwsSingleNodeHostActivationRequest(
    makeFixture().requestContext,
  );
  return {
    request,
    context: deepFreeze({
      request,
      step: {
        intentId: getAwsSingleNodeHostActivationIntentId(
          request,
          'runtime-identity',
        ),
        kind: 'runtime-identity',
        attemptGeneration: 0,
      },
      priorEvidence: {},
    }),
  };
}

/** @param {Readonly<AnyRecord>} request @param {AnyRecord} [overrides] @returns {Readonly<AnyRecord>} */
function makeCallerIdentity(request, overrides = {}) {
  return deepFreeze({
    Account: request.providerScope.accountId,
    Arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
    UserId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
    ...overrides,
  });
}

/** @param {Readonly<AnyRecord>} request @returns {Readonly<AnyRecord>} */
function makeEvidence(request) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: request.requestId,
    accountId: request.providerScope.accountId,
    arn: `arn:${request.providerScope.partition}:sts::${request.providerScope.accountId}:assumed-role/${request.runtimeRoleName}/${request.nodeProviderResourceId}`,
    userId: `${request.runtimeRoleId}:${request.nodeProviderResourceId}`,
  });
}

/** @param {Readonly<AnyRecord>} head @returns {Readonly<AnyRecord>} */
function makeHeadRecord(head) {
  return deepFreeze({
    record_key: getDeploymentControlHeadRecordKey(head.deploymentInstanceId),
    storage_schema_version: 1,
    record_kind: 'deployment-head',
    document_id: head.headId,
    document: head,
  });
}

/** @param {unknown} callback @returns {unknown} */
function captureFailure(callback) {
  try {
    /** @type {Function} */ (callback)();
  } catch (error) {
    return error;
  }
  throw new Error('Expected operation to fail.');
}

beforeEach(() => {
  rawClients = [];
  rawDynamoClients = [];
  documentClients = [];
  identities = [];
  controlResponses = [];
  credentialSourceConstructionFailure = undefined;
  stsConstructionFailure = undefined;
  dynamoConstructionFailure = undefined;
  documentConstructionFailure = undefined;
  credentialSource = undefined;
  transformCredentialSource = undefined;
  credentialSourceCloseImplementation = undefined;
  transformRawClient = undefined;
  sendImplementation = undefined;
  destroyImplementation = undefined;
  dynamoSendImplementation = undefined;
  dynamoDestroyImplementation = undefined;

  credentialProvider.mockReset();
  openCredentialSource.mockReset();
  credentialSourceClose.mockReset();
  STSClient.mockReset();
  GetCallerIdentityCommand.mockReset();
  DynamoDBClient.mockReset();
  GetCommand.mockReset();
  documentClientFrom.mockReset();

  credentialSourceClose.mockImplementation(
    /** @this {AnyRecord} */
    function closeSource() {
      if (credentialSourceCloseImplementation !== undefined) {
        return credentialSourceCloseImplementation.call(
          /** @type {AnyRecord} */ (this),
        );
      }
      return Promise.resolve();
    },
  );
  openCredentialSource.mockImplementation(() => {
    if (credentialSourceConstructionFailure !== undefined) {
      throw credentialSourceConstructionFailure;
    }
    const source = {
      credentials: credentialProvider,
      close: credentialSourceClose,
    };
    credentialSource =
      transformCredentialSource === undefined
        ? Object.freeze(source)
        : transformCredentialSource(source);
    return credentialSource;
  });
  GetCallerIdentityCommand.mockImplementation((input) =>
    Object.freeze({ input }),
  );
  STSClient.mockImplementation((config) => {
    if (stsConstructionFailure !== undefined) throw stsConstructionFailure;
    const client = {
      config,
      send: jest.fn(function send(command, options) {
        if (sendImplementation !== undefined) {
          return sendImplementation.call(
            client,
            /** @type {AnyRecord} */ (command),
            /** @type {AnyRecord} */ (options),
          );
        }
        return Promise.resolve(identities.shift());
      }),
      destroy: jest.fn(function destroy() {
        if (destroyImplementation !== undefined) {
          return destroyImplementation.call(client);
        }
        return undefined;
      }),
    };
    const transformed =
      transformRawClient === undefined ? client : transformRawClient(client);
    rawClients.push(transformed);
    return transformed;
  });
  DynamoDBClient.mockImplementation((config) => {
    if (dynamoConstructionFailure !== undefined) {
      throw dynamoConstructionFailure;
    }
    const client = {
      config,
      destroy: jest.fn(function destroy() {
        if (dynamoDestroyImplementation !== undefined) {
          return dynamoDestroyImplementation.call(client);
        }
        return undefined;
      }),
    };
    rawDynamoClients.push(client);
    return client;
  });
  GetCommand.mockImplementation((input) => Object.freeze({ input }));
  documentClientFrom.mockImplementation((client, config) => {
    if (documentConstructionFailure !== undefined) {
      throw documentConstructionFailure;
    }
    const documentClient = {
      rawClient: client,
      config,
      send: jest.fn(function send(command, options) {
        if (dynamoSendImplementation !== undefined) {
          return dynamoSendImplementation.call(
            documentClient,
            /** @type {AnyRecord} */ (command),
            /** @type {AnyRecord} */ (options),
          );
        }
        return Promise.resolve(controlResponses.shift() ?? {});
      }),
    };
    documentClients.push(documentClient);
    return documentClient;
  });
});

describe('AWS single-node host client family construction', () => {
  it('owns one credential source and environment-independent regional STS and DynamoDB clients', async () => {
    const { request } = makeActivation();
    const poisonedEnvironment = {
      AWS_ACCESS_KEY_ID: 'ambient-access-key-must-not-be-used',
      AWS_SECRET_ACCESS_KEY: 'ambient-secret-must-not-be-used',
      AWS_SESSION_TOKEN: 'ambient-token-must-not-be-used',
      AWS_ENDPOINT_URL: 'https://ambient-endpoint.invalid',
      AWS_ENDPOINT_URL_STS: 'https://ambient-sts-endpoint.invalid',
      AWS_ENDPOINT_URL_DYNAMODB: 'https://ambient-dynamodb.invalid',
      AWS_ACCOUNT_ID_ENDPOINT_MODE: 'required',
      AWS_USE_DUALSTACK_ENDPOINT: 'true',
      AWS_USE_FIPS_ENDPOINT: 'true',
      AWS_MAX_ATTEMPTS: '99',
    };
    const savedEnvironment = Object.fromEntries(
      Object.keys(poisonedEnvironment).map((name) => [name, process.env[name]]),
    );
    for (const [name, value] of Object.entries(poisonedEnvironment)) {
      process.env[name] = value;
    }
    const consoleSpies = ['debug', 'info', 'warn', 'error', 'trace'].map(
      (method) =>
        jest
          .spyOn(console, /** @type {'debug'} */ (method))
          .mockImplementation(() => undefined),
    );

    let family;
    try {
      family = openAwsSingleNodeHostClientFamily({
        providerScope: request.providerScope,
        deploymentInstanceId: request.deploymentInstanceId,
      });

      expect(openCredentialSource).toHaveBeenCalledTimes(1);
      expect(openCredentialSource).toHaveBeenCalledWith();
      expect(credentialSource).toBeDefined();
      expect(Object.keys(/** @type {AnyRecord} */ (credentialSource))).toEqual([
        'credentials',
        'close',
      ]);
      expect(Object.isFrozen(credentialSource)).toBe(true);

      expect(STSClient).toHaveBeenCalledTimes(1);
      const stsConfig = STSClient.mock.calls[0][0];
      expect(Object.keys(stsConfig)).toEqual([
        'retryStrategy',
        'maxAttempts',
        'region',
        'endpoint',
        'useDualstackEndpoint',
        'useFipsEndpoint',
        'useGlobalEndpoint',
        'credentials',
        'logger',
      ]);
      expect(stsConfig.maxAttempts).toBe(1);
      expect(stsConfig.region).toBe(request.providerScope.region);
      expect(stsConfig.endpoint).toBe(
        `https://sts.${request.providerScope.region}.amazonaws.com`,
      );
      expect(stsConfig.useDualstackEndpoint).toBe(false);
      expect(stsConfig.useFipsEndpoint).toBe(false);
      expect(stsConfig.useGlobalEndpoint).toBe(false);
      expect(stsConfig.credentials).toBe(credentialProvider);
      expect(Object.isFrozen(stsConfig.logger)).toBe(true);
      expect(stsConfig.logger).toEqual({
        trace: expect.any(Function),
        debug: expect.any(Function),
        info: expect.any(Function),
        warn: expect.any(Function),
        error: expect.any(Function),
      });
      for (const method of ['trace', 'debug', 'info', 'warn', 'error']) {
        expect(stsConfig.logger[method]('provider-secret')).toBeUndefined();
      }
      expect(consoleSpies.every((spy) => spy.mock.calls.length === 0)).toBe(
        true,
      );
      await expect(stsConfig.retryStrategy.maxAttempts()).resolves.toBe(1);

      expect(DynamoDBClient).toHaveBeenCalledTimes(1);
      const dynamoConfig = DynamoDBClient.mock.calls[0][0];
      expect(Object.keys(dynamoConfig)).toEqual([
        'retryStrategy',
        'maxAttempts',
        'region',
        'endpoint',
        'useDualstackEndpoint',
        'useFipsEndpoint',
        'accountIdEndpointMode',
        'credentials',
        'logger',
      ]);
      expect(dynamoConfig).toMatchObject({
        maxAttempts: 1,
        region: request.providerScope.region,
        endpoint: `https://dynamodb.${request.providerScope.region}.amazonaws.com`,
        useDualstackEndpoint: false,
        useFipsEndpoint: false,
        accountIdEndpointMode: 'disabled',
        credentials: credentialProvider,
      });
      expect(dynamoConfig.logger).toBe(stsConfig.logger);
      await expect(dynamoConfig.retryStrategy.maxAttempts()).resolves.toBe(1);
      expect(documentClientFrom).toHaveBeenCalledTimes(1);
      expect(documentClientFrom).toHaveBeenCalledWith(rawDynamoClients[0], {
        marshallOptions: {
          convertClassInstanceToMap: false,
          convertEmptyValues: false,
          removeUndefinedValues: false,
        },
        unmarshallOptions: { wrapNumbers: false },
      });
      expect(credentialProvider).not.toHaveBeenCalled();
    } finally {
      if (family !== undefined) await family.close();
      for (const spy of consoleSpies) spy.mockRestore();
      for (const [name, value] of Object.entries(savedEnvironment)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('exposes only the frozen scope, narrow ports, and owner close', async () => {
    const { request } = makeActivation();
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: clone(request.providerScope),
      deploymentInstanceId: request.deploymentInstanceId,
    });

    expect(Object.keys(family)).toEqual([
      'providerScope',
      'runtimeIdentity',
      'activationAuthority',
      'close',
    ]);
    expect(Object.keys(family.runtimeIdentity)).toEqual([
      'observe',
      'validateEvidence',
    ]);
    expect(Object.keys(family.activationAuthority)).toEqual([
      'readAuthorizedRequest',
      'authorizeRequest',
    ]);
    expect(family.providerScope).toEqual(request.providerScope);
    expectDeepFrozen(family.providerScope);
    expect(Object.isFrozen(family.runtimeIdentity)).toBe(true);
    expect(Object.isFrozen(family.activationAuthority)).toBe(true);
    expect(Object.isFrozen(family)).toBe(true);
    for (const forbidden of [
      'client',
      'sts',
      'credentials',
      'credentialProvider',
      'logger',
      'abortController',
      'retryStrategy',
    ]) {
      expect(family).not.toHaveProperty(forbidden);
      expect(family.runtimeIdentity).not.toHaveProperty(forbidden);
      expect(family.activationAuthority).not.toHaveProperty(forbidden);
    }

    await family.close();
  });

  it.each([
    null,
    {},
    { providerScope: null },
    {
      providerScope: makeActivation().request.providerScope,
      deploymentInstanceId: makeActivation().request.deploymentInstanceId,
      extra: true,
    },
    {
      providerScope: makeActivation().request.providerScope,
      deploymentInstanceId: 'wdi1_invalid',
    },
    {
      providerScope: {
        ...clone(makeActivation().request.providerScope),
        region: 'not-a-region',
      },
      deploymentInstanceId: makeActivation().request.deploymentInstanceId,
    },
  ])(
    'rejects invalid exact options before constructing credential authority %#',
    (options) => {
      expect(() => openAwsSingleNodeHostClientFamily(options)).toThrow();
      expect(openCredentialSource).not.toHaveBeenCalled();
      expect(STSClient).not.toHaveBeenCalled();
      expect(DynamoDBClient).not.toHaveBeenCalled();
    },
  );

  it('rejects a valid recomputed unsupported AWS partition before opening authority', () => {
    const providerScope = createAwsProviderScope({
      partition: 'aws-us-gov',
      accountId: '123456789012',
      region: 'us-gov-west-1',
    });

    expect(() =>
      openAwsSingleNodeHostClientFamily({
        providerScope,
        deploymentInstanceId: makeActivation().request.deploymentInstanceId,
      }),
    ).toThrow(TypeError);
    expect(openCredentialSource).not.toHaveBeenCalled();
    expect(STSClient).not.toHaveBeenCalled();
    expect(DynamoDBClient).not.toHaveBeenCalled();
  });

  it.each([
    [
      'credential source construction',
      () => {
        credentialSourceConstructionFailure = new Error(
          'ambient-credential-secret-source',
        );
      },
      0,
    ],
    [
      'non-callable credential source',
      () => {
        transformCredentialSource = (source) =>
          Object.freeze({
            credentials: { secret: 'credential-source-secret' },
            close: source.close,
          });
      },
      1,
    ],
    [
      'STS construction',
      () => {
        stsConstructionFailure = new Error('sts-construction-secret');
      },
      1,
    ],
    [
      'DynamoDB construction',
      () => {
        dynamoConstructionFailure = new Error('dynamodb-construction-secret');
      },
      1,
    ],
    [
      'DynamoDB document construction',
      () => {
        documentConstructionFailure = new Error('document-construction-secret');
      },
      1,
    ],
  ])(
    'redacts %s failures behind one fixed typed error',
    (_label, arrange, expectedSourceCloses) => {
      const { request } = makeActivation();
      arrange();

      const failure = captureFailure(() =>
        openAwsSingleNodeHostClientFamily({
          providerScope: request.providerScope,
          deploymentInstanceId: request.deploymentInstanceId,
        }),
      );

      expect(failure).toBeInstanceOf(
        AwsSingleNodeHostClientFamilyInitializationError,
      );
      expect(failure).toMatchObject({
        name: 'AwsSingleNodeHostClientFamilyInitializationError',
        message: 'AWS single-node host client family initialization failed.',
        code: 'AWS_SINGLE_NODE_HOST_CLIENT_FAMILY_INITIALIZATION_FAILED',
      });
      expect(failure).not.toHaveProperty('cause');
      expect(String(failure)).not.toMatch(/secret|credential source|STS/i);
      expect(credentialSourceClose).toHaveBeenCalledTimes(expectedSourceCloses);
    },
  );

  it('best-effort closes a partial STS/source lifetime without leaking either failure', () => {
    const { request } = makeActivation();
    /** @type {jest.Mock<() => void>|undefined} */
    let destroy;
    credentialSourceCloseImplementation = () => {
      throw new Error('credential-cleanup-secret');
    };
    destroyImplementation = () => {
      throw new Error('sts-cleanup-secret');
    };
    transformRawClient = (client) => {
      destroy = client.destroy;
      delete client.send;
      return client;
    };

    const failure = captureFailure(() =>
      openAwsSingleNodeHostClientFamily({
        providerScope: request.providerScope,
        deploymentInstanceId: request.deploymentInstanceId,
      }),
    );

    expect(failure).toBeInstanceOf(
      AwsSingleNodeHostClientFamilyInitializationError,
    );
    expect(String(failure)).not.toMatch(/cleanup-secret/);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(credentialSourceClose).toHaveBeenCalledTimes(1);
  });

  it('best-effort destroys both raw clients when document-client construction fails', () => {
    const { request } = makeActivation();
    documentConstructionFailure = new Error('document-provider-secret');
    destroyImplementation = () => {
      throw new Error('sts-cleanup-secret');
    };
    dynamoDestroyImplementation = () => {
      throw new Error('dynamo-cleanup-secret');
    };

    const failure = captureFailure(() =>
      openAwsSingleNodeHostClientFamily({
        providerScope: request.providerScope,
        deploymentInstanceId: request.deploymentInstanceId,
      }),
    );

    expect(failure).toBeInstanceOf(
      AwsSingleNodeHostClientFamilyInitializationError,
    );
    expect(String(failure)).not.toMatch(/provider-secret|cleanup-secret/);
    expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(credentialSourceClose).toHaveBeenCalledTimes(1);
  });
});

describe('AWS single-node host runtime identity projection', () => {
  it('sends one empty GetCallerIdentity command with cancellation and settles exact V67 evidence', async () => {
    const { request, context } = makeActivation();
    identities.push(makeCallerIdentity(request));
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });

    const observation = await family.runtimeIdentity.observe(context);

    expect(observation).toEqual({
      status: 'settled',
      evidence: makeEvidence(request),
    });
    expectDeepFrozen(observation);
    expect(GetCallerIdentityCommand).toHaveBeenCalledTimes(1);
    expect(GetCallerIdentityCommand).toHaveBeenCalledWith({});
    expect(rawClients[0].send).toHaveBeenCalledTimes(1);
    expect(rawClients[0].send.mock.contexts[0]).toBe(rawClients[0]);
    const [command, options] = rawClients[0].send.mock.calls[0];
    expect(command).toBe(GetCallerIdentityCommand.mock.results[0].value);
    expect(command.input).toEqual({});
    expect(Object.isFrozen(command.input)).toBe(true);
    expect(Object.keys(options)).toEqual(['abortSignal']);
    expect(options.abortSignal).toBeInstanceOf(AbortSignal);
    expect(options.abortSignal.aborted).toBe(false);
    expect(Object.isFrozen(options)).toBe(true);
    expect(
      family.runtimeIdentity.validateEvidence(
        clone(observation.evidence),
        context,
      ),
    ).toEqual(observation.evidence);

    await family.close();
  });

  it('classifies a well-formed wrong live identity through the unchanged V67 adapter', async () => {
    const { request, context } = makeActivation();
    identities.push(
      makeCallerIdentity(request, { Account: '999999999999' }),
      makeCallerIdentity(request, { Account: '999999999999' }),
      makeCallerIdentity(request, { Account: '999999999999' }),
    );
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });

    jest.useFakeTimers();
    try {
      const observation = family.runtimeIdentity.observe(context);
      await jest.advanceTimersByTimeAsync(6_000);
      await expect(observation).resolves.toEqual({
        status: 'conflict',
      });
      expect(rawClients[0].send).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
      await family.close();
    }
  });

  it('snapshots raw STS capabilities instead of following later mutation', async () => {
    const { request, context } = makeActivation();
    identities.push(makeCallerIdentity(request));
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });
    const originalSend = rawClients[0].send;
    const originalDestroy = rawClients[0].destroy;
    rawClients[0].send = jest.fn(() => {
      throw new Error('replacement send must not run');
    });
    rawClients[0].destroy = jest.fn(() => {
      throw new Error('replacement destroy must not run');
    });

    await expect(
      family.runtimeIdentity.observe(context),
    ).resolves.toMatchObject({ status: 'settled' });
    await expect(family.close()).resolves.toBeUndefined();

    expect(originalSend).toHaveBeenCalledTimes(1);
    expect(originalDestroy).toHaveBeenCalledTimes(1);
    expect(rawClients[0].send).not.toHaveBeenCalled();
    expect(rawClients[0].destroy).not.toHaveBeenCalled();
  });
});

describe('AWS single-node host activation authority projection', () => {
  it('performs request-first/head-last strongly consistent reads through the pinned document client', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    const authorityRecord =
      createAwsSingleNodeHostActivationAuthorityRecord(request);
    const currentHeadRecord = makeHeadRecord(fixture.head);
    controlResponses.push(
      { Item: authorityRecord },
      { Item: currentHeadRecord },
      { Item: authorityRecord },
      { Item: currentHeadRecord },
    );
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });
    const originalSend = documentClients[0].send;
    const originalDestroy = rawDynamoClients[0].destroy;
    documentClients[0].send = jest.fn(() => {
      throw new Error('replacement document send must not run');
    });
    rawDynamoClients[0].destroy = jest.fn(() => {
      throw new Error('replacement DynamoDB destroy must not run');
    });

    await expect(
      family.activationAuthority.readAuthorizedRequest({
        deploymentInstanceId: request.deploymentInstanceId,
        requestId: request.requestId,
      }),
    ).resolves.toEqual(request);
    await expect(
      family.activationAuthority.authorizeRequest({
        request,
        purpose: 'dispatch',
        step: 'runtime-identity',
        receipt: null,
      }),
    ).resolves.toBe(true);

    expect(GetCommand).toHaveBeenCalledTimes(4);
    expect(
      GetCommand.mock.calls.map(([input]) => input.Key.record_key),
    ).toEqual([
      authorityRecord.record_key,
      currentHeadRecord.record_key,
      authorityRecord.record_key,
      currentHeadRecord.record_key,
    ]);
    for (const [input] of GetCommand.mock.calls) {
      expect(input).toEqual({
        TableName: DEPLOYMENT_CONTROL_TABLE_NAME,
        Key: {
          [DEPLOYMENT_CONTROL_TABLE_RECORD_KEY]: input.Key.record_key,
        },
        ConsistentRead: true,
      });
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen(input.Key)).toBe(true);
    }
    expect(originalSend).toHaveBeenCalledTimes(4);
    for (const [
      index,
      [command, options],
    ] of originalSend.mock.calls.entries()) {
      expect(originalSend.mock.contexts[index]).toBe(documentClients[0]);
      expect(command).toBe(GetCommand.mock.results[index].value);
      expect(Object.keys(options)).toEqual(['abortSignal']);
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options.abortSignal.aborted).toBe(false);
      expect(Object.isFrozen(options)).toBe(true);
    }

    await family.close();
    expect(originalDestroy).toHaveBeenCalledTimes(1);
    expect(originalDestroy.mock.contexts[0]).toBe(rawDynamoClients[0]);
    expect(documentClients[0].send).not.toHaveBeenCalled();
    expect(rawDynamoClients[0].destroy).not.toHaveBeenCalled();
  });

  it('never classifies a present null Item as conclusive absence', async () => {
    const fixture = makeFixture();
    const request = createAwsSingleNodeHostActivationRequest(
      fixture.requestContext,
    );
    controlResponses.push({ Item: null });
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });

    await expect(
      family.activationAuthority.readAuthorizedRequest({
        deploymentInstanceId: request.deploymentInstanceId,
        requestId: request.requestId,
      }),
    ).rejects.toMatchObject({
      name: 'AwsSingleNodeHostActivationAuthorityUnavailableError',
      code: 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_UNAVAILABLE',
    });

    await family.close();
  });
});

describe('AWS single-node host client family ownership lifecycle', () => {
  it('aborts and fences immediately, drains active observation, and memoizes one destroy', async () => {
    const { request, context } = makeActivation();
    const entered = deferred();
    const response = deferred();
    const sourceClose = deferred();
    credentialSourceCloseImplementation = () => sourceClose.promise;
    /** @type {AbortSignal|undefined} */
    let signal;
    sendImplementation = (_command, options) => {
      signal = options.abortSignal;
      entered.resolve(undefined);
      return response.promise;
    };
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });
    const active = family.runtimeIdentity.observe(context);
    await entered.promise;

    const firstClose = family.close();
    const secondClose = family.close();
    const closeSettled = jest.fn();
    firstClose.then(closeSettled, closeSettled);

    expect(secondClose).toBe(firstClose);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(true);
    expect(credentialSourceClose).toHaveBeenCalledTimes(1);
    expect(credentialSourceClose.mock.contexts[0]).toBe(credentialSource);
    expect(rawClients[0].destroy).not.toHaveBeenCalled();
    expect(rawDynamoClients[0].destroy).not.toHaveBeenCalled();
    expect(() => family.runtimeIdentity.observe(context)).toThrow(
      AwsSingleNodeHostClientFamilyClosedError,
    );
    expect(() => family.runtimeIdentity.validateEvidence({}, context)).toThrow(
      AwsSingleNodeHostClientFamilyClosedError,
    );
    expect(() =>
      family.activationAuthority.readAuthorizedRequest({
        deploymentInstanceId: request.deploymentInstanceId,
        requestId: request.requestId,
      }),
    ).toThrow(AwsSingleNodeHostClientFamilyClosedError);

    response.resolve(makeCallerIdentity(request));
    await expect(active).resolves.toMatchObject({ status: 'settled' });
    await Promise.resolve();
    expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(closeSettled).not.toHaveBeenCalled();

    sourceClose.resolve(undefined);
    await expect(firstClose).resolves.toBeUndefined();
    expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(rawClients[0].destroy.mock.contexts[0]).toBe(rawClients[0]);
    expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
    expect(rawDynamoClients[0].destroy.mock.contexts[0]).toBe(
      rawDynamoClients[0],
    );
    expect(family.close()).toBe(firstClose);
  });

  it('stops retrying on close but drains one abort-ignoring raw send', async () => {
    const { request, context } = makeActivation();
    const firstSendEntered = deferred();
    const send = deferred();
    /** @type {AbortSignal[]} */
    const signals = [];
    sendImplementation = (_command, options) => {
      signals.push(options.abortSignal);
      firstSendEntered.resolve(undefined);
      return send.promise;
    };
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });
    /** @type {Promise<unknown>|undefined} */
    let observation;
    /** @type {Promise<void>|undefined} */
    let close;

    jest.useFakeTimers();
    try {
      observation = family.runtimeIdentity.observe(context);
      await firstSendEntered.promise;
      const closeAttempt = family.close();
      close = closeAttempt;
      const closeSettled = jest.fn();
      closeAttempt.then(closeSettled, closeSettled);

      expect(signals[0].aborted).toBe(true);
      expect(credentialSourceClose).toHaveBeenCalledTimes(1);
      expect(rawClients[0].destroy).not.toHaveBeenCalled();
      expect(rawDynamoClients[0].destroy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(10_000);
      await expect(observation).resolves.toEqual({ status: 'unknown' });
      await jest.advanceTimersByTimeAsync(30_000);
      expect(rawClients[0].send).toHaveBeenCalledTimes(1);
      expect(signals).toHaveLength(1);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(closeSettled).not.toHaveBeenCalled();

      send.resolve(undefined);
      await expect(closeAttempt).resolves.toBeUndefined();
      expect(closeSettled).toHaveBeenCalledTimes(1);
      expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
    } finally {
      send.resolve(undefined);
      await jest.runAllTimersAsync();
      if (close === undefined) close = family.close();
      jest.useRealTimers();
      await Promise.allSettled([observation, close]);
    }
  });

  it('aborts a live authority read, fences new reads, and drains an abort-ignoring DynamoDB send', async () => {
    const { request } = makeActivation();
    const entered = deferred();
    const send = deferred();
    /** @type {AbortSignal|undefined} */
    let signal;
    dynamoSendImplementation = (_command, options) => {
      signal = options.abortSignal;
      entered.resolve(undefined);
      return send.promise;
    };
    const family = openAwsSingleNodeHostClientFamily({
      providerScope: request.providerScope,
      deploymentInstanceId: request.deploymentInstanceId,
    });

    jest.useFakeTimers();
    try {
      const read = family.activationAuthority.readAuthorizedRequest({
        deploymentInstanceId: request.deploymentInstanceId,
        requestId: request.requestId,
      });
      const readFailure = read.then(
        () => {
          throw new Error('Expected authority read to fail.');
        },
        (/** @type {unknown} */ error) => error,
      );
      await entered.promise;
      const close = family.close();
      const closeSettled = jest.fn();
      close.then(closeSettled, closeSettled);

      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal?.aborted).toBe(true);
      expect(() =>
        family.activationAuthority.authorizeRequest({
          request,
          purpose: 'claim',
          step: null,
          receipt: null,
        }),
      ).toThrow(AwsSingleNodeHostClientFamilyClosedError);
      expect(rawClients[0].destroy).not.toHaveBeenCalled();
      expect(rawDynamoClients[0].destroy).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(10_000);
      await expect(readFailure).resolves.toMatchObject({
        code: 'AWS_SINGLE_NODE_HOST_ACTIVATION_AUTHORITY_UNAVAILABLE',
      });
      expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(closeSettled).not.toHaveBeenCalled();

      send.resolve({});
      await expect(close).resolves.toBeUndefined();
      expect(closeSettled).toHaveBeenCalledTimes(1);
    } finally {
      send.resolve({});
      await jest.runAllTimersAsync();
      jest.useRealTimers();
      await family.close().catch(() => undefined);
    }
  });

  it.each([
    [
      'STS destroy',
      () => {
        destroyImplementation = () => {
          throw new Error('raw-destroy-provider-secret');
        };
      },
    ],
    [
      'credential source close',
      () => {
        credentialSourceCloseImplementation = () =>
          Promise.reject(new Error('credential-close-provider-secret'));
      },
    ],
    [
      'DynamoDB destroy',
      () => {
        dynamoDestroyImplementation = () => {
          throw new Error('dynamo-destroy-provider-secret');
        };
      },
    ],
  ])(
    'keeps one closed lifetime and redacts a %s failure',
    async (_label, arrange) => {
      const { request, context } = makeActivation();
      arrange();
      const family = openAwsSingleNodeHostClientFamily({
        providerScope: request.providerScope,
        deploymentInstanceId: request.deploymentInstanceId,
      });

      const firstClose = family.close();
      const secondClose = family.close();
      expect(secondClose).toBe(firstClose);

      /** @type {unknown} */
      let failure;
      try {
        await firstClose;
      } catch (error) {
        failure = error;
      }
      expect(failure).toBeInstanceOf(AwsSingleNodeHostClientFamilyCloseError);
      expect(failure).toMatchObject({
        name: 'AwsSingleNodeHostClientFamilyCloseError',
        message: 'AWS single-node host client family close failed.',
        code: 'AWS_SINGLE_NODE_HOST_CLIENT_FAMILY_CLOSE_FAILED',
      });
      expect(failure).not.toHaveProperty('cause');
      expect(String(failure)).not.toContain('provider-secret');
      expect(credentialSourceClose).toHaveBeenCalledTimes(1);
      expect(rawClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(rawDynamoClients[0].destroy).toHaveBeenCalledTimes(1);
      expect(family.close()).toBe(firstClose);
      await expect(family.close()).rejects.toBe(failure);
      expect(() => family.runtimeIdentity.observe(context)).toThrow(
        AwsSingleNodeHostClientFamilyClosedError,
      );
    },
  );
});
