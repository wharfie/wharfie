import { EventEmitter } from 'node:events';
import { promises as fsp } from 'node:fs';

import {
  AwsSingleNodeHostActivationPersistenceCorruptError,
  createAwsSingleNodeHostActivationPersistence,
} from '../../../src/core/runtime/deployment-aws-host-activation-persistence.js';
import { acquireLinuxAbstractOperationLock } from '../../../src/core/runtime/linux-abstract-operation-lock.js';

/**
 * The bounded FIFO probe runs on macOS as well as Linux, so it uses the same
 * deterministic abstract-address model as the parent Jest process.
 * @returns {typeof import('node:net').createServer}
 */
function createFakeServerFactory() {
  /** @type {Set<string>} */
  const addresses = new Set();

  class FakeServer extends EventEmitter {
    constructor() {
      super();
      this.address = null;
      this.listening = false;
    }

    /** @param {string} address @returns {FakeServer} */
    listen(address) {
      queueMicrotask(() => {
        if (addresses.has(address)) {
          const error = new Error('simulated address collision');
          Object.defineProperty(error, 'code', { value: 'EADDRINUSE' });
          this.emit('error', error);
          return;
        }
        addresses.add(address);
        this.address = address;
        this.listening = true;
        this.emit('listening');
      });
      return this;
    }

    /** @param {(error?: Error) => void} [callback] @returns {FakeServer} */
    close(callback) {
      if (!this.listening || this.address === null) {
        const error = new Error('simulated server is not running');
        Object.defineProperty(error, 'code', {
          value: 'ERR_SERVER_NOT_RUNNING',
        });
        throw error;
      }
      addresses.delete(this.address);
      this.address = null;
      this.listening = false;
      queueMicrotask(() => callback?.());
      return this;
    }

    /** @returns {FakeServer} */
    unref() {
      return this;
    }
  }

  return /** @type {typeof import('node:net').createServer} */ (
    /** @type {unknown} */ (() => new FakeServer())
  );
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'probe-corrupt-persistence') {
    const [deploymentInstanceId, stateDirectory, expectedUidText] = args;
    let token = 0;
    try {
      const persistence = await createAwsSingleNodeHostActivationPersistence({
        deploymentInstanceId,
        stateDirectory,
        expectedUid: Number(expectedUidText),
        fsOps: fsp,
        createServer: createFakeServerFactory(),
        createToken() {
          token += 1;
          return `child-token-${token}`;
        },
        retainedSupersededStates: 8,
      });
      await persistence.close();
      throw new Error('Corrupt persistence unexpectedly opened.');
    } catch (error) {
      if (error instanceof AwsSingleNodeHostActivationPersistenceCorruptError) {
        process.stdout.write(`${error.code}\n`);
        return;
      }
      throw error;
    }
  }
  if (mode === 'hold-real-lock') {
    const [domain, scope] = args;
    await acquireLinuxAbstractOperationLock({ domain, scope });
    process.stdout.write('locked\n');
    setInterval(() => undefined, 60_000);
    return;
  }
  throw new Error('Unsupported persistence child mode.');
}

await main().catch((error) => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
