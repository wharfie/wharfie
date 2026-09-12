/* eslint-disable jsdoc/require-jsdoc, jsdoc/require-param-description, jsdoc/require-returns-description -- These fixtures exercise the durable receipt boundary with real files and injected I/O failures. */

import { afterEach, describe, expect, test } from '@jest/globals';
import assert from 'node:assert/strict';
import {
  closeSync,
  fsyncSync,
  fstatSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { publishLiveDeploymentReceipt } from '../../scripts/verify-live-deployment.js';

/** @type {string[]} */
const directories = [];
const BEFORE = { applyAttempted: false };
const AFTER = { applyAttempted: true };

/** @param {'file'|'directory'} [failure] */
function fixture(failure) {
  const directory = mkdtempSync(
    path.join(realpathSync(os.tmpdir()), 'wharfie-live-receipt-test-'),
  );
  directories.push(directory);
  const receipt = path.join(directory, 'run.json');
  writeFileSync(receipt, JSON.stringify(BEFORE), { mode: 0o600 });
  /** @type {string[]} */
  const events = [];
  /** @type {Map<number, import('node:fs').PathLike>} */
  const descriptors = new Map();
  const io = {
    /**
     * @param {import('node:fs').PathLike} file
     * @param {string|number} flags
     * @param {import('node:fs').Mode} [mode]
     */
    openSync: (file, flags, mode) => {
      const descriptor = openSync(file, flags, mode);
      descriptors.set(descriptor, file);
      return descriptor;
    },
    writeFileSync,
    /** @param {number} descriptor */
    fsyncSync: (descriptor) => {
      const isDirectory = fstatSync(descriptor).isDirectory();
      if (isDirectory) {
        expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual(AFTER);
        events.push('directory-flush');
      } else {
        const temporary = descriptors.get(descriptor);
        assert.ok(temporary !== undefined);
        expect(JSON.parse(readFileSync(temporary, 'utf8'))).toEqual(AFTER);
        // The prior authority remains visible until the replacement is durable.
        expect(JSON.parse(readFileSync(receipt, 'utf8'))).toEqual(BEFORE);
        events.push('file-flush');
      }
      if (failure === (isDirectory ? 'directory' : 'file')) {
        throw Object.assign(
          new Error('Simulated receipt persistence failure.'),
          {
            code: 'EIO',
          },
        );
      }
      fsyncSync(descriptor);
    },
    /** @param {number} descriptor */
    closeSync: (descriptor) => {
      closeSync(descriptor);
      descriptors.delete(descriptor);
    },
    /**
     * @param {import('node:fs').PathLike} source
     * @param {import('node:fs').PathLike} destination
     */
    renameSync: (source, destination) => {
      expect(events).toEqual(['file-flush']);
      events.push('publish');
      renameSync(source, destination);
    },
  };
  return {
    directory,
    receipt,
    events,
    descriptors,
    publish: () =>
      publishLiveDeploymentReceipt(directory, 'run.json', AFTER, io),
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('durable live deployment receipts', () => {
  test('publishes durable replacement bytes and flushes the containing directory before returning', () => {
    const setup = fixture();
    setup.publish();
    expect(setup.events).toEqual(['file-flush', 'publish', 'directory-flush']);
    expect(JSON.parse(readFileSync(setup.receipt, 'utf8'))).toEqual(AFTER);
    expect(statSync(setup.receipt).mode & 0o077).toBe(0);
    expect(setup.descriptors.size).toBe(0);
  });

  test('a failed file flush leaves the previous visible authority unchanged and releases its descriptor', () => {
    const setup = fixture('file');
    expect(setup.publish).toThrow('Simulated receipt persistence failure.');
    expect(setup.events).toEqual(['file-flush']);
    expect(JSON.parse(readFileSync(setup.receipt, 'utf8'))).toEqual(BEFORE);
    expect(setup.descriptors.size).toBe(0);
  });

  test('a failed directory flush reports failure even when replacement bytes are already visible', () => {
    const setup = fixture('directory');
    expect(setup.publish).toThrow('Simulated receipt persistence failure.');
    expect(setup.events).toEqual(['file-flush', 'publish', 'directory-flush']);
    expect(JSON.parse(readFileSync(setup.receipt, 'utf8'))).toEqual(AFTER);
    expect(setup.descriptors.size).toBe(0);
  });
});
