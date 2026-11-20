import {
  chownSync,
  closeSync,
  constants as fsConstants,
  fchownSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';

/**
 * A native LMDB open and close by one process while another process writes the
 * same environment can lose or corrupt the writer's transactions (lmdb-js
 * #370). A long-lived reader is safe; open/close churn beside a writer is not.
 * So every Wharfie process that opens a resident store natively holds this
 * readers-writer lock for the whole native lifetime of its environment:
 * shared for a read-only environment, exclusive for a writable one.
 *
 * The lock is a SQLite (POSIX fcntl) lock on an otherwise unused file next to
 * LMDB's own lock.mdb. The kernel releases it when its process exits, however
 * it exits, so there is no stale lock to recover. Acquisition never blocks;
 * callers that wait retry with their own deadline.
 */

/** Lock file in the LMDB directory. Never written; only locked. */
export const LMDB_HOLDER_LOCK_FILE = 'wharfie-holder.lock';
/** Informational record of the current exclusive holder, for refusals. */
export const LMDB_HOLDER_RECORD_FILE = 'wharfie-holder.json';

const SQLITE_BUSY = 5;
const MAX_COMMAND_WORDS = 2;
const COMMAND_WORD = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * Another process holds a local store in a conflicting mode.
 */
export class LocalStoreBusyError extends Error {
  /**
   * @param {string} message - Safe operator-facing diagnostic.
   * @param {{holder?: LmdbHolderRecord, readers?: boolean}} [options] - Who holds it.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'LocalStoreBusyError';
    this.code = 'local-store-busy';
    if (options.holder !== undefined) this.holder = options.holder;
    this.readers = options.readers === true;
  }
}

/**
 * The store's holder lock could not be taken for a reason other than another
 * holder: a lock file this user cannot open, a filesystem without POSIX
 * locks, or a Node without its built-in SQLite. Opens fail closed.
 */
export class LocalStoreLockError extends Error {
  /**
   * @param {string} message - Safe operator-facing diagnostic.
   * @param {{cause?: unknown}} [options] - Underlying error.
   */
  constructor(message, options = {}) {
    super(message);
    this.name = 'LocalStoreLockError';
    this.code = 'local-store-lock';
    if (options.cause !== undefined) this.cause = options.cause;
  }
}

/**
 * A wait for a store's holder was abandoned because its caller was told to
 * stop. Nothing was opened.
 */
export class LocalStoreWaitAbortedError extends Error {
  /** @param {unknown} [cause] - The abort reason. */
  constructor(cause) {
    super(
      'Stopped waiting for this local store because the process was asked to stop; it did not open the store.',
    );
    this.name = 'LocalStoreWaitAbortedError';
    this.code = 'local-store-wait-aborted';
    if (cause !== undefined) this.cause = cause;
  }
}

/**
 * Wait between attempts to take a store, ending early when told to stop.
 * @param {number} milliseconds - Retry interval.
 * @param {AbortSignal | undefined} signal - Caller's stop signal.
 * @returns {Promise<void>} - Resolves after the interval.
 * @throws {LocalStoreWaitAbortedError} - When the signal aborts first.
 */
export async function waitForLocalStore(milliseconds, signal) {
  if (signal?.aborted) throw new LocalStoreWaitAbortedError(signal.reason);
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LocalStoreWaitAbortedError(signal?.reason));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(undefined);
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * @typedef {{pid: number, startedAt: number, command: string}} LmdbHolderRecord
 */

/** @type {any} */
let sqlite;

/**
 * Load node:sqlite once. It is built into every supported Node binary,
 * including the one a SEA embeds. Its one-time experimental-feature warning
 * would otherwise appear on every Wharfie command's stderr.
 * @returns {any} - The node:sqlite module.
 */
function loadSqlite() {
  if (sqlite) return sqlite;
  const emitWarning = process.emitWarning;
  process.emitWarning = /** @type {typeof process.emitWarning} */ (
    (warning, ...rest) => {
      const type =
        typeof rest[0] === 'string'
          ? rest[0]
          : /** @type {any} */ (rest[0])?.type;
      if (type === 'ExperimentalWarning' && /SQLite/.test(String(warning))) {
        return;
      }
      return Reflect.apply(emitWarning, process, [warning, ...rest]);
    }
  );
  try {
    sqlite = process.getBuiltinModule('node:sqlite');
  } finally {
    process.emitWarning = emitWarning;
  }
  if (!sqlite?.DatabaseSync) {
    sqlite = undefined;
    throw new LocalStoreLockError(
      "Wharfie needs Node's built-in SQLite module (node:sqlite) to lock its local stores, and this Node process does not provide it. It was probably started with --no-experimental-sqlite (check NODE_OPTIONS) or built without SQLite; remove that option or use an official Node 24 build. No store was opened.",
    );
  }
  return sqlite;
}

/**
 * Name this process for another process's refusal: its program and up to two
 * subcommand words (for example `hello wharfie ledger-service`). Arguments
 * that are not plain command words, such as paths, JSON, or values, are left
 * out so the record never carries operator data.
 * @returns {string} - A short, secret-free description of this process.
 */
function describeCommand() {
  const program = basename(process.argv[1] || process.execPath);
  const words = process.argv
    .slice(2)
    .filter((word) => COMMAND_WORD.test(word))
    .slice(0, MAX_COMMAND_WORDS);
  return [program, ...words].join(' ');
}

/**
 * @param {unknown} error - Candidate SQLite error.
 * @returns {boolean} - Whether the lock is held in a conflicting mode.
 */
function isBusy(error) {
  return (
    !!error &&
    typeof error === 'object' &&
    /** @type {{errcode?: unknown}} */ (error).errcode === SQLITE_BUSY
  );
}

/**
 * Create the lock file privately, refusing a symbolic link.
 *
 * A new file is given to the owner of the LMDB directory, which is the
 * store's owner. That keeps a root (sudo) open of a user's store from leaving
 * behind a root-owned lock file the user can no longer open, and matches the
 * store's own files: data.mdb and lock.mdb already exist when anyone but the
 * owner opens the store, so such an open never changes who owns them. A user
 * who cannot hand the file over is refused instead.
 *
 * This must never open and close an existing lock file: POSIX drops every
 * fcntl lock a process holds on a file when that process closes any
 * descriptor of it, so doing that in a holder would silently release the
 * holder's lock. O_EXCL fails with EEXIST without opening a descriptor, and
 * the existing file is then only lstat'ed.
 * @param {string} file - Lock file path.
 * @param {string} dbRoot - LMDB directory.
 * @returns {void}
 */
function createPrivateLockFile(file, dbRoot) {
  let descriptor;
  try {
    descriptor = openSync(
      file,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST')
      throw error;
    const stats = lstatSync(file);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new LocalStoreLockError(
        `The local store lock ${file} must be a regular file, not a symbolic link or anything else. Remove it while no Wharfie process uses this store.`,
      );
    }
    return;
  }
  try {
    const owner = statSync(dbRoot);
    if (process.geteuid?.() !== owner.uid) {
      try {
        fchownSync(descriptor, owner.uid, owner.gid);
      } catch (cause) {
        closeSync(descriptor);
        descriptor = undefined;
        unlinkSync(file);
        throw new LocalStoreLockError(
          `This local store belongs to uid ${owner.uid}, and this process runs as uid ${process.geteuid?.()}; it cannot create the store's lock file ${file} for that owner. Run Wharfie as the store's owner.`,
          { cause },
        );
      }
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * Explain a lock failure that is not another holder, with what an operator
 * can check and do.
 * @param {string} file - Lock file path.
 * @param {string} dbRoot - LMDB directory.
 * @param {unknown} cause - SQLite or filesystem error.
 * @returns {LocalStoreLockError} - Fail-closed error.
 */
function lockFailure(file, dbRoot, cause) {
  const describe = (/** @type {string} */ path) => {
    try {
      const stats = lstatSync(path);
      return `uid ${stats.uid}, mode ${(stats.mode & 0o777).toString(8).padStart(4, '0')}`;
    } catch (error) {
      return /** @type {NodeJS.ErrnoException} */ (error).code || 'unreadable';
    }
  };
  const detail =
    cause instanceof Error ? cause.message : String(cause ?? 'unknown error');
  return new LocalStoreLockError(
    `Could not lock this local store through ${file} (${describe(file)}; the store directory is ${describe(dbRoot)}; this process runs as uid ${process.geteuid?.()}): ${detail}. The lock file must be a regular file owned by the store's owner and writable by it, on a filesystem with POSIX (fcntl) locks. Fix its owner (chown) or remove it while no Wharfie process uses this store, and run Wharfie as the store's owner. No store was opened.`,
    { cause },
  );
}

/**
 * @param {number} pid - Candidate process.
 * @returns {boolean} - Whether a process with that pid exists.
 */
function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return /** @type {NodeJS.ErrnoException} */ (error).code === 'EPERM';
  }
}

/**
 * Read the record the current exclusive holder wrote. It only words refusals:
 * the lock alone decides who may open the store.
 * @param {string} dbRoot - LMDB directory.
 * @returns {LmdbHolderRecord | undefined} - Last exclusive holder, if recorded.
 */
export function readLmdbHolderRecord(dbRoot) {
  try {
    const record = JSON.parse(
      readFileSync(join(dbRoot, LMDB_HOLDER_RECORD_FILE), 'utf8'),
    );
    if (
      Number.isSafeInteger(record?.pid) &&
      Number.isFinite(record?.startedAt) &&
      typeof record?.command === 'string'
    ) {
      return {
        pid: record.pid,
        startedAt: record.startedAt,
        command: record.command,
      };
    }
  } catch {
    // Missing or partial: the refusal says only that the store is held.
  }
  return undefined;
}

/**
 * @param {LmdbHolderRecord | undefined} holder - Recorded holder.
 * @returns {string} - Operator-facing description of that holder.
 */
export function describeLmdbHolder(holder) {
  if (!holder) return 'another Wharfie process';
  const since = new Date(holder.startedAt).toISOString();
  if (!processExists(holder.pid)) {
    return `another Wharfie process (the last recorded holder, pid ${holder.pid} '${holder.command}', has exited)`;
  }
  return `pid ${holder.pid} ('${holder.command}', holding it since ${since})`;
}

/**
 * @param {string} dbRoot - LMDB directory.
 * @returns {void}
 */
function writeHolderRecord(dbRoot) {
  const file = join(dbRoot, LMDB_HOLDER_RECORD_FILE);
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(
      temporary,
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        command: describeCommand(),
      }),
      { mode: 0o600 },
    );
    // Keep the record readable by the store's owner, as the lock file is.
    const owner = statSync(dbRoot);
    if (process.geteuid?.() !== owner.uid) {
      chownSync(temporary, owner.uid, owner.gid);
    }
    renameSync(temporary, file);
  } catch {
    // Informational only; the lock itself is already held.
  }
}

