/* eslint-disable jsdoc/require-param, jsdoc/require-returns, jsdoc/require-param-description, jsdoc/require-returns-description -- Internal bounded recipient download boundary. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import { loadPreviewReleaseCandidate } from './publish-preview-release.js';
import packageMetadata from '../package.json' with { type: 'json' };

const API = 'https://api.github.com/repos/wharfie/wharfie';
const REPOSITORY = 'https://github.com/wharfie/wharfie';
const CDN_HOSTS = new Set([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const MAX_ASSET_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 180_000;
const TOTAL_TIMEOUT_MS = 900_000;

/**
 * @typedef {{tag: string, directory: string, expectedCommit?: string, draft?: boolean, token?: string, signal?: AbortSignal}} RecipientDownloadOptions
 * @typedef {{fetch?: typeof fetch, requestTimeoutMs?: number, totalTimeoutMs?: number}} RecipientDownloadDependencies
 */

/** @param {unknown} value @returns {Record<string, any>} */
function object(value) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  return /** @type {Record<string, any>} */ (value);
}

/** @param {unknown} value @returns {number} */
function positiveId(value) {
  assert.ok(Number.isSafeInteger(value) && Number(value) > 0);
  return Number(value);
}

/** @param {string} tag */
function assetLimits(tag) {
  const version = tag.slice(1);
  return new Map([
    ['preview-release.json', 1024 * 1024],
    ['SHA256SUMS', 4096],
    [`wharfie-wharfie-${version}.tgz`, 128 * 1024 * 1024],
    [`wharfie-aws-${version}.tgz`, 128 * 1024 * 1024],
    [`wharfie-${tag}-linux-x64`, MAX_ASSET_BYTES],
    [`wharfie-${tag}-linux-x64.artifact.json`, 1024 * 1024],
  ]);
}

/**
 * Bound all six regular files before the shared verifier reads any contents.
 * The directory must be private to the caller while it is being verified.
 * @param {string} directory
 * @param {{expectedCommit?: string}} [options]
 */
export async function verifyPreviewRecipientCandidate(directory, options = {}) {
  assert.ok(path.isAbsolute(directory));
  const directoryStats = await lstat(directory);
  assert.ok(directoryStats.isDirectory() && !directoryStats.isSymbolicLink());
  const expected = assetLimits(`v${packageMetadata.version}`);
  let total = 0;
  for await (const entry of await opendir(directory)) {
    const maximum = expected.get(entry.name);
    assert.ok(
      maximum !== undefined && entry.isFile() && !entry.isSymbolicLink(),
    );
    expected.delete(entry.name);
    const stats = await lstat(path.join(directory, entry.name));
    assert.ok(stats.isFile() && !stats.isSymbolicLink());
    assert.ok(stats.size > 0 && stats.size <= maximum);
    total += stats.size;
    assert.ok(total <= MAX_TOTAL_BYTES);
  }
  assert.equal(expected.size, 0);
  return loadPreviewReleaseCandidate(directory, options);
}

