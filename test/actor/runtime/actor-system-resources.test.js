/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import os from 'node:os';
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { fileURLToPath } from 'node:url';

import Function from '../../../lambdas/lib/actor/resources/builds/function.js';
import ActorSystem from '../../../lambdas/lib/actor/resources/builds/actor-system.js';
import { createActorSystemResources } from '../../../lambdas/lib/actor/runtime/resources.js';

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

    expect(typeof resources.db?.put).toBe('function');
    expect(typeof resources.queue?.sendMessage).toBe('function');
    expect(typeof resources.objectStorage?.putObject).toBe('function');

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
});
