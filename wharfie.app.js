export default {
  schemaVersion: 4,
  app: { id: 'wharfie' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli/entry.js',
      export: 'main',
    },
  },
  targets: [
    {
      nodeVersion: '24.13.1',
      platform: 'linux',
      architecture: 'x64',
      libc: 'glibc',
    },
  ],
};
