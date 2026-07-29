import { describe, expect, it } from '@jest/globals';
import {
  decodeHetznerAction,
  decodeHetznerFirewall,
  decodeHetznerImage,
  decodeHetznerLocation,
  decodeHetznerPagination,
  decodeHetznerPrimaryIp,
  decodeHetznerPrimaryIpCreationResponse,
  decodeHetznerServer,
  decodeHetznerServerCreationResponse,
  decodeHetznerServerType,
} from '../../../../src/core/runtime/providers/hetzner/api-documents.js';

function location(overrides = {}) {
  return {
    id: 9,
    name: 'ash',
    city: 'Ashburn, VA',
    country: 'US',
    network_zone: 'us-east',
    ...overrides,
  };
}

function action(overrides = {}) {
  return {
    id: 101,
    status: 'running',
    command: 'create_server',
    progress: 25,
    error: null,
    started: '2026-07-29T12:00:00+00:00',
    finished: null,
    resources: [{ id: 42, type: 'server' }],
    ...overrides,
  };
}

function server(overrides = {}) {
  return {
    id: 42,
    name: 'wharfie-demo',
    status: 'running',
    public_net: {
      ipv4: {
        id: 6,
        ip: '203.0.113.7',
        blocked: false,
        dns_ptr: 'host.example',
      },
      ipv6: null,
      floating_ips: [],
      firewalls: [{ id: 5, status: 'applied' }],
    },
    location: location(),
    server_type: { id: 1, name: 'cx23', ignored: true },
    image: { id: 2, name: 'ubuntu-24.04' },
    labels: { 'wharfie.deployment': 'demo' },
    locked: false,
    protection: { delete: false, rebuild: false },
    ignored: 'provider fields are intentionally ignored',
    ...overrides,
  };
}

