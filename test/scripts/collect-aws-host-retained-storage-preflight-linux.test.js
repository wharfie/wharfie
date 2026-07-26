import {
  main,
  parseAwsRetainedStorageHostPreflightArguments,
} from '../../scripts/collect-aws-host-retained-storage-preflight-linux.js';

describe('AWS retained-storage host preflight CLI', () => {
  it.each([
    ['x86_64', 'a'.repeat(40)],
    ['arm64', 'b'.repeat(40)],
  ])('creates one frozen path-free %s request', (architecture, commit) => {
    const request = parseAwsRetainedStorageHostPreflightArguments([
      'node',
      'script',
      commit,
      architecture,
    ]);

    expect(request).toEqual({
      sourceCommit: commit,
      expectedArchitecture: architecture,
    });
    expect(Reflect.ownKeys(request)).toEqual([
      'sourceCommit',
      'expectedArchitecture',
    ]);
    expect(Object.isFrozen(request)).toBe(true);
    expect(JSON.stringify(request)).not.toContain('/');
  });

  it.each([
    [[]],
    [['node']],
    [['node', 'script']],
    [['node', 'script', 'commit-only']],
    [['node', 'script', 'g'.repeat(40), 'x86_64']],
    [['node', 'script', 'a'.repeat(40), 'ppc64le']],
    [['node', 'script', 'commit', 'x86_64', 'extra']],
    [['node', 'script', 'commit', 1]],
  ])('rejects malformed argv without opening or reading a path', (argv) => {
    expect(() =>
      parseAwsRetainedStorageHostPreflightArguments(/** @type {any} */ (argv)),
    ).toThrow(
      'Usage: collect-aws-host-retained-storage-preflight-linux.js <source-commit> <x86_64|arm64>',
    );
  });

  it('rejects an invalid CLI shape before native host collection', async () => {
    await expect(main(['node', 'script'])).rejects.toThrow(
      'Usage: collect-aws-host-retained-storage-preflight-linux.js <source-commit> <x86_64|arm64>',
    );
  });
});
