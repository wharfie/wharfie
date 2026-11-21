/**
 * Open one of an installed package's local stores natively the way product
 * code does: under its holder lock, so a verifier never opens a store beside
 * a process that writes it, and a resident never starts while a verifier is
 * inside (src/core/lib/db/lmdb-holder-lock.js). A conflict is retried for up
 * to 10 s, like a product open, and then fails the verification loudly.
 *
 * Two exceptions read without the lock, both read-only:
 * - the process holding the store is one the verifier holds paused in the
 *   debugger: it cannot release the lock, and it cannot write while stopped.
 *   Only that holder counts; another paused process does not open this store;
 * - the store has no read host (the application-state store) and a live
 *   holder has it: there is nowhere else to read it, so the open is reported
 *   through `onUnhostedRead` and counted by the caller.
 * @param {{default: (options: Record<string, any>) => Record<string, any>}} adapterModule - Installed LMDB adapter.
 * @param {string} storePath - Store path.
 * @param {boolean} readOnly - Access mode.
 * @param {{isPausedHere: (processId: number) => boolean, unhostedStore?: boolean, onUnhostedRead?: () => void, waitMs?: number}} options - Which processes the caller holds paused, and the unhosted-store exception.
 * @returns {Promise<Record<string, any>>} - Open DB client.
 */
export async function openInstalledStore(
  adapterModule,
  storePath,
  readOnly,
  options,
) {
  const deadline = Date.now() + (options.waitMs ?? 10_000);
  for (;;) {
    try {
      return adapterModule.default({
        path: storePath,
        readOnly,
        holderLock: true,
      });
    } catch (error) {
      if (/** @type {any} */ (error)?.code !== 'local-store-busy') throw error;
      const holderPid = /** @type {any} */ (error).holder?.pid;
      if (
        readOnly &&
        Number.isSafeInteger(holderPid) &&
        options.isPausedHere(holderPid)
      ) {
        return adapterModule.default({ path: storePath, readOnly });
      }
      if (readOnly && options.unhostedStore === true) {
        options.onUnhostedRead?.();
        return adapterModule.default({ path: storePath, readOnly });
      }
      if (Date.now() >= deadline) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export default { openInstalledStore };
