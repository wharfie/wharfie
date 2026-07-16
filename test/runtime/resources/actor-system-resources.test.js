/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';

import { afterEach, describe, expect, it } from '@jest/globals';
import { fileURLToPath } from 'node:url';

import { SHARED_RESOURCE_REGISTRY_FILE_NAME } from '../../../src/core/runtime/shared-resource-registry.js';
import Function from '../../../src/core/resources/builds/function.js';
import ActorSystem from '../../../src/core/resources/builds/actor-system.js';
import MacOSBinarySignature from '../../../src/core/resources/builds/macos-binary-signature.js';
import SeaBuild from '../../../src/core/resources/builds/sea-build.js';
import { createActorSystemResources } from '../../../src/core/runtime/resources.js';
import sandboxWorker from '../../../src/core/lib/code-execution/worker.js';

afterEach(() => {
  delete process.env.CONFIG_DIR;
});

describe('ActorSystem runtime resources', () => {
  it('createActorSystemResources: vanilla adapters create usable clients', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-actor-system-resources-'),
    );

    const { resources, close } = await createActorSystemResources({
      db: { adapter: 'vanilla', options: { path: tmp } },
      queue: { adapter: 'vanilla', options: { path: tmp } },
      objectStorage: { adapter: 'vanilla', options: { path: tmp } },
    });
    if (!resources.db || !resources.queue || !resources.objectStorage) {
      throw new Error('Expected runtime resources to be initialized');
    }

    expect(typeof resources.db?.put).toBe('function');
    expect(typeof resources.queue?.sendMessage).toBe('function');
    expect(typeof resources.objectStorage?.putObject).toBe('function');

    await close();
  });

  it('createActorSystemResources: resolves shared refs from the config dir registry', async () => {
    const configDir = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-shared-resource-config-'),
    );
    process.env.CONFIG_DIR = configDir;

    await fsp.writeFile(
      path.join(configDir, SHARED_RESOURCE_REGISTRY_FILE_NAME),
      JSON.stringify(
        {
          db: {
            appdb: {
              adapter: 'vanilla',
              options: { path: path.join(configDir, 'db') },
            },
          },
          queue: {
            jobs: {
              adapter: 'vanilla',
              options: { path: path.join(configDir, 'queue') },
            },
          },
          objectStorage: {
            blobs: {
              adapter: 'vanilla',
              options: { path: path.join(configDir, 'object-storage') },
            },
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const { resources, close } = await createActorSystemResources({
      db: { ref: 'appdb' },
      queue: { ref: 'jobs' },
      objectStorage: { ref: 'blobs' },
    });
    if (!resources.db || !resources.queue || !resources.objectStorage) {
      throw new Error(
        'Expected shared refs to resolve to initialized resources',
      );
    }

    expect(typeof resources.db.put).toBe('function');
    expect(typeof resources.queue.sendMessage).toBe('function');
    expect(typeof resources.objectStorage.putObject).toBe('function');

    await close();
  });

  it('ActorSystem.invoke injects resources into context.resources', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-actor-system-invoke-'),
    );

    // NOTE: Jest executes tests inside vm modules; Node's `import.meta.dirname`
    // is not guaranteed to exist. Use `import.meta.url` instead.
    const actorPath = fileURLToPath(
      new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
    );

    const hello = new Function({
      name: 'hello-resources',
      entrypoint: { path: actorPath, export: 'helloResources' },
      properties: {},
    });

    const system = new ActorSystem({
      name: 'test-system',
      functions: [hello],
      properties: {
        targets: [],
        resources: {
          db: { adapter: 'vanilla', options: { path: tmp } },
          queue: { adapter: 'vanilla', options: { path: tmp } },
          objectStorage: { adapter: 'vanilla', options: { path: tmp } },
        },
      },
    });

    const result = await system.invoke('hello-resources', { who: 'jest' });

    expect(result.who).toBe('jest');
    expect(result.dbRecord?.message).toBe('hello jest');
    expect(result.queueBody).toBe(JSON.stringify({ hello: 'jest' }));
    expect(result.objectBody).toBe('hello jest');

    // resources are cached on the ActorSystem instance
    const r1 = await system.getRuntimeResources();
    const r2 = await system.getRuntimeResources();
    expect(r1.db).toBe(r2.db);
    expect(r1.queue).toBe(r2.queue);
    expect(r1.objectStorage).toBe(r2.objectStorage);

    await system.closeRuntimeResources();
  });

  it('accepts runtime.stateStore and telemetry callbacks while preserving emitter-compatible events', async () => {
    const actorPath = fileURLToPath(
      new URL('../../fixtures/actors/hello-resources.js', import.meta.url),
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
      name: 'hello-resources',
      entrypoint: { path: actorPath, export: 'helloResources' },
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
        resources: {},
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
        resources: {},
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
        resources: {},
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
        resources: {},
      },
    });
    const build = system
      .getResources()
      .find((resource) => resource instanceof SeaBuild);

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
  });

  it('worker sandbox: context.resources proxies use an RPC bridge to host resources', async () => {
    const tmp = await fsp.mkdtemp(
      path.join(os.tmpdir(), 'wharfie-actor-system-worker-rpc-'),
    );

    const { resources, close } = await createActorSystemResources({
      db: { adapter: 'vanilla', options: { path: tmp } },
      queue: { adapter: 'vanilla', options: { path: tmp } },
      objectStorage: { adapter: 'vanilla', options: { path: tmp } },
    });
    if (!resources.db || !resources.queue || !resources.objectStorage) {
      throw new Error('Expected runtime resources to be initialized');
    }

    const fnName = `wharfie-worker-hello-${Date.now()}-${Math.floor(
      Math.random() * 1e9,
    )}`;

    const codeString = `
      global[Symbol.for(${JSON.stringify(fnName)})] = async (event, context) => {
        const who = event?.who || 'world';
        const message = 'hello ' + who;

        // Verify that arbitrary host-provided resource fields survive the proxy hydration.
        const extraValue = context?.resources?.extraValue || 'missing';

        await context.resources.db.put({
          tableName: 'test',
          keyName: 'id',
          record: { id: 'greeting', who, message, extraValue }
        });

        await context.resources.queue.sendMessage({
          QueueUrl: 'test-queue',
          MessageBody: JSON.stringify({ hello: who })
        });

        await context.resources.objectStorage.createBucket({ Bucket: 'test-bucket' });
        await context.resources.objectStorage.putObject({
          Bucket: 'test-bucket',
          Key: 'greeting.txt',
          Body: message,
        });
      };
    `;

    try {
      await sandboxWorker.runInSandbox(
        fnName,
        codeString,
        [{ who: 'jest-worker' }, { resources: { extraValue: 'from-host' } }],
        {
          rpc: { resources },
        },
      );

      const rec = await resources.db.get({
        tableName: 'test',
        keyName: 'id',
        keyValue: 'greeting',
      });

      if (!rec) {
        throw new Error('Expected db record to exist');
      }

      expect(rec.message).toBe('hello jest-worker');
      expect(rec.extraValue).toBe('from-host');

      const received = await resources.queue.receiveMessage({
        QueueUrl: 'test-queue',
        MaxNumberOfMessages: 1,
        WaitTimeSeconds: 0,
      });

      expect(received?.Messages?.[0]?.Body).toBe(
        JSON.stringify({ hello: 'jest-worker' }),
      );

      const obj = await resources.objectStorage.getObject({
        Bucket: 'test-bucket',
        Key: 'greeting.txt',
      });

      expect(obj).toBe('hello jest-worker');
    } finally {
      await close();
      await sandboxWorker._destroyWorker();
      sandboxWorker._clearSandboxCache();
    }
  });
});
