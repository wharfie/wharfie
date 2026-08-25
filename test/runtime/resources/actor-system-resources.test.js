/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { describe, expect, it } from '@jest/globals';
import { fileURLToPath } from 'node:url';

import Function from '../../../src/core/resources/builds/function.js';
import ActorSystem from '../../../src/core/resources/builds/actor-system.js';
import CoreRuntimeDependenciesResource from '../../../src/core/resources/builds/core-runtime-dependencies.js';
import FunctionResource from '../../../src/core/resources/builds/function-resource.js';
import MacOSBinarySignature from '../../../src/core/resources/builds/macos-binary-signature.js';
import SeaBuild from '../../../src/core/resources/builds/sea-build.js';

describe('ActorSystem build graph', () => {
  it('rejects the removed runtime resources property', () => {
    expect(
      () =>
        new ActorSystem({
          name: 'legacy-runtime-resources',
          properties: /** @type {any} */ ({ targets: [], resources: {} }),
        }),
    ).toThrow(/no longer supports properties\.resources/i);
  });

  it('accepts runtime.stateStore and telemetry callbacks while preserving emitter-compatible events', async () => {
    const actorPath = fileURLToPath(
      new URL('../../fixtures/actors/hello-activity.js', import.meta.url),
    );
    const store = {
      putResource: async () => {},
      putResourceStatus: async () => {},
      getResource: async () => undefined,
      getResourceStatus: async () => undefined,
      getResources: async () => [],
      deleteResource: async () => {},
    };
    /** @type {string[]} */
    const events = [];

    const hello = new Function({
      name: 'hello-activity',
      entrypoint: { path: actorPath, export: 'helloActivity' },
      properties: {},
    });

    const system = new ActorSystem({
      name: 'runtime-config-system',
      functions: [hello],
      runtime: {
        stateStore: store,
        telemetry: {
          emit(/** @type {string} */ eventName, /** @type {any} */ event) {
            if (eventName === 'WHARFIE_STATUS') {
              events.push(`${event.constructor}:${event.name}:${event.status}`);
            }
          },
        },
      },
      properties: {
        targets: [],
      },
    });

    expect(system.getStateDB()).toBe(store);
    expect(system.getRuntimeConfig().stateStore).toBe(store);

    await system.reconcile();

    expect(events).toEqual(
      expect.arrayContaining(['ActorSystem:runtime-config-system:STABLE']),
    );
  });

  it('keeps macOS signing credentials out of serialized and persisted resource state', async () => {
    /** @type {string[]} */
    const persistedResources = [];
    const store = {
      putResource: async (/** @type {ActorSystem} */ resource) => {
        persistedResources.push(JSON.stringify(resource.serialize()));
      },
      putResourceStatus: async () => {},
      getResource: async () => undefined,
      getResourceStatus: async () => undefined,
      getResources: async () => [],
      deleteResource: async () => {},
    };
    const credentials = {
      certificateBase64: 'ephemeral-certificate-data',
      certificatePassword: 'ephemeral-certificate-password',
      keychainPassword: 'ephemeral-keychain-password',
    };

    const system = new ActorSystem({
      name: 'ephemeral-signing-system',
      macosSigningCredentials: credentials,
      stateDB: store,
      properties: /** @type {any} */ ({
        targets: [],
        macosCertBase64: 'legacy-certificate-data',
        macosCertPassword: 'legacy-certificate-password',
        macosKeychainPassword: 'legacy-keychain-password',
        macosSigningCredentials: {
          certificatePassword: 'misplaced-credential-password',
        },
      }),
    });

    expect(system.getMacOSSigningCredentials()).toEqual(credentials);
    expect(system.has('macosCertBase64')).toBe(false);
    expect(system.has('macosCertPassword')).toBe(false);
    expect(system.has('macosKeychainPassword')).toBe(false);
    expect(system.has('macosSigningCredentials')).toBe(false);
    const credentialSymbol = Object.getOwnPropertySymbols(system).find(
      (symbol) => symbol.description === 'macosSigningCredentials',
    );
    if (!credentialSymbol) {
      throw new Error('Expected a private macOS signing credential channel');
    }
    expect(
      Object.getOwnPropertyDescriptor(system, credentialSymbol)?.enumerable,
    ).toBe(false);

    await system.save();

    const serialized = JSON.stringify(system.serialize());
    const persisted = persistedResources.join('\n');
    for (const secret of [
      ...Object.values(credentials),
      'legacy-certificate-data',
      'legacy-certificate-password',
      'legacy-keychain-password',
      'misplaced-credential-password',
    ]) {
      expect(serialized).not.toContain(secret);
      expect(persisted).not.toContain(secret);
    }
  });

  it('provides late signing credentials to existing macOS signature resources', () => {
    const system = new ActorSystem({
      name: 'late-signing-system',
      properties: {
        targets: [
          {
            nodeVersion: process.versions.node,
            platform: 'darwin',
            architecture: 'arm64',
          },
        ],
      },
    });
    const signature = system
      .getResources()
      .find((resource) => resource instanceof MacOSBinarySignature);
    if (!(signature instanceof MacOSBinarySignature)) {
      throw new Error('Expected a macOS signature resource');
    }

    expect(signature.getMacOSSigningCredentials()).toEqual({
      certificateBase64: '',
      certificatePassword: '',
      keychainPassword: '',
    });

    const credentials = {
      certificateBase64: 'late-certificate-data',
      certificatePassword: 'late-certificate-password',
      keychainPassword: 'late-keychain-password',
    };
    system.setMacOSSigningCredentials(credentials);

    expect(
      system
        .getResources()
        .find((resource) => resource instanceof MacOSBinarySignature),
    ).toBe(signature);
    expect(signature.getMacOSSigningCredentials()).toEqual(credentials);
    expect(JSON.stringify(signature.serialize())).not.toContain(
      'late-certificate',
    );
  });

  it('propagates canonical glibc identity to Linux SEA builds', () => {
    const system = new ActorSystem({
      name: 'linux-libc-system',
      properties: {
        targets: [
          {
            nodeVersion: process.versions.node,
            platform: 'linux',
            architecture: 'arm64',
          },
        ],
      },
    });
    const build = system
      .getResources()
      .find((resource) => resource instanceof SeaBuild);
    const coreRuntimeDependencies = system
      .getResources()
      .find((resource) => resource instanceof CoreRuntimeDependenciesResource);

    expect(system.get('targets')).toEqual([
      {
        nodeVersion: process.versions.node,
        platform: 'linux',
        architecture: 'arm64',
        libc: 'glibc',
      },
    ]);
    expect(build).toBeInstanceOf(SeaBuild);
    expect(build?.get('libc')).toBe('glibc');
    expect(coreRuntimeDependencies).toBeInstanceOf(
      CoreRuntimeDependenciesResource,
    );
    expect(coreRuntimeDependencies?.get('buildTarget')).toEqual({
      nodeVersion: process.versions.node,
      platform: 'linux',
      architecture: 'arm64',
      libc: 'glibc',
    });
    expect(build?.dependsOn).toContain(coreRuntimeDependencies);
  });

  it('does not install source-map support in the packaged SEA entrypoint', () => {
    const system = new ActorSystem({
      name: 'source-map-free-system',
      properties: {
        targets: [
          {
            nodeVersion: process.versions.node,
            platform: 'linux',
            architecture: 'arm64',
          },
        ],
      },
    });
    const build = system
      .getResources()
      .find((resource) => resource instanceof SeaBuild);
    const entryCode = build?.get('entryCode');

    expect(typeof entryCode).toBe('string');
    expect(entryCode).not.toContain('source-map-support');
    expect(entryCode).not.toContain('sourceMapSupport');
  });

  it('defers packaged native-runtime preparation to the packaged dispatcher', () => {
    const system = new ActorSystem({
      name: 'lazy-native-runtime-system',
      properties: {
        targets: [
          {
            nodeVersion: process.versions.node,
            platform: 'linux',
            architecture: 'arm64',
          },
        ],
      },
    });
    const build = system
      .getResources()
      .find((resource) => resource instanceof SeaBuild);
    const entryCode = build?.get('entryCode');

    expect(typeof entryCode).toBe('string');
    expect(entryCode).not.toContain(
      'await preparePackagedCoreRuntimeDependencies()',
    );
    expect(entryCode).toContain(
      'prepareRuntime: preparePackagedCoreRuntimeDependencies',
    );
  });

  it('rejects Windows targets before defining a core-runtime SEA build', () => {
    expect(
      () =>
        new ActorSystem({
          name: 'unsupported-windows-core-runtime-system',
          properties: {
            targets: [
              {
                nodeVersion: process.versions.node,
                platform: 'win32',
                architecture: 'x64',
              },
            ],
          },
        }),
    ).toThrow(
      /Windows SEA targets are deferred until private core-runtime extraction is hardened and tested/i,
    );
  });

  it('omits libc from Darwin function build targets', () => {
    const activityPath = fileURLToPath(
      new URL('../../fixtures/actors/hello-activity.js', import.meta.url),
    );
    const activity = new Function({
      name: 'darwin-activity',
      entrypoint: { path: activityPath, export: 'helloActivity' },
      properties: {
        external: [{ name: 'lmdb', version: '3.4.4' }],
      },
    });
    const system = new ActorSystem({
      name: 'darwin-target-system',
      functions: [activity],
      properties: {
        targets: [
          {
            nodeVersion: process.versions.node,
            platform: 'darwin',
            architecture: 'arm64',
          },
        ],
      },
    });
    const functionResource = system
      .getResources()
      .find((resource) => resource instanceof FunctionResource);
    const build = system
      .getResources()
      .find((resource) => resource instanceof SeaBuild);
    const coreRuntimeDependencies = system
      .getResources()
      .find((resource) => resource instanceof CoreRuntimeDependenciesResource);

    expect(functionResource).toBeInstanceOf(FunctionResource);
    expect(coreRuntimeDependencies).toBeInstanceOf(
      CoreRuntimeDependenciesResource,
    );
    expect(coreRuntimeDependencies?.get('buildTarget')).toEqual({
      nodeVersion: process.versions.node,
      platform: 'darwin',
      architecture: 'arm64',
    });
    expect(functionResource?.get('buildTarget')).toEqual({
      nodeVersion: process.versions.node,
      platform: 'darwin',
      architecture: 'arm64',
    });
    const assetDigest = {
      algorithm: /** @type {const} */ ('sha256'),
      value: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    };
    functionResource?._setUNSAFE('singleExecutableAssetPath', '/tmp/asset');
    functionResource?._setUNSAFE('singleExecutableAssetDigest', assetDigest);
    expect(build?.get('assets')).toEqual({
      'darwin-activity': '/tmp/asset',
    });
    expect(build?.get('functionAssetDigests')).toEqual({
      'darwin-activity': assetDigest,
    });
  });
});
