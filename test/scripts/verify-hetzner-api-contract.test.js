import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { createHetznerApiClientForTest } from '../../src/core/runtime/providers/hetzner/api-client.js';
import { checkHetznerApiContract } from '../../scripts/verify-hetzner-api-contract.js';

/**
 * @param {string} key - Collection key.
 * @param {any[]} items - Provider items.
 * @returns {Response} - One-page list response.
 */
function listResponse(key, items) {
  return new Response(
    JSON.stringify({
      [key]: items,
      meta: {
        pagination: {
          page: 1,
          per_page: 50,
          previous_page: null,
          next_page: null,
          last_page: 1,
          total_entries: items.length,
        },
      },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** @param {Record<string, any>} [overrides] - Image field overrides. */
function productionImage(overrides = {}) {
  return {
    id: 161547269,
    name: 'ubuntu-24.04',
    architecture: 'x86',
    bound_to: null,
    created: '2024-04-25T13:26:27Z',
    created_from: null,
    deleted: null,
    deprecation: null,
    description: 'Ubuntu 24.04',
    disk_size: 5,
    image_size: null,
    labels: {},
    os_flavor: 'ubuntu',
    os_version: '24.04',
    protection: { delete: false },
    rapid_deploy: true,
    status: 'available',
    type: 'system',
    ...overrides,
  };
}

/** @param {string} name @param {boolean} available */
function serverType(name, available) {
  return {
    id: { cx23: 114, cpx12: 108, cpx22: 109 }[name],
    name,
    architecture: 'x86',
    cores: 1,
    memory: 2,
    disk: 40,
    deprecation: null,
    locations: [
      { id: 1, name: 'fsn1', available, recommended: false, deprecation: null },
    ],
  };
}

/**
 * @param {{images?: any[], serverTypes?: any[], requests?: {method: string, url: URL}[]}} [options] - Catalog variations.
 * @returns {Readonly<Record<string, Function>>} - Read client over a fake API.
 */
function clientFor({
  images = [productionImage()],
  serverTypes = [serverType('cx23', false), serverType('cpx12', true)],
  requests = [],
} = {}) {
  return createHetznerApiClientForTest({
    token: 'hcloud-test-token',
    baseUrl: 'https://api.example.test/v1',
    maxGetAttempts: 1,
    waitForRetry: async () => {},
    fetchImplementation: async (
      /** @type {string} */ url,
      /** @type {RequestInit} */ init,
    ) => {
      requests.push({ method: String(init.method), url: new URL(url) });
      const { pathname } = new URL(url);
      if (pathname.endsWith('/locations')) {
        return listResponse('locations', [
          {
            id: 1,
            name: 'fsn1',
            city: 'Falkenstein',
            country: 'DE',
            network_zone: 'eu-central',
          },
        ]);
      }
      if (pathname.endsWith('/server_types')) {
        return listResponse('server_types', serverTypes);
      }
      if (pathname.endsWith('/images')) return listResponse('images', images);
      throw new Error('unexpected Hetzner contract endpoint');
    },
  });
}

const SCRIPT = path.join(
  process.cwd(),
  'scripts',
  'verify-hetzner-api-contract.js',
);

/** @param {Record<string, string>} env - Exact child environment. */
function runScript(env) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
}

describe('verify-hetzner-api-contract', () => {
  it('passes against the production catalog shape with GET-only planner reads', async () => {
    /** @type {{method: string, url: URL}[]} */
    const requests = [];
    await expect(
      checkHetznerApiContract({
        api: clientFor({ requests }),
        location: 'fsn1',
      }),
    ).resolves.toEqual({
      format: 'wharfie-hetzner-api-contract',
      version: 1,
      location: 'fsn1',
      reads: {
        locations: { decoded: true, count: 1 },
        serverTypes: { decoded: true, count: 2 },
        images: { decoded: true, count: 1 },
      },
      selection: {
        location: 'fsn1',
        serverType: 'cpx12',
        image: { id: 161547269, name: 'ubuntu-24.04' },
      },
      result: 'passed',
    });
    expect(requests.map(({ method }) => method)).toEqual(['GET', 'GET', 'GET']);
    const imageQuery = requests.find(({ url }) =>
      url.pathname.endsWith('/images'),
    )?.url.searchParams;
    expect(Object.fromEntries(imageQuery ?? [])).toMatchObject({
      name: 'ubuntu-24.04',
      type: 'system',
      architecture: 'x86',
      include_deprecated: 'false',
    });
    expect(
      requests
        .find(({ url }) => url.pathname.endsWith('/locations'))
        ?.url.searchParams.get('name'),
    ).toBe('fsn1');
  });

  it('fails with the fixed decoder error when image deprecation evidence is missing', async () => {
    const { deprecation: _omitted, ...withoutDeprecation } = productionImage();
    const report = await checkHetznerApiContract({
      api: clientFor({ images: [withoutDeprecation] }),
      location: 'fsn1',
    });

    expect(report.result).toBe('failed');
    expect(report.selection).toBeNull();
    expect(report.reads.images).toEqual({
      decoded: false,
      error: 'Hetzner API response document is invalid.',
    });
  });

  it.each([
    [
      'the only image is deprecated',
      {
        images: [
          productionImage({
            deprecation: {
              announced: '2026-11-01T00:00:00Z',
              unavailable_after: '2027-02-01T00:00:00Z',
            },
          }),
        ],
      },
      /exactly one current image/u,
    ],
    [
      'no small type is available',
      { serverTypes: [serverType('cpx12', false)] },
      /No supported small x86/u,
    ],
    [
      'a server type name is ambiguous',
      {
        serverTypes: [
          serverType('cx23', true),
          { ...serverType('cx23', true), id: 999 },
        ],
      },
      /provider-ambiguous/u,
    ],
  ])(
    'fails with the planner selection error when %s',
    async (_name, options, error) => {
      const report = await checkHetznerApiContract({
        api: clientFor(options),
        location: 'fsn1',
      });

      expect(report.result).toBe('failed');
      expect(report.selection).toBeNull();
      expect(report.selectionError).toMatch(error);
    },
  );

  it('exits cleanly without a usable token and never makes a request', () => {
    const missing = runScript({});
    const malformed = runScript({ HCLOUD_TOKEN: ' not-a-trimmed-token ' });

    expect(missing.status).toBe(2);
    expect(missing.stderr).toBe(
      'verify:hetzner:contract requires HCLOUD_TOKEN.\n',
    );
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toBe(
      'verify:hetzner:contract could not create a read client: Hetzner API client options are invalid.\n',
    );
    expect(malformed.stdout).toBe('');
  });
});
