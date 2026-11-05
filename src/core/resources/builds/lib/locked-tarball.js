import { createHash } from 'node:crypto';

const MAX_TARBALL_BYTES = 256 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 240_000;

/**
 * Download only the immutable URL named by a frozen dependency plan. Do not
 * consult package metadata, npm configuration, credentials, or a mutable cache.
 * No archive parser receives bytes until the complete SHA-512 digest matches.
 * @param {string} resolved - Exact credential-free HTTPS tarball URL.
 * @param {{integrity: string, signal?: AbortSignal}} options - Locked digest and optional cancellation.
 * @param {{fetchImplementation?: typeof fetch, maxBytes?: number, timeoutMs?: number}} [dependencies] - Transfer primitives and smaller verification budgets.
 * @returns {Promise<Buffer>} - Complete integrity-checked archive bytes.
 */
export async function downloadLockedTarball(
  resolved,
  options,
  dependencies = {},
) {
  let locator;
  try {
    locator = new URL(resolved);
  } catch {
    throw new TypeError('Locked package URL must be canonical HTTPS.');
  }
  if (
    locator.protocol !== 'https:' ||
    locator.username ||
    locator.password ||
    locator.search ||
    locator.hash ||
    locator.href !== resolved
  ) {
    throw new TypeError(
      'Locked package URL must be credential-free canonical HTTPS.',
    );
  }
  if (typeof options?.integrity !== 'string') {
    throw new TypeError(
      'Locked package integrity must be canonical SHA-512 SRI.',
    );
  }
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(options.integrity);
  const expected = match && Buffer.from(match[1], 'base64');
  if (
    !expected ||
    expected.length !== 64 ||
    expected.toString('base64') !== match?.[1]
  ) {
    throw new TypeError(
      'Locked package integrity must be canonical SHA-512 SRI.',
    );
  }
  const maxBytes = dependencies.maxBytes ?? MAX_TARBALL_BYTES;
  const timeoutMs = dependencies.timeoutMs ?? DOWNLOAD_TIMEOUT_MS;
  for (const { label, value, maximum } of [
    { label: 'maxBytes', value: maxBytes, maximum: MAX_TARBALL_BYTES },
    { label: 'timeoutMs', value: timeoutMs, maximum: DOWNLOAD_TIMEOUT_MS },
  ]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new TypeError(
        `Locked package ${label} exceeds its transfer budget.`,
      );
    }
  }

  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  signal.throwIfAborted();
  const timer = setTimeout(
    () => controller.abort(new Error('Locked package download timed out.')),
    timeoutMs,
  );
  /** @type {ReadableStreamDefaultReader<Uint8Array> | undefined} */
  let reader;
  const cancelReader = () => {
    reader?.cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener('abort', cancelReader, { once: true });
  try {
    const response = await (dependencies.fetchImplementation || fetch)(
      resolved,
      {
        signal,
        redirect: 'error',
        credentials: 'omit',
        headers: {
          accept: 'application/octet-stream',
          'accept-encoding': 'identity',
        },
      },
    );
    signal.throwIfAborted();
    if (
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== resolved)
    ) {
      throw new Error(
        `Locked package download rejected HTTP ${response.status}.`,
      );
    }
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') {
      throw new Error(
        'Locked package download must return unencoded archive bytes.',
      );
    }
    const lengthHeader = response.headers.get('content-length');
    const expectedLength =
      lengthHeader === null ? undefined : Number(lengthHeader);
    if (
      lengthHeader !== null &&
      (!/^[1-9]\d*$/.test(lengthHeader) ||
        !Number.isSafeInteger(expectedLength) ||
        /** @type {number} */ (expectedLength) > maxBytes)
    ) {
      throw new Error(
        'Locked package download has an invalid or excessive Content-Length.',
      );
    }
    if (!response.body)
      throw new Error('Locked package download has no archive body.');
    reader = response.body.getReader();
    /** @type {Buffer[]} */
    const chunks = [];
    const hash = createHash('sha512');
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new Error(
          'Locked package download exceeds its archive byte limit.',
        );
      }
      const chunk = Buffer.from(value);
      hash.update(chunk);
      chunks.push(chunk);
    }
    if (
      size === 0 ||
      (expectedLength !== undefined && size !== expectedLength)
    ) {
      throw new Error(
        'Locked package download has an empty or truncated archive body.',
      );
    }
    if (hash.digest('base64') !== expected.toString('base64')) {
      throw new Error('Locked package SHA-512 integrity mismatch.');
    }
    return Buffer.concat(chunks, size);
  } finally {
    clearTimeout(timer);
    controller.abort();
    signal.removeEventListener('abort', cancelReader);
    reader?.releaseLock();
  }
}
