const child_process = require('node:child_process');

/**
 * Run a shell command and throw on error.
 * @param {string} cmd - The command to execute.
 * @param {string[]} args - Arguments for the command.
 * @returns {Promise<void>}
 */
async function runCmd(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = child_process.spawn(cmd, args, { stdio: 'inherit' });
    proc.on('exit', (code, signal) => {
      if (code !== null) {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Command failed: ${cmd} ${args.join(' ')}, exit code ${code}`
            )
          );
      } else {
        reject(new Error(`Command terminated with signal ${signal}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Run a shell command and throw on error.
 * @param {string} filepath - The command to execute.
 * @param {string[]} [args] - Arguments for the command.
 * @param {child_process.ExecFileOptions} [options] - Arguments for the command.
 * @returns {Promise<void>}
 */
async function execFile(filepath, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = child_process.execFile(
      filepath,
      args,
      options,
      (error, stdout, stderr) => {
        if (error) {
          console.error('Error:', error);
          console.error('stderr:', stderr);
          return;
        }

        console.log('stdout:', stdout);
      }
    );
    proc.on('exit', (code, signal) => {
      if (code !== null) {
        if (code === 0) resolve();
        else
          reject(
            new Error(
              `Command failed: ${filepath} ${args.join(' ')}, exit code ${code}`
            )
          );
      } else {
        reject(new Error(`Command terminated with signal ${signal}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

module.exports = {
  runCmd,
  execFile,
  spawnSync: child_process.spawnSync,
};
