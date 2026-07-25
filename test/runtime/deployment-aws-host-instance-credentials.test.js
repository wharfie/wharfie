import { EventEmitter } from 'node:events';

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

const INSTANCE_CREDENTIALS_IMPORT =
  '../../src/core/runtime/deployment-aws-host-instance-credentials.js';
const START_TIME = new Date('2026-07-25T12:00:00.000Z');
const ROLE_NAME = 'wharfie-runtime-role';
const IMDS_TOKEN = 'imds-v2-token';

/** @typedef {Record<string, any>} AnyRecord */

/** @type {AnyRecord[]} */
let plans = [];
/** @type {MockClientRequest[]} */
let requests = [];

class MockIncomingMessage extends EventEmitter {
  /** @param {number} statusCode @param {unknown} body @param {unknown} [destroyError] */
  constructor(statusCode, body, destroyError) {
    super();
    this.statusCode = statusCode;
    this.body = body;
    this.destroyError = destroyError;
    this.destroyCalls = 0;
    this.resumeCalls = 0;
  }

  /** @returns {this} */
  destroy() {
    this.destroyCalls += 1;
    if (this.destroyError !== undefined) throw this.destroyError;
    return this;
  }

  /** @returns {this} */
  resume() {
    this.resumeCalls += 1;
    return this;
  }

  /** @returns {void} */
  deliver() {
    if (Array.isArray(this.body)) {
      for (const chunk of this.body) this.emit('data', chunk);
    } else if (this.body !== undefined) {
      this.emit('data', this.body);
    }
    this.emit('end');
  }
}

class MockClientRequest extends EventEmitter {
  /**
   * @param {AnyRecord} options
   * @param {(response: MockIncomingMessage) => void} receiveResponse
   * @param {AnyRecord} plan
   */
  constructor(options, receiveResponse, plan) {
    super();
    this.options = options;
    this.receiveResponse = receiveResponse;
    this.plan = plan;
    this.timeoutMilliseconds = undefined;
    this.timeoutCallback = undefined;
    this.endCalls = 0;
    this.destroyCalls = 0;
    this.destroyed = false;
    this.response = undefined;
  }

  /** @param {number} milliseconds @param {() => void} callback @returns {this} */
  setTimeout(milliseconds, callback) {
    this.timeoutMilliseconds = milliseconds;
    this.timeoutCallback = callback;
    return this;
  }

  /** @returns {void} */
  end() {
    this.endCalls += 1;
    if (this.plan.kind === 'hang') return;
    Promise.resolve().then(() => {
      if (this.plan.kind === 'error') {
        this.emit('error', this.plan.error);
        return;
      }
      this.respond(
        this.plan.statusCode ?? 200,
        this.plan.body,
        this.plan.responseDestroyError,
      );
    });
  }

  /** @returns {this} */
  destroy() {
    this.destroyCalls += 1;
    this.destroyed = true;
    if (this.plan.requestDestroyError !== undefined) {
      throw this.plan.requestDestroyError;
    }
    return this;
  }

  /** @returns {void} */
  fireTimeout() {
    if (this.timeoutCallback === undefined) {
      throw new Error('No timeout callback was installed.');
    }
    this.timeoutCallback();
  }

  /** @param {number} statusCode @param {unknown} body @param {unknown} [destroyError] @returns {void} */
  respond(statusCode, body, destroyError) {
    const response = new MockIncomingMessage(statusCode, body, destroyError);
    this.response = response;
    this.receiveResponse(response);
    response.deliver();
  }
}

/** @type {jest.Mock<(options: AnyRecord, callback: Function) => MockClientRequest>} */
const request = jest.fn((options, callback) => {
  const pending = new MockClientRequest(
    options,
    /** @type {(response: MockIncomingMessage) => void} */ (callback),
    plans.shift() ?? { kind: 'hang' },
  );
  requests.push(pending);
  return pending;
});

jest.unstable_mockModule('node:http', () => ({
  default: Object.freeze({ request }),
  request,
}));

