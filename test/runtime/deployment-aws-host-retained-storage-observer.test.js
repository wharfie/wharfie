import { beforeAll, describe, expect, it, jest } from '@jest/globals';

import { createAwsSingleNodeHostActivationRequest } from '../../src/core/runtime/deployment-aws-host-agent-contract.js';
import { getAwsSingleNodeHostActivationIntentId } from '../../src/core/runtime/deployment-aws-host-activation.js';
import { createAwsSingleNodeHostRetainedStorageBlankFormatProof } from '../../src/core/runtime/deployment-aws-host-retained-storage-format-journal.js';
import {
  AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
  createAwsSingleNodeHostApplicationStorageAdapter,
  createAwsSingleNodeHostControlStorageAdapter,
  getAwsSingleNodeHostRetainedStorageBootProjection,
} from '../../src/core/runtime/deployment-aws-host-retained-storage.js';
import {
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLKID_PATH,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LSBLK_PATH,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_MOUNTINFO_PATH,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PID1_MOUNT_NAMESPACE_PATH,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SELF_MOUNT_NAMESPACE_PATH,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_UDEVADM_PATH,
  AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_WIPEFS_PATH,
  createAwsSingleNodeHostRetainedStorageObserver,
  createAwsSingleNodeHostRetainedStorageObserverForTest,
} from '../../src/core/runtime/deployment-aws-host-retained-storage-observer.js';
import { getAwsSingleNodeHostRetainedStorageByIdPath } from '../../src/core/runtime/deployment-aws-host-retained-storage-projection.js';
import {
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
  AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
} from '../../src/core/runtime/deployment-aws-host-runtime-identity.js';
import { AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID } from '../../src/core/runtime/deployment-aws-host-runtime-account.js';
import {
  clone,
  expectDeepFrozen,
  makeFixture,
} from './fixtures/deployment-aws-host-activation.js';

/** @typedef {Record<string, any>} AnyRecord */

const RUNTIME_UID = AWS_SINGLE_NODE_HOST_RUNTIME_ACCOUNT_UID;
const DEVICE_PATH = '/dev/nvme1n1';
const DEVICE_MAJOR = 259;
const DEVICE_MINOR = 1;

/** @type {Readonly<AnyRecord>} */
let request;
/** @type {Readonly<AnyRecord>} */
let applicationDesired;
/** @type {Readonly<AnyRecord>} */
let controlDesired;

/** @template T @param {T} value @returns {T} */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/** @returns {{promise: Promise<void>, resolve: () => void}} */
function deferred() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((_resolve) => {
    resolve = () => _resolve();
  });
  return { promise, resolve };
}

/** @param {Readonly<AnyRecord>} activationRequest @returns {Readonly<AnyRecord>} */
function runtimeEvidence(activationRequest) {
  return deepFreeze({
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_RUNTIME_IDENTITY_EVIDENCE_KIND,
    requestId: activationRequest.requestId,
    accountId: activationRequest.providerScope.accountId,
    userId: `${activationRequest.runtimeRoleId}:${activationRequest.nodeProviderResourceId}`,
    arn: `arn:${activationRequest.providerScope.partition}:sts::${activationRequest.providerScope.accountId}:assumed-role/${activationRequest.runtimeRoleName}/${activationRequest.nodeProviderResourceId}`,
  });
}

/**
 * @param {Readonly<AnyRecord>} activationRequest
 * @param {'application-storage'|'control-storage'} kind
 * @param {Readonly<AnyRecord>|null} applicationEvidence
 * @returns {Readonly<AnyRecord>}
 */
function contextFor(activationRequest, kind, applicationEvidence) {
  return deepFreeze({
    request: activationRequest,
    step: {
      intentId: getAwsSingleNodeHostActivationIntentId(activationRequest, kind),
      kind,
      attemptGeneration: 0,
    },
    priorEvidence: {
      'runtime-identity': runtimeEvidence(activationRequest),
      ...(kind === 'control-storage'
        ? { 'application-storage': applicationEvidence }
        : {}),
    },
  });
}

