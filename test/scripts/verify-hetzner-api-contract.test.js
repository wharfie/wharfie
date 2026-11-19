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

/**
 * @param {{images?: any[], available?: boolean}} [options] - Catalog variations.
 * @returns {Readonly<Record<string, Function>>} - Read client over a fake API.
 */
function clientFor({ images = [productionImage()], available = true } = {}) {
  return createHetznerApiClientForTest({
    token: 'hcloud-test-token',
    baseUrl: 'https://api.example.test/v1',
    maxGetAttempts: 1,
    waitForRetry: async () => {},
    fetchImplementation: async (/** @type {string} */ url) => {
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
        return listResponse('server_types', [
          {
            id: 108,
            name: 'cpx12',
            architecture: 'x86',
            cores: 1,
            memory: 2,
            disk: 40,
            deprecation: null,
            locations: [
              {
                id: 1,
                name: 'fsn1',
                available,
                recommended: false,
                deprecation: null,
              },
            ],
          },
        ]);
      }
      if (pathname.endsWith('/images')) return listResponse('images', images);
      throw new Error('unexpected Hetzner contract endpoint');
    },
  });
}

describe('verify-hetzner-api-contract', () => {
  it('passes against the production catalog shape without `deprecated`', async () => {
    await expect(
      checkHetznerApiContract({ api: clientFor(), location: 'fsn1' }),
    ).resolves.toEqual({
      format: 'wharfie-hetzner-api-contract',
      version: 1,
      location: 'fsn1',
      reads: {
        locations: { decoded: true, count: 1 },
        serverTypes: { decoded: true, count: 1 },
        images: { decoded: true, count: 1 },
      },
      selection: {
        location: 'fsn1',
        availableSmallServerTypes: ['cpx12'],
        currentImages: [{ id: 161547269, name: 'ubuntu-24.04' }],
      },
      result: 'passed',
    });
  });

  it('fails with the fixed decoder error when image deprecation evidence is missing', async () => {
    const { deprecation: _omitted, ...withoutDeprecation } = productionImage();
    const report = await checkHetznerApiContract({
      api: clientFor({ images: [withoutDeprecation] }),
      location: 'fsn1',
    });

    expect(report.result).toBe('failed');
    expect(report.reads.images).toEqual({
      decoded: false,
      error: 'Hetzner API response document is invalid.',
    });
  });

  it('fails when the only image is deprecated or no small type is available', async () => {
    const deprecated = await checkHetznerApiContract({
      api: clientFor({
        images: [
          productionImage({
            deprecation: {
              announced: '2026-11-01T00:00:00Z',
              unavailable_after: '2027-02-01T00:00:00Z',
            },
          }),
        ],
      }),
      location: 'fsn1',
    });
    const unavailable = await checkHetznerApiContract({
      api: clientFor({ available: false }),
      location: 'fsn1',
    });

    expect(deprecated.selection.currentImages).toEqual([]);
    expect(deprecated.result).toBe('failed');
    expect(unavailable.selection.availableSmallServerTypes).toEqual([]);
    expect(unavailable.result).toBe('failed');
  });
});
