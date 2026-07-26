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
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
} from '../../src/core/runtime/deployment-aws-host-runtime-account.js';

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

    expect(AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION).toBe(3);
    expect(AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN).toBe(
      'wharfie:aws-single-node-bootstrap:v3',
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
      value: 'ojMgit_HvWEtmgQoLbQ224MDEzCMCCLaB4z59SFZJW0',
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

    expect(bytes.byteLength).toBe(14_651);
    expect(bytes.byteLength).toBeLessThanOrEqual(
      AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES,
    );
    expect(Buffer.from(text, 'utf8')).toEqual(bytes);
    expect(text.startsWith('#!/bin/bash\n')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toContain('\r');
    expect(text).not.toContain('\0');
    expect(base64).toBe(getAwsSingleNodeBootstrapBase64());
    expect(base64).toHaveLength(19_536);
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

  it('preflights every supported identity state before mutation and revalidates exact uniqueness', () => {
    const text = getAwsSingleNodeBootstrapBytes().toString('utf8');

    expect(text).toContain(
      'set -Eeuo pipefail\numask 027\nexport PATH=/usr/sbin:/usr/bin:/sbin:/bin\nexport LANG=C\nexport LC_ALL=C\n',
    );
    expect(text).toContain(
      [
        `readonly runtime_expected_user=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER}`,
        `readonly runtime_expected_group=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP}`,
        `readonly runtime_expected_uid=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID}`,
        `readonly runtime_expected_gid=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID}`,
        `readonly runtime_expected_gecos=${JSON.stringify(
          AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
        )}`,
        `readonly runtime_expected_home=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME}`,
        `readonly runtime_expected_shell=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL}`,
      ].join('\n'),
    );
    expect(text).toContain(
      'validate_runtime_id_number() {\n  case "$1" in\n    \'\'|0|*[!0-9]*|0[0-9]*|???????????*) exit 1 ;;\n  esac\n  if [ "$1" -gt 4294967293 ] || [ "$1" -eq 65534 ]; then',
    );
    expect(text).toContain(
      'validate_runtime_group() {\n  runtime_group_record=$(/usr/bin/getent group "$runtime_expected_group")',
    );
    expect(text).toContain(
      'IFS=: read -r runtime_group_name runtime_group_marker runtime_gid runtime_group_members runtime_group_extra <<< "$runtime_group_record"',
    );
    expect(text).toContain(
      'if [ "$runtime_group_name" != "$runtime_expected_group" ] || [ "$runtime_group_marker" != x ] || [ "$runtime_gid" != "$runtime_expected_gid" ] || [ -n "$runtime_group_members" ] || [ -n "$runtime_group_extra" ]; then',
    );
    expect(text).toContain('validate_runtime_id_number "$runtime_gid"');
    expect(text).toContain(
      'validate_runtime_id_number "$runtime_uid"\n  validate_runtime_id_number "$runtime_user_gid"\n  if [ "$runtime_user_gid" -ne "$runtime_gid" ]; then',
    );
    expect(text).toContain(
      'runtime_group_numeric_record=$(/usr/bin/getent group "$runtime_expected_gid")\n  if [ "$runtime_group_record" != "$runtime_group_numeric_record" ]; then',
    );
    expect(text).toContain(
      'runtime_user_numeric_record=$(/usr/bin/getent passwd "$runtime_expected_uid")\n  if [ "$runtime_user_record" != "$runtime_user_numeric_record" ]; then',
    );
    expect(text).toContain(
      '[ -n "$runtime_user_gecos" ] || [ "$runtime_user_home" != "$runtime_expected_home" ]',
    );
    expect(text).toContain(
      'validate_runtime_group_shadow_record() {\n  runtime_group_shadow_record=$1',
    );
    expect(text).toContain(
      'validate_runtime_user_shadow_record() {\n  runtime_user_shadow_record=$1',
    );
    expect(text).toContain(
      'runtime_group_preflight=$(/usr/bin/getent group "$runtime_expected_group") || runtime_group_status=$?',
    );
    expect(text).toContain(
      'runtime_user_preflight=$(/usr/bin/getent passwd "$runtime_expected_user") || runtime_user_status=$?',
    );
    expect(text).toContain(
      'runtime_gid_preflight=$(/usr/bin/getent group "$runtime_expected_gid") || runtime_gid_status=$?',
    );
    expect(text).toContain(
      'runtime_uid_preflight=$(/usr/bin/getent passwd "$runtime_expected_uid") || runtime_uid_status=$?',
    );
    expect(text).toContain(
      'runtime_gshadow_preflight=$(/usr/bin/getent gshadow "$runtime_expected_group") || runtime_gshadow_status=$?',
    );
    expect(text).toContain(
      'runtime_shadow_preflight=$(/usr/bin/getent shadow "$runtime_expected_user") || runtime_shadow_status=$?',
    );
    expect(text).toContain(
      'if [ "$runtime_group_status" -eq 2 ] && [ "$runtime_user_status" -eq 2 ]; then',
    );
    expect(text).toContain(
      'if [ "$runtime_gid_status" -ne 2 ] || [ "$runtime_uid_status" -ne 2 ] || [ "$runtime_gshadow_status" -ne 2 ] || [ "$runtime_shadow_status" -ne 2 ]; then',
    );
    expect(text).toContain(
      'elif [ "$runtime_group_status" -eq 0 ] && [ "$runtime_user_status" -eq 2 ]; then',
    );
    expect(text).toContain(
      'if [ "$runtime_gid_status" -ne 0 ] || [ "$runtime_uid_status" -ne 2 ] || [ "$runtime_gshadow_status" -ne 0 ] || [ "$runtime_shadow_status" -ne 2 ]',
    );
    expect(text).toContain(
      'elif [ "$runtime_group_status" -eq 0 ] && [ "$runtime_user_status" -eq 0 ]; then',
    );
    expect(text).toContain(
      'if [ "$runtime_gid_status" -ne 0 ] || [ "$runtime_uid_status" -ne 0 ] || [ "$runtime_gshadow_status" -ne 0 ] || [ "$runtime_shadow_status" -ne 0 ]',
    );
    expect(text).toContain(
      '/usr/sbin/groupadd --system --gid "$runtime_expected_gid" "$runtime_expected_group"',
    );
    expect(text).toContain(
      'runtime_group_shadow_before=$(/usr/bin/getent gshadow "$runtime_expected_group")\nvalidate_runtime_group_shadow_record "$runtime_group_shadow_before"\nruntime_group_shadow_locked_expected=$runtime_group_shadow_locked_record',
    );
    expect(text).toContain(
      'runtime_group_shadow_after=$(/usr/bin/getent gshadow "$runtime_expected_group")\nif [ "$runtime_group_shadow_after" != "$runtime_group_shadow_locked_expected" ]; then',
    );
    expect(text).toContain(
      '/usr/sbin/useradd --system --uid "$runtime_expected_uid" --gid "$runtime_expected_group"',
    );
    expect(text).toContain(
      '/usr/sbin/useradd --system --uid "$runtime_expected_uid" --gid "$runtime_expected_group" --comment "$runtime_expected_gecos" --no-create-home --home-dir "$runtime_expected_home" --shell "$runtime_expected_shell" "$runtime_expected_user"',
    );
    expect(text).toContain(
      'runtime_groups=$(/usr/bin/id -G "$runtime_expected_user")',
    );
    expect(text).toContain(
      'runtime_user_shadow_before=$(/usr/bin/getent shadow "$runtime_expected_user")\nvalidate_runtime_user_shadow_record "$runtime_user_shadow_before"\nruntime_user_shadow_locked_expected=$runtime_user_shadow_locked_record',
    );
    expect(text).toContain(
      'runtime_user_shadow_after=$(/usr/bin/getent shadow "$runtime_expected_user")\nif [ "$runtime_user_shadow_after" != "$runtime_user_shadow_locked_expected" ]; then',
    );
    const firstMutation = text.indexOf('/usr/sbin/groupadd ');
    expect(text).toContain('runtime_identity_state=absent');
    expect(text).toContain('runtime_identity_state=group-only');
    expect(text).toContain('runtime_identity_state=existing');
    expect(text.indexOf('runtime_group_preflight=')).toBeLessThan(
      firstMutation,
    );
    expect(text.indexOf('runtime_user_preflight=')).toBeLessThan(firstMutation);
    expect(text.indexOf('runtime_gid_preflight=')).toBeLessThan(firstMutation);
    expect(text.indexOf('runtime_uid_preflight=')).toBeLessThan(firstMutation);
    expect(text.indexOf('runtime_gshadow_preflight=')).toBeLessThan(
      firstMutation,
    );
    expect(text.indexOf('runtime_shadow_preflight=')).toBeLessThan(
      firstMutation,
    );
    expect(text).not.toMatch(
      /getent (?:passwd|group|shadow|gshadow)(?: \||\))/u,
    );
    expect(text).not.toContain(
      'elif [ "$runtime_group_status" -eq 2 ] && [ "$runtime_user_status" -eq 0 ]; then',
    );
    expect(text).not.toContain('--user-group');
    expect(text).not.toContain('--create-home');
    expect(text).not.toContain(
      '/usr/sbin/useradd --system --gid "$runtime_gid" ',
    );
  });

  it('creates only the home leaf as root and mutates descendants through a capability-empty runtime principal', () => {
    const text = getAwsSingleNodeBootstrapBytes().toString('utf8');
    const setprivPrefix =
      '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs ';

    expect(text).toContain('verify_runtime_directory /var/lib 0 0 755');
    expect(text).toContain(
      'if [ -L "$runtime_expected_home" ]; then\n  exit 1\nelif [ -e "$runtime_expected_home" ]; then\n  verify_runtime_directory "$runtime_expected_home" "$runtime_uid" "$runtime_gid" 700',
    );
    expect(text).toContain(
      '/usr/bin/install -d -o "$runtime_expected_user" -g "$runtime_expected_group" -m 0700 -- "$runtime_expected_home"',
    );
    expect(text).toContain(
      'for runtime_descendant in "$runtime_expected_home/tmp" "$runtime_expected_home/.config" "$runtime_expected_home/.config/systemd" "$runtime_expected_home/.config/systemd/user"; do',
    );
    expect(text).toContain(
      `${setprivPrefix}/usr/bin/install -d -m 0700 -- "$runtime_expected_home/tmp"`,
    );
    expect(text).toContain(
      `${setprivPrefix}/usr/bin/install -d -m 0750 -- "$runtime_expected_home/.config" "$runtime_expected_home/.config/systemd" "$runtime_expected_home/.config/systemd/user"`,
    );
    expect(text).toContain(
      `${setprivPrefix}/usr/bin/chmod 0700 -- "$runtime_expected_home/tmp"`,
    );
    expect(text).toContain(
      `${setprivPrefix}/usr/bin/chmod 0750 -- "$runtime_expected_home/.config" "$runtime_expected_home/.config/systemd" "$runtime_expected_home/.config/systemd/user"`,
    );
    expect(text.split(setprivPrefix)).toHaveLength(5);
    for (const [directory, mode] of [
      ['"$runtime_expected_home"', '700'],
      ['"$runtime_expected_home/tmp"', '700'],
      ['"$runtime_expected_home/.config"', '750'],
      ['"$runtime_expected_home/.config/systemd"', '750'],
      ['"$runtime_expected_home/.config/systemd/user"', '750'],
    ]) {
      expect(text).toContain(
        `verify_runtime_directory ${directory} "$runtime_uid" "$runtime_gid" ${mode}`,
      );
    }
    const rootInstallLines = text
      .split('\n')
      .map((line) => line.trimStart())
      .filter((line) => line.startsWith('/usr/bin/install '));
    expect(
      rootInstallLines.filter((line) =>
        line.includes('/var/lib/wharfie-runtime/'),
      ),
    ).toEqual([]);
    expect(
      rootInstallLines.filter((line) =>
        line.includes('/var/lib/wharfie-runtime'),
      ),
    ).toEqual([]);
    expect(rootInstallLines).toContain(
      '/usr/bin/install -d -o "$runtime_expected_user" -g "$runtime_expected_group" -m 0700 -- "$runtime_expected_home"',
    );
    expect(text).toContain(
      'verify_runtime_directory /etc 0 0 755\nensure_runtime_directory /etc/wharfie 0 0 755',
    );
    expect(text).toContain(
      'verify_runtime_directory /opt 0 0 755\nensure_runtime_directory /opt/wharfie 0 "$runtime_gid" 750\nensure_runtime_directory /opt/wharfie/app 0 "$runtime_gid" 750',
    );
    expect(text).not.toContain(
      '/usr/bin/install -d -o root -g root -m 0755 /etc/wharfie /opt/wharfie /opt/wharfie/app',
    );
    expect(text).not.toContain('--init-groups');
    expect(text).toContain(
      'runtime_manager_dropin="/etc/systemd/system/user@$runtime_uid.service.d"',
    );
    expect(text).toContain(
      'verify_runtime_directory /etc/systemd 0 0 755\nverify_runtime_directory /etc/systemd/system 0 0 755',
    );
    expect(text).toContain(
      'ensure_runtime_directory "$runtime_manager_dropin" 0 0 755',
    );
    expect(text).toContain(
      'if [ -e "$runtime_manager_dropin_file" ] || [ -L "$runtime_manager_dropin_file" ]; then\n  verify_runtime_file "$runtime_manager_dropin_file" 0 0 644',
    );
    expect(text).toContain(
      'runtime_manager_dropin_temp=$(/usr/bin/mktemp --tmpdir="$runtime_manager_dropin" \'.50-wharfie-imds.conf.XXXXXXXXXX\')',
    );
    expect(text).toContain(
      "/usr/bin/printf '%s\\n' '[Service]' 'IPAddressDeny=169.254.169.254/32' > \"$runtime_manager_dropin_temp\"",
    );
    expect(text).toContain(
      '/usr/bin/mv --no-target-directory -- "$runtime_manager_dropin_temp" "$runtime_manager_dropin_file"',
    );
    expect(text).toContain(
      "/usr/bin/printf '%s\\n' '[Service]' 'IPAddressDeny=169.254.169.254/32' | /usr/bin/cmp --silent - \"$runtime_manager_dropin_file\"",
    );
    expect(text).not.toContain(
      'cat > "$runtime_manager_dropin/50-wharfie-imds.conf"',
    );
    expect(text).toContain(
      '/usr/bin/loginctl enable-linger "$runtime_expected_user"',
    );
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