/** @param {Readonly<AnyRecord>} desired @returns {Readonly<AnyRecord>} */
function applicationEvidenceFrom(desired) {
  return deepFreeze({
    ...clone(desired),
    schemaVersion:
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_EVIDENCE_SCHEMA_VERSION,
    kind: AWS_SINGLE_NODE_HOST_APPLICATION_STORAGE_EVIDENCE_KIND,
    device: {
      nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
      nvmeSerialVolumeId: desired.volumeProviderResourceId,
      path: DEVICE_PATH,
      major: DEVICE_MAJOR,
      minor: DEVICE_MINOR,
    },
    mount: {
      ...clone(desired.mount),
      sourcePath: DEVICE_PATH,
      mounted: true,
    },
  });
}

/** @returns {Promise<void>} */
async function captureDesiredDocuments() {
  request = createAwsSingleNodeHostActivationRequest(
    makeFixture().requestContext,
  );
  const applicationInspect = jest.fn((desired) => {
    applicationDesired = /** @type {Readonly<AnyRecord>} */ (desired);
    return { status: 'ready' };
  });
  const application = createAwsSingleNodeHostApplicationStorageAdapter({
    command: {
      inspect: applicationInspect,
      converge: jest.fn(),
    },
  });
  await application.observe(contextFor(request, 'application-storage', null));

  const controlInspect = jest.fn((desired) => {
    controlDesired = /** @type {Readonly<AnyRecord>} */ (desired);
    return { status: 'ready' };
  });
  const control = createAwsSingleNodeHostControlStorageAdapter({
    command: {
      inspect: controlInspect,
      converge: jest.fn(),
    },
  });
  await control.observe(
    contextFor(
      request,
      'control-storage',
      applicationEvidenceFrom(applicationDesired),
    ),
  );
}

/** @param {AnyRecord} [overrides] @returns {AnyRecord} */
function stats(overrides = {}) {
  return {
    type: 'regular',
    uid: 0,
    gid: 0,
    mode: 0o644,
    nlink: 1,
    rdevMajor: null,
    rdevMinor: null,
    ...overrides,
  };
}

/**
 * @param {Readonly<AnyRecord>} desired
 * @param {AnyRecord} [overrides]
 * @returns {AnyRecord}
 */
function blockRecord(desired, overrides = {}) {
  return {
    path: DEVICE_PATH,
    type: 'disk',
    size: desired.sizeBytes,
    ro: false,
    rm: false,
    model: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
    serial: desired.volumeProviderResourceId.replace('-', ''),
    'maj:min': `${DEVICE_MAJOR}:${DEVICE_MINOR}`,
    pkname: null,
    ...overrides,
  };
}

/**
 * @param {Readonly<AnyRecord>} desired
 * @param {AnyRecord} options
 * @param {boolean} changed
 * @returns {string}
 */
function lsblkOutput(desired, options, changed) {
  if (options.malformedLsblk === true) return '{"blockdevices":';
  const selected = blockRecord(desired, {
    ...(changed ? { 'maj:min': `${DEVICE_MAJOR}:2` } : {}),
    ...(options.noDevice === true ? { serial: 'vol00000000000000fff' } : {}),
  });
  if (options.children === true) {
    selected.children = [
      blockRecord(desired, {
        path: `${DEVICE_PATH}p1`,
        type: 'part',
        size: desired.sizeBytes,
        model: null,
        serial: null,
        'maj:min': `${DEVICE_MAJOR}:3`,
        pkname: 'nvme1n1',
      }),
    ];
  }
  const blockdevices = [selected];
  if (options.duplicate === true) {
    blockdevices.push(
      blockRecord(desired, {
        path: '/dev/nvme2n1',
        'maj:min': `${DEVICE_MAJOR}:2`,
      }),
    );
  }
  return JSON.stringify({ blockdevices });
}

/**
 * @param {Readonly<AnyRecord>} desired
 * @param {AnyRecord} options
 * @returns {string}
 */
function mountinfoText(desired, options) {
  const mount = options.mount ?? 'exact';
  if (mount === 'absent') return '';
  const target =
    mount === 'wrong-target'
      ? `${desired.mount.target}-wrong`
      : desired.mount.target;
  const deviceNumber =
    mount === 'wrong-device' ? '8:1' : `${DEVICE_MAJOR}:${DEVICE_MINOR}`;
  const source = mount === 'wrong-device' ? '/dev/sda1' : DEVICE_PATH;
  const mountOptions = ['rw', 'nosuid', 'nodev', 'noexec', 'relatime'];
  if (mount === 'missing-relatime') mountOptions.pop();
  const optionalFields = mount === 'shared' ? ' shared:1' : '';
  const superOptions =
    mount === 'missing-errors' ? 'rw' : 'rw,errors=remount-ro';
  return `36 25 ${deviceNumber} / ${target} ${mountOptions.join(
    ',',
  )}${optionalFields} - ext4 ${source} ${superOptions}\n`;
}