/**
 * @param {any} database - Open lock connection.
 * @param {boolean} exclusive - Requested mode.
 * @returns {void} - Holds the lock until the connection closes.
 */
function lock(database, exclusive) {
  if (exclusive) {
    database.exec('BEGIN EXCLUSIVE');
    return;
  }
  database.exec('BEGIN');
  try {
    // A deferred transaction takes its shared lock on its first read.
    database.prepare('SELECT count(*) FROM sqlite_master').get();
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Nothing was locked.
    }
    throw error;
  }
}

/**
 * Take a store's holder lock without waiting.
 * @param {string} dbRoot - Canonical LMDB directory; must exist.
 * @param {{exclusive: boolean, readOnly: boolean}} options - Exclusive for a writable environment; whether a missing lock file may be tolerated on a read-only volume.
 * @returns {{release: () => void} | undefined} - Held lock, or undefined where no lock applies.
 * @throws {LocalStoreBusyError} - When another process holds a conflicting lock.
 */
export function tryAcquireLmdbHolderLock(dbRoot, options) {
  if (process.platform === 'win32') return undefined;
  const file = join(dbRoot, LMDB_HOLDER_LOCK_FILE);
  try {
    createPrivateLockFile(file, dbRoot);
  } catch (error) {
    // A read-only volume on a read-only filesystem has no writer to protect.
    if (
      options.readOnly &&
      ['EACCES', 'EROFS'].includes(
        /** @type {NodeJS.ErrnoException} */ (error).code || '',
      )
    ) {
      return undefined;
    }
    if (error instanceof LocalStoreLockError) throw error;
    throw lockFailure(file, dbRoot, error);
  }
  const { DatabaseSync } = loadSqlite();
  let database;
  try {
    database = new DatabaseSync(file, { timeout: 0 });
  } catch (error) {
    throw lockFailure(file, dbRoot, error);
  }
  try {
    database.exec('PRAGMA journal_mode=OFF');
    lock(database, options.exclusive);
  } catch (error) {
    database.close();
    if (!isBusy(error)) throw lockFailure(file, dbRoot, error);
    throw busyError(dbRoot, options.exclusive);
  }
  if (options.exclusive) writeHolderRecord(dbRoot);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      database.close();
    },
  };
}

