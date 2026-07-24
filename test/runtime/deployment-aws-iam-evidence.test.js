import { describe, expect, it, jest } from '@jest/globals';

import {
  AWS_IAM_EVIDENCE_MAX_DOCUMENT_BYTES,
  AWS_IAM_EVIDENCE_MAX_READ_PAGES,
  AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
  AwsIamEvidenceConflictError,
  AwsIamEvidenceTransientError,
  AwsIamEvidenceUnknownError,
  decodeAwsIamAttachedPolicies,
  decodeAwsIamJsonDocument,
  decodeAwsIamListPage,
  decodeAwsIamPolicyNames,
  decodeAwsIamTags,
  isAwsIamErrorNamed,
  readAwsIamListPages,
  validateAwsIamTagSubset,
  validateAwsIamTags,
} from '../../src/core/runtime/deployment-aws-iam-evidence.js';

/** @typedef {Record<string, any>} AnyRecord */

/** @param {any} value @returns {void} */
function expectDeepFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}

describe('AWS IAM shared evidence', () => {
  it('canonicalizes and deeply freezes raw or URI-encoded JSON objects', () => {
    const expected = { a: [{ c: 3, d: 4 }], b: 2 };
    for (const value of [
      JSON.stringify({ b: 2, a: [{ d: 4, c: 3 }] }),
      encodeURIComponent(JSON.stringify({ b: 2, a: [{ d: 4, c: 3 }] })),
    ]) {
      const decoded = decodeAwsIamJsonDocument(value);
      expect(decoded).toEqual(expected);
      expectDeepFrozen(decoded);
    }
  });

  it.each([
    [null],
    [''],
    ['not-json'],
    ['%E0%A4%A'],
    ['[]'],
    [JSON.stringify('value')],
    ['x'.repeat(AWS_IAM_EVIDENCE_MAX_DOCUMENT_BYTES + 1)],
  ])('rejects malformed or unbounded IAM documents', (value) => {
    expect(() => decodeAwsIamJsonDocument(value)).toThrow(
      AwsIamEvidenceUnknownError,
    );
  });

  it('strictly decodes terminal and truncated Marker pages', () => {
    expect(
      decodeAwsIamListPage(
        { Values: ['a'], IsTruncated: true, Marker: 'next' },
        'Values',
      ),
    ).toEqual({ items: ['a'], nextMarker: 'next' });
    expect(
      decodeAwsIamListPage({ Values: ['b'], IsTruncated: false }, 'Values'),
    ).toEqual({ items: ['b'], nextMarker: null });
  });

  it.each([
    [{ Values: [], IsTruncated: true }, 'Values'],
    [{ Values: [], IsTruncated: false, Marker: 'unexpected' }, 'Values'],
    [{ Values: [], IsTruncated: 'false' }, 'Values'],
    [{ Values: 'not-an-array', IsTruncated: false }, 'Values'],
    [
      {
        Values: Array.from(
          { length: AWS_IAM_EVIDENCE_READ_MAX_ITEMS + 1 },
          () => 'x',
        ),
        IsTruncated: false,
      },
      'Values',
    ],
  ])('rejects malformed IAM list pages', (response, itemKey) => {
    expect(() => decodeAwsIamListPage(response, itemKey)).toThrow(
      AwsIamEvidenceUnknownError,
    );
  });

  it('reads complete pages with frozen bounded requests', async () => {
    const readPage = jest
      .fn(
        async (/** @type {AnyRecord} */ _request) =>
          /** @type {AnyRecord} */ ({
            Values: ['b'],
            IsTruncated: false,
          }),
      )
      .mockResolvedValueOnce(
        /** @type {AnyRecord} */ ({
          Values: ['a'],
          IsTruncated: true,
          Marker: 'page-2',
        }),
      );
    const values = await readAwsIamListPages({
      readPage,
      itemKey: 'Values',
      baseRequest: { RoleName: 'role' },
    });
    expect(values).toEqual(['a', 'b']);
    expect(readPage).toHaveBeenNthCalledWith(1, {
      RoleName: 'role',
      MaxItems: AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
    });
    expect(readPage).toHaveBeenNthCalledWith(2, {
      RoleName: 'role',
      MaxItems: AWS_IAM_EVIDENCE_READ_MAX_ITEMS,
      Marker: 'page-2',
    });
    expectDeepFrozen(readPage.mock.calls[0][0]);
    expectDeepFrozen(readPage.mock.calls[1][0]);
  });

  it('validates each page before issuing a later read', async () => {
    const readPage = jest
      .fn(
        async (/** @type {AnyRecord} */ _request) =>
          /** @type {AnyRecord} */ ({}),
      )
      .mockResolvedValueOnce(
        /** @type {AnyRecord} */ ({
          Values: ['foreign'],
          IsTruncated: true,
          Marker: 'page-2',
        }),
      )
      .mockRejectedValueOnce(new Error('later transport failure'));
    await expect(
      readAwsIamListPages({
        readPage,
        decodeItems(/** @type {unknown[]} */ items) {
          if (items.includes('foreign')) {
            throw new AwsIamEvidenceConflictError();
          }
          return items;
        },
        itemKey: 'Values',
        baseRequest: {},
      }),
    ).rejects.toBeInstanceOf(AwsIamEvidenceConflictError);
    expect(readPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'repeated marker',
      [
        { Values: [], IsTruncated: true, Marker: 'again' },
        { Values: [], IsTruncated: true, Marker: 'again' },
      ],
      {},
    ],
    [
      'page exhaustion',
      [
        { Values: [], IsTruncated: true, Marker: 'again' },
        { Values: [], IsTruncated: true, Marker: 'later' },
      ],
      { maxPages: 2 },
    ],
  ])('rejects %s', async (_name, pages, extra) => {
    const readPage = jest.fn(
      async (/** @type {AnyRecord} */ _request) =>
        /** @type {AnyRecord} */ ({}),
    );
    for (const page of pages) {
      readPage.mockResolvedValueOnce(/** @type {AnyRecord} */ (page));
    }
    await expect(
      readAwsIamListPages({
        readPage,
        itemKey: 'Values',
        baseRequest: {},
        ...extra,
      }),
    ).rejects.toBeInstanceOf(AwsIamEvidenceUnknownError);
  });

  it('canonicalizes exact tags and rejects duplicate ownership keys', () => {
    const tags = decodeAwsIamTags([
      { Key: 'z', Value: '2' },
      { Key: 'a', Value: '1' },
    ]);
    expect(tags).toEqual([
      { Key: 'a', Value: '1' },
      { Key: 'z', Value: '2' },
    ]);
    expectDeepFrozen(tags);
    expect(() =>
      decodeAwsIamTags([
        { Key: 'a', Value: '1' },
        { Key: 'a', Value: '1' },
      ]),
    ).toThrow(AwsIamEvidenceConflictError);
  });

  it('distinguishes exact, propagation-incomplete, subset, and conflicting tags', () => {
    const expected = [
      { Key: 'a', Value: '1' },
      { Key: 'b', Value: '2' },
    ];
    expect(validateAwsIamTags([...expected].reverse(), expected)).toEqual(
      expected,
    );
    expect(() =>
      validateAwsIamTags(expected.slice(0, 1), expected, {
        allowIncomplete: true,
      }),
    ).toThrow(AwsIamEvidenceTransientError);
    expect(
      validateAwsIamTagSubset(
        [...expected, { Key: 'extra', Value: 'ok' }],
        expected.slice(0, 1),
      ),
    ).toHaveLength(3);
    expect(() =>
      validateAwsIamTags([{ Key: 'a', Value: 'wrong' }], expected, {
        allowIncomplete: true,
      }),
    ).toThrow(AwsIamEvidenceConflictError);
  });

  it('normalizes strict policy names and attached-policy records', () => {
    expect(decodeAwsIamPolicyNames(['z-policy', 'a-policy'])).toEqual([
      'a-policy',
      'z-policy',
    ]);
    expect(
      decodeAwsIamAttachedPolicies([
        {
          PolicyName: 'z-policy',
          PolicyArn: 'arn:aws:iam::123456789012:policy/z',
        },
        {
          PolicyName: 'a-policy',
          PolicyArn: 'arn:aws:iam::123456789012:policy/a',
        },
      ]),
    ).toEqual([
      {
        PolicyName: 'a-policy',
        PolicyArn: 'arn:aws:iam::123456789012:policy/a',
      },
      {
        PolicyName: 'z-policy',
        PolicyArn: 'arn:aws:iam::123456789012:policy/z',
      },
    ]);
  });

  it('rejects malformed or duplicate policy list evidence', () => {
    expect(() => decodeAwsIamPolicyNames(['same', 'same'])).toThrow(
      AwsIamEvidenceUnknownError,
    );
    expect(() =>
      decodeAwsIamAttachedPolicies([
        {
          PolicyName: 'same',
          PolicyArn: 'arn:aws:iam::123456789012:policy/same',
          Extra: true,
        },
      ]),
    ).toThrow(AwsIamEvidenceUnknownError);
  });

  it('matches only exact throwable names and exports bounded constants', () => {
    expect(isAwsIamErrorNamed({ name: 'NoSuchEntity' }, 'NoSuchEntity')).toBe(
      true,
    );
    expect(isAwsIamErrorNamed(null, 'NoSuchEntity')).toBe(false);
    expect(AWS_IAM_EVIDENCE_MAX_READ_PAGES).toBe(16);
    expect(AWS_IAM_EVIDENCE_READ_MAX_ITEMS).toBe(1000);
  });
});
