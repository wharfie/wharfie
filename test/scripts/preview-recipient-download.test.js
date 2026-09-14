// @ts-nocheck -- External HTTP fixture documents intentionally model malformed release metadata.
/* eslint-env jest */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import packageMetadata from '../../package.json' with { type: 'json' };
import {
  downloadPreviewRecipientRelease,
  verifyPreviewRecipientCandidate,
} from '../../scripts/preview-recipient-download.js';

const API = 'https://api.github.com/repos/wharfie/wharfie';
const REPOSITORY = 'https://github.com/wharfie/wharfie';
const COMMIT = 'a'.repeat(40);
const TAG = `v${packageMetadata.version}`;
const TARGET = {
  nodeVersion: '24.13.1',
  platform: 'linux',
  architecture: 'x64',
  libc: 'glibc',
};
const REVISION_ID = `wrv1_${Buffer.alloc(32, 0x52).toString('base64url')}`;
const TOKEN = 'secret-draft-token';

function hash(bytes, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(bytes).digest(encoding);
}

function tarball(metadata) {
  const contents = Buffer.from(JSON.stringify(metadata));
  const header = Buffer.alloc(512);
  header.write('package/package.json');
  for (const [offset, length, value] of [
    [100, 8, 0o644],
    [108, 8, 0],
    [116, 8, 0],
    [124, 12, contents.length],
    [136, 12, 0],
  ]) {
    header.write(
      `${value.toString(8).padStart(length - 1, '0')}\0`,
      offset,
      length,
      'ascii',
    );
  }
  header.fill(0x20, 148, 156);
  header[156] = 48;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return gzipSync(
    Buffer.concat([
      header,
      contents,
      Buffer.alloc((512 - (contents.length % 512)) % 512),
      Buffer.alloc(1024),
    ]),
  );
}

function fixture(options = {}) {
  const version = packageMetadata.version;
  const standalone = Buffer.from('unexecutable recipient fixture');
  const artifactId = `waf1_${hash(standalone, 'sha256', 'base64url')}`;
  const metadata = (companion) => ({
    name: companion ? '@wharfie/aws' : '@wharfie/wharfie',
    version,
    private: false,
    repository: {
      type: 'git',
      url: 'git+https://github.com/wharfie/wharfie.git',
      ...(companion ? { directory: 'packages/aws' } : {}),
    },
    engines: { node: '>=24.13.1 <25' },
    peerDependencies: {
      [companion ? '@wharfie/wharfie' : '@wharfie/aws']: version,
    },
    peerDependenciesMeta: {
      [companion ? '@wharfie/wharfie' : '@wharfie/aws']: { optional: true },
    },
    publishConfig: companion
      ? { access: 'public' }
      : { access: 'public', tag: 'preview-candidate', provenance: true },
  });
  const record = {
    schemaVersion: 1,
    kind: 'artifactRecord',
    artifactId,
    byteDigest: {
      algorithm: 'sha256',
      value: hash(standalone, 'sha256', 'base64url'),
    },
    size: standalone.length,
    appId: 'wharfie',
    revisionId: REVISION_ID,
    target: TARGET,
    targetId: 'node-v24.13.1-linux-x64-glibc',
    format: { kind: 'node-sea', version: 1 },
    provenance: { fixture: 'recipient-download' },
  };
  options.mutateRecord?.(record);
  const core = metadata(false);
  options.mutateCore?.(core);
  const files = new Map([
    [`wharfie-wharfie-${version}.tgz`, tarball(core)],
    [`wharfie-aws-${version}.tgz`, tarball(metadata(true))],
    [`wharfie-${TAG}-linux-x64`, standalone],
    [
      `wharfie-${TAG}-linux-x64.artifact.json`,
      Buffer.from(`${JSON.stringify(record)}\n`),
    ],
  ]);
  const artifacts = [...files].map(([fileName, bytes], index) => ({
    fileName,
    kind: [
      'npm-package',
      'npm-companion-package',
      'standalone-cli',
      'artifact-record',
    ][index],
    sha256: hash(bytes),
    size: bytes.length,
    ...(index < 2
      ? {
          integrity: `sha512-${hash(bytes, 'sha512', 'base64')}`,
          package: index === 0 ? '@wharfie/wharfie' : '@wharfie/aws',
          publication: index === 0 ? 'npm-preview' : 'github-release-only',
          npmShasum: hash(bytes, 'sha1'),
          version,
        }
      : { artifactId }),
    ...(index === 2 ? { target: TARGET, revisionId: REVISION_ID } : {}),
  }));
  const manifest = {
    schemaVersion: 1,
    kind: 'wharfie.preview-release',
    package: '@wharfie/wharfie',
    version,
    tag: TAG,
    source: { repository: REPOSITORY, commit: COMMIT },
    artifacts,
  };
  options.mutateManifest?.(manifest);
  files.set(
    'preview-release.json',
    Buffer.from(`${JSON.stringify(manifest)}\n`),
  );
  files.set(
    'SHA256SUMS',
    Buffer.from(
      [...files]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, bytes]) => `${hash(bytes)}  ${name}\n`)
        .join(''),
    ),
  );
  const release = {
    id: 42,
    url: `${API}/releases/42`,
    tag_name: TAG,
    draft: options.draft === true,
    prerelease: true,
    assets: [...files].map(([name, bytes], index) => ({
      id: index + 100,
      name,
      state: 'uploaded',
      size: bytes.length,
      digest: `sha256:${hash(bytes)}`,
      url: `${API}/releases/assets/${index + 100}`,
      browser_download_url: `${REPOSITORY}/releases/download/${TAG}/${name}`,
    })),
  };
  options.mutateRelease?.(release);
  return { files, release };
}

