import { assertSha256Base64Url, sha256Base64Url } from './content-id.js';

export const AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION = 2;
export const AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN =
  'wharfie:aws-single-node-bootstrap:v2';
export const AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES = 16 * 1024;

const BOOTSTRAP_LINES = Object.freeze([
  '#!/bin/bash',
  'set -Eeuo pipefail',
  'umask 027',
  'export PATH=/usr/sbin:/usr/bin:/sbin:/bin',
  'export LANG=C',
  'export LC_ALL=C',
  '',
  'validate_runtime_id_number() {',
  '  case "$1" in',
  "    ''|0|*[!0-9]*|0[0-9]*|???????????*) exit 1 ;;",
  '  esac',
  '  if [ "$1" -gt 4294967293 ] || [ "$1" -eq 65534 ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'validate_runtime_group() {',
  '  runtime_group_record=$(/usr/bin/getent group wharfie-runtime)',
  '  case "$runtime_group_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_group_name runtime_group_marker runtime_gid runtime_group_members runtime_group_extra <<< "$runtime_group_record"',
  '  if [ "$runtime_group_name" != wharfie-runtime ] || [ "$runtime_group_marker" != x ] || [ -n "$runtime_group_members" ] || [ -n "$runtime_group_extra" ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_id_number "$runtime_gid"',
  '  runtime_group_name_count=$(/usr/bin/getent group | /usr/bin/awk -F: \'$1 == "wharfie-runtime" { count += 1 } END { print count + 0 }\')',
  '  runtime_group_gid_count=$(/usr/bin/getent group | /usr/bin/awk -F: -v gid="$runtime_gid" \'$3 == gid { count += 1 } END { print count + 0 }\')',
  '  runtime_group_numeric_name_count=$(/usr/bin/getent group | /usr/bin/awk -F: -v name="$runtime_gid" -v plus_name="+$runtime_gid" \'$1 == name || $1 == plus_name { count += 1 } END { print count + 0 }\')',
  '  case "$runtime_group_name_count:$runtime_group_gid_count:$runtime_group_numeric_name_count" in',
  "    ''|*[!0-9:]*) exit 1 ;;",
  '  esac',
  '  if [ "$runtime_group_name_count" -ne 1 ] || [ "$runtime_group_gid_count" -ne 1 ] || [ "$runtime_group_numeric_name_count" -ne 0 ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'validate_runtime_identity() {',
  '  validate_runtime_group',
  '  runtime_user_record=$(/usr/bin/getent passwd wharfie-runtime)',
  '  case "$runtime_user_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_user_name runtime_user_marker runtime_uid runtime_user_gid runtime_user_gecos runtime_user_home runtime_user_shell runtime_user_extra <<< "$runtime_user_record"',
  '  if [ "$runtime_user_name" != wharfie-runtime ] || [ "$runtime_user_marker" != x ] || [ "$runtime_user_home" != /var/lib/wharfie-runtime ] || [ "$runtime_user_shell" != /usr/sbin/nologin ] || [ -n "$runtime_user_extra" ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_id_number "$runtime_uid"',
  '  validate_runtime_id_number "$runtime_user_gid"',
  '  if [ "$runtime_user_gid" -ne "$runtime_gid" ]; then',
  '    exit 1',
  '  fi',
  '  runtime_user_name_count=$(/usr/bin/getent passwd | /usr/bin/awk -F: \'$1 == "wharfie-runtime" { count += 1 } END { print count + 0 }\')',
  '  runtime_user_uid_count=$(/usr/bin/getent passwd | /usr/bin/awk -F: -v uid="$runtime_uid" \'$3 == uid { count += 1 } END { print count + 0 }\')',
  '  runtime_user_gid_count=$(/usr/bin/getent passwd | /usr/bin/awk -F: -v gid="$runtime_gid" \'$4 == gid { count += 1 } END { print count + 0 }\')',
  '  runtime_user_numeric_name_count=$(/usr/bin/getent passwd | /usr/bin/awk -F: -v name="$runtime_uid" -v plus_name="+$runtime_uid" \'$1 == name || $1 == plus_name { count += 1 } END { print count + 0 }\')',
  '  case "$runtime_user_name_count:$runtime_user_uid_count:$runtime_user_gid_count:$runtime_user_numeric_name_count" in',
  "    ''|*[!0-9:]*) exit 1 ;;",
  '  esac',
  '  if [ "$runtime_user_name_count" -ne 1 ] || [ "$runtime_user_uid_count" -ne 1 ] || [ "$runtime_user_gid_count" -ne 1 ] || [ "$runtime_user_numeric_name_count" -ne 0 ]; then',
  '    exit 1',
  '  fi',
  '  runtime_resolved_uid=$(/usr/bin/id -u wharfie-runtime)',
  '  runtime_resolved_gid=$(/usr/bin/id -g wharfie-runtime)',
  '  runtime_groups=$(/usr/bin/id -G wharfie-runtime)',
  '  if [ "$runtime_resolved_uid" != "$runtime_uid" ] || [ "$runtime_resolved_gid" != "$runtime_gid" ] || [ "$runtime_groups" != "$runtime_gid" ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'validate_runtime_group_shadow() {',
  '  runtime_group_shadow_record=$(/usr/bin/getent gshadow wharfie-runtime)',
  '  case "$runtime_group_shadow_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_group_shadow_name runtime_group_shadow_hash runtime_group_shadow_admins runtime_group_shadow_members runtime_group_shadow_extra <<< "$runtime_group_shadow_record"',
  '  if [ "$runtime_group_shadow_name" != wharfie-runtime ] || [ "$runtime_group_shadow_hash" != "!" ] || [ -n "$runtime_group_shadow_admins" ] || [ -n "$runtime_group_shadow_members" ] || [ -n "$runtime_group_shadow_extra" ]; then',
  '    exit 1',
  '  fi',
  '  runtime_group_shadow_name_count=$(/usr/bin/getent gshadow | /usr/bin/awk -F: \'$1 == "wharfie-runtime" { count += 1 } END { print count + 0 }\')',
  '  case "$runtime_group_shadow_name_count" in',
  "    ''|*[!0-9]*) exit 1 ;;",
  '  esac',
  '  if [ "$runtime_group_shadow_name_count" -ne 1 ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'validate_runtime_user_shadow() {',
  '  runtime_user_shadow_record=$(/usr/bin/getent shadow wharfie-runtime)',
  '  case "$runtime_user_shadow_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_user_shadow_name runtime_user_shadow_hash runtime_user_shadow_changed runtime_user_shadow_minimum runtime_user_shadow_maximum runtime_user_shadow_warning runtime_user_shadow_inactive runtime_user_shadow_expire runtime_user_shadow_reserved runtime_user_shadow_extra <<< "$runtime_user_shadow_record"',
  '  if [ "$runtime_user_shadow_name" != wharfie-runtime ] || [ "$runtime_user_shadow_hash" != "!" ] || [ -n "$runtime_user_shadow_extra" ]; then',
  '    exit 1',
  '  fi',
  '  runtime_user_shadow_name_count=$(/usr/bin/getent shadow | /usr/bin/awk -F: \'$1 == "wharfie-runtime" { count += 1 } END { print count + 0 }\')',
  '  case "$runtime_user_shadow_name_count" in',
  "    ''|*[!0-9]*) exit 1 ;;",
  '  esac',
  '  if [ "$runtime_user_shadow_name_count" -ne 1 ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'verify_runtime_directory() {',
  '  if [ ! -d "$1" ] || [ -L "$1" ]; then',
  '    exit 1',
  '  fi',
  '  runtime_directory_identity=$(/usr/bin/stat --format=%u:%g:%a -- "$1")',
  '  if [ "$runtime_directory_identity" != "$2:$3:$4" ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'verify_runtime_file() {',
  '  if [ ! -f "$1" ] || [ -L "$1" ]; then',
  '    exit 1',
  '  fi',
  '  runtime_file_identity=$(/usr/bin/stat --format=%u:%g:%a:%h -- "$1")',
  '  if [ "$runtime_file_identity" != "$2:$3:$4:1" ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'ensure_runtime_directory() {',
  '  if [ -L "$1" ]; then',
  '    exit 1',
  '  elif [ -e "$1" ]; then',
  '    verify_runtime_directory "$1" "$2" "$3" "$4"',
  '  else',
  '    /usr/bin/install -d -o "$2" -g "$3" -m "$4" -- "$1"',
  '  fi',
  '  verify_runtime_directory "$1" "$2" "$3" "$4"',
  '}',
  '',
  'runtime_group_status=0',
  'runtime_group_preflight=$(/usr/bin/getent group wharfie-runtime) || runtime_group_status=$?',
  'runtime_user_status=0',
  'runtime_user_preflight=$(/usr/bin/getent passwd wharfie-runtime) || runtime_user_status=$?',
  'case "$runtime_group_status:$runtime_user_status" in',
  '  0:0|0:2|2:0|2:2) ;;',
  '  *) exit 1 ;;',
  'esac',
  'runtime_preflight_group_names=$(/usr/bin/getent group | /usr/bin/awk -F: \'$1 == "wharfie-runtime" { count += 1 } END { print count + 0 }\')',
  'runtime_preflight_user_names=$(/usr/bin/getent passwd | /usr/bin/awk -F: \'$1 == "wharfie-runtime" { count += 1 } END { print count + 0 }\')',
  'case "$runtime_preflight_group_names:$runtime_preflight_user_names" in',
  "  ''|*[!0-9:]*) exit 1 ;;",
  'esac',
  '',
  'if [ "$runtime_group_status" -eq 2 ] && [ "$runtime_user_status" -eq 2 ]; then',
  '  if [ "$runtime_preflight_group_names" -ne 0 ] || [ "$runtime_preflight_user_names" -ne 0 ]; then',
  '    exit 1',
  '  fi',
  '  runtime_identity_state=absent',
  'elif [ "$runtime_group_status" -eq 0 ] && [ "$runtime_user_status" -eq 2 ]; then',
  '  if [ "$runtime_preflight_group_names" -ne 1 ] || [ "$runtime_preflight_user_names" -ne 0 ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_group',
  '  runtime_preflight_gid_users=$(/usr/bin/getent passwd | /usr/bin/awk -F: -v gid="$runtime_gid" \'$4 == gid { count += 1 } END { print count + 0 }\')',
  '  case "$runtime_preflight_gid_users" in',
  "    ''|*[!0-9]*) exit 1 ;;",
  '  esac',
  '  if [ "$runtime_preflight_gid_users" -ne 0 ]; then',
  '    exit 1',
  '  fi',
  '  runtime_identity_state=group-only',
  'elif [ "$runtime_group_status" -eq 0 ] && [ "$runtime_user_status" -eq 0 ]; then',
  '  if [ "$runtime_preflight_group_names" -ne 1 ] || [ "$runtime_preflight_user_names" -ne 1 ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_identity',
  '  runtime_identity_state=existing',
  'else',
  '  exit 1',
  'fi',
  '',
  'case "$runtime_identity_state" in',
  '  absent)',
  '    /usr/sbin/groupadd --system wharfie-runtime',
  '    ;;',
  '  group-only|existing) ;;',
  '  *) exit 1 ;;',
  'esac',
  'validate_runtime_group',
  "/usr/sbin/groupmod -p '!' wharfie-runtime",
  'validate_runtime_group',
  'validate_runtime_group_shadow',
  '/usr/bin/sync --file-system /etc',
  '',
  'case "$runtime_identity_state" in',
  '  absent|group-only)',
  '    runtime_new_group_gid_users=$(/usr/bin/getent passwd | /usr/bin/awk -F: -v gid="$runtime_gid" \'$4 == gid { count += 1 } END { print count + 0 }\')',
  '    case "$runtime_new_group_gid_users" in',
  "      ''|*[!0-9]*) exit 1 ;;",
  '    esac',
  '    if [ "$runtime_new_group_gid_users" -ne 0 ]; then',
  '      exit 1',
  '    fi',
  '    /usr/sbin/useradd --system --gid wharfie-runtime --no-create-home --home-dir /var/lib/wharfie-runtime --shell /usr/sbin/nologin wharfie-runtime',
  '    ;;',
  '  existing) ;;',
  '  *) exit 1 ;;',
  'esac',
  'validate_runtime_identity',
  "/usr/sbin/usermod -p '!' wharfie-runtime",
  'validate_runtime_identity',
  'validate_runtime_user_shadow',
  '/usr/bin/sync --file-system /etc',
  '',
  'verify_runtime_directory /var/lib 0 0 755',
  'if [ -L /var/lib/wharfie-runtime ]; then',
  '  exit 1',
  'elif [ -e /var/lib/wharfie-runtime ]; then',
  '  verify_runtime_directory /var/lib/wharfie-runtime "$runtime_uid" "$runtime_gid" 700',
  'else',
  '  /usr/bin/install -d -o wharfie-runtime -g wharfie-runtime -m 0700 -- /var/lib/wharfie-runtime',
  'fi',
  'verify_runtime_directory /var/lib/wharfie-runtime "$runtime_uid" "$runtime_gid" 700',
  '',
  'for runtime_descendant in /var/lib/wharfie-runtime/tmp /var/lib/wharfie-runtime/.config /var/lib/wharfie-runtime/.config/systemd /var/lib/wharfie-runtime/.config/systemd/user; do',
  '  if [ -L "$runtime_descendant" ] || { [ -e "$runtime_descendant" ] && [ ! -d "$runtime_descendant" ]; }; then',
  '    exit 1',
  '  fi',
  'done',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/install -d -m 0700 -- /var/lib/wharfie-runtime/tmp',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/install -d -m 0750 -- /var/lib/wharfie-runtime/.config /var/lib/wharfie-runtime/.config/systemd /var/lib/wharfie-runtime/.config/systemd/user',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/chmod 0700 -- /var/lib/wharfie-runtime/tmp',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/chmod 0750 -- /var/lib/wharfie-runtime/.config /var/lib/wharfie-runtime/.config/systemd /var/lib/wharfie-runtime/.config/systemd/user',
  'verify_runtime_directory /var/lib/wharfie-runtime/tmp "$runtime_uid" "$runtime_gid" 700',
  'verify_runtime_directory /var/lib/wharfie-runtime/.config "$runtime_uid" "$runtime_gid" 750',
  'verify_runtime_directory /var/lib/wharfie-runtime/.config/systemd "$runtime_uid" "$runtime_gid" 750',
  'verify_runtime_directory /var/lib/wharfie-runtime/.config/systemd/user "$runtime_uid" "$runtime_gid" 750',
  '',
  'verify_runtime_directory /etc 0 0 755',
  'ensure_runtime_directory /etc/wharfie 0 0 755',
  'verify_runtime_directory /opt 0 0 755',
  'ensure_runtime_directory /opt/wharfie 0 "$runtime_gid" 750',
  'ensure_runtime_directory /opt/wharfie/app 0 "$runtime_gid" 750',
  '',
  'verify_runtime_directory /etc/systemd 0 0 755',
  'verify_runtime_directory /etc/systemd/system 0 0 755',
  'runtime_manager_dropin="/etc/systemd/system/user@$runtime_uid.service.d"',
  'ensure_runtime_directory "$runtime_manager_dropin" 0 0 755',
  'runtime_manager_dropin_file="$runtime_manager_dropin/50-wharfie-imds.conf"',
  'if [ -e "$runtime_manager_dropin_file" ] || [ -L "$runtime_manager_dropin_file" ]; then',
  '  verify_runtime_file "$runtime_manager_dropin_file" 0 0 644',
  'fi',
  'runtime_manager_dropin_temp=$(/usr/bin/mktemp --tmpdir="$runtime_manager_dropin" \'.50-wharfie-imds.conf.XXXXXXXXXX\')',
  'runtime_manager_dropin_cleanup() {',
  '  if [ -n "$runtime_manager_dropin_temp" ]; then',
  '    /usr/bin/rm -f -- "$runtime_manager_dropin_temp"',
  '  fi',
  '}',
  'trap runtime_manager_dropin_cleanup ERR EXIT',
  "/usr/bin/printf '%s\\n' '[Service]' 'IPAddressDeny=169.254.169.254/32' > \"$runtime_manager_dropin_temp\"",
  '/usr/bin/chown root:root "$runtime_manager_dropin_temp"',
  '/usr/bin/chmod 0644 "$runtime_manager_dropin_temp"',
  'verify_runtime_file "$runtime_manager_dropin_temp" 0 0 644',
  '/usr/bin/sync --file-system "$runtime_manager_dropin_temp"',
  '/usr/bin/mv --no-target-directory -- "$runtime_manager_dropin_temp" "$runtime_manager_dropin_file"',
  "runtime_manager_dropin_temp=''",
  '/usr/bin/sync --file-system "$runtime_manager_dropin"',
  'verify_runtime_file "$runtime_manager_dropin_file" 0 0 644',
  "/usr/bin/printf '%s\\n' '[Service]' 'IPAddressDeny=169.254.169.254/32' | /usr/bin/cmp --silent - \"$runtime_manager_dropin_file\"",
  'trap - ERR EXIT',
  '',
  '/usr/bin/systemctl daemon-reload',
  '/usr/bin/loginctl enable-linger wharfie-runtime',
  '/usr/bin/systemctl restart "user@$runtime_uid.service"',
  '/usr/bin/systemctl enable --now amazon-ssm-agent.service',
]);

const BOOTSTRAP_TEXT = `${BOOTSTRAP_LINES.join('\n')}\n`;
const BOOTSTRAP_BYTES = Buffer.from(BOOTSTRAP_TEXT, 'utf8');

const REQUIRED_FRAGMENTS = Object.freeze([
  '#!/bin/bash\n',
  'set -Eeuo pipefail\n',
  'export PATH=/usr/sbin:/usr/bin:/sbin:/bin\n',
  'validate_runtime_id_number() {\n',
  '[ "$1" -gt 4294967293 ] || [ "$1" -eq 65534 ]',
  'validate_runtime_group() {\n',
  'validate_runtime_group_shadow() {\n',
  'validate_runtime_user_shadow() {\n',
  'verify_runtime_file() {\n',
  'ensure_runtime_directory() {\n',
  'runtime_group_name_count=$(/usr/bin/getent group | /usr/bin/awk -F:',
  'runtime_user_uid_count=$(/usr/bin/getent passwd | /usr/bin/awk -F:',
  'runtime_group_preflight=$(/usr/bin/getent group wharfie-runtime) || runtime_group_status=$?\n',
  'runtime_user_preflight=$(/usr/bin/getent passwd wharfie-runtime) || runtime_user_status=$?\n',
  'runtime_identity_state=group-only\n',
  '/usr/sbin/groupadd --system wharfie-runtime\n',
  "/usr/sbin/groupmod -p '!' wharfie-runtime\n",
  '/usr/bin/sync --file-system /etc\n',
  '/usr/sbin/useradd --system --gid wharfie-runtime --no-create-home',
  "validate_runtime_identity\n/usr/sbin/usermod -p '!' wharfie-runtime\n",
  'runtime_groups=$(/usr/bin/id -G wharfie-runtime)\n',
  'verify_runtime_directory /var/lib 0 0 755\n',
  '/usr/bin/install -d -o wharfie-runtime -g wharfie-runtime -m 0700 -- /var/lib/wharfie-runtime\n',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/install',
  'verify_runtime_directory /var/lib/wharfie-runtime/.config/systemd/user "$runtime_uid" "$runtime_gid" 750\n',
  'verify_runtime_directory /etc 0 0 755\n',
  'ensure_runtime_directory /etc/wharfie 0 0 755\n',
  'verify_runtime_directory /opt 0 0 755\n',
  'ensure_runtime_directory /opt/wharfie 0 "$runtime_gid" 750\n',
  'ensure_runtime_directory /opt/wharfie/app 0 "$runtime_gid" 750\n',
  'verify_runtime_directory /etc/systemd/system 0 0 755\n',
  'runtime_manager_dropin="/etc/systemd/system/user@$runtime_uid.service.d"\n',
  'runtime_manager_dropin_temp=$(/usr/bin/mktemp --tmpdir="$runtime_manager_dropin"',
  '/usr/bin/mv --no-target-directory -- "$runtime_manager_dropin_temp" "$runtime_manager_dropin_file"\n',
  "/usr/bin/printf '%s\\n' '[Service]' 'IPAddressDeny=169.254.169.254/32'",
  'verify_runtime_file "$runtime_manager_dropin_file" 0 0 644\n',
  '/usr/bin/loginctl enable-linger wharfie-runtime\n',
  '/usr/bin/systemctl restart "user@$runtime_uid.service"\n',
  '/usr/bin/systemctl enable --now amazon-ssm-agent.service\n',
]);

/** Validate the immutable byte contract before exposing any derived value. */
function validateBootstrapContract() {
  if (
    !Number.isSafeInteger(AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION) ||
    AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION !== 2
  ) {
    throw new TypeError(
      'AWS single-node bootstrap contract version must be exactly 2.',
    );
  }
  if (
    !Number.isSafeInteger(AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES) ||
    AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES !== 16_384
  ) {
    throw new TypeError(
      'AWS single-node bootstrap raw byte limit must be exactly 16 KiB.',
    );
  }
  if (
    BOOTSTRAP_BYTES.byteLength === 0 ||
    BOOTSTRAP_BYTES.byteLength > AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES
  ) {
    throw new TypeError(
      'AWS single-node bootstrap bytes exceed their exact size contract.',
    );
  }
  if (
    !BOOTSTRAP_TEXT.startsWith('#!/bin/bash\n') ||
    !BOOTSTRAP_TEXT.endsWith('\n') ||
    BOOTSTRAP_TEXT.includes('\r') ||
    BOOTSTRAP_TEXT.includes('\0') ||
    BOOTSTRAP_BYTES.toString('utf8') !== BOOTSTRAP_TEXT
  ) {
    throw new TypeError(
      'AWS single-node bootstrap must be canonical LF-terminated UTF-8 shell text.',
    );
  }
  if (/\$\{|\{\{|\}\}/u.test(BOOTSTRAP_TEXT)) {
    throw new TypeError(
      'AWS single-node bootstrap must not contain interpolation placeholders.',
    );
  }
  if (
    /access[-_ ]?key|secret|password|credential|session[-_ ]?token|security[-_ ]?token|AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}/iu.test(
      BOOTSTRAP_TEXT,
    )
  ) {
    throw new TypeError(
      'AWS single-node bootstrap must not contain credential material.',
    );
  }
  for (const fragment of REQUIRED_FRAGMENTS) {
    if (!BOOTSTRAP_TEXT.includes(fragment)) {
      throw new TypeError(
        'AWS single-node bootstrap is missing a required fixed operation.',
      );
    }
  }
  if (
    !Buffer.from(BOOTSTRAP_BYTES.toString('base64'), 'base64').equals(
      BOOTSTRAP_BYTES,
    )
  ) {
    throw new TypeError(
      'AWS single-node bootstrap base64 encoding must round-trip exactly.',
    );
  }
}

validateBootstrapContract();

export const AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST = Object.freeze({
  algorithm: 'sha256',
  value: sha256Base64Url(
    Buffer.concat([
      Buffer.from(`${AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN}\0`, 'utf8'),
      BOOTSTRAP_BYTES,
    ]),
  ),
});

assertSha256Base64Url(
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST.value,
  'AWS single-node bootstrap digest',
);

/**
 * Return an independently mutable copy of the fixed raw EC2 user-data bytes.
 * @returns {Buffer} - Fresh LF-terminated UTF-8 shell bytes.
 */
export function getAwsSingleNodeBootstrapBytes() {
  return Buffer.from(BOOTSTRAP_BYTES);
}

/**
 * Return the fixed EC2 RunInstances base64 user-data representation.
 * @returns {string} - Standard padded base64 text.
 */
export function getAwsSingleNodeBootstrapBase64() {
  return BOOTSTRAP_BYTES.toString('base64');
}

export default Object.freeze({
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION,
  AWS_SINGLE_NODE_NODE_BOOTSTRAP_DIGEST,
  AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN,
  AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES,
  getAwsSingleNodeBootstrapBase64,
  getAwsSingleNodeBootstrapBytes,
});
