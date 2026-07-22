import { assertSha256Base64Url, sha256Base64Url } from './content-id.js';

export const AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION = 1;
export const AWS_SINGLE_NODE_BOOTSTRAP_DIGEST_DOMAIN =
  'wharfie:aws-single-node-bootstrap:v1';
export const AWS_SINGLE_NODE_BOOTSTRAP_MAX_RAW_BYTES = 16 * 1024;

const BOOTSTRAP_LINES = Object.freeze([
  '#!/bin/bash',
  'set -Eeuo pipefail',
  'umask 027',
  '',
  'if ! /usr/bin/getent group wharfie-runtime >/dev/null; then',
  '  /usr/sbin/groupadd --system wharfie-runtime',
  'fi',
  'if ! /usr/bin/id --user wharfie-runtime >/dev/null 2>&1; then',
  '  /usr/sbin/useradd --system --gid wharfie-runtime --create-home --home-dir /var/lib/wharfie-runtime --shell /usr/sbin/nologin wharfie-runtime',
  'fi',
  '/usr/sbin/usermod --gid wharfie-runtime --home /var/lib/wharfie-runtime --shell /usr/sbin/nologin --lock wharfie-runtime',
  '',
  '/usr/bin/install -d -o root -g root -m 0755 /etc/wharfie /opt/wharfie /opt/wharfie/app',
  '/usr/bin/install -d -o wharfie-runtime -g wharfie-runtime -m 0700 /var/lib/wharfie-runtime',
  '/usr/bin/install -d -o wharfie-runtime -g wharfie-runtime -m 0750 /var/lib/wharfie-runtime/.config /var/lib/wharfie-runtime/.config/systemd /var/lib/wharfie-runtime/.config/systemd/user',
  'runtime_uid=$(/usr/bin/id --user wharfie-runtime)',
  'case "$runtime_uid" in',
  "  ''|*[!0-9]*) exit 1 ;;",
  'esac',
  '',
  'runtime_manager_dropin="/etc/systemd/system/user@$runtime_uid.service.d"',
  '/usr/bin/install -d -o root -g root -m 0755 "$runtime_manager_dropin"',
  'cat > "$runtime_manager_dropin/50-wharfie-imds.conf" <<\'WHARFIE_IMDS_UNIT\'',
  '[Service]',
  'IPAddressDeny=169.254.169.254/32',
  'WHARFIE_IMDS_UNIT',
  '/usr/bin/chown root:root "$runtime_manager_dropin/50-wharfie-imds.conf"',
  '/usr/bin/chmod 0644 "$runtime_manager_dropin/50-wharfie-imds.conf"',
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
  '/usr/sbin/usermod --gid wharfie-runtime --home /var/lib/wharfie-runtime --shell /usr/sbin/nologin --lock wharfie-runtime\n',
  'runtime_uid=$(/usr/bin/id --user wharfie-runtime)\n',
  'runtime_manager_dropin="/etc/systemd/system/user@$runtime_uid.service.d"\n',
  'IPAddressDeny=169.254.169.254/32\n',
  '/usr/bin/chown root:root "$runtime_manager_dropin/50-wharfie-imds.conf"\n',
  '/usr/bin/loginctl enable-linger wharfie-runtime\n',
  '/usr/bin/systemctl restart "user@$runtime_uid.service"\n',
  '/usr/bin/systemctl enable --now amazon-ssm-agent.service\n',
]);

/** Validate the immutable byte contract before exposing any derived value. */
function validateBootstrapContract() {
  if (
    !Number.isSafeInteger(AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION) ||
    AWS_SINGLE_NODE_NODE_BOOTSTRAP_CONTRACT_VERSION < 1
  ) {
    throw new TypeError(
      'AWS single-node bootstrap contract version must be positive.',
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
