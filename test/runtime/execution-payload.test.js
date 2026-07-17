/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { createHash } from 'node:crypto';
import { describe, expect, it } from '@jest/globals';

import {
  EXECUTION_PAYLOAD_ID_DOMAIN,
  EXECUTION_PAYLOAD_MAX_BYTES,
  EXECUTION_PAYLOAD_REFERENCE_KIND,
  EXECUTION_PAYLOAD_STORAGE_KIND,
  createExecutionPayloadId,
  createExecutionPayloadReference,
  decodeCanonicalJsonPayload,
  encodeCanonicalJsonPayload,
  getExecutionPayloadStorageKey,
  validateExecutionPayloadReference,
  verifyExecutionPayloadReference,
} from '../../src/core/runtime/execution-payload.js';

const PAYLOAD_SCHEMA = 'wharfie.execution.manual-request.v1';
const STORE_ID = 'local-control';

/**
 * @param {any} value
 * @returns {any}
 */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe('execution payload references', () => {
  it('canonicalizes JSON bytes and binds a domain-separated ID plus raw digest', () => {
    const firstBytes = encodeCanonicalJsonPayload({ z: 1, a: { d: 2, b: 3 } });
    const secondBytes = encodeCanonicalJsonPayload({ a: { b: 3, d: 2 }, z: 1 });
    expect(firstBytes).toEqual(Buffer.from('{"a":{"b":3,"d":2},"z":1}'));
    expect(secondBytes).toEqual(firstBytes);

    const reference = createExecutionPayloadReference({
      bytes: firstBytes,
      payloadSchema: PAYLOAD_SCHEMA,
      storeId: STORE_ID,
    });
    const rawDigest = createHash('sha256')
      .update(firstBytes)
      .digest('base64url');
    expect(reference).toEqual({
      schemaVersion: 1,
      kind: EXECUTION_PAYLOAD_REFERENCE_KIND,
      payloadId: createExecutionPayloadId(firstBytes),
      digest: { algorithm: 'sha256', value: rawDigest },
      size: firstBytes.byteLength,
      mediaType: 'application/json',
      payloadSchema: PAYLOAD_SCHEMA,
      storage: {
        kind: EXECUTION_PAYLOAD_STORAGE_KIND,
        storeId: STORE_ID,
        key: getExecutionPayloadStorageKey({
          algorithm: 'sha256',
          value: rawDigest,
        }),
      },
    });
    expect(reference.payloadId).not.toBe(`wlp_${rawDigest}`);
    expect(reference.payloadId).toMatch(/^wlp_[A-Za-z0-9_-]{43}$/);
    expect(EXECUTION_PAYLOAD_ID_DOMAIN).toContain('execution-payload');
    expect(Object.isFrozen(reference)).toBe(true);
    expect(Object.isFrozen(reference.storage)).toBe(true);
    expect(validateExecutionPayloadReference(reference)).toEqual(reference);
    expect(verifyExecutionPayloadReference(reference, firstBytes)).toEqual({
      reference,
      value: { a: { b: 3, d: 2 }, z: 1 },
    });
  });

  it('rejects noncanonical JSON byte spellings before deriving a durable reference', () => {
    expect(() => decodeCanonicalJsonPayload(Buffer.from('{ "a": 1 }'))).toThrow(
      /canonical compact JSON/i,
    );
    expect(() =>
      decodeCanonicalJsonPayload(Buffer.from('{"b":1,"a":2}')),
    ).toThrow(/canonical compact JSON/i);
    expect(() => decodeCanonicalJsonPayload(Buffer.from('{"a":1.0}'))).toThrow(
      /canonical compact JSON/i,
    );
    expect(() =>
      createExecutionPayloadReference({
        bytes: Buffer.from('{"b":1,"a":2}'),
        payloadSchema: PAYLOAD_SCHEMA,
        storeId: STORE_ID,
      }),
    ).toThrow(/canonical compact JSON/i);
  });

  it('enforces the single protocol byte cap for created and serialized references', () => {
    const bytes = encodeCanonicalJsonPayload({ ok: true });
    const reference = createExecutionPayloadReference({
      bytes,
      payloadSchema: PAYLOAD_SCHEMA,
      storeId: STORE_ID,
    });
    const oversizedBytes = Buffer.alloc(EXECUTION_PAYLOAD_MAX_BYTES + 1);

    expect(() =>
      createExecutionPayloadReference({
        bytes: oversizedBytes,
        payloadSchema: PAYLOAD_SCHEMA,
        storeId: STORE_ID,
      }),
    ).toThrow(/execution payload limit/i);

    const oversizedReference = clone(reference);
    oversizedReference.size = EXECUTION_PAYLOAD_MAX_BYTES + 1;
    expect(() => validateExecutionPayloadReference(oversizedReference)).toThrow(
      /execution payload limit/i,
    );
    expect(() =>
      verifyExecutionPayloadReference(reference, oversizedBytes),
    ).toThrow(/execution payload limit/i);
  });

  it('requires exact reference fields and content-derived storage keys', () => {
    const bytes = encodeCanonicalJsonPayload({ ok: true });
    const reference = createExecutionPayloadReference({
      bytes,
      payloadSchema: PAYLOAD_SCHEMA,
      storeId: STORE_ID,
    });

    const extra = { ...clone(reference), observedAt: 1 };
    expect(() => validateExecutionPayloadReference(extra)).toThrow(
      /observedAt is not supported/i,
    );

    const wrongKey = clone(reference);
    wrongKey.storage.key = 'some/mutable/path';
    expect(() => validateExecutionPayloadReference(wrongKey)).toThrow(
      /content-derived digest key/i,
    );

    const wrongSize = clone(reference);
    wrongSize.size += 1;
    expect(() => verifyExecutionPayloadReference(wrongSize, bytes)).toThrow(
      /does not match its exact bytes/i,
    );

    const wrongId = clone(reference);
    wrongId.payloadId = createExecutionPayloadId(
      encodeCanonicalJsonPayload({ changed: true }),
    );
    expect(() => verifyExecutionPayloadReference(wrongId, bytes)).toThrow(
      /does not match its exact bytes/i,
    );

    expect(() =>
      createExecutionPayloadReference({
        bytes,
        payloadSchema: ' WharFie ',
        storeId: STORE_ID,
      }),
    ).toThrow(/canonical lowercase payload schema identity/i);
  });
});
