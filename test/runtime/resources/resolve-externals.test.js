/* eslint-env jest */

import { normalizeExternalDependencies } from '../../../src/core/resources/builds/lib/resolve-externals.js';

describe('external dependency normalization', () => {
  it('canonicalizes exact semantic versions', () => {
    expect(
      normalizeExternalDependencies(
        [
          'example-package@v1.2.3',
          { name: '@scope/example', version: '2.0.0-beta.1' },
        ],
        undefined,
      ),
    ).toEqual([
      { name: 'example-package', version: '1.2.3' },
      { name: '@scope/example', version: '2.0.0-beta.1' },
    ]);
  });

  it.each(['^1.2.3', '~1.2.3', 'latest', 'git+https://example.invalid/x'])(
    'rejects mutable or non-registry version spec %s',
    (version) => {
      expect(() =>
        normalizeExternalDependencies(
          [{ name: 'example-package', version }],
          undefined,
        ),
      ).toThrow(/requires an exact semantic version/i);
    },
  );

  it('resolves a bare installed dependency to its exact installed version', () => {
    const [resolved] =
      normalizeExternalDependencies(['semver'], undefined) || [];

    expect(resolved).toEqual({
      name: 'semver',
      version: expect.stringMatching(/^\d+\.\d+\.\d+/),
    });
  });
});
