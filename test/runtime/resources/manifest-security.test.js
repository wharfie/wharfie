/* eslint-env jest */

import { assertManifestIsSecretFree } from '../../../src/core/runtime/manifest-security.js';

describe('manifest security boundary', () => {
  it.each([
    'dbPassword',
    'apiTokenValue',
    'secretAccessKey',
    'apiKeyValue',
    'clientKey',
    'auth',
    'bearer',
    'dsn',
  ])(
    'rejects compound secret-like field %s without rendering its value',
    (fieldName) => {
      const secret = `secret-sentinel-for-${fieldName}`;

      expect(() =>
        assertManifestIsSecretFree({
          resources: { db: { options: { [fieldName]: secret } } },
        }),
      ).toThrow(/inline secret-like values.*inspectable manifest/i);

      try {
        assertManifestIsSecretFree({
          resources: { db: { options: { [fieldName]: secret } } },
        });
      } catch (error) {
        expect(String(error)).not.toContain(secret);
      }
    },
  );

  it('rejects credential-bearing URLs without rendering the URL', () => {
    const secretUrl =
      'https://example.invalid/resource?apiTokenValue=url-secret-sentinel';

    expect(() => assertManifestIsSecretFree({ endpoint: secretUrl })).toThrow(
      /credential-bearing URLs.*inspectable manifest/i,
    );

    try {
      assertManifestIsSecretFree({ endpoint: secretUrl });
    } catch (error) {
      expect(String(error)).not.toContain(secretUrl);
      expect(String(error)).not.toContain('url-secret-sentinel');
    }
  });

  it.each([
    'https://reader:credential-sentinel@example.invalid/data',
    'postgres://reader:credential-sentinel@example.invalid/database',
    ' \r\nhttps://reader:credential-sentinel@example.invalid/data\t',
    'https://example.invalid/data?%61pi%54oken%56alue=credential-sentinel',
    'custom:opaque?access_token=credential-sentinel',
  ])('rejects URL credentials across WHATWG URL forms', (endpoint) => {
    expect(() => assertManifestIsSecretFree({ endpoint })).toThrow(
      /credential-bearing URLs.*inspectable manifest/i,
    );
    try {
      assertManifestIsSecretFree({ endpoint });
    } catch (error) {
      expect(String(error)).not.toContain('credential-sentinel');
      expect(String(error)).not.toContain(endpoint);
    }
  });

  it.each([
    'ready',
    'wsnd1_ordinary-deployment-identity',
    '2026-09-14T00:00:00Z',
    '/var/lib/wharfie/state',
    'https://[invalid-host',
    'https://example.invalid/data?region=us-east-2',
    'custom:opaque?region=us-east-2',
  ])('allows non-URL strings and URLs without credentials', (value) => {
    expect(() => assertManifestIsSecretFree({ value })).not.toThrow();
  });

  it.each([
    'Authorization: Bearer header-secret-sentinel',
    'Basic header-secret-sentinel',
    '-----BEGIN PRIVATE KEY-----\nkey-secret-sentinel',
  ])('rejects inline credential marker without rendering it', (secret) => {
    expect(() => assertManifestIsSecretFree({ value: secret })).toThrow(
      /inline credential material.*inspectable manifest/i,
    );

    try {
      assertManifestIsSecretFree({ value: secret });
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain('secret-sentinel');
    }
  });

  it('allows empty secret-like placeholders and unrelated compound names', () => {
    expect(() =>
      assertManifestIsSecretFree({
        credentials: {},
        password: '',
        tokenizerModel: 'portable-model',
      }),
    ).not.toThrow();
  });
});