const {
  AwsSingleNodeHostInstanceCredentialRetrievalError,
  AwsSingleNodeHostInstanceCredentialSourceCloseError,
  AwsSingleNodeHostInstanceCredentialSourceClosedError,
  openAwsSingleNodeHostInstanceCredentialSource,
} = await import(INSTANCE_CREDENTIALS_IMPORT);

/** @param {AnyRecord} [overrides] @returns {string} */
function credentialDocument(overrides = {}) {
  return JSON.stringify({
    Code: 'Success',
    LastUpdated: '2026-07-25T11:59:00Z',
    Type: 'AWS-HMAC',
    AccessKeyId: 'ASIAEXAMPLE00000001',
    SecretAccessKey: 'example-secret-access-key',
    Token: 'example-session-token',
    Expiration: '2026-07-25T13:00:00Z',
    AccountId: '123456789012',
    ...overrides,
  });
}

/** @param {string} [document] @returns {void} */
function queueCredentialRefresh(document = credentialDocument()) {
  plans.push(
    { kind: 'response', statusCode: 200, body: IMDS_TOKEN },
    { kind: 'response', statusCode: 200, body: ROLE_NAME },
    { kind: 'response', statusCode: 200, body: document },
  );
}

/** @returns {Promise<void>} */
async function flushPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

/** @param {unknown} error @returns {string} */
function errorSurface(error) {
  const candidate = /** @type {AnyRecord} */ (error);
  return [
    candidate?.name,
    candidate?.message,
    candidate?.code,
    candidate?.stack,
  ].join('\n');
}