describe('Hetzner API response documents', () => {
  it('projects and freezes only the location fields used by deployment', () => {
    const result = decodeHetznerLocation({
      id: 1,
      name: 'ash',
      city: 'Ashburn, VA',
      country: 'US',
      network_zone: 'us-east',
      description: 'ignored',
    });

    expect(result).toEqual({
      id: 1,
      name: 'ash',
      city: 'Ashburn, VA',
      country: 'US',
      networkZone: 'us-east',
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('projects server type and image selection evidence', () => {
    expect(
      decodeHetznerServerType({
        id: 3,
        name: 'cax11',
        architecture: 'arm',
        cores: 2,
        memory: 4,
        disk: 40,
        deprecated: false,
        deprecation: null,
        locations: [
          {
            id: 9,
            name: 'ash',
            available: true,
            recommended: true,
            deprecation: null,
          },
          {
            id: 10,
            name: 'hil',
            available: false,
            recommended: false,
            deprecation: {
              announced: '2026-01-01T00:00:00+00:00',
              unavailable_after: '2026-08-01T00:00:00+00:00',
            },
          },
        ],
        prices: [],
      }),
    ).toEqual({
      id: 3,
      name: 'cax11',
      architecture: 'arm',
      cores: 2,
      memory: 4,
      disk: 40,
      locations: [
        {
          id: 9,
          name: 'ash',
          available: true,
          recommended: true,
          deprecation: null,
        },
        {
          id: 10,
          name: 'hil',
          available: false,
          recommended: false,
          deprecation: {
            announced: '2026-01-01T00:00:00+00:00',
            unavailableAfter: '2026-08-01T00:00:00+00:00',
          },
        },
      ],
    });
    expect(
      decodeHetznerImage({
        id: 4,
        name: 'ubuntu-24.04',
        description: 'Ubuntu 24.04',
        type: 'system',
        status: 'available',
        architecture: 'x86',
        os_flavor: 'ubuntu',
        os_version: '24.04',
        rapid_deploy: true,
        deprecated: '2026-10-01T00:00:00+00:00',
      }),
    ).toMatchObject({
      id: 4,
      name: 'ubuntu-24.04',
      architecture: 'x86',
      osFlavor: 'ubuntu',
      osVersion: '24.04',
      rapidDeploy: true,
      deprecatedAt: '2026-10-01T00:00:00+00:00',
    });
  });

  it('projects ownership and address evidence from mutable resources', () => {
    const firewall = decodeHetznerFirewall({
      id: 5,
      name: 'wharfie-demo',
      labels: { owner: 'wharfie' },
      rules: [
        {
          direction: 'in',
          source_ips: ['203.0.113.9/32'],
          destination_ips: [],
          protocol: 'tcp',
          port: '22',
          description: 'SSH',
        },
      ],
      applied_to: [{ type: 'server', server: { id: 42 } }],
    });
    const primaryIp = decodeHetznerPrimaryIp({
      id: 6,
      name: 'wharfie-demo',
      ip: '203.0.113.7',
      type: 'ipv4',
      assignee_id: 42,
      assignee_type: 'server',
      auto_delete: false,
      blocked: false,
      location: location(),
      labels: { owner: 'wharfie' },
      protection: { delete: false },
    });
    const decodedServer = decodeHetznerServer(server());

    expect(firewall).toEqual({
      id: 5,
      name: 'wharfie-demo',
      labels: { owner: 'wharfie' },
      rules: [
        {
          direction: 'in',
          sourceIps: ['203.0.113.9/32'],
          destinationIps: [],
          protocol: 'tcp',
          port: '22',
          description: 'SSH',
        },
      ],
      appliedTo: [
        {
          type: 'server',
          serverId: 42,
          labelSelector: null,
          appliedToResources: [],
        },
      ],
    });
    expect(primaryIp).toEqual({
      id: 6,
      name: 'wharfie-demo',
      ip: '203.0.113.7',
      type: 'ipv4',
      assigneeId: 42,
      assigneeType: 'server',
      autoDelete: false,
      blocked: false,
      location: {
        id: 9,
        name: 'ash',
        city: 'Ashburn, VA',
        country: 'US',
        networkZone: 'us-east',
      },
      labels: { owner: 'wharfie' },
      deleteProtected: false,
    });
    expect(decodedServer).toMatchObject({
      id: 42,
      publicIpv4: { id: 6, ip: '203.0.113.7', blocked: false },
      publicIpv6: null,
      firewalls: [{ id: 5, status: 'applied' }],
      location: { id: 9, name: 'ash' },
      serverType: { id: 1, name: 'cx23' },
      image: { id: 2, name: 'ubuntu-24.04' },
    });
    expect(Object.isFrozen(decodedServer.labels)).toBe(true);
    expect(Object.isFrozen(decodedServer.serverType)).toBe(true);
  });

  it('projects exact public IPv6 state when the provider assigned it', () => {
    const decoded = decodeHetznerServer(
      server({
        public_net: {
          ipv4: {
            id: 6,
            ip: '203.0.113.7',
            blocked: false,
          },
          ipv6: {
            id: 7,
            ip: '2001:db8:1234::/64',
            blocked: false,
            dns_ptr: [],
          },
          floating_ips: [],
          firewalls: [{ id: 5, status: 'applied' }],
        },
      }),
    );

    expect(decoded.publicIpv6).toEqual({
      id: 7,
      ip: '2001:db8:1234::/64',
      blocked: false,
    });
    expect(Object.isFrozen(decoded.publicIpv6)).toBe(true);
  });

  it('decodes official pagination and nullable Primary IP create actions', () => {
    expect(
      decodeHetznerPagination({
        meta: {
          pagination: {
            page: 2,
            per_page: 25,
            previous_page: 1,
            next_page: 3,
            last_page: 3,
            total_entries: 60,
          },
        },
      }),
    ).toEqual({
      page: 2,
      perPage: 25,
      previousPage: 1,
      nextPage: 3,
      lastPage: 3,
      totalEntries: 60,
    });

    const result = decodeHetznerPrimaryIpCreationResponse({
      primary_ip: {
        id: 6,
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
      },
      action: null,
    });
    expect(result.action).toBeNull();
    expect(result.primaryIp.location.name).toBe('ash');
  });

  it('projects terminal action errors for safe higher-level handling', () => {
    const result = decodeHetznerAction(
      action({
        status: 'error',
        progress: 100,
        error: { code: 'resource_limit_exceeded', message: 'unsafe detail' },
        finished: '2026-07-29T12:01:00+00:00',
      }),
    );

    expect(result).toMatchObject({
      id: 101,
      status: 'error',
      error: {
        code: 'resource_limit_exceeded',
      },
    });
    expect(result.error).not.toHaveProperty('message');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.error)).toBe(true);
  });

  it('decodes the server creation action chain and ignores extra fields', () => {
    const result = decodeHetznerServerCreationResponse({
      server: server(),
      action: action(),
      next_actions: [
        action({ id: 102, command: 'attach_firewall', progress: 0 }),
      ],
      root_password: 'must not be retained',
    });

    expect(result.server.id).toBe(42);
    expect(result.action.id).toBe(101);
    expect(result.nextActions.map(({ id }) => id)).toEqual([102]);
    expect(result).not.toHaveProperty('root_password');
    expect(Object.isFrozen(result.nextActions)).toBe(true);
  });

  it.each([
    ['location without an ID', () => decodeHetznerLocation({ name: 'ash' })],
    [
      'server with malformed labels',
      () => decodeHetznerServer(server({ labels: { owner: 7 } })),
    ],
    [
      'server with malformed public IPv6',
      () =>
        decodeHetznerServer(
          server({
            public_net: {
              ipv4: { id: 6, ip: '203.0.113.7', blocked: false },
              ipv6: { id: 7, ip: '2001:db8::/64', blocked: 'false' },
              floating_ips: [],
              firewalls: [],
            },
          }),
        ),
    ],
    [
      'primary IP with an unsafe ID',
      () =>
        decodeHetznerPrimaryIp({
          id: 0,
          name: 'ip',
          ip: '203.0.113.7',
          type: 'ipv4',
          assignee_id: null,
          assignee_type: 'server',
          auto_delete: false,
          labels: {},
          protection: { delete: false },
        }),
    ],
    [
      'action with a malformed terminal code',
      () =>
        decodeHetznerAction(
          action({ status: 'error', error: { code: 7, message: 'ignored' } }),
        ),
    ],
  ])('rejects %s with one fixed validation error', (_name, decode) => {
    expect(decode).toThrow(
      new TypeError('Hetzner API response document is invalid.'),
    );
  });
});
