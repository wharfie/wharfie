import path from 'node:path';

const SYSTEMD_UNIT_SAFE_BYTE = /^[A-Za-z0-9_.:]$/u;
const EBS_VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const SYSTEMD_UNIT_NAME_MAX_BYTES = 255;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BY_ID_ROOT =
  '/dev/disk/by-id';

/**
 * Derive the only systemd mount-unit name permitted for a canonical target.
 * systemd requires mount unit names to be the escaped `Where=` path, and the
 * result must fit one Linux directory entry.
 * @param {unknown} targetValue - Canonical absolute mount target.
 * @returns {string} Exact systemd mount-unit name.
 */
export function getAwsSingleNodeHostRetainedStorageMountUnitName(targetValue) {
  if (
    typeof targetValue !== 'string' ||
    !path.posix.isAbsolute(targetValue) ||
    path.posix.normalize(targetValue) !== targetValue ||
    targetValue === '/'
  ) {
    throw new TypeError(
      'retained storage mount target must be a canonical non-root absolute path.',
    );
  }
  const bytes = Buffer.from(targetValue.slice(1), 'utf8');
  let escaped = '';
  for (const byte of bytes) {
    const character = String.fromCharCode(byte);
    if (character === '/') {
      escaped += '-';
    } else if (character !== '-' && SYSTEMD_UNIT_SAFE_BYTE.test(character)) {
      escaped += character;
    } else {
      escaped += `\\x${byte.toString(16).padStart(2, '0')}`;
    }
  }
  const unitName = `${escaped}.mount`;
  if (Buffer.byteLength(unitName, 'utf8') > SYSTEMD_UNIT_NAME_MAX_BYTES) {
    throw new TypeError(
      'retained storage mount target exceeds the systemd unit-name limit.',
    );
  }
  return unitName;
}

/**
 * Derive the fixed udev EBS identity link used both for observation and boot.
 * @param {unknown} volumeIdValue - Canonical EBS volume ID.
 * @returns {string} Exact udev by-id path.
 */
export function getAwsSingleNodeHostRetainedStorageByIdPath(volumeIdValue) {
  if (
    typeof volumeIdValue !== 'string' ||
    !EBS_VOLUME_ID_PATTERN.test(volumeIdValue)
  ) {
    throw new TypeError(
      'retained storage volume ID must be a canonical EBS volume ID.',
    );
  }
  return path.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BY_ID_ROOT,
    `nvme-Amazon_Elastic_Block_Store_${volumeIdValue.replace('-', '')}`,
  );
}

export default {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BY_ID_ROOT,
  getAwsSingleNodeHostRetainedStorageByIdPath,
  getAwsSingleNodeHostRetainedStorageMountUnitName,
};