/**
 * @param {Readonly<AnyRecord>} desired
 * @param {AnyRecord} [options]
 * @returns {{ports: AnyRecord, calls: Record<string, AnyRecord[]>}}
 */
function makePorts(desired, options = {}) {
  const projection = getAwsSingleNodeHostRetainedStorageBootProjection(desired);
  /** @type {Record<string, AnyRecord[]>} */
  const calls = {
    run: [],
    readText: [],
    readDirectory: [],
    readLink: [],
    stat: [],
  };
  let lsblkReads = 0;
  let mountinfoReads = 0;
  let mountNamespaceReads = 0;
  const filesystem = options.filesystem ?? 'exact';
  const boot = options.boot ?? 'exact';
  const target = options.target ?? 'exact';
  const stderr = options.toolStderr === true ? 'observation warning\n' : '';

  const ports = {
    run: jest.fn(async (/** @type {AnyRecord} */ input) => {
      calls.run.push(input);
      if (input.file === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_UDEVADM_PATH) {
        return { exitCode: 0, stdout: '', stderr };
      }
      if (input.file === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LSBLK_PATH) {
        const changed = options.changeIdentity === true && lsblkReads > 0;
        lsblkReads += 1;
        return {
          exitCode: 0,
          stdout: lsblkOutput(desired, options, changed),
          stderr,
        };
      }
      if (input.file === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLKID_PATH) {
        if (filesystem === 'blank') {
          return { exitCode: 2, stdout: '', stderr };
        }
        if (filesystem === 'foreign') {
          return {
            exitCode: 0,
            stdout: `DEVNAME=${DEVICE_PATH}\nTYPE=xfs\nUUID=foreign\n`,
            stderr,
          };
        }
        return {
          exitCode: 0,
          stdout: `DEVNAME=${DEVICE_PATH}\nTYPE=${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE}\nUUID=${desired.filesystem.uuid}\n`,
          stderr,
        };
      }
      if (input.file === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_WIPEFS_PATH) {
        const signatures =
          filesystem === 'blank'
            ? []
            : filesystem === 'foreign'
              ? [{ type: 'xfs', uuid: 'foreign' }]
              : [
                  {
                    type: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_FILESYSTEM_TYPE,
                    uuid: desired.filesystem.uuid,
                  },
                ];
        return {
          exitCode: 0,
          stdout: JSON.stringify({ signatures }),
          stderr,
        };
      }
      throw new Error('unexpected retained-storage host tool');
    }),
    readText: jest.fn(async (/** @type {AnyRecord} */ input) => {
      calls.readText.push(input);
      if (input.path.endsWith('/device/model')) {
        return `${AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL}\n`;
      }
      if (input.path.endsWith('/device/serial')) {
        return `${desired.volumeProviderResourceId.replace('-', '')}\n`;
      }
      if (input.path === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_MOUNTINFO_PATH) {
        const changed = options.changeMount === true && mountinfoReads > 0;
        mountinfoReads += 1;
        return mountinfoText(
          desired,
          changed ? { ...options, mount: 'absent' } : options,
        );
      }
      if (input.path === projection.unitPath) {
        return boot === 'wrong-unit'
          ? `${projection.unitText}forged\n`
          : projection.unitText;
      }
      if (input.path === projection.userManagerGate.dropInPath) {
        return boot === 'wrong-gate'
          ? `${projection.userManagerGate.dropInText}forged\n`
          : projection.userManagerGate.dropInText;
      }
      throw new Error('unexpected retained-storage text read');
    }),
    readDirectory: jest.fn(async (/** @type {AnyRecord} */ input) => {
      calls.readDirectory.push(input);
      if (input.path.endsWith('/holders')) {
        return options.holders === true ? ['dm-0'] : [];
      }
      if (input.path === desired.mount.target) {
        return options.targetEntries ?? [];
      }
      throw new Error('unexpected retained-storage directory read');
    }),
    readLink: jest.fn(async (/** @type {AnyRecord} */ input) => {
      calls.readLink.push(input);
      if (
        input.path ===
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SELF_MOUNT_NAMESPACE_PATH ||
        input.path ===
          AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_PID1_MOUNT_NAMESPACE_PATH
      ) {
        const changed =
          options.changeMountNamespace === true && mountNamespaceReads >= 2;
        mountNamespaceReads += 1;
        if (
          options.splitMountNamespace === true &&
          input.path ===
            AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_SELF_MOUNT_NAMESPACE_PATH
        ) {
          return 'mnt:[4026539999]';
        }
        return changed ? 'mnt:[4026539999]' : 'mnt:[4026531841]';
      }
      if (input.path === projection.enableLinkPath) {
        return boot === 'wrong-link'
          ? '../wrong.mount'
          : `../${projection.unitName}`;
      }
      if (input.path.startsWith('/dev/disk/by-id/')) {
        return options.wrongById === true ? '../../nvme9n1' : '../../nvme1n1';
      }
      throw new Error('unexpected retained-storage link read');
    }),
    stat: jest.fn(async (/** @type {AnyRecord} */ input) => {
      calls.stat.push(input);
      if (input.path === DEVICE_PATH) {
        return stats({
          type: 'block',
          uid: 0,
          gid: 6,
          mode: 0o660,
          rdevMajor: DEVICE_MAJOR,
          rdevMinor: DEVICE_MINOR,
        });
      }
      if (input.path === desired.mount.target) {
        if (target === 'absent') return null;
        return stats({
          type: 'directory',
          uid:
            target === 'wrong-owner'
              ? desired.directory.uid + 1
              : desired.directory.uid,
          gid: desired.directory.gid,
          mode: desired.directory.mode,
          nlink: 2,
        });
      }
      if (
        input.path === '/' ||
        input.path === '/var' ||
        input.path === '/var/lib'
      ) {
        return stats({
          type: 'directory',
          mode: 0o755,
          nlink: 2,
        });
      }
      if (
        input.path === '/var/lib/wharfie-runtime' ||
        input.path.startsWith('/var/lib/wharfie-runtime/')
      ) {
        if (options.symlinkAncestor === input.path) {
          return stats({
            type: 'symlink',
            uid: desired.directory.uid,
            gid: desired.directory.gid,
            mode: 0o777,
          });
        }
        return stats({
          type: 'directory',
          uid: desired.directory.uid,
          gid: desired.directory.gid,
          mode: 0o700,
          nlink: 2,
        });
      }
      if (input.path === projection.unitPath) {
        if (boot === 'absent' || boot === 'gate-only') return null;
        return stats({
          nlink: boot === 'hardlinked-unit' ? 2 : 1,
        });
      }
      if (input.path === projection.enableLinkPath) {
        if (
          boot === 'absent' ||
          boot === 'partial' ||
          boot === 'gate-only' ||
          boot === 'gated'
        ) {
          return null;
        }
        return stats({ type: 'symlink', mode: 0o777 });
      }
      if (input.path === projection.userManagerGate.dropInPath) {
        if (
          boot === 'absent' ||
          boot === 'partial' ||
          boot === 'unsafe-enabled'
        ) {
          return null;
        }
        return stats();
      }
      if (input.path === projection.userManagerGate.legacyDropInPaths[0]) {
        return boot === 'legacy-v1-application' ? stats() : null;
      }
      if (input.path === projection.userManagerGate.legacyDropInPaths[1]) {
        return boot === 'legacy-v1-control' ? stats() : null;
      }
      return null;
    }),
  };
  return { ports, calls };
}

