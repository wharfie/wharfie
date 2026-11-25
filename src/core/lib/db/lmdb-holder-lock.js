import { randomBytes } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

/*
 * A store is opened only by the user who owns its LMDB directory. Before it
 * touches anything in that directory, this module opens the directory itself
 * (refusing a symbolic link), checks its owner on that descriptor, and
 * refuses any other user, root included. So it never creates, writes,
 * renames, unlinks or changes the owner of anything in a store that belongs
 * to someone else.
 */

/** Lock file in the LMDB directory. Never written; only locked. */
export const LMDB_HOLDER_LOCK_FILE = 'wharfie-holder.lock';
/** Informational record of the current exclusive holder, for refusals. */
export const LMDB_HOLDER_RECORD_FILE = 'wharfie-holder.json';

const SQLITE_BUSY = 5;
const MAX_HOLDER_RECORD_BYTES = 1024;
const RECORDED_COMMAND = /^[A-Za-z0-9._-]{1,160}( [a-z][a-z0-9-]{0,39}){0,2}$/;
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
  /**
   * @param {unknown} [cause] - The abort reason.
   * @param {string} [waitingFor] - What the wait was for.
   */
  constructor(cause, waitingFor) {
    super(
      `Stopped waiting for this local store because the process was asked to stop; it did not open the store.${waitingFor ? ` It was waiting because: ${waitingFor}` : ''}`,
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
 * @param {string} [waitingFor] - What the wait is for, for the abort error.
 * @returns {Promise<void>} - Resolves after the interval.
 * @throws {LocalStoreWaitAbortedError} - When the signal aborts first.
 */
export async function waitForLocalStore(milliseconds, signal, waitingFor) {
  if (signal?.aborted) {
    throw new LocalStoreWaitAbortedError(signal.reason, waitingFor);
  }
  await new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new LocalStoreWaitAbortedError(signal?.reason, waitingFor));
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
 * The owner of the store's LMDB directory, read from a descriptor of that
 * directory opened without following a link, so the answer is about the
 * directory itself and not whatever a path later resolves to.
 * @param {string} dbRoot - LMDB directory.
 * @returns {number} - Owner uid.
 */
function directoryOwnerUid(dbRoot) {
  let descriptor;
  try {
    descriptor = openSync(
      dbRoot,
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
  } catch (error) {
    const code = /** @type {NodeJS.ErrnoException} */ (error).code;
    if (code === 'ELOOP' || code === 'ENOTDIR') {
      throw new LocalStoreLockError(
        `The local store directory ${dbRoot} must be a directory, not a symbolic link or anything else.`,
        { cause: error },
      );
    }
    throw error;
  }
  try {
    return fstatSync(descriptor).uid;
  } finally {
    closeSync(descriptor);
  }
}

/**
 * Refuse a process that does not own the store, before it touches anything
 * in it. A directory this user cannot even open (a 0700 directory of another
 * user) is judged by its lstat owner instead: it is refused either way.
 * @param {string} dbRoot - LMDB directory.
 * @param {number | undefined} effectiveUid - This process's effective uid.
 * @returns {void}
 */
function assertStoreOwner(dbRoot, effectiveUid) {
  let owner;
  try {
    owner = directoryOwnerUid(dbRoot);
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EACCES') {
      throw error;
    }
    const stats = lstatSync(dbRoot);
    if (!stats.isDirectory() || stats.uid === effectiveUid) throw error;
    owner = stats.uid;
  }
  if (effectiveUid === owner) return;
  if (owner === 0) {
    // Running as root is never the fix: root left this directory behind.
    throw new LocalStoreLockError(
      `This local store's directory ${dbRoot} belongs to root (uid 0): a command run as root (for example sudo wharfie ...) created it, and this process runs as uid ${effectiveUid}. Do not run Wharfie as root for this store. If you own the directory that contains it, move root's directory aside (mv ${dbRoot} ${dbRoot}.root-owned) or remove it if it holds nothing you need, then run the command again as yourself. Nothing in the store was changed.`,
    );
  }
  throw new LocalStoreLockError(
    `This local store belongs to uid ${owner}, and this process runs as uid ${effectiveUid}. A store is opened only by the user who owns it: run the command as that user (for example: sudo -u '#${owner}' <command>). Nothing in the store was changed.`,
  );
}

/**
 * Refuse to create a store inside another user's directory tree. Called
 * before a writable open creates a missing LMDB directory (and any missing
 * parents): the nearest directory that already exists on the way up decides.
 * It may belong to this process's user, or to root (only root can change a
 * root-owned directory, so creating there hands no one else anything, and an
 * ordinary user may keep a store under, say, /tmp). Any other owner is
 * refused, so in particular root never creates a store in a user's tree.
 * A link on the way is judged by both its own owner and its target's.
 * @param {string} dbRoot - LMDB directory a writable open would create.
 * @param {{effectiveUid?: number}} [options] - For tests only: the effective uid to act as.
 * @returns {void}
 * @throws {LocalStoreLockError} - When the containing directory belongs to another user.
 */
export function assertMayCreateLocalStore(dbRoot, options = {}) {
  if (process.platform === 'win32') return;
  const effectiveUid = options.effectiveUid ?? process.geteuid?.();
  const allowed = (/** @type {number} */ uid) =>
    uid === effectiveUid || uid === 0;
  for (let candidate = dbRoot; ; candidate = dirname(candidate)) {
    let stats;
    try {
      stats = lstatSync(candidate);
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (code === 'ENOENT' && dirname(candidate) !== candidate) continue;
      throw error;
    }
    // An existing store is judged by the lock itself (assertStoreOwner).
    if (candidate === dbRoot) return;
    const owners = [stats.uid];
    if (stats.isSymbolicLink()) {
      const target = statSync(candidate);
      if (!target.isDirectory()) break;
      owners.push(target.uid);
    } else if (!stats.isDirectory()) {
      break;
    }
    const foreign = owners.find((uid) => !allowed(uid));
    if (foreign === undefined) return;
    throw new LocalStoreLockError(
      `This local store does not exist yet, and the directory it would be created in, ${candidate}, belongs to uid ${foreign} while this process runs as uid ${effectiveUid}. A store is created and opened only by the user who owns its directory: run the command as that user (for example: sudo -u '#${foreign}' <command>). Nothing was created.`,
    );
  }
  // Not a directory: let the creation fail with its own error.
}

/**
 * Create the lock file privately, refusing a symbolic link. Called only by
 * the store's owner.
 *
 * This must never open and close an existing lock file: POSIX drops every
 * fcntl lock a process holds on a file when that process closes any
 * descriptor of it, so doing that in a holder would silently release the
 * holder's lock. O_EXCL fails with EEXIST without opening a descriptor, and
 * the existing file is then only lstat'ed.
 * @param {string} file - Lock file path.
 * @returns {void}
 */
function createPrivateLockFile(file) {
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
  closeSync(descriptor);
}

/**
 * Open the lock file through SQLite. `mode=rw` never creates a file: the
 * file was created, or found to be a regular file, just before.
 * @param {string} file - Lock file path.
 * @returns {any} - Open SQLite connection.
 */
function openLockConnection(file) {
  const { DatabaseSync } = loadSqlite();
  const url = pathToFileURL(file);
  url.searchParams.set('mode', 'rw');
  return new DatabaseSync(url, { timeout: 0 });
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
 * the lock alone decides who may open the store. The file is untrusted: it
 * is read only if it is a small regular file owned by the store directory's
 * owner, opened without following a link (or blocking on a FIFO), and only
 * its validated fields are returned.
 * @param {string} dbRoot - LMDB directory.
 * @returns {LmdbHolderRecord | undefined} - Last exclusive holder, if recorded.
 */
export function readLmdbHolderRecord(dbRoot) {
  let descriptor;
  try {
    const ownerUid = directoryOwnerUid(dbRoot);
    descriptor = openSync(
      join(dbRoot, LMDB_HOLDER_RECORD_FILE),
      fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
    );
    const stats = fstatSync(descriptor);
    if (
      !stats.isFile() ||
      stats.uid !== ownerUid ||
      stats.size > MAX_HOLDER_RECORD_BYTES
    ) {
      return undefined;
    }
    const buffer = Buffer.alloc(MAX_HOLDER_RECORD_BYTES);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    const record = JSON.parse(buffer.subarray(0, length).toString('utf8'));
    if (
      Number.isSafeInteger(record?.pid) &&
      record.pid > 0 &&
      Number.isSafeInteger(record?.startedAt) &&
      record.startedAt > 0 &&
      typeof record?.command === 'string' &&
      RECORDED_COMMAND.test(record.command)
    ) {
      return {
        pid: record.pid,
        startedAt: record.startedAt,
        command: record.command,
      };
    }
  } catch {
    // Missing, foreign, or malformed: the refusal says less, never more.
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return undefined;
}

/**
 * @param {LmdbHolderRecord | undefined} holder - Recorded holder.
 * @returns {string} - Operator-facing description of that holder.
 */
export function describeLmdbHolder(holder) {
  if (!holder) {
    return 'another process (its holder record is missing or unreadable)';
  }
  const since = new Date(holder.startedAt).toISOString();
  if (!processExists(holder.pid)) {
    return `another Wharfie process (the last recorded holder, pid ${holder.pid} '${holder.command}', has exited)`;
  }
  return `pid ${holder.pid} ('${holder.command}', holding it since ${since})`;
}

/**
 * Record this process as the store's exclusive holder, so refusals can name
 * it. Only the store's owner gets here. The record goes through a new,
 * exclusively created file under an unpredictable name, written through its
 * descriptor and renamed into place.
 * @param {string} dbRoot - LMDB directory.
 * @returns {void}
 */
function writeHolderRecord(dbRoot) {
  const file = join(dbRoot, LMDB_HOLDER_RECORD_FILE);
  const temporary = join(
    dbRoot,
    `.${LMDB_HOLDER_RECORD_FILE}.${randomBytes(12).toString('hex')}.tmp`,
  );
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY |
        fsConstants.O_CREAT |
        fsConstants.O_EXCL |
        fsConstants.O_NOFOLLOW,
      0o600,
    );
    writeSync(
      descriptor,
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        command: describeCommand(),
      }),
    );
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, file);
  } catch {
    // Informational only; the lock itself is already held.
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporary);
    } catch {
      // Never created, or already renamed.
    }
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
 * @param {{exclusive: boolean, readOnly: boolean, effectiveUid?: number}} options - Exclusive for a writable environment; whether a missing lock file may be tolerated on a read-only volume; and, for tests only, the effective uid to act as (default: this process's).
 * @throws {LocalStoreLockError} - When this process does not own the store.
 * @returns {{release: () => void} | undefined} - Held lock, or undefined where no lock applies.
 * @throws {LocalStoreBusyError} - When another process holds a conflicting lock.
 */
export function tryAcquireLmdbHolderLock(dbRoot, options) {
  if (process.platform === 'win32') return undefined;
  const file = join(dbRoot, LMDB_HOLDER_LOCK_FILE);
  // Before anything else in the directory: refuse a store of another user.
  try {
    assertStoreOwner(dbRoot, options.effectiveUid ?? process.geteuid?.());
  } catch (error) {
    if (error instanceof LocalStoreLockError) throw error;
    throw lockFailure(file, dbRoot, error);
  }
  try {
    createPrivateLockFile(file);
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
  let database;
  try {
    database = openLockConnection(file);
  } catch (error) {
    if (error instanceof LocalStoreLockError) throw error;
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
    try {
      const probe = openLockConnection(join(dbRoot, LMDB_HOLDER_LOCK_FILE));
      try {
        probe.exec('PRAGMA journal_mode=OFF');
        lock(probe, false);
        readersOnly = true;
      } catch {
        // Held exclusively.
      } finally {
        probe.close();
      }
    } catch {
      // The lock file changed underneath; say only that the store is held.
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
  assertMayCreateLocalStore,
  waitForLocalStore,
  describeLmdbHolder,
  readLmdbHolderRecord,
  tryAcquireLmdbHolderLock,
};
