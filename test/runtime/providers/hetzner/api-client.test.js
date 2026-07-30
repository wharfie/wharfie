import { describe, expect, it, jest } from '@jest/globals';
import {
  createHetznerApiClient,
  createHetznerApiClientForTest,
  HetznerApiError,
} from '../../../../src/core/runtime/providers/hetzner/api-client.js';

const TOKEN = 'hcloud-test-token';
const BASE_URL = 'https://api.example.test/v1';

/**
 * @param {unknown} document - JSON document.
 * @param {{status?: number, headers?: Record<string, string>}} [init] - Init.
 * @returns {Response} - Response.
 */
function jsonResponse(document, init = {}) {
  return new Response(JSON.stringify(document), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
}

/**
 * @param {Record<string, any[]>} document - One list payload.
 * @param {Record<string, any>} [overrides] - Pagination overrides.
 * @returns {Record<string, any>} - Paginated document.
 */
function listDocument(document, overrides = {}) {
  const itemCount = Object.values(document)[0].length;
  return {
    ...document,
    meta: {
      pagination: {
        page: 1,
        per_page: 25,
        previous_page: null,
        next_page: null,
        last_page: 1,
        total_entries: itemCount,
        ...overrides,
      },
    },
  };
}

function location(overrides = {}) {
  return {
    id: 1,
    name: 'ash',
    city: 'Ashburn, VA',
    country: 'US',
    network_zone: 'us-east',
    ...overrides,
  };
}

function serverType(overrides = {}) {
  return {
    id: 2,
    name: 'cx23',
    architecture: 'x86',
    cores: 2,
    memory: 4,
    disk: 40,
    deprecated: false,
    deprecation: null,
    locations: [
      {
        id: 1,
        name: 'ash',
        available: true,
        recommended: true,
        deprecation: null,
      },
    ],
    ...overrides,
  };
}

function image(overrides = {}) {
  return {
    id: 3,
    name: 'ubuntu-24.04',
    description: 'Ubuntu 24.04',
    type: 'system',
    status: 'available',
    architecture: 'x86',
    os_flavor: 'ubuntu',
    os_version: '24.04',
    rapid_deploy: true,
    deprecated: null,
    ...overrides,
  };
}

function firewall(overrides = {}) {
  return {
    id: 4,
    name: 'wharfie-demo',
    labels: { owner: 'wharfie' },
    rules: [],
    applied_to: [],
    ...overrides,
  };
}

function primaryIp(overrides = {}) {
  return {
    id: 5,
    name: 'wharfie-demo',
    ip: '203.0.113.7',
    type: 'ipv4',
    assignee_id: null,
    assignee_type: 'server',
    auto_delete: false,
    blocked: false,
    location: location(),
    labels: { owner: 'wharfie' },
    protection: { delete: false },
    ...overrides,
  };
}

function server(overrides = {}) {
  return {
    id: 6,
    name: 'wharfie-demo',
    status: 'running',
    public_net: {
      ipv4: { id: 5, ip: '203.0.113.7', blocked: false },
      firewalls: [{ id: 4, status: 'applied' }],
    },
    location: location(),
    server_type: { id: 2, name: 'cx23' },
    image: { id: 3, name: 'ubuntu-24.04' },
    labels: { owner: 'wharfie' },
    locked: false,
    protection: { delete: false },
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    id: 7,
    status: 'success',
    command: 'create_server',
    progress: 100,
    error: null,
    started: null,
    finished: null,
    ...overrides,
  };
}

/**
 * @param {(...args: any[]) => Promise<Response>} fetchImplementation - Fetch.
 * @param {Record<string, any>} [overrides] - Internal option overrides.
 * @returns {Readonly<Record<string, Function>>} - Test client.
 */
function clientWith(fetchImplementation, overrides = {}) {
  return createHetznerApiClientForTest({
    token: TOKEN,
    fetchImplementation,
    baseUrl: BASE_URL,
    maxGetAttempts: 3,
    waitForRetry: async () => {},
    ...overrides,
  });
}

/**
 * @param {(...args: any[]) => Promise<Response>} implementation - Behavior.
 * @returns {jest.Mock<(...args: any[]) => Promise<Response>>} - Fetch mock.
 */
function fetchMock(implementation) {
  return jest.fn(implementation);
}

describe('Hetzner API client', () => {
  it('uses bearer authentication, redirect refusal, and mapped list filters', async () => {
    const fetchImplementation = fetchMock(async () =>
      jsonResponse(listDocument({ servers: [server()] }, { per_page: 50 })),
    );
    const client = clientWith(fetchImplementation);

    await expect(
      client.listServers({
        name: 'wharfie-demo',
        labelSelector: 'owner=wharfie',
        status: 'running',
        perPage: 50,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 6, name: 'wharfie-demo' }),
    ]);

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url).toBe(
      `${BASE_URL}/servers?name=wharfie-demo&label_selector=owner%3Dwharfie&status=running&per_page=50&page=1`,
    );
    expect(request).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${TOKEN}`,
        'user-agent': 'wharfie-self-deployment/1',
      },
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request).not.toHaveProperty('body');
  });

  it('uses only each endpoint current list query contract', async () => {
    const responses = [
      listDocument({ locations: [location()] }),
      listDocument({ server_types: [serverType()] }),
      listDocument({ images: [image()] }),
      listDocument({ firewalls: [firewall()] }),
      listDocument({ primary_ips: [primaryIp()] }),
    ];
    const fetchImplementation = fetchMock(async () => {
      const document = responses.shift();
      if (document === undefined) throw new Error('No response queued.');
      return jsonResponse(document);
    });
    const client = clientWith(fetchImplementation);

    await client.listLocations({ name: 'ash', sort: 'name', perPage: 50 });
    await client.listServerTypes({ name: 'cx23', perPage: 50 });
    await client.listImages({
      name: 'ubuntu-24.04',
      type: 'system',
      status: 'available',
      architecture: 'x86',
      includeDeprecated: false,
      boundTo: 6,
      sort: 'name',
      perPage: 50,
    });
    await client.listFirewalls({
      name: 'wharfie-demo',
      labelSelector: 'owner=wharfie',
      sort: 'name',
      perPage: 50,
    });
    await client.listPrimaryIps({
      name: 'wharfie-demo',
      labelSelector: 'owner=wharfie',
      ip: '203.0.113.7',
      sort: 'name',
      perPage: 50,
    });

    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      `${BASE_URL}/locations?name=ash&sort=name&per_page=50&page=1`,
      `${BASE_URL}/server_types?name=cx23&per_page=50&page=1`,
      `${BASE_URL}/images?name=ubuntu-24.04&type=system&status=available&architecture=x86&include_deprecated=false&bound_to=6&sort=name&per_page=50&page=1`,
      `${BASE_URL}/firewalls?name=wharfie-demo&label_selector=owner%3Dwharfie&sort=name&per_page=50&page=1`,
      `${BASE_URL}/primary_ips?name=wharfie-demo&label_selector=owner%3Dwharfie&ip=203.0.113.7&sort=name&per_page=50&page=1`,
    ]);

    await expect(
      client.listServerTypes({ architecture: 'x86' }),
    ).rejects.toThrow('Hetzner API request is invalid.');
    await expect(
      client.listLocations({ labelSelector: 'owner=wharfie' }),
    ).rejects.toThrow('Hetzner API request is invalid.');
    await expect(client.listFirewalls({ status: 'applied' })).rejects.toThrow(
      'Hetzner API request is invalid.',
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
  });

  it('automatically follows bounded pagination while preserving filters', async () => {
    const responses = [
      listDocument(
        { servers: [server()] },
        {
          per_page: 1,
          next_page: 2,
          last_page: 2,
          total_entries: 2,
        },
      ),
      listDocument(
        { servers: [server({ id: 9, name: 'wharfie-second' })] },
        {
          page: 2,
          per_page: 1,
          previous_page: 1,
          last_page: 2,
          total_entries: 2,
        },
      ),
    ];
    const fetchImplementation = fetchMock(async () => {
      const document = responses.shift();
      if (document === undefined) throw new Error('No response queued.');
      return jsonResponse(document);
    });
    const client = clientWith(fetchImplementation);

    await expect(
      client.listServers({
        labelSelector: 'owner=wharfie',
        status: 'running',
        perPage: 1,
      }),
    ).resolves.toEqual([
      expect.objectContaining({ id: 6 }),
      expect.objectContaining({ id: 9 }),
    ]);
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      `${BASE_URL}/servers?label_selector=owner%3Dwharfie&status=running&per_page=1&page=1`,
      `${BASE_URL}/servers?label_selector=owner%3Dwharfie&status=running&per_page=1&page=2`,
    ]);
  });

  it('follows official pagination when totals and the last page are null', async () => {
    const responses = [
      listDocument(
        { locations: [location()] },
        {
          per_page: 1,
          next_page: 2,
          last_page: null,
          total_entries: null,
        },
      ),
      listDocument(
        { locations: [location({ id: 2, name: 'hil' })] },
        {
          page: 2,
          per_page: 1,
          previous_page: 1,
          last_page: null,
          total_entries: null,
        },
      ),
    ];
    const fetchImplementation = fetchMock(async () => {
      const document = responses.shift();
      if (document === undefined) throw new Error('No response queued.');
      return jsonResponse(document);
    });
    const client = clientWith(fetchImplementation);

    await expect(client.listLocations({ perPage: 1 })).resolves.toEqual([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({ id: 2 }),
    ]);
    expect(fetchImplementation.mock.calls.map(([url]) => url)).toEqual([
      `${BASE_URL}/locations?per_page=1&page=1`,
      `${BASE_URL}/locations?per_page=1&page=2`,
    ]);
  });

  it('rejects malformed, looping, duplicate, and excessive pagination', async () => {
    const malformed = clientWith(
      fetchMock(async () =>
        jsonResponse(
          listDocument(
            { locations: [location()] },
            {
              next_page: 1,
              last_page: 2,
              total_entries: 2,
            },
          ),
        ),
      ),
    );
    await expect(malformed.listLocations()).rejects.toThrow(
      'Hetzner API response document is invalid.',
    );

    const duplicateResponses = [
      listDocument(
        { locations: [location()] },
        { next_page: 2, last_page: 2, total_entries: 2 },
      ),
      listDocument(
        { locations: [location()] },
        {
          page: 2,
          previous_page: 1,
          last_page: 2,
          total_entries: 2,
        },
      ),
    ];
    const duplicate = clientWith(
      fetchMock(async () => {
        const document = duplicateResponses.shift();
        if (document === undefined) throw new Error('No response queued.');
        return jsonResponse(document);
      }),
    );
    await expect(duplicate.listLocations()).rejects.toMatchObject({
      code: 'HETZNER_API_PAGINATION_INVALID',
    });

    const excessiveFetch = fetchMock(async (url) => {
      const page = Number(new URL(url).searchParams.get('page'));
      return jsonResponse(
        listDocument(
          { locations: [location({ id: page, name: `location-${page}` })] },
          {
            page,
            per_page: 1,
            previous_page: page === 1 ? null : page - 1,
            next_page: page + 1,
            last_page: 101,
            total_entries: 101,
          },
        ),
      );
    });
    const excessive = clientWith(excessiveFetch);
    await expect(excessive.listLocations()).rejects.toMatchObject({
      code: 'HETZNER_API_PAGINATION_INVALID',
    });
    expect(excessiveFetch).toHaveBeenCalledTimes(100);
  });

  it('exposes only the preview resource methods and exact action lookup', () => {
    const client = clientWith(fetchMock(async () => jsonResponse({})));
    expect(Object.keys(client).sort()).toEqual(
      [
        'createFirewall',
        'createPrimaryIp',
        'createServer',
        'deleteFirewall',
        'deletePrimaryIp',
        'deleteServer',
        'getAction',
        'getFirewall',
        'getImage',
        'getLocation',
        'getPrimaryIp',
        'getServer',
        'getServerType',
        'listFirewalls',
        'listImages',
        'listLocations',
        'listPrimaryIps',
        'listServerTypes',
        'listServers',
      ].sort(),
    );
    expect(client).not.toHaveProperty('listActions');
    expect(client).not.toHaveProperty('createSshKey');
    expect(Object.isFrozen(client)).toBe(true);
  });

  it.each([
    ['listLocations', [{ locations: [location()] }], 1],
    ['getLocation', [{ location: location() }, 1], 1],
    ['listServerTypes', [{ server_types: [serverType()] }], 2],
    ['getServerType', [{ server_type: serverType() }, 2], 2],
    ['listImages', [{ images: [image()] }], 3],
    ['getImage', [{ image: image() }, 3], 3],
    ['listFirewalls', [{ firewalls: [firewall()] }], 4],
    ['getFirewall', [{ firewall: firewall() }, 4], 4],
    ['listPrimaryIps', [{ primary_ips: [primaryIp()] }], 5],
    ['getPrimaryIp', [{ primary_ip: primaryIp() }, 5], 5],
    ['getServer', [{ server: server() }, 6], 6],
    ['getAction', [{ action: action() }, 7], 7],
  ])(
    'decodes %s response documents',
    async (method, [document, argument], id) => {
      const responseDocument = method.startsWith('list')
        ? listDocument(/** @type {Record<string, any[]>} */ (document))
        : document;
      const client = clientWith(
        fetchMock(async () => jsonResponse(responseDocument)),
      );
      const result = await client[method](argument);
      if (Array.isArray(result)) {
        expect(result[0].id).toBe(id);
        expect(Object.isFrozen(result)).toBe(true);
      } else {
        expect(result.id).toBe(id);
        expect(Object.isFrozen(result)).toBe(true);
      }
    },
  );

  it('sends each mutation once and decodes its creation evidence', async () => {
    const responses = [
      jsonResponse(
        { firewall: firewall(), actions: [action()] },
        { status: 201 },
      ),
      new Response(null, { status: 204 }),
      jsonResponse(
        { primary_ip: primaryIp(), action: action() },
        { status: 201 },
      ),
      new Response(null, { status: 204 }),
      jsonResponse(
        {
          server: server(),
          action: action(),
          next_actions: [action({ id: 8, command: 'attach_firewall' })],
        },
        { status: 201 },
      ),
      jsonResponse({ action: action({ command: 'delete_server' }) }),
    ];
    const fetchImplementation = fetchMock(async () => {
      const response = responses.shift();
      if (response === undefined) throw new Error('No response queued.');
      return response;
    });
    const client = clientWith(fetchImplementation);

    await expect(
      client.createFirewall({ name: 'wharfie-demo', rules: [] }),
    ).resolves.toMatchObject({ firewall: { id: 4 } });
    await expect(client.deleteFirewall(4)).resolves.toBeUndefined();
    await expect(
      client.createPrimaryIp({
        name: 'wharfie-demo',
        type: 'ipv4',
        location: 'ash',
      }),
    ).resolves.toMatchObject({ primaryIp: { id: 5 } });
    await expect(client.deletePrimaryIp(5)).resolves.toBeUndefined();
    await expect(
      client.createServer({ name: 'wharfie-demo', server_type: 2, image: 3 }),
    ).resolves.toMatchObject({
      server: { id: 6 },
      action: { id: 7 },
      nextActions: [{ id: 8 }],
    });
    await expect(client.deleteServer(6)).resolves.toMatchObject({
      id: 7,
      status: 'success',
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    expect(
      fetchImplementation.mock.calls.map(([url, request]) => [
        url,
        request.method,
      ]),
    ).toEqual([
      [`${BASE_URL}/firewalls`, 'POST'],
      [`${BASE_URL}/firewalls/4`, 'DELETE'],
      [`${BASE_URL}/primary_ips`, 'POST'],
      [`${BASE_URL}/primary_ips/5`, 'DELETE'],
      [`${BASE_URL}/servers`, 'POST'],
      [`${BASE_URL}/servers/6`, 'DELETE'],
    ]);
    expect(JSON.parse(fetchImplementation.mock.calls[0][1].body)).toEqual({
      name: 'wharfie-demo',
      rules: [],
    });
  });

  it('retries only GET transport and retryable status failures', async () => {
    const responses = [
      new TypeError('network down'),
      jsonResponse(
        { error: { code: 'rate_limit_exceeded', message: 'slow down' } },
        { status: 429 },
      ),
      jsonResponse(listDocument({ locations: [location()] })),
    ];
    const fetchImplementation = fetchMock(async () => {
      const response = responses.shift();
      if (response === undefined) throw new Error('No response queued.');
      if (response instanceof Error) throw response;
      return response;
    });
    const waitForRetry = jest.fn(async () => {});
    const client = clientWith(fetchImplementation, { waitForRetry });

    await expect(client.listLocations()).resolves.toHaveLength(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(waitForRetry.mock.calls).toEqual([
      [1, null],
      [2, 429],
    ]);
  });

  it('never retries mutations when a response or transport result is uncertain', async () => {
    const providerFailure = fetchMock(async () =>
      jsonResponse(
        { error: { code: 'rate_limit_exceeded', message: 'do not reflect' } },
        { status: 503 },
      ),
    );
    const firstClient = clientWith(providerFailure);
    await expect(
      firstClient.createFirewall({ name: 'demo', rules: [] }),
    ).rejects.toMatchObject({
      code: 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
      status: 503,
      retryable: false,
    });
    expect(providerFailure).toHaveBeenCalledTimes(1);

    const transportFailure = fetchMock(async () => {
      throw new Error(`request failed with ${TOKEN}`);
    });
    const secondClient = clientWith(transportFailure);
    const error = await secondClient
      .deleteServer(6)
      .catch((/** @type {any} */ failure) => failure);
    expect(error).toMatchObject({
      code: 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(error.message).not.toContain(TOKEN);
    expect(transportFailure).toHaveBeenCalledTimes(1);
  });

  it.each([408, 429, 500, 503, 599])(
    'classifies mutation status %i as unknown without retry',
    async (status) => {
      const fetchImplementation = fetchMock(async () =>
        jsonResponse(
          { error: { code: 'temporarily_unavailable', message: 'unsafe' } },
          { status },
        ),
      );
      const client = clientWith(fetchImplementation);

      await expect(
        client.createServer({ name: 'demo', server_type: 2, image: 3 }),
      ).rejects.toMatchObject({
        code: 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
        status,
        retryable: false,
      });
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it('classifies malformed successful mutation bodies as outcome unknown', async () => {
    const unsafeBody = `{"credential":"${TOKEN}"`;
    const fetchImplementation = fetchMock(
      async () => new Response(unsafeBody, { status: 201 }),
    );
    const client = clientWith(fetchImplementation);

    const error = await client
      .createServer({ name: 'demo', server_type: 2, image: 3 })
      .catch((/** @type {any} */ failure) => failure);
    expect(error).toMatchObject({
      code: 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
      status: 201,
      retryable: false,
    });
    expect(error.message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('classifies invalid successful creation documents as outcome unknown', async () => {
    const fetchImplementation = fetchMock(async () =>
      jsonResponse(
        {
          firewall: {
            id: 4,
            name: 'demo',
            labels: {},
            rules: 'changed-provider-shape',
            applied_to: [],
          },
          actions: [],
          reflected_secret: TOKEN,
        },
        { status: 201 },
      ),
    );
    const client = clientWith(fetchImplementation);

    const error = await client
      .createFirewall({ name: 'demo', rules: [] })
      .catch((/** @type {any} */ failure) => failure);
    expect(error).toMatchObject({
      code: 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(error.message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('classifies an unexpected successful delete document as outcome unknown', async () => {
    const fetchImplementation = fetchMock(async () =>
      jsonResponse(
        { unexpected: 'shape', reflected_secret: TOKEN },
        { status: 200 },
      ),
    );
    const client = clientWith(fetchImplementation);

    const error = await client
      .deleteFirewall(4)
      .catch((/** @type {any} */ failure) => failure);
    expect(error).toMatchObject({
      code: 'HETZNER_API_MUTATION_OUTCOME_UNKNOWN',
      retryable: false,
    });
    expect(error.message).not.toContain(TOKEN);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('returns safe status metadata without provider messages or credentials', async () => {
    const unsafeMessage = `bad token ${TOKEN}`;
    const client = clientWith(
      fetchMock(async () =>
        jsonResponse(
          {
            error: {
              code: 'unauthorized',
              message: unsafeMessage,
              details: { credential: TOKEN },
            },
          },
          {
            status: 401,
            headers: { 'x-request-id': 'request-safe-123' },
          },
        ),
      ),
      { maxGetAttempts: 1 },
    );

    const error = await client
      .getServer(6)
      .catch((/** @type {any} */ failure) => failure);
    expect(error).toBeInstanceOf(HetznerApiError);
    expect(error).toMatchObject({
      code: 'HETZNER_API_REQUEST_FAILED',
      status: 401,
      providerCode: 'unauthorized',
      requestId: 'request-safe-123',
      retryable: false,
    });
    expect(error.message).not.toContain(unsafeMessage);
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it('rejects oversized and malformed successful JSON documents', async () => {
    const oversizedClient = clientWith(
      fetchMock(
        async () =>
          new Response('{}', {
            status: 200,
            headers: { 'content-length': String(1024 * 1024 + 1) },
          }),
      ),
    );
    await expect(oversizedClient.listLocations()).rejects.toMatchObject({
      code: 'HETZNER_API_RESPONSE_TOO_LARGE',
    });

    const streamedClient = clientWith(
      fetchMock(async () => {
        const chunk = new Uint8Array(600 * 1024);
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(chunk);
              controller.enqueue(chunk);
              controller.close();
            },
          }),
          { status: 200 },
        );
      }),
    );
    await expect(streamedClient.listLocations()).rejects.toMatchObject({
      code: 'HETZNER_API_RESPONSE_TOO_LARGE',
    });

    const malformedClient = clientWith(
      fetchMock(async () => new Response('{', { status: 200 })),
    );
    await expect(malformedClient.listLocations()).rejects.toMatchObject({
      code: 'HETZNER_API_RESPONSE_INVALID',
    });
  });

  it('rejects invalid IDs, queries, and request bodies before fetch', async () => {
    const fetchImplementation = fetchMock(async () => jsonResponse({}));
    const client = clientWith(fetchImplementation);

    await expect(client.getServer(0)).rejects.toThrow(
      'Hetzner API request is invalid.',
    );
    await expect(client.listServers({ unknown: true })).rejects.toThrow(
      'Hetzner API request is invalid.',
    );
    await expect(client.listServers({ page: 2 })).rejects.toThrow(
      'Hetzner API request is invalid.',
    );
    await expect(client.listServers({ name: true })).rejects.toThrow(
      'Hetzner API request is invalid.',
    );
    await expect(
      client.listImages({ includeDeprecated: 'false' }),
    ).rejects.toThrow('Hetzner API request is invalid.');
    await expect(client.createServer(null)).rejects.toThrow(
      'Hetzner API request is invalid.',
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('keeps the production endpoint and fetch authority non-injectable', () => {
    expect(() =>
      createHetznerApiClient({
        token: TOKEN,
        baseUrl: BASE_URL,
      }),
    ).toThrow('Hetzner API client options are invalid.');
    expect(() =>
      createHetznerApiClient({ token: TOKEN, fetchImplementation: jest.fn() }),
    ).toThrow('Hetzner API client options are invalid.');
    expect(() => createHetznerApiClient({ token: 'unsafe\nheader' })).toThrow(
      'Hetzner API client options are invalid.',
    );
    expect(() => createHetznerApiClient({ token: 'x'.repeat(513) })).toThrow(
      'Hetzner API client options are invalid.',
    );
  });
});
