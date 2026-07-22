import { describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';

import {
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION,
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST,
  AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES,
  getAwsSingleNodeBootstrapBase64,
  getAwsSingleNodeBootstrapBytes,
} from '../../src/core/runtime/deployment-aws-node-bootstrap-contract.js';
import { sha256Base64Url } from '../../src/core/runtime/content-id.js';

describe('AWS single-node bootstrap contract', () => {
  it('returns deterministic bytes without exposing its private buffer', () => {
    const first = getAwsSingleNodeBootstrapBytes();
    const second = getAwsSingleNodeBootstrapBytes();

    expect(Buffer.isBuffer(first)).toBe(true);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(getAwsSingleNodeBootstrapBytes.length).toBe(0);
    expect(getAwsSingleNodeBootstrapBase64.length).toBe(0);

    first.fill(0);
    expect(getAwsSingleNodeBootstrapBytes()).toEqual(second);
  });

  it('pins the versioned domain-separated digest of the exact raw bytes', () => {
    const bytes = getAwsSingleNodeBootstrapBytes();

    expect(AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION).toBe(1);
    expect(AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-bootstrap:v1',
    );
    expect(AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES).toBe(16_384);
    expect(AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST).toEqual({
      algorithm: 'sha256',
      value: sha256Base64Url(
        Buffer.concat([
          Buffer.from(`${AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN}\0`, 'utf8'),
          bytes,
        ]),
      ),
    });
    expect(AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST).toEqual({
      algorithm: 'sha256',
      value: 'BvhiqCgVW8yJ5wjDbk9cSGcXgPklpEg2UeEJ4YLm3hs',
    });
    expect(AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST.value).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(Object.isFrozen(AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST)).toBe(true);
  });

  it('is bounded canonical LF UTF-8 and round-trips through EC2 base64', () => {
    const bytes = getAwsSingleNodeBootstrapBytes();
    const text = bytes.toString('utf8');
    const base64 = getAwsSingleNodeBootstrapBase64();

    expect(bytes.byteLength).toBe(1561);
    expect(bytes.byteLength).toBeLessThanOrEqual(
      AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES,
    );
    expect(Buffer.from(text, 'utf8')).toEqual(bytes);
    expect(text.startsWith('#!/bin/bash\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text).not.toContain('\0');
    expect(base64).toBe(getAwsSingleNodeBootstrapBase64());
    expect(base64).toHaveLength(2084);
    expect(Buffer.from(base64, 'base64')).toEqual(bytes);

    const syntax = spawnSync('/bin/bash', ['-n'], {
      input: bytes,
      encoding: 'utf8',
    });
    expect(syntax.error).toBeUndefined();
    expect(syntax.status).toBe(0);
    expect(syntax.stderr).toBe('');
  });

  it('contains no credentials or deployment-specific interpolation', () => {
    const text = getAwsSingleNodeBootstrapBytes().toString('utf8');

    expect(text).not.toMatch(/\$\{|\{\{|\}\}/u);
    expect(text).not.toMatch(
      /access[-_ ]?key|secret|password|credential|session[-_ ]?token|security[-_ ]?token|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}/iu,
    );
    expect(text).not.toMatch(
      /provider.?scope|deployment.?instance|incarnation|artifact.?id|revision.?id|account.?id|bucket.?name|region.?name|arn:aws/iu,
    );
  });

  it('pins user, directory, IMDS isolation, lingering, and SSM hardening', () => {
    const text = getAwsSingleNodeBootstrapBytes().toString('utf8');

    expect(text).toContain('set -Eeuo pipefail\numask 027\n');
    expect(text).toContain(
      '/usr/sbin/useradd --system --gid wharfie-runtime --create-home --home-dir /var/lib/wharfie-runtime --shell /usr/sbin/nologin wharfie-runtime',
    );
    expect(text).toContain(
      '/usr/sbin/usermod --gid wharfie-runtime --home /var/lib/wharfie-runtime --shell /usr/sbin/nologin --lock wharfie-runtime',
    );
    expect(text).toContain(
      '/usr/bin/install -d -o root -g root -m 0755 /etc/wharfie /opt/wharfie /opt/wharfie/app',
    );
    expect(text).toContain('runtime_uid=$(/usr/bin/id --user wharfie-runtime)');
    expect(text).toContain(
      'runtime_manager_dropin="/etc/systemd/system/user@$runtime_uid.service.d"',
    );
    expect(text).toContain('[Service]\nIPAddressDeny=169.254.169.254/32\n');
    expect(text).toContain(
      '/usr/bin/chown root:root "$runtime_manager_dropin/50-wharfie-imds.conf"',
    );
    expect(text).toContain('/usr/bin/loginctl enable-linger wharfie-runtime');
    expect(text).toContain(
      '/usr/bin/systemctl restart "user@$runtime_uid.service"',
    );
    expect(text).toContain(
      '/usr/bin/systemctl enable --now amazon-ssm-agent.service',
    );
    expect(text).not.toMatch(/\biptables\b|\bnft\b|\bdnf\b|\byum\b|\brpm\b/iu);
  });

  it('stages no application bytes and starts no application service', () => {
    const text = getAwsSingleNodeBootstrapBytes().toString('utf8');

    expect(text).not.toMatch(/\bcurl\b|\bwget\b|\baws\s+s3\b/iu);
    expect(text).not.toMatch(/\bnode\b|\bnpm\b|\bnpx\b/iu);
    expect(text).not.toMatch(
      /ExecStart=\/opt\/wharfie|systemctl[^\n]*(?:start|enable)[^\n]*wharfie-(?:app|runtime)/iu,
    );
  });
});
