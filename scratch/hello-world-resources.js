import path from 'node:path';
import os from 'node:os';

import Function from '../lambdas/lib/actor/resources/builds/function.js';
import ActorSystem from '../lambdas/lib/actor/resources/builds/actor-system.js';

async function main() {
  const workdir = path.join(os.tmpdir(), `wharfie-hello-world-${Date.now()}`);

  const hello = new Function({
    name: 'hello-world',
    entrypoint: {
      path: path.resolve(import.meta.dirname, 'functions/hello-world.js'),
      export: 'helloWorld',
    },
    properties: {},
  });

  const system = new ActorSystem({
    name: 'hello-system',
    functions: [hello],
    properties: {
      // NOTE: no build targets needed to run in-process.
      targets: [],
      resources: {
        db: { adapter: 'vanilla', options: { path: workdir } },
        queue: { adapter: 'vanilla', options: { path: workdir } },
        objectStorage: { adapter: 'vanilla', options: { path: workdir } },
      },
    },
  });

  const result = await system.invoke('hello-world', { who: 'world' });
  console.log('hello-world result:', result);

  await system.closeRuntimeResources();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
