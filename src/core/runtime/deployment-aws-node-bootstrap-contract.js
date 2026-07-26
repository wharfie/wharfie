import { assertSha256Base64Url, sha256Base64Url } from './content-id.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID,
  AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER,
} from './deployment-aws-host-runtime-account.js';

export const AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION = 3;
export const AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN =
  'wharfie:aws-single-node-bootstrap:v3';
export const AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES = 16 * 1024;

const BOOTSTRAP_LINES = Object.freeze([
  '#!/bin/bash',
  'set -Eeuo pipefail',
  'umask 027',
  'export PATH=/usr/sbin:/usr/bin:/sbin:/bin',
  'export LANG=C',
  'export LC_ALL=C',
  `readonly runtime_expected_user=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER}`,
  `readonly runtime_expected_group=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP}`,
  `readonly runtime_expected_uid=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID}`,
  `readonly runtime_expected_gid=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID}`,
  `readonly runtime_expected_gecos=${JSON.stringify(
    AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
  )}`,
  `readonly runtime_expected_home=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME}`,
  `readonly runtime_expected_shell=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL}`,
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
  '  runtime_group_record=$(/usr/bin/getent group "$runtime_expected_group")',
  '  runtime_group_numeric_record=$(/usr/bin/getent group "$runtime_expected_gid")',
  '  if [ "$runtime_group_record" != "$runtime_group_numeric_record" ]; then',
  '    exit 1',
  '  fi',
  '  case "$runtime_group_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_group_name runtime_group_marker runtime_gid runtime_group_members runtime_group_extra <<< "$runtime_group_record"',
  '  if [ "$runtime_group_name" != "$runtime_expected_group" ] || [ "$runtime_group_marker" != x ] || [ "$runtime_gid" != "$runtime_expected_gid" ] || [ -n "$runtime_group_members" ] || [ -n "$runtime_group_extra" ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_id_number "$runtime_gid"',
  '}',
  '',
  'validate_runtime_identity() {',
  '  validate_runtime_group',
  '  runtime_user_record=$(/usr/bin/getent passwd "$runtime_expected_user")',
  '  runtime_user_numeric_record=$(/usr/bin/getent passwd "$runtime_expected_uid")',
  '  if [ "$runtime_user_record" != "$runtime_user_numeric_record" ]; then',
  '    exit 1',
  '  fi',
  '  case "$runtime_user_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_user_name runtime_user_marker runtime_uid runtime_user_gid runtime_user_gecos runtime_user_home runtime_user_shell runtime_user_extra <<< "$runtime_user_record"',
  '  if [ "$runtime_user_name" != "$runtime_expected_user" ] || [ "$runtime_user_marker" != x ] || [ "$runtime_uid" != "$runtime_expected_uid" ] || [ "$runtime_user_gid" != "$runtime_expected_gid" ] || [ -n "$runtime_user_gecos" ] || [ "$runtime_user_home" != "$runtime_expected_home" ] || [ "$runtime_user_shell" != "$runtime_expected_shell" ] || [ -n "$runtime_user_extra" ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_id_number "$runtime_uid"',
  '  validate_runtime_id_number "$runtime_user_gid"',
  '  if [ "$runtime_user_gid" -ne "$runtime_gid" ]; then',
  '    exit 1',
  '  fi',
  '  runtime_resolved_uid=$(/usr/bin/id -u "$runtime_expected_user")',
  '  runtime_resolved_gid=$(/usr/bin/id -g "$runtime_expected_user")',
  '  runtime_groups=$(/usr/bin/id -G "$runtime_expected_user")',
  '  if [ "$runtime_resolved_uid" != "$runtime_uid" ] || [ "$runtime_resolved_gid" != "$runtime_gid" ] || [ "$runtime_groups" != "$runtime_gid" ]; then',
  '    exit 1',
  '  fi',
  '}',
  '',
  'validate_runtime_group_shadow_record() {',
  '  runtime_group_shadow_record=$1',
  '  case "$runtime_group_shadow_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_group_shadow_name runtime_group_shadow_hash runtime_group_shadow_admins runtime_group_shadow_members runtime_group_shadow_extra <<< "$runtime_group_shadow_record"',
  '  if [ "$runtime_group_shadow_name" != "$runtime_expected_group" ] || [ -n "$runtime_group_shadow_admins" ] || [ -n "$runtime_group_shadow_members" ] || [ -n "$runtime_group_shadow_extra" ]; then',
  '    exit 1',
  '  fi',
  '  printf -v runtime_group_shadow_canonical_record \'%s:%s:%s:%s\' "$runtime_group_shadow_name" "$runtime_group_shadow_hash" "$runtime_group_shadow_admins" "$runtime_group_shadow_members"',
  '  if [ "$runtime_group_shadow_record" != "$runtime_group_shadow_canonical_record" ]; then',
  '    exit 1',
  '  fi',
  '  printf -v runtime_group_shadow_locked_record \'%s:!:%s:%s\' "$runtime_group_shadow_name" "$runtime_group_shadow_admins" "$runtime_group_shadow_members"',
  '}',
  '',
  'validate_runtime_user_shadow_record() {',
  '  runtime_user_shadow_record=$1',
  '  case "$runtime_user_shadow_record" in *$\'\\n\'*) exit 1 ;; esac',
  '  IFS=: read -r runtime_user_shadow_name runtime_user_shadow_hash runtime_user_shadow_changed runtime_user_shadow_minimum runtime_user_shadow_maximum runtime_user_shadow_warning runtime_user_shadow_inactive runtime_user_shadow_expire runtime_user_shadow_reserved runtime_user_shadow_extra <<< "$runtime_user_shadow_record"',
  '  if [ "$runtime_user_shadow_name" != "$runtime_expected_user" ] || [ -n "$runtime_user_shadow_reserved" ] || [ -n "$runtime_user_shadow_extra" ]; then',
  '    exit 1',
  '  fi',
  '  printf -v runtime_user_shadow_canonical_record \'%s:%s:%s:%s:%s:%s:%s:%s:%s\' "$runtime_user_shadow_name" "$runtime_user_shadow_hash" "$runtime_user_shadow_changed" "$runtime_user_shadow_minimum" "$runtime_user_shadow_maximum" "$runtime_user_shadow_warning" "$runtime_user_shadow_inactive" "$runtime_user_shadow_expire" "$runtime_user_shadow_reserved"',
  '  if [ "$runtime_user_shadow_record" != "$runtime_user_shadow_canonical_record" ]; then',
  '    exit 1',
  '  fi',
  '  printf -v runtime_user_shadow_locked_record \'%s:!:%s:%s:%s:%s:%s:%s:%s\' "$runtime_user_shadow_name" "$runtime_user_shadow_changed" "$runtime_user_shadow_minimum" "$runtime_user_shadow_maximum" "$runtime_user_shadow_warning" "$runtime_user_shadow_inactive" "$runtime_user_shadow_expire" "$runtime_user_shadow_reserved"',
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
  'runtime_group_preflight=$(/usr/bin/getent group "$runtime_expected_group") || runtime_group_status=$?',
  'runtime_user_status=0',
  'runtime_user_preflight=$(/usr/bin/getent passwd "$runtime_expected_user") || runtime_user_status=$?',
  'runtime_gid_status=0',
  'runtime_gid_preflight=$(/usr/bin/getent group "$runtime_expected_gid") || runtime_gid_status=$?',
  'runtime_uid_status=0',
  'runtime_uid_preflight=$(/usr/bin/getent passwd "$runtime_expected_uid") || runtime_uid_status=$?',
  'runtime_gshadow_status=0',
  'runtime_gshadow_preflight=$(/usr/bin/getent gshadow "$runtime_expected_group") || runtime_gshadow_status=$?',
  'runtime_shadow_status=0',
  'runtime_shadow_preflight=$(/usr/bin/getent shadow "$runtime_expected_user") || runtime_shadow_status=$?',
  'case "$runtime_group_status:$runtime_user_status:$runtime_gid_status:$runtime_uid_status:$runtime_gshadow_status:$runtime_shadow_status" in',
  "  ''|*[!0-9:]*) exit 1 ;;",
  '  *) ;;',
  'esac',
  'case "$runtime_group_status" in 0|2) ;; *) exit 1 ;; esac',
  'case "$runtime_user_status" in 0|2) ;; *) exit 1 ;; esac',
  'case "$runtime_gid_status" in 0|2) ;; *) exit 1 ;; esac',
  'case "$runtime_uid_status" in 0|2) ;; *) exit 1 ;; esac',
  'case "$runtime_gshadow_status" in 0|2) ;; *) exit 1 ;; esac',
  'case "$runtime_shadow_status" in 0|2) ;; *) exit 1 ;; esac',
  '',
  'if [ "$runtime_group_status" -eq 2 ] && [ "$runtime_user_status" -eq 2 ]; then',
  '  if [ "$runtime_gid_status" -ne 2 ] || [ "$runtime_uid_status" -ne 2 ] || [ "$runtime_gshadow_status" -ne 2 ] || [ "$runtime_shadow_status" -ne 2 ]; then',
  '    exit 1',
  '  fi',
  '  runtime_identity_state=absent',
  'elif [ "$runtime_group_status" -eq 0 ] && [ "$runtime_user_status" -eq 2 ]; then',
  '  if [ "$runtime_gid_status" -ne 0 ] || [ "$runtime_uid_status" -ne 2 ] || [ "$runtime_gshadow_status" -ne 0 ] || [ "$runtime_shadow_status" -ne 2 ] || [ "$runtime_gid_preflight" != "$runtime_group_preflight" ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_group',
  '  validate_runtime_group_shadow_record "$runtime_gshadow_preflight"',
  '  runtime_identity_state=group-only',
  'elif [ "$runtime_group_status" -eq 0 ] && [ "$runtime_user_status" -eq 0 ]; then',
  '  if [ "$runtime_gid_status" -ne 0 ] || [ "$runtime_uid_status" -ne 0 ] || [ "$runtime_gshadow_status" -ne 0 ] || [ "$runtime_shadow_status" -ne 0 ] || [ "$runtime_gid_preflight" != "$runtime_group_preflight" ] || [ "$runtime_uid_preflight" != "$runtime_user_preflight" ]; then',
  '    exit 1',
  '  fi',
  '  validate_runtime_identity',
  '  validate_runtime_group_shadow_record "$runtime_gshadow_preflight"',
  '  validate_runtime_user_shadow_record "$runtime_shadow_preflight"',
  '  runtime_identity_state=existing',
  'else',
  '  exit 1',
  'fi',
  '',
  'case "$runtime_identity_state" in',
  '  absent)',
  '    /usr/sbin/groupadd --system --gid "$runtime_expected_gid" "$runtime_expected_group"',
  '    ;;',
  '  group-only|existing) ;;',
  '  *) exit 1 ;;',
  'esac',
  'validate_runtime_group',
  'runtime_group_shadow_before=$(/usr/bin/getent gshadow "$runtime_expected_group")',
  'validate_runtime_group_shadow_record "$runtime_group_shadow_before"',
  'runtime_group_shadow_locked_expected=$runtime_group_shadow_locked_record',
  '/usr/sbin/groupmod -p \'!\' "$runtime_expected_group"',
  'validate_runtime_group',
  'runtime_group_shadow_after=$(/usr/bin/getent gshadow "$runtime_expected_group")',
  'if [ "$runtime_group_shadow_after" != "$runtime_group_shadow_locked_expected" ]; then',
  '  exit 1',
  'fi',
  'validate_runtime_group_shadow_record "$runtime_group_shadow_after"',
  '/usr/bin/sync --file-system /etc',
  '',
  'case "$runtime_identity_state" in',
  '  absent|group-only)',
  '    runtime_new_user_status=0',
  '    runtime_new_user_record=$(/usr/bin/getent passwd "$runtime_expected_user") || runtime_new_user_status=$?',
  '    runtime_new_uid_status=0',
  '    runtime_new_uid_record=$(/usr/bin/getent passwd "$runtime_expected_uid") || runtime_new_uid_status=$?',
  '    if [ "$runtime_new_user_status" -ne 2 ] || [ "$runtime_new_uid_status" -ne 2 ]; then',
  '      exit 1',
  '    fi',
  '    /usr/sbin/useradd --system --uid "$runtime_expected_uid" --gid "$runtime_expected_group" --comment "$runtime_expected_gecos" --no-create-home --home-dir "$runtime_expected_home" --shell "$runtime_expected_shell" "$runtime_expected_user"',
  '    ;;',
  '  existing) ;;',
  '  *) exit 1 ;;',
  'esac',
  'validate_runtime_identity',
  'runtime_user_shadow_before=$(/usr/bin/getent shadow "$runtime_expected_user")',
  'validate_runtime_user_shadow_record "$runtime_user_shadow_before"',
  'runtime_user_shadow_locked_expected=$runtime_user_shadow_locked_record',
  '/usr/sbin/usermod -p \'!\' "$runtime_expected_user"',
  'validate_runtime_identity',
  'runtime_user_shadow_after=$(/usr/bin/getent shadow "$runtime_expected_user")',
  'if [ "$runtime_user_shadow_after" != "$runtime_user_shadow_locked_expected" ]; then',
  '  exit 1',
  'fi',
  'validate_runtime_user_shadow_record "$runtime_user_shadow_after"',
  '/usr/bin/sync --file-system /etc',
  '',
  'verify_runtime_directory /var/lib 0 0 755',
  'if [ -L "$runtime_expected_home" ]; then',
  '  exit 1',
  'elif [ -e "$runtime_expected_home" ]; then',
  '  verify_runtime_directory "$runtime_expected_home" "$runtime_uid" "$runtime_gid" 700',
  'else',
  '  /usr/bin/install -d -o "$runtime_expected_user" -g "$runtime_expected_group" -m 0700 -- "$runtime_expected_home"',
  'fi',
  'verify_runtime_directory "$runtime_expected_home" "$runtime_uid" "$runtime_gid" 700',
  '',
  'for runtime_descendant in "$runtime_expected_home/tmp" "$runtime_expected_home/.config" "$runtime_expected_home/.config/systemd" "$runtime_expected_home/.config/systemd/user"; do',
  '  if [ -L "$runtime_descendant" ] || { [ -e "$runtime_descendant" ] && [ ! -d "$runtime_descendant" ]; }; then',
  '    exit 1',
  '  fi',
  'done',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/install -d -m 0700 -- "$runtime_expected_home/tmp"',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/install -d -m 0750 -- "$runtime_expected_home/.config" "$runtime_expected_home/.config/systemd" "$runtime_expected_home/.config/systemd/user"',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/chmod 0700 -- "$runtime_expected_home/tmp"',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/chmod 0750 -- "$runtime_expected_home/.config" "$runtime_expected_home/.config/systemd" "$runtime_expected_home/.config/systemd/user"',
  'verify_runtime_directory "$runtime_expected_home/tmp" "$runtime_uid" "$runtime_gid" 700',
  'verify_runtime_directory "$runtime_expected_home/.config" "$runtime_uid" "$runtime_gid" 750',
  'verify_runtime_directory "$runtime_expected_home/.config/systemd" "$runtime_uid" "$runtime_gid" 750',
  'verify_runtime_directory "$runtime_expected_home/.config/systemd/user" "$runtime_uid" "$runtime_gid" 750',
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
  '/usr/bin/loginctl enable-linger "$runtime_expected_user"',
  '/usr/bin/systemctl restart "user@$runtime_uid.service"',
  '/usr/bin/systemctl enable --now amazon-ssm-agent.service',
]);