/** Validate the exact six downloadable files before following any asset URL. */
function releaseProjection(
  /** @type {unknown} */ value,
  /** @type {string} */ tag,
  /** @type {boolean} */ draft,
) {
  const release = object(value);
  const expected = assetLimits(tag);
  const id = positiveId(release.id);
  assert.equal(release.url, `${API}/releases/${id}`);
  assert.equal(release.tag_name, tag);
  assert.equal(release.draft, draft);
  assert.equal(release.prerelease, true);
  assert.ok(Array.isArray(release.assets) && release.assets.length === 6);
  const ids = new Set();
  const assets = release.assets.map((/** @type {unknown} */ entry) => {
    const asset = object(entry);
    const assetId = positiveId(asset.id);
    const maximum = expected.get(asset.name);
    assert.ok(maximum !== undefined);
    expected.delete(asset.name);
    assert.ok(!ids.has(assetId));
    ids.add(assetId);
    assert.equal(asset.state, 'uploaded');
    assert.ok(
      Number.isSafeInteger(asset.size) &&
        asset.size > 0 &&
        asset.size <= maximum,
    );
    assert.equal(asset.url, `${API}/releases/assets/${assetId}`);
    // Draft browser URLs can use a temporary untagged path. Draft downloads
    // use only the exact API asset URL above; public downloads use this URL.
    if (!draft)
      assert.equal(
        asset.browser_download_url,
        `${REPOSITORY}/releases/download/${tag}/${asset.name}`,
      );
    assert.ok(
      typeof asset.digest === 'string' &&
        /^sha256:[a-f0-9]{64}$/.test(asset.digest),
    );
    return {
      id: assetId,
      name: /** @type {string} */ (asset.name),
      size: /** @type {number} */ (asset.size),
      digest: asset.digest,
      url: /** @type {string} */ (asset.url),
      browserUrl: /** @type {string} */ (asset.browser_download_url),
    };
  });
  assert.equal(expected.size, 0);
  assert.ok(
    assets.reduce((total, asset) => total + asset.size, 0) <= MAX_TOTAL_BYTES,
  );
  return {
    id,
    tag,
    draft,
    prerelease: true,
    assets: assets.sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/**
 * Download exactly one canonical release and reuse the publication verifier for
 * its full bytes, sidecar, checksum and npm archive contracts. No package is
 * extracted and no downloaded executable or package script is run here. The
 * caller owns the successful directory; failures remove only our new directory.
 * Published mode never reads ambient credentials. Draft access is explicit and
 * the token is sent only to the canonical API, never to an asset redirect.
 * @param {RecipientDownloadOptions} options
 * @param {RecipientDownloadDependencies} [dependencies]
 */
export async function downloadPreviewRecipientRelease(
  options,
  dependencies = {},
) {
  const started = performance.now();
  let phase = 'validate-request';
  let ownedDirectory = /** @type {string|null} */ (null);
  let httpStatus = /** @type {number|null} */ (null);
  let timedOut = false;
  const overall = new AbortController();
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let overallTimer;
  try {
    assert.match(
      options.tag,
      /^v(?:0|[1-9]\d{0,7})\.(?:0|[1-9]\d{0,7})\.(?:0|[1-9]\d{0,7})$/,
    );
    assert.ok(
      path.isAbsolute(options.directory) &&
        path.normalize(options.directory) === options.directory,
    );
    if (options.expectedCommit !== undefined)
      assert.match(options.expectedCommit, /^[a-f0-9]{40}$/);
    assert.ok(
      options.draft === undefined || typeof options.draft === 'boolean',
    );
    const draft = options.draft === true;
    if (draft)
      assert.ok(
        typeof options.token === 'string' &&
          /^[\x21-\x7e]{1,4096}$/.test(options.token),
      );
    else
      assert.equal(
        options.token,
        undefined,
        'Published downloads must be unauthenticated.',
      );
    const requestTimeoutMs =
      dependencies.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    const totalTimeoutMs = dependencies.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
    for (const [value, maximum] of [
      [requestTimeoutMs, REQUEST_TIMEOUT_MS],
      [totalTimeoutMs, TOTAL_TIMEOUT_MS],
    ]) {
      assert.ok(Number.isSafeInteger(value) && value > 0 && value <= maximum);
    }
    const fetchResource = dependencies.fetch ?? fetch;
    const signal = AbortSignal.any([
      overall.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
    signal.throwIfAborted();
    overallTimer = setTimeout(() => {
      timedOut = true;
      overall.abort();
    }, totalTimeoutMs);
    overallTimer.unref();
    await mkdir(options.directory, { mode: 0o700 });
    ownedDirectory = options.directory;
    ownedDirectory = await realpath(ownedDirectory);

    /**
     * A single deadline covers redirects and the entire streamed response. Each
     * redirect is checked before another request, with a fresh header set.
     * @param {string} initialUrl
     * @param {{maximumBytes: number, asset?: boolean, destination?: string, expectedSize?: number}} input
     */
    const transfer = async (initialUrl, input) => {
      const controller = new AbortController();
      const requestSignal = AbortSignal.any([signal, controller.signal]);
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, requestTimeoutMs);
      timer.unref();
      /** @type {import('node:fs/promises').FileHandle|undefined} */
      let file;
      /** @type {ReadableStreamDefaultReader<Uint8Array>|undefined} */
      let reader;
      /** @type {Buffer[]} */
      const buffers = [];
      const digest = createHash('sha256');
      let size = 0;
      let rejectAbort = /** @type {(reason?: any) => void} */ (() => {});
      const aborted = new Promise(
        /** @param {(value: never) => void} _resolve */ (_resolve, reject) => {
          rejectAbort = reject;
        },
      );
      aborted.catch(() => {});
      const abort = () =>
        rejectAbort(new Error('Recipient request interrupted.'));
      requestSignal.addEventListener('abort', abort, { once: true });
      try {
        requestSignal.throwIfAborted();
        let url = new URL(initialUrl);
        let response;
        for (let redirects = 0; redirects <= 3; redirects++) {
          const headers = {
            accept: input.asset
              ? 'application/octet-stream'
              : 'application/vnd.github+json',
            'user-agent': 'wharfie-preview-recipient',
            ...(url.origin === 'https://api.github.com'
              ? {
                  'x-github-api-version': '2026-03-10',
                  ...(draft
                    ? { authorization: `Bearer ${options.token}` }
                    : {}),
                }
              : {}),
          };
          response = await Promise.race([
            fetchResource(url.href, {
              method: 'GET',
              headers,
              redirect: 'manual',
              signal: requestSignal,
            }),
            aborted,
          ]);
          assert.ok(response && typeof response.status === 'number');
          if (![301, 302, 303, 307, 308].includes(response.status)) break;
          await Promise.race([response.body?.cancel(), aborted]);
          assert.ok(input.asset && redirects < 3);
          const location = response.headers.get('location');
          assert.ok(location);
          const next = new URL(location, url);
          assert.ok(
            next.protocol === 'https:' &&
              !next.username &&
              !next.password &&
              !next.port &&
              !next.hash &&
              CDN_HOSTS.has(next.hostname),
          );
          url = next;
        }
        assert.ok(response);
        httpStatus = response.status;
        assert.equal(response.status, 200);
        httpStatus = null;
        const contentLength = response.headers.get('content-length');
        if (contentLength !== null) {
          assert.match(contentLength, /^\d+$/);
          assert.ok(Number(contentLength) <= input.maximumBytes);
          if (input.expectedSize !== undefined)
            assert.equal(Number(contentLength), input.expectedSize);
        }
        assert.ok(response.body);
        reader = response.body.getReader();
        if (input.destination)
          file = await open(input.destination, 'wx', 0o600);
        for (;;) {
          const chunk = await Promise.race([reader.read(), aborted]);
          if (chunk.done) break;
          size += chunk.value.byteLength;
          assert.ok(size <= input.maximumBytes);
          if (input.expectedSize !== undefined)
            assert.ok(size <= input.expectedSize);
          const bytes = Buffer.from(chunk.value);
          digest.update(bytes);
          if (file) await file.writeFile(bytes);
          else buffers.push(bytes);
        }
        if (input.expectedSize !== undefined)
          assert.equal(size, input.expectedSize);
        if (file) await file.sync();
        return {
          bytes: file ? null : Buffer.concat(buffers),
          size,
          sha256: digest.digest('hex'),
        };
      } finally {
        clearTimeout(timer);
        requestSignal.removeEventListener('abort', abort);
        controller.abort();
        reader?.cancel().catch(() => {});
        await file?.close();
      }
    };
    /** @param {string} url */
    const json = async (url) => {
      const result = await transfer(url, { maximumBytes: MAX_METADATA_BYTES });
      assert.ok(result.bytes);
      return JSON.parse(result.bytes.toString('utf8'));
    };
    phase = 'release-metadata';
    let selected;
    if (draft) {
      // GitHub's tag endpoint serves published releases. Drafts require the
      // authenticated list endpoint; ignore its Link URL and bound pagination.
      const matches = [];
      for (let page = 1; page <= 10; page++) {
        const releases = await json(
          `${API}/releases?per_page=100&page=${page}`,
        );
        assert.ok(Array.isArray(releases) && releases.length <= 100);
        matches.push(
          ...releases.filter((entry) => object(entry).tag_name === options.tag),
        );
        if (releases.length < 100) break;
        assert.ok(page < 10, 'Release pagination exceeded its bound.');
      }
      assert.equal(matches.length, 1);
      selected = matches[0];
    } else selected = await json(`${API}/releases/tags/${options.tag}`);
    const release = releaseProjection(selected, options.tag, draft);
    phase = 'download-assets';
    for (const asset of release.assets) {
      const downloaded = await transfer(draft ? asset.url : asset.browserUrl, {
        asset: true,
        maximumBytes: asset.size,
        expectedSize: asset.size,
        destination: path.join(ownedDirectory, asset.name),
      });
      assert.equal(`sha256:${downloaded.sha256}`, asset.digest);
    }
    phase = 'verify-assets';
    signal.throwIfAborted();
    const candidate = await verifyPreviewRecipientCandidate(ownedDirectory, {
      expectedCommit: options.expectedCommit,
    });
    assert.equal(candidate.manifest.tag, options.tag);
    signal.throwIfAborted();
    phase = 'recheck-release';
    const after = releaseProjection(
      await json(`${API}/releases/${release.id}`),
      options.tag,
      draft,
    );
    assert.deepEqual(
      after,
      release,
      'Release metadata changed during download.',
    );
    signal.throwIfAborted();
    return {
      candidate,
      receipt: {
        schemaVersion: 1,
        kind: 'wharfie.preview.recipient-download',
        source: 'github-release',
        repository: REPOSITORY,
        releaseId: release.id,
        tag: options.tag,
        commit: candidate.manifest.source.commit,
        draft,
        metadataRechecked: true,
        assets: candidate.assets.map(({ name, size, sha256 }) => ({
          name,
          size,
          sha256,
        })),
      },
    };
  } catch {
    let cleanupFailed = false;
    if (ownedDirectory !== null) {
      try {
        await rm(ownedDirectory, { recursive: true, force: true });
      } catch {
        cleanupFailed = true;
      }
    }
    throw Object.assign(new Error('Preview recipient download failed.'), {
      diagnostic: {
        phase,
        durationMs: Math.round(performance.now() - started),
        status: httpStatus,
        timedOut,
        aborted: options.signal?.aborted === true,
        cleanupFailed,
      },
    });
  } finally {
    clearTimeout(overallTimer);
    overall.abort();
  }
}
