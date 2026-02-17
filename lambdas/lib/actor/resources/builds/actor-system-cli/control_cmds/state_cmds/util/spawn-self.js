import fs from 'node:fs';

/**
 * Determine how to spawn a new copy of the current CLI program.
 *
 * - In normal Node execution (`node path/to/script.js ...`), we need:
 * [process.execPath, process.argv[1], ...args]
 * - In SEA execution (`./binary ...`), we need:
 * [process.execPath, ...args]
 * @returns {{ cmd: string, prefixArgs: string[] }} - Result.
 */
export function getSelfSpawnCommand() {
  const cmd = process.execPath;
  const maybeScript = process.argv[1];

  if (
    maybeScript &&
    typeof maybeScript === 'string' &&
    fs.existsSync(maybeScript)
  ) {
    return { cmd, prefixArgs: [maybeScript] };
  }

  return { cmd, prefixArgs: [] };
}