/**
 * Explain a conflict: an exclusive holder (named from its record), or only
 * shared readers that opened the store directly.
 * @param {string} dbRoot - LMDB directory.
 * @param {boolean} exclusive - The mode that was refused.
 * @returns {LocalStoreBusyError} - Refusal.
 */
function busyError(dbRoot, exclusive) {
  let readersOnly = false;
  if (exclusive) {
    // A shared probe succeeds only if no process holds the lock exclusively.
    const { DatabaseSync } = loadSqlite();
    const probe = new DatabaseSync(join(dbRoot, LMDB_HOLDER_LOCK_FILE), {
      timeout: 0,
    });
    try {
      probe.exec('PRAGMA journal_mode=OFF');
      lock(probe, false);
      readersOnly = true;
    } catch {
      // Held exclusively.
    } finally {
      probe.close();
    }
  }
  if (readersOnly) {
    // Readers leave no record; the operating system can still name them.
    return new LocalStoreBusyError(
      `Other processes are reading this local store directly (no Wharfie process serves it), so it cannot be opened for writing until they finish. To see which processes they are, run: lsof ${join(dbRoot, LMDB_HOLDER_LOCK_FILE)}`,
      { readers: true },
    );
  }
  const holder = readLmdbHolderRecord(dbRoot);
  return new LocalStoreBusyError(
    `This local store is held by ${describeLmdbHolder(holder)}; it cannot be opened ${exclusive ? 'for writing' : 'for reading'} until that process releases it.`,
    holder === undefined ? {} : { holder },
  );
}

export default {
  LMDB_HOLDER_LOCK_FILE,
  LMDB_HOLDER_RECORD_FILE,
  LocalStoreBusyError,
  LocalStoreLockError,
  LocalStoreWaitAbortedError,
  waitForLocalStore,
  describeLmdbHolder,
  readLmdbHolderRecord,
  tryAcquireLmdbHolderLock,
};
