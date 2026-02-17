import { execFile } from 'node:child_process';
import { access, readFile, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';

/**
 * Promise wrapper around execFile.
 * @param {string} file - Executable name (e.g., "ssh-keygen").
 * @param {string[]} args - Arguments passed to the executable.
 * @returns {Promise<{ stdout: string, stderr: string }>} -
 */
function execp(file, args) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) return reject(err);
        resolve({ stdout, stderr });
      },
    );
  });
}

/**
 * SSH key generation via system ssh-keygen.
 * Requires OpenSSH client to be available on PATH.
 */
class SSHKeygen {
  /**
   * Check whether `ssh-keygen` is available on PATH.
   * @returns {Promise<boolean>} - Result.
   */
  static async isAvailable() {
    try {
      await execp('ssh-keygen', ['-V']);
      return true;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT')
        return false;
      return true;
    }
  }

  /**
   * Generate an ed25519 keypair using ssh-keygen and write to disk.
   * @param {string} outPrefix - Path prefix for the key files (e.g., "/home/me/.ssh/id_ed25519").
   * @param {string} [comment='node@host'] - Public key comment.
   * @param {{ overwrite?: boolean, passphrase?: string, rounds?: number }} [opts] - Options.
   * @returns {Promise<{ publicKey: string, fingerprint: string }>} -
   */
  static async generate(outPrefix, comment = 'node@host', opts) {
    const {
      overwrite = false,
      passphrase = '',
      rounds: roundsMaybe,
    } = opts ?? {};
    const rounds =
      roundsMaybe && Number.isInteger(roundsMaybe) && roundsMaybe > 0
        ? roundsMaybe
        : 64;

    if (!overwrite) {
      await Promise.all([
        SSHKeygen.assertNotExists(outPrefix),
        SSHKeygen.assertNotExists(`${outPrefix}.pub`),
      ]);
    }

    await execp('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-C',
      comment,
      '-f',
      outPrefix,
      '-N',
      passphrase,
      '-a',
      String(rounds),
    ]);

    const publicKey = await SSHKeygen.readPublicKey(outPrefix);
    const fingerprint = await SSHKeygen.fingerprint(`${outPrefix}.pub`);
    return { publicKey, fingerprint };
  }

  /**
   * Read OpenSSH public key from `<outPrefix>.pub`.
   * @param {string} outPrefix - Path prefix used when generating the key.
   * @returns {Promise<string>} - Result.
   */
  static async readPublicKey(outPrefix) {
    const contents = await readFile(`${outPrefix}.pub`, 'utf8');
    return contents.trim();
  }

  /**
   * Compute the SHA256 fingerprint for a public key file.
   * @param {string} pubKeyPath - Path to the `.pub` file.
   * @returns {Promise<string>} Fingerprint like "SHA256:abcdef...".
   */
  static async fingerprint(pubKeyPath) {
    const { stdout } = await execp('ssh-keygen', ['-lf', pubKeyPath]);
    const parts = stdout.trim().split(/\s+/);
    if (parts.length < 2 || !parts[1].startsWith('SHA256:')) {
      throw new Error(`Unexpected ssh-keygen -lf output: ${stdout}`);
    }
    return parts[1];
  }

  /**
   * Remove generated keypair files if they exist.
   * @param {string} outPrefix - Path prefix used when generating.
   * @returns {Promise<void>} - Result.
   */
  static async remove(outPrefix) {
    await Promise.allSettled([unlink(outPrefix), unlink(`${outPrefix}.pub`)]);
  }

  /**
   * Check if a file exists.
   * @param {string} path - Filesystem path.
   * @returns {Promise<boolean>} - Result.
   */
  static async exists(path) {
    try {
      await access(path, constants.F_OK);
      return true;
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT')
        return false;
      throw err;
    }
  }

  /**
   * Ensure a file does not already exist (unless overwriting).
   * @param {string} path - Filesystem path to check.
   * @returns {Promise<void>} - Result.
   */
  static async assertNotExists(path) {
    try {
      await access(path, constants.F_OK);
      throw new Error(`Refusing to overwrite existing file: ${path}`);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT')
        return;
      throw err;
    }
  }
}

export default SSHKeygen;