function transport(candidate, overrides = {}) {
  const calls = [];
  const fetch = async (input, init) => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const call = {
      url,
      headers,
      method: init.method,
      redirect: init.redirect,
      signal: init.signal,
    };
    calls.push(call);
    if (overrides.handle) {
      const result = await overrides.handle(call, calls);
      if (result !== undefined) return result;
    }
    if (url === `${API}/releases/tags/${TAG}` || url === `${API}/releases/42`)
      return Response.json(candidate.release);
    if (url === `${API}/releases?per_page=100&page=1`)
      return Response.json([candidate.release]);
    const asset = candidate.release.assets.find(
      (entry) =>
        entry.url === url ||
        entry.browser_download_url === url ||
        `https://release-assets.githubusercontent.com/${entry.id}?signature=private` ===
          url,
    );
    if (!asset) throw new Error(`Unexpected request: ${url}`);
    if (
      overrides.redirectAssets &&
      !url.startsWith('https://release-assets.githubusercontent.com/')
    )
      return new Response(null, {
        status: 302,
        headers: {
          location: `https://release-assets.githubusercontent.com/${asset.id}?signature=private`,
        },
      });
    return new Response(candidate.files.get(asset.name), {
      headers: { 'content-length': String(asset.size) },
    });
  };
  return { fetch, calls };
}

let root;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'wharfie-recipient-download-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function options(extra = {}) {
  return {
    tag: TAG,
    directory: path.join(root, 'download'),
    expectedCommit: COMMIT,
    ...extra,
  };
}

async function rejectsDownload(
  candidate,
  overrides = {},
  extra = {},
  dependencies = {},
) {
  const input = options(extra);
  const http = transport(candidate, overrides);
  let failure;
  try {
    await downloadPreviewRecipientRelease(input, { ...http, ...dependencies });
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(failure.message).toBe('Preview recipient download failed.');
  expect(failure.diagnostic).toEqual(
    expect.objectContaining({
      phase: expect.any(String),
      durationMs: expect.any(Number),
      cleanupFailed: false,
    }),
  );
  expect(JSON.stringify(failure)).not.toContain(TOKEN);
  expect(existsSync(input.directory)).toBe(false);
  return { failure, calls: http.calls };
}

test('downloads the exact public release anonymously, verifies bytes and rechecks its identity', async () => {
  const candidate = fixture();
  const http = transport(candidate, { redirectAssets: true });
  const input = options();
  const result = await downloadPreviewRecipientRelease(input, http);
  expect(result.receipt).toEqual({
    schemaVersion: 1,
    kind: 'wharfie.preview.recipient-download',
    source: 'github-release',
    repository: REPOSITORY,
    releaseId: 42,
    tag: TAG,
    commit: COMMIT,
    draft: false,
    metadataRechecked: true,
    assets: [...candidate.files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bytes]) => ({
        name,
        size: bytes.length,
        sha256: hash(bytes),
      })),
  });
  expect(result.candidate.manifest.source.commit).toBe(COMMIT);
  expect(readdirSync(input.directory).sort()).toEqual(
    [...candidate.files.keys()].sort(),
  );
  for (const [name, bytes] of candidate.files) {
    expect(readFileSync(path.join(input.directory, name))).toEqual(bytes);
    expect(statSync(path.join(input.directory, name)).mode & 0o777).toBe(0o600);
  }
  expect(http.calls.at(0).url).toBe(`${API}/releases/tags/${TAG}`);
  expect(http.calls.at(-1).url).toBe(`${API}/releases/42`);
  expect(
    http.calls.every(
      (call) =>
        call.method === 'GET' &&
        call.redirect === 'manual' &&
        !call.headers.has('authorization'),
    ),
  ).toBe(true);
});

