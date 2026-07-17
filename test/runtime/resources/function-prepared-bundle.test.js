/* eslint-env jest */
/* eslint-disable jsdoc/require-jsdoc */

import { afterEach, describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';

import worker from '../../../src/core/lib/code-execution/worker.js';
import WharfieFunction from '../../../src/core/resources/builds/function.js';

/** @param {string | Buffer | Uint8Array} value */
function digest(value) {
  return {
    algorithm: /** @type {const} */ ('sha256'),
    value: createHash('sha256').update(value).digest('base64url'),
  };
}

afterEach(async () => {
  await worker._clearSandboxCache();
});

describe('prepared in-memory function bundles', () => {
  it('executes without reading a SEA asset and releases its worker', async () => {
    const name = `prepared-source-${Date.now()}`;
    const codeString = `
      globalThis[Symbol.for(${JSON.stringify(name)})] = async (event) => ({
        source: 'prepared',
        value: event.value,
      });
    `;

    await expect(
      WharfieFunction.runPreparedBundle(name, { codeString }, { value: 42 }),
    ).resolves.toEqual({ source: 'prepared', value: 42 });
  });

  it('rejects archive drift before starting prepared code', async () => {
    const externalsTar = Buffer.from('not the expected archive');
    await expect(
      WharfieFunction.runPreparedBundle(
        'prepared-archive-drift',
        {
          codeString:
            "globalThis[Symbol.for('prepared-archive-drift')] = () => true;",
          externalsTar,
          externalArchiveDigest: digest('different archive'),
        },
        {},
      ),
    ).rejects.toThrow(/does not match its embedded build digest/i);
  });

  it('refuses direct source invocation with ambient external packages', async () => {
    const fn = new WharfieFunction({
      name: 'ambient-external-rejected',
      entrypoint: { path: '/path/that/must/not/be/imported.js' },
      properties: {
        external: [{ name: 'example-package', version: '1.2.3' }],
      },
    });

    await expect(fn.fn({}, {})).rejects.toThrow(
      /must run through a prepared application revision/i,
    );
  });
});