const BOOTSTRAP_TEXT = `${BOOTSTRAP_LINES.join('\n')}\n`;
const BOOTSTRAP_BYTES = Buffer.from(BOOTSTRAP_TEXT, 'utf8');

const REQUIRED_FRAGMENTS = Object.freeze([
  '#!/bin/bash\n',
  'set -Eeuo pipefail\n',
  'export PATH=/usr/sbin:/usr/bin:/sbin:/bin\n',
  `readonly runtime_expected_user=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_USER}\n`,
  `readonly runtime_expected_group=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GROUP}\n`,
  `readonly runtime_expected_uid=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID}\n`,
  `readonly runtime_expected_gid=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GID}\n`,
  `readonly runtime_expected_gecos=${JSON.stringify(
    AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_GECOS,
  )}\n`,
  `readonly runtime_expected_home=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_HOME}\n`,
  `readonly runtime_expected_shell=${AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_SHELL}\n`,
  'validate_runtime_id_number() {\n',
  '[ "$1" -gt 4294967293 ] || [ "$1" -eq 65534 ]',
  'validate_runtime_group() {\n',
  'validate_runtime_group_shadow_record() {\n',
  'validate_runtime_user_shadow_record() {\n',
  'verify_runtime_file() {\n',
  'ensure_runtime_directory() {\n',
  'runtime_group_numeric_record=$(/usr/bin/getent group "$runtime_expected_gid")\n',
  'runtime_user_numeric_record=$(/usr/bin/getent passwd "$runtime_expected_uid")\n',
  'runtime_group_preflight=$(/usr/bin/getent group "$runtime_expected_group") || runtime_group_status=$?\n',
  'runtime_user_preflight=$(/usr/bin/getent passwd "$runtime_expected_user") || runtime_user_status=$?\n',
  'runtime_gid_preflight=$(/usr/bin/getent group "$runtime_expected_gid") || runtime_gid_status=$?\n',
  'runtime_uid_preflight=$(/usr/bin/getent passwd "$runtime_expected_uid") || runtime_uid_status=$?\n',
  'runtime_gshadow_preflight=$(/usr/bin/getent gshadow "$runtime_expected_group") || runtime_gshadow_status=$?\n',
  'runtime_shadow_preflight=$(/usr/bin/getent shadow "$runtime_expected_user") || runtime_shadow_status=$?\n',
  'runtime_new_user_record=$(/usr/bin/getent passwd "$runtime_expected_user") || runtime_new_user_status=$?\n',
  'runtime_new_uid_record=$(/usr/bin/getent passwd "$runtime_expected_uid") || runtime_new_uid_status=$?\n',
  'runtime_identity_state=group-only\n',
  '/usr/sbin/groupadd --system --gid "$runtime_expected_gid" "$runtime_expected_group"\n',
  '/usr/sbin/groupmod -p \'!\' "$runtime_expected_group"\n',
  '/usr/bin/sync --file-system /etc\n',
  '/usr/sbin/useradd --system --uid "$runtime_expected_uid" --gid "$runtime_expected_group" --comment "$runtime_expected_gecos" --no-create-home',
  'runtime_user_shadow_locked_expected=$runtime_user_shadow_locked_record\n/usr/sbin/usermod -p \'!\' "$runtime_expected_user"\n',
  'runtime_groups=$(/usr/bin/id -G "$runtime_expected_user")\n',
  'verify_runtime_directory /var/lib 0 0 755\n',
  '/usr/bin/install -d -o "$runtime_expected_user" -g "$runtime_expected_group" -m 0700 -- "$runtime_expected_home"\n',
  '/usr/bin/setpriv --reuid="+$runtime_uid" --regid="+$runtime_gid" --clear-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs /usr/bin/install',
  'verify_runtime_directory "$runtime_expected_home/.config/systemd/user" "$runtime_uid" "$runtime_gid" 750\n',
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
  '/usr/bin/loginctl enable-linger "$runtime_expected_user"\n',
  '/usr/bin/systemctl restart "user@$runtime_uid.service"\n',
  '/usr/bin/systemctl enable --now amazon-ssm-agent.service\n',
]);

/** Validate the immutable byte contract before exposing any derived value. */
function validateBootstrapContract() {
  if (
    !Number.isSafeInteger(AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION) ||
    AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION !== 3
  ) {
    throw new TypeError(
      'AWS single-node bootstrap contract version must be exactly 3.',
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
