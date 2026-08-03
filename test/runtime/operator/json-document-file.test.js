import { afterEach, describe, expect, it } from '@jest/globals';
import { promises as fsp } from 'node:fs';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import {
  OPERATOR_JSON_DOCUMENT_MAX_BYTES,
  readOperatorJsonObjectFile,
} from '../../../src/core/runtime/operator/json-document-file.js';

/** @type {string[]} */
const temporaryDirectories = [];
const execFileAsync = promisify(execFile);

/** @returns {Promise<string>} - Fresh temporary directory. */
async function makeTemporaryDirectory() {
  const directory = await fsp.mkdtemp(
    path.join(os.tmpdir(), 'wharfie-operator-json-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

/**
 * @param {string | Buffer} contents - Exact file contents.
 * @returns {Promise<string>} - Fresh document path.
 */
async function makeDocument(contents) {
  const directory = await makeTemporaryDirectory();
  const filePath = path.join(directory, 'document.json');
  await fsp.writeFile(filePath, contents);
  return filePath;
}

afterEach(async () => {
  const directories = temporaryDirectories.splice(0);
  await Promise.all(
    directories.map((directory) =>
      fsp.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('operator JSON object file reader', () => {
  it('reads one complete regular UTF-8 JSON object', async () => {
    const value = {
      schemaVersion: 1,
      kind: 'operatorDocument',
      nested: { enabled: true, values: [1, 'two', null] },
    };
    const filePath = await makeDocument(JSON.stringify(value));

    await expect(
      readOperatorJsonObjectFile(filePath, 'deployment plan'),
    ).resolves.toEqual(value);
  });

  it.each([undefined, null, '', 1, 'invalid\0path'])(
    'rejects invalid path input without exposing file contents: %#',
    async (filePath) => {
      await expect(
        readOperatorJsonObjectFile(filePath, 'deployment plan'),
      ).rejects.toThrow('deployment plan file path must be a nonempty string.');
    },
  );

  it('requires a regular file', async () => {
    const directory = await makeTemporaryDirectory();

    await expect(
      readOperatorJsonObjectFile(directory, 'deployment profile'),
    ).rejects.toThrow('deployment profile file must be a regular file.');
  });

  it('rejects a FIFO without waiting for a writer', async () => {
    if (process.platform === 'win32') return;
    const directory = await makeTemporaryDirectory();
    const fifoPath = path.join(directory, 'document.fifo');
    await execFileAsync('mkfifo', [fifoPath]);
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const timeout = new Promise((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('FIFO read did not settle promptly.')),
        1_000,
      );
    });
    try {
      await expect(
        Promise.race([
          readOperatorJsonObjectFile(fifoPath, 'deployment plan'),
          timeout,
        ]),
      ).rejects.toThrow('deployment plan file must be a regular file.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  });

  it('rejects an oversize sparse file before allocating its contents', async () => {
    const directory = await makeTemporaryDirectory();
    const filePath = path.join(directory, 'oversize.json');
    const handle = await fsp.open(filePath, 'w');
    try {
      await handle.truncate(OPERATOR_JSON_DOCUMENT_MAX_BYTES + 1);
    } finally {
      await handle.close();
    }

    await expect(
      readOperatorJsonObjectFile(filePath, 'prepared deployment'),
    ).rejects.toThrow(
      `prepared deployment file must not exceed ${OPERATOR_JSON_DOCUMENT_MAX_BYTES} bytes.`,
    );
  });

  it('rejects malformed JSON without echoing its contents', async () => {
    const secret = 'must-not-echo-json-sentinel';
    const filePath = await makeDocument(`{"secret":"${secret}"`);

    let thrown;
    try {
      await readOperatorJsonObjectFile(filePath, 'deployment plan');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(/** @type {Error} */ (thrown).message).toBe(
      'deployment plan file must contain valid UTF-8 JSON.',
    );
    expect(/** @type {Error} */ (thrown).message).not.toContain(secret);
  });

  it('rejects invalid UTF-8 before accepting JSON syntax', async () => {
    const filePath = await makeDocument(Buffer.from([0x7b, 0xc3, 0x28, 0x7d]));

    await expect(
      readOperatorJsonObjectFile(filePath, 'deployment plan'),
    ).rejects.toThrow('deployment plan file must contain valid UTF-8 JSON.');
  });

  it.each([
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"value"'],
    ['number', '42'],
    ['boolean', 'true'],
  ])(
    'rejects a valid JSON %s because it is not an object',
    async (_kind, text) => {
      const filePath = await makeDocument(text);

      await expect(
        readOperatorJsonObjectFile(filePath, 'deployment profile'),
      ).rejects.toThrow(
        'deployment profile file must contain one JSON object.',
      );
    },
  );

  it('accepts an empty JSON object at the object-reader boundary', async () => {
    const filePath = await makeDocument('{}');

    await expect(readOperatorJsonObjectFile(filePath)).resolves.toEqual({});
  });

  it('closes its descriptor after both success and parse failure', async () => {
    const successfulPath = await makeDocument('{"ok":true}');
    const failedPath = await makeDocument('{');

    await readOperatorJsonObjectFile(successfulPath);
    await expect(readOperatorJsonObjectFile(failedPath)).rejects.toThrow();

    await expect(fsp.rm(successfulPath)).resolves.toBeUndefined();
    await expect(fsp.rm(failedPath)).resolves.toBeUndefined();
  });
});
