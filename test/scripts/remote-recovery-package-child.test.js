import { describe, expect, test } from '@jest/globals';

import { assertMatchingRemoteRecoveryPayloadRecords } from '../../scripts/remote-recovery-package-child.js';

const RECORD = Object.freeze({
  artifactId: 'artifact-identity',
  revisionId: 'revision-identity',
  byteDigest: { algorithm: 'sha256', value: 'byte-digest' },
  size: 1024,
  target: { platform: 'linux', architecture: 'x64', libc: 'glibc' },
  provenance: { builder: { name: '@wharfie/wharfie', version: '0.0.15' } },
});

describe('remote recovery guest/payload record agreement', () => {
  test('accepts the same complete artifact JSON through null-prototype payload validation', () => {
    const embedded = JSON.parse(JSON.stringify(RECORD), (_key, value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return Object.assign(Object.create(null), value);
      }
      return value;
    });
    expect(Object.getPrototypeOf(embedded)).toBeNull();
    expect(Object.getPrototypeOf(embedded.byteDigest)).toBeNull();
    expect(() =>
      assertMatchingRemoteRecoveryPayloadRecords(embedded, RECORD),
    ).not.toThrow();
  });

  test.each([
    { artifactId: 'another-artifact' },
    { revisionId: 'another-revision' },
    { byteDigest: { algorithm: 'sha256', value: 'another-digest' } },
    { size: 1025 },
    { target: { ...RECORD.target, architecture: 'arm64' } },
    {
      provenance: {
        builder: { ...RECORD.provenance.builder, version: '0.0.16' },
      },
    },
  ])('rejects changed artifact evidence %j', (changed) => {
    expect(() =>
      assertMatchingRemoteRecoveryPayloadRecords(
        { ...RECORD, ...changed },
        RECORD,
      ),
    ).toThrow();
  });
});