/** @param {Promise<unknown>} promise @returns {Promise<unknown>} */
async function captureFailure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected promise to reject.');
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(START_TIME);
  plans = [];
  requests = [];
  request.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AWS single-node host instance credential source', () => {
  it('uses only the fixed IMDSv2 token, role, and credential request sequence', async () => {
    const savedEnvironment = {
      endpoint: process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    };
    process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT = 'http://attacker.invalid';
    process.env.AWS_ACCESS_KEY_ID = 'ambient-access-key';
    process.env.AWS_SECRET_ACCESS_KEY = 'ambient-secret-key';

    queueCredentialRefresh();
    const source = openAwsSingleNodeHostInstanceCredentialSource();
    try {
      expect(Object.keys(source)).toEqual(['credentials', 'close']);
      expect(Object.isFrozen(source)).toBe(true);
      expect(Object.isFrozen(source.credentials)).toBe(true);
      expect(Object.isFrozen(source.close)).toBe(true);

      const credentials = await source.credentials();

      expect(request).toHaveBeenCalledTimes(3);
      expect(
        requests.map(({ options }) => ({
          hostname: options.hostname,
          port: options.port,
          family: options.family,
          method: options.method,
          path: options.path,
          agent: options.agent,
          maxHeaderSize: options.maxHeaderSize,
          headers: options.headers,
        })),
      ).toEqual([
        {
          hostname: '169.254.169.254',
          port: 80,
          family: 4,
          method: 'PUT',
          path: '/latest/api/token',
          agent: false,
          maxHeaderSize: 8192,
          headers: {
            connection: 'close',
            'x-aws-ec2-metadata-token-ttl-seconds': '21600',
          },
        },
        {
          hostname: '169.254.169.254',
          port: 80,
          family: 4,
          method: 'GET',
          path: '/latest/meta-data/iam/security-credentials/',
          agent: false,
          maxHeaderSize: 8192,
          headers: {
            connection: 'close',
            'x-aws-ec2-metadata-token': IMDS_TOKEN,
          },
        },
        {
          hostname: '169.254.169.254',
          port: 80,
          family: 4,
          method: 'GET',
          path: `/latest/meta-data/iam/security-credentials/${ROLE_NAME}`,
          agent: false,
          maxHeaderSize: 8192,
          headers: {
            connection: 'close',
            'x-aws-ec2-metadata-token': IMDS_TOKEN,
          },
        },
      ]);
      for (const pending of requests) {
        expect(pending.timeoutMilliseconds).toBe(1000);
        expect(pending.endCalls).toBe(1);
        expect(Object.isFrozen(pending.options)).toBe(true);
        expect(Object.isFrozen(pending.options.headers)).toBe(true);
      }
      expect(Object.keys(credentials)).toEqual([
        'accessKeyId',
        'secretAccessKey',
        'sessionToken',
        'expiration',
      ]);
      expect(credentials).toEqual({
        accessKeyId: 'ASIAEXAMPLE00000001',
        secretAccessKey: 'example-secret-access-key',
        sessionToken: 'example-session-token',
        expiration: new Date('2026-07-25T13:00:00Z'),
      });
      expect(Object.isFrozen(credentials)).toBe(true);
      expect(Object.isFrozen(credentials.expiration)).toBe(true);
    } finally {
      await source.close();
      if (savedEnvironment.endpoint === undefined) {
        delete process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT;
      } else {
        process.env.AWS_EC2_METADATA_SERVICE_ENDPOINT =
          savedEnvironment.endpoint;
      }
      if (savedEnvironment.accessKeyId === undefined) {
        delete process.env.AWS_ACCESS_KEY_ID;
      } else {
        process.env.AWS_ACCESS_KEY_ID = savedEnvironment.accessKeyId;
      }
      if (savedEnvironment.secretAccessKey === undefined) {
        delete process.env.AWS_SECRET_ACCESS_KEY;
      } else {
        process.env.AWS_SECRET_ACCESS_KEY = savedEnvironment.secretAccessKey;
      }
    }
  });

  it('rejects options instead of accepting an alternate metadata authority', () => {
    expect(() =>
      openAwsSingleNodeHostInstanceCredentialSource({
        endpoint: 'http://attacker.invalid',
      }),
    ).toThrow(
      'AWS single-node host instance credential source does not accept options.',
    );
    expect(request).not.toHaveBeenCalled();
  });

  it('coalesces a refresh and caches credentials only while more than five minutes remain', async () => {
    plans.push({ kind: 'hang' });
    const source = openAwsSingleNodeHostInstanceCredentialSource();

    const first = source.credentials();
    const coalesced = source.credentials();
    expect(coalesced).toBe(first);
    expect(request).toHaveBeenCalledTimes(1);

    requests[0].respond(200, IMDS_TOKEN);
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(2);
    requests[1].respond(200, ROLE_NAME);
    await flushPromises();
    expect(request).toHaveBeenCalledTimes(3);
    requests[2].respond(200, credentialDocument());
    const initialCredentials = await first;
    await expect(coalesced).resolves.toBe(initialCredentials);

    jest.setSystemTime(new Date('2026-07-25T12:54:59.000Z'));
    await expect(source.credentials()).resolves.toBe(initialCredentials);
    expect(request).toHaveBeenCalledTimes(3);

    queueCredentialRefresh(
      credentialDocument({
        AccessKeyId: 'ASIAEXAMPLE00000002',
        Expiration: '2026-07-25T14:00:00Z',
      }),
    );
    jest.setSystemTime(new Date('2026-07-25T12:55:00.000Z'));
    const rotated = await source.credentials();
    expect(rotated.accessKeyId).toBe('ASIAEXAMPLE00000002');
    expect(rotated).not.toBe(initialCredentials);
    expect(request).toHaveBeenCalledTimes(6);
    await source.close();
  });

  it('uses its internal expiry and never lets a mutated Date extend cached credentials', async () => {
    queueCredentialRefresh(
      credentialDocument({
        Expiration: '2026-07-25T12:06:00Z',
        AccountId: undefined,
      }),
    );
    const source = openAwsSingleNodeHostInstanceCredentialSource();
    const initial = await source.credentials();

    initial.expiration.setTime(Date.parse('2099-01-01T00:00:00Z'));
    queueCredentialRefresh(
      credentialDocument({
        AccessKeyId: 'ASIAEXAMPLE00000003',
        Expiration: '2026-07-25T13:00:00Z',
      }),
    );
    jest.setSystemTime(new Date('2026-07-25T12:06:01.000Z'));

    const rotated = await source.credentials();
    expect(rotated.accessKeyId).toBe('ASIAEXAMPLE00000003');
    expect(request).toHaveBeenCalledTimes(6);
    await source.close();
  });

  it('retains a still-valid cached credential only until its real expiry when refresh fails', async () => {
    queueCredentialRefresh(
      credentialDocument({
        Expiration: '2026-07-25T12:06:00Z',
      }),
    );
    const source = openAwsSingleNodeHostInstanceCredentialSource();
    const initial = await source.credentials();

    jest.setSystemTime(new Date('2026-07-25T12:01:00.000Z'));
    plans.push({ kind: 'response', statusCode: 500, body: 'unavailable' });
    await expect(source.credentials()).resolves.toBe(initial);
    expect(request).toHaveBeenCalledTimes(4);

    jest.setSystemTime(new Date('2026-07-25T12:06:00.001Z'));
    plans.push({ kind: 'response', statusCode: 500, body: 'unavailable' });
    await expect(source.credentials()).rejects.toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialRetrievalError,
    );
    expect(request).toHaveBeenCalledTimes(5);
    await source.close();
  });

  it.each([301, 403, 404, 500])(
    'rejects token status %i without redirect or IMDSv1 fallback',
    async (statusCode) => {
      plans.push({
        kind: 'response',
        statusCode,
        body: 'http://attacker.invalid/latest/meta-data/',
      });
      const source = openAwsSingleNodeHostInstanceCredentialSource();

      await expect(source.credentials()).rejects.toBeInstanceOf(
        AwsSingleNodeHostInstanceCredentialRetrievalError,
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(requests[0].options.method).toBe('PUT');
      expect(requests[0].destroyCalls).toBe(1);
      await source.close();
    },
  );

  it('rejects unsafe role names, failed AWS-HMAC documents, and expired documents', async () => {
    const cases = [
      {
        responses: [IMDS_TOKEN, '../ambient-role'],
        calls: 2,
      },
      {
        responses: [
          IMDS_TOKEN,
          ROLE_NAME,
          credentialDocument({
            Code: 'Error',
            SecretAccessKey: 'raw-secret-must-not-escape',
          }),
        ],
        calls: 3,
      },
      {
        responses: [
          IMDS_TOKEN,
          ROLE_NAME,
          credentialDocument({
            AccountId: 'not-an-account',
          }),
        ],
        calls: 3,
      },
      {
        responses: [
          IMDS_TOKEN,
          ROLE_NAME,
          credentialDocument({
            Expiration: '2026-07-25T11:59:59Z',
            Token: 'raw-token-must-not-escape',
          }),
        ],
        calls: 3,
      },
    ];

    for (const scenario of cases) {
      plans.push(
        ...scenario.responses.map((body) => ({
          kind: 'response',
          statusCode: 200,
          body,
        })),
      );
      const source = openAwsSingleNodeHostInstanceCredentialSource();
      const failure = await captureFailure(source.credentials());
      expect(failure).toBeInstanceOf(
        AwsSingleNodeHostInstanceCredentialRetrievalError,
      );
      expect(errorSurface(failure)).not.toContain('raw-secret-must-not-escape');
      expect(errorSurface(failure)).not.toContain('raw-token-must-not-escape');
      expect(request).toHaveBeenCalledTimes(scenario.calls);
      await source.close();
      request.mockClear();
      requests = [];
      plans = [];
    }
  });

  it('bounds token and credential-document response bodies', async () => {
    plans.push({
      kind: 'response',
      statusCode: 200,
      body: 't'.repeat(1025),
    });
    const tokenSource = openAwsSingleNodeHostInstanceCredentialSource();
    await expect(tokenSource.credentials()).rejects.toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialRetrievalError,
    );
    expect(requests[0].destroyCalls).toBe(1);
    await tokenSource.close();

    request.mockClear();
    requests = [];
    plans = [
      { kind: 'response', statusCode: 200, body: IMDS_TOKEN },
      { kind: 'response', statusCode: 200, body: 'r'.repeat(257) },
    ];
    const roleSource = openAwsSingleNodeHostInstanceCredentialSource();
    await expect(roleSource.credentials()).rejects.toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialRetrievalError,
    );
    expect(request).toHaveBeenCalledTimes(2);
    expect(requests[1].destroyCalls).toBe(1);
    await roleSource.close();

    request.mockClear();
    requests = [];
    plans = [
      { kind: 'response', statusCode: 200, body: IMDS_TOKEN },
      { kind: 'response', statusCode: 200, body: ROLE_NAME },
      { kind: 'response', statusCode: 200, body: 'x'.repeat(16 * 1024 + 1) },
    ];
    const documentSource = openAwsSingleNodeHostInstanceCredentialSource();
    await expect(documentSource.credentials()).rejects.toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialRetrievalError,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(requests[2].destroyCalls).toBe(1);
    await documentSource.close();
  });

  it('turns timeouts and raw transport failures into silent redacted errors', async () => {
    const consoleSpies = ['debug', 'info', 'warn', 'error', 'trace'].map(
      (method) =>
        jest
          .spyOn(console, /** @type {'debug'} */ (method))
          .mockImplementation(() => undefined),
    );
    plans.push({ kind: 'hang' });
    const timeoutSource = openAwsSingleNodeHostInstanceCredentialSource();
    const timeout = timeoutSource.credentials();
    const timeoutFailurePromise = captureFailure(timeout);
    await jest.advanceTimersByTimeAsync(1000);
    const timeoutFailure = await timeoutFailurePromise;
    expect(timeoutFailure).toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialRetrievalError,
    );
    expect(requests[0].destroyCalls).toBe(1);
    await timeoutSource.close();

    request.mockClear();
    requests = [];
    plans = [
      {
        kind: 'error',
        error: new Error('raw-transport-secret-must-not-escape'),
      },
    ];
    const transportSource = openAwsSingleNodeHostInstanceCredentialSource();
    const transportFailure = await captureFailure(
      transportSource.credentials(),
    );
    expect(transportFailure).toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialRetrievalError,
    );
    expect(errorSurface(transportFailure)).not.toContain(
      'raw-transport-secret-must-not-escape',
    );
    expect(requests[0].destroyCalls).toBe(1);
    await transportSource.close();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  it('fences calls, cancels active requests, drains refresh, and memoizes close', async () => {
    plans.push({ kind: 'hang' });
    const source = openAwsSingleNodeHostInstanceCredentialSource();
    const pending = source.credentials();
    expect(request).toHaveBeenCalledTimes(1);

    const firstClose = source.close();
    const secondClose = source.close();
    expect(secondClose).toBe(firstClose);
    expect(requests[0].destroyCalls).toBe(1);
    expect(() => source.credentials()).toThrow(
      AwsSingleNodeHostInstanceCredentialSourceClosedError,
    );
    await expect(pending).rejects.toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialSourceClosedError,
    );
    await expect(firstClose).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(1);
    expect(requests[0].destroyCalls).toBe(1);
  });

  it('redacts destroy failures while still draining and memoizing close', async () => {
    plans.push({
      kind: 'hang',
      requestDestroyError: new Error('raw-destroy-credential-must-not-escape'),
    });
    const source = openAwsSingleNodeHostInstanceCredentialSource();
    const pending = source.credentials();
    const close = source.close();

    await expect(pending).rejects.toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialSourceClosedError,
    );
    const failure = await captureFailure(close);
    expect(failure).toBeInstanceOf(
      AwsSingleNodeHostInstanceCredentialSourceCloseError,
    );
    expect(errorSurface(failure)).not.toContain(
      'raw-destroy-credential-must-not-escape',
    );
    expect(source.close()).toBe(close);
    await expect(source.close()).rejects.toBe(failure);
    expect(requests[0].destroyCalls).toBe(1);
  });
});
