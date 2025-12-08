const { getInstalledVersion, Function, ActorSystem } = require('willem');

const foo = new Function(
  async (event, context) => {
    console.log('funciton called with: ', event, 'and context', context);
  },
  {
    name: 'foo',
    properties: {
      external: [
        // { name: '@duckdb/node-api', version: getInstalledVersion('@duckdb/node-api') },
      ],
    },
  }
);

const bar = new Function('relative_path/file.entrypoint', {
  name: 'bar',
  properties: {},
});

const main = new ActorSystem({
  name: 'main',
  functions: [foo, bar],
  properties: {
    targets: [
      {
        nodeVersion: '24',
        platform: 'darwin',
        architecture: 'arm64',
      },
      {
        nodeVersion: '23',
        platform: 'linux',
        architecture: 'x64',
      },
    ],
  },
});
