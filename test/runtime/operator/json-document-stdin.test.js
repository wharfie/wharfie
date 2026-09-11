import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { PassThrough } from 'node:stream';

import {
  OPERATOR_JSON_STDIN_TIMEOUT_MILLISECONDS,
  readOperatorJsonObjectStdin,
} from '../../../src/core/runtime/operator/json-document-stdin.js';
import { COORDINATOR_AUTHORITY_INSPECTION_MAX_BYTES } from '../../../src/core/runtime/operator/coordinator-authority-command.js';

const LABEL = 'coordinator authority inspection';

afterEach(() => {
  jest.useRealTimers();
});

/**
 * @param {PassThrough} input - Reader-owned listener target.
 * @returns {void} - Assert only temporary resources were removed.
 */
function expectClean(input) {
  for (const name of ['data', 'end', 'error', 'close']) {
    expect(input.listenerCount(name)).toBe(0);
  }
  expect(input.isPaused()).toBe(true);
  expect(input.destroyed).toBe(false);
}

describe('bounded operator JSON stdin', () => {
  it('waits for EOF and decodes UTF-8 split across chunks', async () => {
    const input = new PassThrough({ autoDestroy: false });
    const bytes = Buffer.from('{"value":"é"}\n');
    const pending = readOperatorJsonObjectStdin(bytes.length, LABEL, { input });
    let finished = false;
    const completed = pending.then(() => {
      finished = true;
    });
    const split = bytes.indexOf(0xc3) + 1;
    input.write(bytes.subarray(0, split));
    input.write(bytes.subarray(split));
    await Promise.resolve();
    expect(finished).toBe(false);
    input.end();
    await expect(pending).resolves.toEqual({ value: 'é' });
    await completed;
    expectClean(input);
  });

  it('accepts exactly the inspection byte bound and clears its timer', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    const input = new PassThrough({ autoDestroy: false });
    const pending = readOperatorJsonObjectStdin(
      COORDINATOR_AUTHORITY_INSPECTION_MAX_BYTES,
      LABEL,
      { input },
    );
    const bytes = Buffer.alloc(
      COORDINATOR_AUTHORITY_INSPECTION_MAX_BYTES,
      0x20,
    );
    bytes.write('{}');
    input.end(bytes);
    await expect(pending).resolves.toEqual({});
    expect(jest.getTimerCount()).toBe(0);
    expectClean(input);
  });

  it('rejects excess bytes before EOF and releases its timer and listeners', async () => {
    jest.useFakeTimers();
    const input = new PassThrough({ autoDestroy: false });
    const pending = readOperatorJsonObjectStdin(4, LABEL, { input });
    input.write(Buffer.from('{}'));
    input.write(Buffer.from('   '));
    await expect(pending).rejects.toThrow('must not exceed 4 bytes');
    expect(jest.getTimerCount()).toBe(0);
    expectClean(input);
  });

  it.each([
    ['empty', Buffer.alloc(0)],
    ['invalid JSON', Buffer.from('{"private":"stdin-secret"')],
    ['multiple documents', Buffer.from('{}{}')],
    ['invalid UTF-8', Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d])],
    ['null', Buffer.from('null')],
    ['array', Buffer.from('[]')],
  ])('rejects %s input without echoing it', async (_name, bytes) => {
    const input = new PassThrough({ autoDestroy: false });
    const pending = readOperatorJsonObjectStdin(1024, LABEL, { input });
    input.end(bytes);
    await expect(pending).rejects.toThrow(/valid UTF-8 JSON|one JSON object/u);
    await expect(pending).rejects.not.toThrow('stdin-secret');
    expectClean(input);
  });

  it('rejects interactive stdin before attaching listeners', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    await expect(
      readOperatorJsonObjectStdin(1024, LABEL, { input }),
    ).rejects.toThrow('noninteractive byte stream');
    expect(input.listenerCount('data')).toBe(0);
    expect(input.readableFlowing).toBe(null);
    input.destroy();
  });

  it('does not allow a decoder to conceal invalid input bytes', async () => {
    const input = new PassThrough();
    input.setEncoding('utf8');
    await expect(
      readOperatorJsonObjectStdin(1024, LABEL, { input }),
    ).rejects.toThrow('unread byte stream');
    expect(input.listenerCount('data')).toBe(0);
    input.destroy();
  });

  it('rejects sender errors without revealing their details', async () => {
    const input = new PassThrough({ autoDestroy: false });
    const pending = readOperatorJsonObjectStdin(1024, LABEL, { input });
    input.emit('error', new Error('stdin-private-error'));
    await expect(pending).rejects.toThrow('stdin could not be read');
    await expect(pending).rejects.not.toThrow('stdin-private-error');
    expectClean(input);
  });

  it('preserves listeners owned by its caller', async () => {
    const input = new PassThrough({ autoDestroy: false });
    const observer = jest.fn();
    input.on('error', observer);
    const pending = readOperatorJsonObjectStdin(1024, LABEL, { input });
    input.end(Buffer.from('{}'));
    await expect(pending).resolves.toEqual({});
    expect(input.listeners('error')).toEqual([observer]);
    input.removeListener('error', observer);
    expectClean(input);
  });

  it('rejects close before EOF', async () => {
    const input = new PassThrough({ autoDestroy: false });
    const pending = readOperatorJsonObjectStdin(1024, LABEL, { input });
    input.emit('close');
    await expect(pending).rejects.toThrow('closed before EOF');
    expectClean(input);
  });

  it('rejects a valid prefix without EOF at the finite default deadline', async () => {
    jest.useFakeTimers();
    const input = new PassThrough({ autoDestroy: false });
    const pending = readOperatorJsonObjectStdin(1024, LABEL, { input });
    input.write(Buffer.from('{}'));
    await Promise.all([
      expect(pending).rejects.toThrow('did not reach EOF before its deadline'),
      jest.advanceTimersByTimeAsync(OPERATOR_JSON_STDIN_TIMEOUT_MILLISECONDS),
    ]);
    expect(jest.getTimerCount()).toBe(0);
    expectClean(input);
  });
});
