import path from 'node:path';

const SYSTEMD_UNIT_SAFE_BYTE = /^[A-Za-z0-9_.:]$/u;
const EBS_VOLUME_ID_PATTERN = /^vol-[0-9a-f]{8,32}$/u;
const SYSTEMD_UNIT_NAME_MAX_BYTES = 255;
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BY_ID_ROOT =
  '/dev/disk/by-id';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT =
  '/etc/systemd/system';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_USER_MANAGER_GATE_DROP_IN_NAME =
  '60-wharfie-retained-storage.conf';
export const AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LEGACY_DROP_IN_NAMES =
  Object.freeze([
    '60-wharfie-retained-application-state.conf',
    '61-wharfie-retained-control-state.conf',
  ]);

const FIXED_UNIT_MOUNT_OPTIONS = Object.freeze([
  'rw',
  'nodev',
  'noexec',
  'nosuid',
  'relatime',
  'errors=remount-ro',
  'private',
]);

/**
 * Freeze every reachable object in one pure projection.
 * @template T
 * @param {T} value - Candidate projection value.
 * @returns {T} The same deeply frozen value.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

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

/**
 * Project the exact persistent systemd mount plus the one shared user-manager
 * gate that requires both retained mounts. The caller must pass a canonical
 * desired document returned by the retained-storage contract validator.
 *
 * This function deliberately remains validation-independent so the strict
 * contract can depend on these pure path/byte projections without a module
 * cycle. Public callers use the validating facade exported by
 * deployment-aws-host-retained-storage.js.
 * @param {Readonly<Record<string, any>>} desired - Canonical desired state.
 * @returns {Readonly<Record<string, any>>} Exact immutable boot projection.
 */
export function projectAwsSingleNodeHostRetainedStorageBoot(desired) {
  const unitName = getAwsSingleNodeHostRetainedStorageMountUnitName(
    desired.mount.target,
  );
  const unitPath = path.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    unitName,
  );
  const enableLinkPath = path.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    'local-fs.target.wants',
    unitName,
  );
  const sourcePath = getAwsSingleNodeHostRetainedStorageByIdPath(
    desired.volumeProviderResourceId,
  );
  const stateRoot = path.posix.dirname(desired.mount.target);
  const retainedMountUnitNames = [
    getAwsSingleNodeHostRetainedStorageMountUnitName(
      path.posix.join(stateRoot, 'application-state'),
    ),
    getAwsSingleNodeHostRetainedStorageMountUnitName(
      path.posix.join(stateRoot, 'control'),
    ),
  ];
  const userManagerUnitName = `user@${desired.directory.uid}.service`;
  const dropInDirectoryPath = path.posix.join(
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
    `${userManagerUnitName}.d`,
  );
  const dropInPath = path.posix.join(
    dropInDirectoryPath,
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_USER_MANAGER_GATE_DROP_IN_NAME,
  );
  const legacyDropInPaths =
    AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LEGACY_DROP_IN_NAMES.map((name) =>
      path.posix.join(dropInDirectoryPath, name),
    );
  const unitText = [
    '[Unit]',
    `Description=Wharfie retained ${desired.capabilityKind} storage`,
    `Before=${userManagerUnitName}`,
    `X-Wharfie-Retained-Storage=${desired.bootWiring.id}`,
    `X-Wharfie-Retained-Storage-Projection=${desired.bootWiring.projectionId}`,
    '',
    '[Mount]',
    `What=${sourcePath}`,
    `Where=${desired.mount.target}`,
    `Type=${desired.filesystem.type}`,
    `Options=${FIXED_UNIT_MOUNT_OPTIONS.join(',')}`,
    'DirectoryMode=0700',
    'ReadWriteOnly=yes',
    'TimeoutSec=90s',
    '',
    '[Install]',
    'WantedBy=local-fs.target',
    '',
  ].join('\n');
  const dropInText = [
    '[Unit]',
    `BindsTo=${retainedMountUnitNames.join(' ')}`,
    `After=${retainedMountUnitNames.join(' ')}`,
    '',
  ].join('\n');
  return deepFreeze({
    unitName,
    unitPath,
    enableLinkPath,
    sourcePath,
    unitText,
    userManagerGate: {
      userManagerUnitName,
      dropInDirectoryPath,
      dropInPath,
      dropInText,
      retainedMountUnitNames,
      legacyDropInPaths,
    },
  });
}

export default {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BY_ID_ROOT,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LEGACY_DROP_IN_NAMES,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SYSTEMD_ROOT,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_USER_MANAGER_GATE_DROP_IN_NAME,
  getAwsSingleNodeHostRetainedStorageByIdPath,
  getAwsSingleNodeHostRetainedStorageMountUnitName,
  projectAwsSingleNodeHostRetainedStorageBoot,
};
