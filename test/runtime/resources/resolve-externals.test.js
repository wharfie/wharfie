/* eslint-env jest */

import { normalizeExternalDependencies } from '../../../src/core/resources/builds/lib/resolve-externals.js';

describe('external dependency normalization', () => {
  it('accepts only exact descriptors and returns one canonical order', () => {
    expect(
      normalizeExternalDependencies(
        [
          'example-package@1.2.3',
          { name: '@scope/example', version: '2.0.0-beta.1' },
        ],
        undefined,
      ),
    ).toEqual([
      { name: '@scope/example', version: '2.0.0-beta.1' },
      { name: 'example-package', version: '1.2.3' },
    ]);
  });

  it.each([
    '^1.2.3',
    '~1.2.3',
    'latest',
    'v1.2.3',
    'git+https://example.invalid/x',
  ])('rejects noncanonical or mutable version spec %s', (version) => {
    expect(() =>
      normalizeExternalDependencies(
        [{ name: 'example-package', version }],
        undefined,
      ),
    ).toThrow(/requires an exact canonical semantic version/i);
  });

  it('rejects an external without an exact authored version', () => {
    for (const externals of [['semver'], [{ name: 'semver' }]]) {
      expect(() =>
        normalizeExternalDependencies(
          /** @type {any} */ (externals),
          undefined,
        ),
      ).toThrow(/version|package@version/i);
    }
  });

  it('rejects aliases, duplicate names, and unsupported descriptor fields', () => {
    expect(() =>
      normalizeExternalDependencies(['alias@npm:semver@7.7.3'], undefined),
    ).toThrow(/package name|canonical semantic version/i);
    expect(() =>
      normalizeExternalDependencies(
        ['semver@7.7.3', { name: 'semver', version: '7.7.3' }],
        undefined,
      ),
    ).toThrow(/declared more than once/i);
    expect(() =>
      normalizeExternalDependencies(
        /** @type {any} */ ([
          { name: 'semver', version: '7.7.3', source: 'ambient' },
        ]),
        undefined,
      ),
    ).toThrow(/source is not supported/i);
  });
});