test('explicit draft mode lists releases and restricts its token to the pinned API', async () => {
  const candidate = fixture({ draft: true });
  const http = transport(candidate, { redirectAssets: true });
  const result = await downloadPreviewRecipientRelease(
    options({ draft: true, token: TOKEN }),
    http,
  );
  expect(result.receipt.draft).toBe(true);
  expect(JSON.stringify(result.receipt)).not.toContain(TOKEN);
  expect(http.calls.at(0).url).toBe(`${API}/releases?per_page=100&page=1`);
  expect(http.calls.some((call) => call.url.includes('/releases/tags/'))).toBe(
    false,
  );
  for (const call of http.calls)
    expect(call.headers.get('authorization')).toBe(
      call.url.startsWith(`${API}/`) ? `Bearer ${TOKEN}` : null,
    );
});

test('draft selection scans bounded canonical pages and ignores arbitrary Link URLs', async () => {
  const candidate = fixture({ draft: true });
  const http = transport(candidate, {
    handle: (call) => {
      if (call.url === `${API}/releases?per_page=100&page=1`)
        return Response.json(
          Array.from({ length: 100 }, () => ({ tag_name: 'v0.0.1' })),
          {
            headers: { link: '<https://attacker.invalid/secret>; rel="next"' },
          },
        );
      if (call.url === `${API}/releases?per_page=100&page=2`)
        return Response.json([candidate.release]);
    },
  });
  const result = await downloadPreviewRecipientRelease(
    options({ draft: true, token: TOKEN }),
    http,
  );
  expect(result.receipt.releaseId).toBe(42);
  expect(http.calls.slice(0, 2).map(({ url }) => url)).toEqual([
    `${API}/releases?per_page=100&page=1`,
    `${API}/releases?per_page=100&page=2`,
  ]);
  expect(http.calls.some(({ url }) => url.includes('attacker'))).toBe(false);
});

test.each(['missing', 'ambiguous', 'too many pages'])(
  'draft selection rejects %s without downloading assets',
  async (kind) => {
    const candidate = fixture({ draft: true });
    const { calls, failure } = await rejectsDownload(
      candidate,
      {
        handle: () =>
          Response.json(
            kind === 'missing'
              ? []
              : kind === 'ambiguous'
                ? [candidate.release, candidate.release]
                : Array.from({ length: 100 }, () => ({ tag_name: 'v0.0.1' })),
          ),
      },
      { draft: true, token: TOKEN },
    );
    expect(calls).toHaveLength(kind === 'too many pages' ? 10 : 1);
    expect(
      calls.every(({ url }) =>
        url.startsWith(`${API}/releases?per_page=100&page=`),
      ),
    ).toBe(true);
    expect(failure.diagnostic.phase).toBe('release-metadata');
  },
);