beforeAll(async () => {
  await captureDesiredDocuments();
});

describe('AWS single-node host retained-storage observer', () => {
  it('exposes a closed frozen observer and exact snapshotted test ports without invoking production host tools', async () => {
    const fixture = makePorts(applicationDesired);
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });
    const originalRun = fixture.ports.run;
    fixture.ports.run = jest.fn(() => {
      throw new Error('replacement host tool must not run');
    });

    await expect(observer.inspect(applicationDesired)).resolves.toEqual({
      status: 'unknown',
    });
    expect(originalRun).toHaveBeenCalled();
    expect(fixture.ports.run).not.toHaveBeenCalled();
    expect(Object.keys(observer)).toEqual(['inspect', 'inspectBlankFormat']);
    expect(Object.isFrozen(observer)).toBe(true);
    expect(() => createAwsSingleNodeHostRetainedStorageObserver({})).toThrow(
      /accepts no options/u,
    );

    const accessor = {};
    Object.defineProperty(accessor, 'ports', {
      enumerable: true,
      get() {
        throw new Error('must not invoke observer port accessor');
      },
    });
    expect(() =>
      createAwsSingleNodeHostRetainedStorageObserverForTest(accessor),
    ).toThrow(/own data property/u);
  });

  it.each(['absent', 'gate-only'])(
    'mints one exact deep-frozen blank proof with %s shared-gate state',
    async (boot) => {
      const fixture = makePorts(applicationDesired, {
        filesystem: 'blank',
        mount: 'absent',
        boot,
      });
      const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
        ports: fixture.ports,
      });
      const expectedProof =
        createAwsSingleNodeHostRetainedStorageBlankFormatProof({
          desired: applicationDesired,
          device: {
            path: DEVICE_PATH,
            major: DEVICE_MAJOR,
            minor: DEVICE_MINOR,
            nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
            nvmeSerialVolumeId: applicationDesired.volumeProviderResourceId,
            byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
              applicationDesired.volumeProviderResourceId,
            ),
            byIdTarget: '../../nvme1n1',
          },
          mountNamespace: 'mnt:[4026531841]',
        });

      const result = await observer.inspectBlankFormat(applicationDesired);

      expect(result).toEqual({ status: 'blank', proof: expectedProof });
      expectDeepFrozen(result);
      expect(result.proof.safety).toEqual({
        stableObservationCount: 2,
        partitionCount: 0,
        holderCount: 0,
        mounted: false,
        bootEnabled: false,
        mountNamespace: 'mnt:[4026531841]',
      });
    },
  );

  it.each([
    ['device identity changes', { changeIdentity: true }, 'unknown'],
    ['mount state changes', { changeMount: true, mount: 'exact' }, 'conflict'],
    ['mount namespace changes', { changeMountNamespace: true }, 'unknown'],
    [
      'observer and PID1 mount namespaces differ',
      { splitMountNamespace: true },
      'unknown',
    ],
  ])('does not mint a blank proof when %s', async (_label, options, status) => {
    const fixture = makePorts(applicationDesired, {
      filesystem: 'blank',
      mount: 'absent',
      boot: 'absent',
      ...options,
    });
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });

    const result = await observer.inspectBlankFormat(applicationDesired);

    expect(result).toEqual({ status });
    expect(result).not.toHaveProperty('proof');
    expectDeepFrozen(result);
  });

  it.each([
    [
      'mounted blank media',
      { filesystem: 'blank', mount: 'exact', boot: 'absent' },
      'conflict',
    ],
    [
      'held blank media',
      { filesystem: 'blank', mount: 'absent', boot: 'absent', holders: true },
      'conflict',
    ],
    [
      'partitioned blank media',
      { filesystem: 'blank', mount: 'absent', boot: 'absent', children: true },
      'conflict',
    ],
    [
      'a staged role unit',
      { filesystem: 'blank', mount: 'absent', boot: 'partial' },
      'conflict',
    ],
    [
      'a gated role unit',
      { filesystem: 'blank', mount: 'absent', boot: 'gated' },
      'conflict',
    ],
    [
      'an enabled role unit',
      { filesystem: 'blank', mount: 'absent', boot: 'exact' },
      'conflict',
    ],
    [
      'foreign signatures',
      { filesystem: 'foreign', mount: 'absent', boot: 'absent' },
      'conflict',
    ],
    [
      'an existing exact-UUID ext4 filesystem',
      { filesystem: 'exact', mount: 'absent', boot: 'absent' },
      'unknown',
    ],
  ])(
    'rejects %s without minting a blank proof',
    async (_label, options, status) => {
      const fixture = makePorts(applicationDesired, options);
      const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
        ports: fixture.ports,
      });

      const result = await observer.inspectBlankFormat(applicationDesired);

      expect(result).toEqual({ status });
      expect(result).not.toHaveProperty('proof');
      expectDeepFrozen(result);
    },
  );

  it('snapshots desired input before its first host await', async () => {
    const fixture = makePorts(applicationDesired, {
      filesystem: 'blank',
      mount: 'absent',
      boot: 'absent',
    });
    const originalRun = fixture.ports.run;
    const udevAdmission = deferred();
    fixture.ports.run = jest.fn(async (/** @type {AnyRecord} */ input) => {
      if (input.file === AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_UDEVADM_PATH) {
        await udevAdmission.promise;
      }
      return await originalRun(input);
    });
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });
    const mutableDesired = /** @type {AnyRecord} */ (clone(applicationDesired));

    const pending = observer.inspectBlankFormat(mutableDesired);
    mutableDesired.filesystem.uuid = '00000000-0000-8000-8000-000000000000';
    mutableDesired.volumeProviderResourceId = 'vol-00000000000000fff';
    mutableDesired.directory.uid += 1;
    udevAdmission.resolve();

    const result = await pending;
    expect(result.status).toBe('blank');
    expect(result.proof.targetId).toBe(
      createAwsSingleNodeHostRetainedStorageBlankFormatProof({
        desired: applicationDesired,
        device: {
          path: DEVICE_PATH,
          major: DEVICE_MAJOR,
          minor: DEVICE_MINOR,
          nvmeModel: AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_NVME_MODEL,
          nvmeSerialVolumeId: applicationDesired.volumeProviderResourceId,
          byIdPath: getAwsSingleNodeHostRetainedStorageByIdPath(
            applicationDesired.volumeProviderResourceId,
          ),
          byIdTarget: '../../nvme1n1',
        },
        mountNamespace: 'mnt:[4026531841]',
      }).targetId,
    );
    expectDeepFrozen(result);
  });

  it('projects exact role mounts behind one shared two-mount user-manager gate', () => {
    const application =
      getAwsSingleNodeHostRetainedStorageBootProjection(applicationDesired);
    const control =
      getAwsSingleNodeHostRetainedStorageBootProjection(controlDesired);

    expect(application.unitName).toMatch(/\.mount$/u);
    expect(application.enableLinkPath).toBe(
      `/etc/systemd/system/local-fs.target.wants/${application.unitName}`,
    );
    expect(application.userManagerGate).toEqual(control.userManagerGate);
    expect(application.userManagerGate.dropInPath).toBe(
      `/etc/systemd/system/user@${RUNTIME_UID}.service.d/60-wharfie-retained-storage.conf`,
    );
    expect(application.unitText).toContain(
      'Options=rw,nodev,noexec,nosuid,relatime,errors=remount-ro,private\nDirectoryMode=0700\nReadWriteOnly=yes\nTimeoutSec=90s\n',
    );
    expect(application.unitText).toContain(
      `What=/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_${applicationDesired.volumeProviderResourceId.replace(
        '-',
        '',
      )}\n`,
    );
    expect(application.unitText).not.toContain('What=UUID=');
    expect(application.userManagerGate.dropInText).toBe(
      `[Unit]\nBindsTo=${application.unitName} ${control.unitName}\nAfter=${application.unitName} ${control.unitName}\n`,
    );
    expect(application.userManagerGate.retainedMountUnitNames).toEqual([
      application.unitName,
      control.unitName,
    ]);
    expect(application.userManagerGate.legacyDropInPaths).toEqual([
      `/etc/systemd/system/user@${RUNTIME_UID}.service.d/60-wharfie-retained-application-state.conf`,
      `/etc/systemd/system/user@${RUNTIME_UID}.service.d/61-wharfie-retained-control-state.conf`,
    ]);
    expect(application.unitText).toContain(
      'X-Wharfie-Retained-Storage-Projection=wharfie-systemd-retained-storage-v2',
    );
    expectDeepFrozen(application);
    expectDeepFrozen(control);
  });

  it('fails closed without minting evidence when ext4 type and UUID do not prove the formatter profile', async () => {
    const fixture = makePorts(applicationDesired);
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });

    const result = await observer.inspect(applicationDesired);

    expect(result).toEqual({ status: 'unknown' });
    expectDeepFrozen(result);
    expect(fixture.calls.run.map((input) => input.file)).toEqual([
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_UDEVADM_PATH,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LSBLK_PATH,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLKID_PATH,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_WIPEFS_PATH,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_LSBLK_PATH,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_BLKID_PATH,
      AWS_SINGLE_NODE_HOST_RETAINED_STORAGE_WIPEFS_PATH,
    ]);
    for (const group of Object.values(fixture.calls)) {
      for (const input of group) expectDeepFrozen(input);
    }
    const serializedCalls = JSON.stringify(fixture.calls);
    expect(serializedCalls).not.toContain(
      request.volumes[0].requestedDeviceName,
    );
    expect(serializedCalls).not.toMatch(/(?:\*|\?|\/bin\/sh)/u);
  });

  it.each([
    [
      'blank, unwired media',
      { filesystem: 'blank', boot: 'absent', mount: 'absent' },
    ],
    [
      'blank media with an absent target',
      {
        filesystem: 'blank',
        target: 'absent',
        mount: 'absent',
        boot: 'absent',
      },
    ],
    [
      'blank media with incomplete exact wiring',
      { filesystem: 'blank', mount: 'absent', boot: 'partial' },
    ],
    [
      'blank media behind a gate staged before either role unit',
      { filesystem: 'blank', mount: 'absent', boot: 'gate-only' },
    ],
    [
      'blank media gated before enablement',
      { filesystem: 'blank', mount: 'absent', boot: 'gated' },
    ],
  ])('reports ready for %s', async (_label, options) => {
    const fixture = makePorts(applicationDesired, options);
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });

    await expect(observer.inspect(applicationDesired)).resolves.toEqual({
      status: 'ready',
    });
  });

  it.each([
    ['an unverified exact ext4 profile', {}],
    ['no matching device', { noDevice: true }],
    ['malformed bounded lsblk output', { malformedLsblk: true }],
    ['identity changing across the observation', { changeIdentity: true }],
    ['a mount changing across the full snapshot', { changeMount: true }],
    [
      'a different observer and PID1 mount namespace',
      { splitMountNamespace: true },
    ],
    ['a host tool diagnostic on stderr', { toolStderr: true }],
  ])('reports unknown for %s', async (_label, options) => {
    const fixture = makePorts(applicationDesired, options);
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });

    await expect(observer.inspect(applicationDesired)).resolves.toEqual({
      status: 'unknown',
    });
  });

  it.each([
    ['duplicate exact volume identities', { duplicate: true }],
    ['a child partition', { children: true }],
    ['a device holder', { holders: true }],
    ['a wrong canonical by-id target', { wrongById: true }],
    ['foreign signatures', { filesystem: 'foreign' }],
    ['a foreign mount target', { mount: 'wrong-target' }],
    ['a foreign device at the target', { mount: 'wrong-device' }],
    ['a live mount without relatime', { mount: 'missing-relatime' }],
    ['a live mount without errors=remount-ro', { mount: 'missing-errors' }],
    ['a shared live mount', { mount: 'shared' }],
    [
      'a nonempty unmounted target',
      { mount: 'absent', boot: 'absent', targetEntries: ['hidden'] },
    ],
    ['wrong target ownership', { target: 'wrong-owner' }],
    ['nonexact mount-unit bytes', { boot: 'wrong-unit' }],
    ['nonexact shared user-manager gate bytes', { boot: 'wrong-gate' }],
    ['a stale V1 application role drop-in', { boot: 'legacy-v1-application' }],
    ['a stale V1 control role drop-in', { boot: 'legacy-v1-control' }],
    ['a noncanonical enable link', { boot: 'wrong-link' }],
    ['a hard-linked persistent unit', { boot: 'hardlinked-unit' }],
    ['an unsafe enable link without the role gate', { boot: 'unsafe-enabled' }],
    [
      'a symlink in the runtime-owned target ancestry',
      { symlinkAncestor: '/var/lib/wharfie-runtime/.local' },
    ],
    [
      'blank media with fully enabled wiring',
      { filesystem: 'blank', mount: 'absent' },
    ],
  ])('reports conflict for %s', async (_label, options) => {
    const fixture = makePorts(applicationDesired, options);
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });

    await expect(observer.inspect(applicationDesired)).resolves.toEqual({
      status: 'conflict',
    });
  });

  it('rejects malformed desired authority before invoking any read-only port', async () => {
    const fixture = makePorts(applicationDesired);
    const observer = createAwsSingleNodeHostRetainedStorageObserverForTest({
      ports: fixture.ports,
    });
    const forged = clone(applicationDesired);
    forged.filesystem.uuid = '00000000-0000-8000-8000-000000000000';

    await expect(observer.inspect(forged)).rejects.toThrow(
      /stable volume authority/u,
    );
    for (const port of Object.values(fixture.ports)) {
      expect(port).not.toHaveBeenCalled();
    }
  });
});