test('an unauthenticated caller cannot silently consume a draft or forward ambient credentials', async () => {
  const priorToken = process.env.GH_TOKEN;
  process.env.GH_TOKEN = TOKEN;
  try {
    const { calls } = await rejectsDownload(fixture({ draft: true }));
    expect(calls).toHaveLength(1);
    expect(calls[0].headers.has('authorization')).toBe(false);
  } finally {
    if (priorToken === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = priorToken;
  }
});

test('metadata redirects never receive a second request or an authorization header', async () => {
  const { calls } = await rejectsDownload(
    fixture({ draft: true }),
    {
      handle: () =>
        new Response(null, {
          status: 302,
          headers: {
            location: 'https://release-assets.githubusercontent.com/metadata',
          },
        }),
    },
    { draft: true, token: TOKEN },
  );
  expect(calls).toHaveLength(1);
});

test('caps the total download before accepting individually bounded assets', async () => {
  const candidate = fixture();
  for (const asset of candidate.release.assets)
    asset.size = asset.name.endsWith('.tgz')
      ? 128 * 1024 * 1024
      : asset.name === `wharfie-${TAG}-linux-x64`
        ? 256 * 1024 * 1024
        : asset.size;
  const { calls, failure } = await rejectsDownload(candidate);
  expect(calls).toHaveLength(1);
  expect(failure.diagnostic.phase).toBe('release-metadata');
});

test.each([
  [
    'wrong tag',
    (release) => {
      release.tag_name = 'v0.0.14';
    },
  ],
  [
    'published draft',
    (release) => {
      release.draft = true;
    },
  ],
  [
    'non-preview release',
    (release) => {
      release.prerelease = false;
    },
  ],
  [
    'unexpected asset',
    (release) => {
      release.assets[0].name = '../escape';
    },
  ],
  [
    'duplicate asset',
    (release) => {
      release.assets[0] = release.assets[1];
    },
  ],
  [
    'missing asset',
    (release) => {
      release.assets.pop();
    },
  ],
  [
    'extra asset',
    (release) => {
      release.assets.push(release.assets[0]);
    },
  ],
  [
    'untrusted download URL',
    (release) => {
      release.assets[0].browser_download_url =
        'https://attacker.invalid/payload';
    },
  ],
  [
    'untrusted API URL',
    (release) => {
      release.assets[0].url = 'https://attacker.invalid/payload';
    },
  ],
  [
    'missing digest',
    (release) => {
      release.assets[0].digest = null;
    },
  ],
  [
    'oversized asset',
    (release) => {
      release.assets[0].size = 129 * 1024 * 1024;
    },
  ],
  [
    'noninteger asset ID',
    (release) => {
      release.assets[0].id = 1.2;
    },
  ],
])('rejects %s before downloading any asset', async (_name, mutateRelease) => {
  const { calls, failure } = await rejectsDownload(fixture({ mutateRelease }));
  expect(calls).toHaveLength(1);
  expect(failure.diagnostic.phase).toBe('release-metadata');
});

test.each([
  ['https://attacker.invalid/payload'],
  ['http://release-assets.githubusercontent.com/payload'],
  ['https://token@release-assets.githubusercontent.com/payload'],
  ['https://release-assets.githubusercontent.com:444/payload'],
  ['https://release-assets.githubusercontent.com.attacker.invalid/payload'],
  ['https://api.github.com/repos/another/repo/releases/assets/1'],
])('refuses an asset redirect to %s without following it', async (location) => {
  const { calls } = await rejectsDownload(
    fixture({ draft: true }),
    {
      handle: (call) =>
        call.url.includes('/releases/assets/')
          ? new Response(null, { status: 302, headers: { location } })
          : undefined,
    },
    { draft: true, token: TOKEN },
  );
  expect(calls).toHaveLength(2);
  expect(calls.some((call) => call.url === location)).toBe(false);
});

test('bounds a repeated permitted CDN redirect chain', async () => {
  const { calls } = await rejectsDownload(fixture(), {
    handle: (call) =>
      !call.url.startsWith(API)
        ? new Response(null, {
            status: 302,
            headers: {
              location: 'https://release-assets.githubusercontent.com/loop',
            },
          })
        : undefined,
  });
  expect(calls).toHaveLength(5);
});

test.each([
  ['asset digest corruption', {}],
  ['manifest checksum corruption', { manifest: true }],
])('rejects %s and removes partial downloads', async (_name, setting) => {
  const candidate = fixture();
  const name = setting.manifest ? 'preview-release.json' : 'SHA256SUMS';
  const bytes = Buffer.from(candidate.files.get(name));
  bytes[0] ^= 1;
  candidate.files.set(name, bytes);
  if (setting.manifest)
    candidate.release.assets.find((entry) => entry.name === name).digest =
      `sha256:${hash(bytes)}`;
  const { failure } = await rejectsDownload(candidate);
  expect(failure.diagnostic.phase).toBe(
    setting.manifest ? 'verify-assets' : 'download-assets',
  );
});

test.each([
  [
    'wrong commit',
    {
      mutateManifest: (manifest) => {
        manifest.source.commit = 'b'.repeat(40);
      },
    },
  ],
  [
    'wrong artifact revision',
    {
      mutateRecord: (record) => {
        record.revisionId = `wrv1_${Buffer.alloc(32, 0x22).toString('base64url')}`;
      },
    },
  ],
  [
    'untrusted package lifecycle',
    {
      mutateCore: (metadata) => {
        metadata.scripts = { preinstall: `echo ${TOKEN}` };
      },
    },
  ],
  [
    'wrong package version',
    {
      mutateCore: (metadata) => {
        metadata.version = '0.0.14';
      },
    },
  ],
])(
  'the shared candidate contract rejects %s even with consistent GitHub digests and checksums',
  async (_name, setting) => {
    const { failure } = await rejectsDownload(fixture(setting));
    expect(failure.diagnostic.phase).toBe('verify-assets');
  },
);

test.each([
  [
    'release ID',
    (release) => {
      release.id++;
      release.url = `${API}/releases/${release.id}`;
    },
  ],
  [
    'draft status',
    (release) => {
      release.draft = true;
    },
  ],
  [
    'asset ID',
    (release) => {
      release.assets[0].id++;
      release.assets[0].url = `${API}/releases/assets/${release.assets[0].id}`;
    },
  ],
  [
    'asset size',
    (release) => {
      release.assets[0].size++;
    },
  ],
  [
    'asset digest',
    (release) => {
      release.assets[0].digest = `sha256:${'f'.repeat(64)}`;
    },
  ],
])('fails the final metadata recheck if %s changes', async (_name, mutate) => {
  const candidate = fixture();
  const { failure } = await rejectsDownload(candidate, {
    handle: (call) => {
      if (call.url !== `${API}/releases/42`) return undefined;
      const after = structuredClone(candidate.release);
      mutate(after);
      return Response.json(after);
    },
  });
  expect(failure.diagnostic.phase).toBe('recheck-release');
});

test.each(['oversized', 'truncated', 'false content length'])(
  'rejects a %s streamed asset',
  async (kind) => {
    const candidate = fixture();
    const size = candidate.files.get('SHA256SUMS').length;
    const { failure } = await rejectsDownload(candidate, {
      handle: (call) => {
        if (!call.url.endsWith('/SHA256SUMS')) return undefined;
        return new Response(
          Buffer.alloc(kind === 'oversized' ? size + 1 : size - 1),
          kind === 'false content length'
            ? { headers: { 'content-length': String(size + 1) } }
            : undefined,
        );
      },
    });
    expect(failure.diagnostic.phase).toBe('download-assets');
  },
);

test('caps metadata bytes while streaming without trusting content length', async () => {
  const { calls, failure } = await rejectsDownload(fixture(), {
    handle: () => new Response(Buffer.alloc(4 * 1024 * 1024 + 1)),
  });
  expect(calls).toHaveLength(1);
  expect(failure.diagnostic.phase).toBe('release-metadata');
});

test('reports only bounded HTTP status rather than server bodies or request secrets', async () => {
  const { failure } = await rejectsDownload(
    fixture({ draft: true }),
    {
      handle: () =>
        new Response(`${TOKEN} private server details`, { status: 403 }),
    },
    { draft: true, token: TOKEN },
  );
  expect(failure.diagnostic.status).toBe(403);
  expect(String(failure)).not.toContain(TOKEN);
  expect(JSON.stringify(failure)).not.toContain('private server');
});

test.each(['fetch', 'stream', 'redirect cancel'])(
  'a bounded request deadline interrupts a hanging %s and cleans its directory',
  async (kind) => {
    const { failure } = await rejectsDownload(
      fixture(),
      {
        handle: () => {
          if (kind === 'fetch') return new Promise(() => {});
          return new Response(
            new ReadableStream({
              pull: () => new Promise(() => {}),
              cancel: () => new Promise(() => {}),
            }),
            kind === 'redirect cancel'
              ? {
                  status: 302,
                  headers: {
                    location:
                      'https://release-assets.githubusercontent.com/hang',
                  },
                }
              : undefined,
          );
        },
      },
      {},
      { requestTimeoutMs: 30, totalTimeoutMs: 300 },
    );
    expect(failure.diagnostic.timedOut).toBe(true);
    expect(failure.diagnostic.aborted).toBe(false);
  },
);

test('an overall deadline remains effective across requests', async () => {
  const { failure } = await rejectsDownload(
    fixture(),
    { handle: () => new Promise(() => {}) },
    {},
    { requestTimeoutMs: 1000, totalTimeoutMs: 30 },
  );
  expect(failure.diagnostic.timedOut).toBe(true);
});

test('caller cancellation interrupts a pending fetch and scrubs its reason', async () => {
  const controller = new AbortController();
  const { failure } = await rejectsDownload(
    fixture(),
    {
      handle: () => {
        controller.abort(new Error(TOKEN));
        return new Promise(() => {});
      },
    },
    { signal: controller.signal },
  );
  expect(failure.diagnostic.aborted).toBe(true);
  expect(failure.diagnostic.timedOut).toBe(false);
});

test('preexisting caller files are never removed', async () => {
  const input = options();
  mkdirSync(input.directory);
  writeFileSync(path.join(input.directory, 'keep'), 'existing');
  const http = transport(fixture());
  await expect(downloadPreviewRecipientRelease(input, http)).rejects.toThrow(
    'Preview recipient download failed.',
  );
  expect(readFileSync(path.join(input.directory, 'keep'), 'utf8')).toBe(
    'existing',
  );
  expect(http.calls).toHaveLength(0);
});

test.each([
  { tag: '../escape' },
  { expectedCommit: 'main' },
  { draft: true },
  { token: TOKEN },
  { draft: true, token: 'newline\nsecret' },
  { signal: AbortSignal.abort(TOKEN) },
])(
  'invalid or aborted input fails before network access: %j',
  async (extra) => {
    const { calls, failure } = await rejectsDownload(fixture(), {}, extra);
    expect(calls).toHaveLength(0);
    expect(failure.diagnostic.phase).toBe('validate-request');
  },
);

function writeLocalCandidate(candidate) {
  const directory = path.join(root, 'candidate');
  mkdirSync(directory);
  for (const [name, bytes] of candidate.files)
    writeFileSync(path.join(directory, name), bytes);
  return directory;
}

test('local artifact mode shares the full candidate byte contract', async () => {
  const directory = writeLocalCandidate(fixture());
  const result = await verifyPreviewRecipientCandidate(directory, {
    expectedCommit: COMMIT,
  });
  expect(result.manifest.source.commit).toBe(COMMIT);
  expect(result.assets).toHaveLength(6);
  await expect(
    verifyPreviewRecipientCandidate(directory, {
      expectedCommit: 'b'.repeat(40),
    }),
  ).rejects.toThrow();
  expect(existsSync(directory)).toBe(true);
});

test.each([
  'symlink file',
  'symlink directory',
  'extra file',
  'missing file',
  'oversized manifest',
])(
  'local artifact preflight rejects %s without removing caller files',
  async (kind) => {
    const directory = writeLocalCandidate(fixture());
    const manifest = path.join(directory, 'preview-release.json');
    let input = directory;
    if (kind === 'symlink file') {
      const outside = path.join(root, 'outside.json');
      writeFileSync(outside, readFileSync(manifest));
      rmSync(manifest);
      symlinkSync(outside, manifest);
    } else if (kind === 'symlink directory') {
      input = path.join(root, 'alias');
      symlinkSync(directory, input);
    } else if (kind === 'extra file')
      writeFileSync(path.join(directory, 'extra'), 'extra');
    else if (kind === 'missing file') rmSync(manifest);
    else truncateSync(manifest, 1024 * 1024 + 1);
    await expect(
      verifyPreviewRecipientCandidate(input, { expectedCommit: COMMIT }),
    ).rejects.toThrow();
    expect(existsSync(directory)).toBe(true);
  },
);
