const path = require('node:path');
const net = require('node:net');
const fsp = require('node:fs/promises');
const { NodeSSH } = require('node-ssh');
const { spawn } = require('node:child_process');

const BaseResourceGroup = require('./base-resource-group');
// const Reconcilable = require('./reconcilable');

/**
 * Node-specific properties used when configuring the resource.
 * @typedef {Object} NodeProperties
 * @property {string} sshPrivateKeyPath -
 * @property {string} binaryLocalPath -
 * @property {string} binaryRemotePath -
 * @property {string} serviceName -
 * @property {string} serviceUser -
 * @property {string} workingDirectory -
 * @property {string} restartPolicy -
 * @property {Number} serviceRestartSec -
 * @property {Object<string,string>} env -
 * @property {string} description -
 * @property {string[]} serviceArgs -
 */

/**
 * Options used to construct a {@link Node} resource group.
 * @typedef {Object} NodeOptions
 * @property {string} name - Logical name of the node resource.
 * @property {string} [parent] - Optional parent resource name to attach this node under.
 * @property {import('./reconcilable').Status} [status] - Optional initial reconciliation status.
 * @property {NodeProperties & import('../typedefs').SharedProperties} properties - Node properties and shared properties used for reconciliation.
 * @property {Array<import('./reconcilable')>} [dependsOn] - Optional list of resources that must be reconciled before this node.
 * @property {Record<string, import('./base-resource') | BaseResourceGroup>} [resources] - Optional map of child resources that belong to this node.
 */

/**
 * Resource group representing a single SSH-manageable node.
 */
class Node extends BaseResourceGroup {
  /**
   * Create a new {@link Node} resource group.
   * @param {NodeOptions} options - Configuration options for the node.
   */
  constructor({ name, parent, status, properties, dependsOn, resources }) {
    super({
      name,
      parent,
      status,
      properties,
      dependsOn,
      resources,
    });

    /**
     * Reusable SSH client for this node. Initialized lazily by {@link Node#_connect}.
     * @type {import('node-ssh').NodeSSH | undefined}
     */
    this.ssh = undefined;
  }

  /**
   * Wait until a TCP port on a remote host becomes reachable.
   * @param {string} host - Hostname or IP address to probe.
   * @param {number} port - TCP port number to check for availability.
   * @param {{ timeoutMs?: number, intervalMs?: number }} [opts] - Optional timing configuration for retries and timeout.
   * @returns {Promise<void>} Resolves when the port is open; rejects if the timeout elapses first.
   */
  async _waitForPortOpen(
    host,
    port,
    { timeoutMs = 5 * 60 * 1000, intervalMs = 1500 } = {}
  ) {
    const start = Date.now();
    let delay = intervalMs;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ok = await new Promise((resolve) => {
        const s = net.createConnection({ host, port });
        s.setTimeout(4000);
        s.once('connect', () => {
          s.destroy();
          resolve(true);
        });
        s.once('timeout', () => {
          s.destroy();
          resolve(false);
        });
        s.once('error', () => {
          s.destroy();
          resolve(false);
        });
      });

      if (ok) return;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(
          `Port ${port} on ${host} did not open within ${timeoutMs}ms`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (delay < 8000) delay += 500;
    }
  }

  /**
   * Establish an SSH connection to the remote node if not already connected.
   * @param {string} ip - IP address or hostname of the remote node.
   * @param {string} keyPath - File system path to the SSH private key.
   * @returns {Promise<void>} Resolves when the SSH connection has been established or already exists.
   */
  async _connect(ip, keyPath) {
    if (this.ssh) return;
    this.ssh = new NodeSSH();
    await this.ssh.connect({
      host: ip,
      username: 'root',
      privateKeyPath: keyPath,
    });
  }

  /**
   * Copy a local file to the remote node using SCP over the existing SSH connection.
   * @param {string} localPath - Local file path to copy from.
   * @param {string} remotePath - Remote destination file path to copy to.
   * @returns {Promise<void>} Resolves when the file has been successfully transferred.
   * @throws {Error} If the SSH client has not been initialized.
   */
  async _scpCopy(localPath, remotePath) {
    if (!this.ssh) throw new Error('ssh client not initialized');

    const transferOptions = {
      // concurrency: 0,
      // chunkSize: 128 * 1024, // tweak as desired
      // chunkSize: 32768 * 100,
      // step(totalTransferred, chunk, total) {
      //   const pct = ((totalTransferred / total) * 100).toFixed(1);
      //   process.stdout.write(
      //     `\r[scp] ${pct}% (${totalTransferred}/${total} bytes)`
      //   );
      // },
    };

    await this.ssh.putFile(localPath, remotePath, null, transferOptions);
    // process.stdout.write('\n');
  }

  /**
   * Execute a command on the remote node via SSH.
   * @param {string} cmd - Base command to execute.
   * @param {string[]} [params] - Additional arguments to append to the command.
   * @param {Record<string, unknown>} [options] - Additional options passed through to the SSH exec implementation.
   * @returns {Promise<{ stdout: string, stderr: string, code: number }>} Resolves with the command result including stdout, stderr, and exit code.
   * @throws {Error} If the SSH client is not initialized or the command exits with a non-zero status.
   */
  async _exec(cmd, params = [], options = {}) {
    if (!this.ssh) throw new Error('ssh client not initialized');

    const command = [cmd, ...params].join(' ');
    const { stdout, stderr, code } = await this.ssh.execCommand(
      command,
      options
    );

    if (code !== 0) {
      const err = new Error(
        `Remote command failed (${command}) with code ${code}: ${
          stderr || stdout
        }`
      );
      // @ts-expect-error augmenting with extra fields for callers
      err.code = code;
      // @ts-expect-error augmenting with extra fields for callers
      err.stdout = stdout;
      // @ts-expect-error augmenting with extra fields for callers
      err.stderr = stderr;
      throw err;
    }

    return { stdout, stderr, code };
  }

  /**
   * Construct a systemd unit file for the service managed by this node.
   *
   * The content is built using service-related properties configured on the resource.
   * @param {string} binaryPath - Absolute path to the service binary on the remote node.
   * @returns {string} The complete systemd unit file content as a single string.
   */
  _buildSystemdUnit(binaryPath) {
    const user = this.get('serviceUser');
    const workingDirectory = this.get('serviceWorkingDirectory');
    const restartPolicy = this.get('serviceRestartPolicy');
    const restartSec = this.get('serviceRestartSeconds');
    const env = this.get('serviceEnvironment', {});
    const description = this.get('serviceDescription');
    const args = this.get('serviceArgs', []);

    const envLines = Object.entries(env).map(
      ([k, v]) => `Environment=${k}=${v}`
    );
    const escapeArg = (/** @type {string} */ s) =>
      s.match(/[\s"'\\]/) ? `"${s.replace(/(["\\$`])/g, '\\$1')}"` : s;

    const execStart = [binaryPath, ...args.map(escapeArg)].join(' ');

    return [
      '[Unit]',
      `Description=${description}`,
      'After=network.target',
      '',
      '[Service]',
      'Type=simple',
      `User=${user}`,
      `WorkingDirectory=${workingDirectory}`,
      `ExecStart=${execStart}`,
      `Restart=${restartPolicy}`,
      `RestartSec=${restartSec}`,
      ...envLines,
      '',
      '[Install]',
      'WantedBy=multi-user.target',
      '',
    ].join('\n');
  }

  /**
   * Install or update a systemd unit file on the remote node.
   * @param {string} serviceName - Name of the systemd service (without `.service` suffix).
   * @param {string} unitContent - Full text content of the systemd unit to install.
   * @returns {Promise<void>} Resolves when the unit has been copied, permissions set, and systemd reloaded.
   */
  async _installSystemdUnit(serviceName, unitContent) {
    const remoteUnitPath = `/etc/systemd/system/${serviceName}.service`;
    const remoteTmp = `/tmp/.${serviceName}.${Date.now()}.service`;
    const localTmp = path.join(
      process.cwd(),
      `.tmp-${serviceName}.${Date.now()}.service`
    );

    await fsp.writeFile(localTmp, unitContent, 'utf8');

    try {
      await this._scpCopy(localTmp, remoteTmp);
      await this._exec('mv', ['-f', remoteTmp, remoteUnitPath]);
      await this._exec('chmod', ['0644', remoteUnitPath]);
      await this._exec('systemctl', ['daemon-reload']);
    } finally {
      await fsp.unlink(localTmp).catch(() => {});
    }
  }

  /**
   * Ensure the systemd service is enabled and running on the remote node.
   * @param {string} serviceName - Name of the systemd service (with or without `.service` suffix).
   * @returns {Promise<void>} Resolves once the service is enabled, restarted, and confirmed active.
   */
  async _ensureServiceEnabledAndRunning(serviceName) {
    // systemctl accepts names without .service suffix
    await this._exec('systemctl', ['enable', serviceName]);
    await this._exec('systemctl', ['restart', serviceName]);
    // Optional sanity check
    await this._exec('systemctl', ['is-active', '--quiet', serviceName]);
  }

  /**
   * Install or update a binary on the remote node.
   *
   * The binary is uploaded to a temporary file and then atomically moved
   * into place with executable permissions.
   * @param {string} localPath - Local file path of the binary to upload.
   * @param {string} remotePath - Destination file path on the remote node.
   * @returns {Promise<void>} Resolves when the binary has been uploaded and moved into place.
   */
  async _installBinary(localPath, remotePath) {
    const basename = path.basename(remotePath);
    const remoteTmp = `/tmp/.${basename}.${Date.now()}.new`;
    await this._scpCopy(localPath, remoteTmp);
    await this._exec('chmod', ['0755', remoteTmp]);
    await this._exec('mkdir', ['-p', `$(dirname ${remotePath})`]);
    await this._exec('mv', ['-f', remoteTmp, remotePath]);
  }

  /**
   * Reconcile the node by ensuring the binary and systemd unit are installed and the service is running.
   *
   * This method:
   *  1. Reconciles base resources.
   *  2. Waits for SSH to be available.
   *  3. Uploads/updates the service binary.
   *  4. Optionally installs/updates the systemd unit and restarts the service.
   * @returns {Promise<void>} Resolves once the node has been fully reconciled.
   */
  async _reconcile() {
    await super._reconcile();

    const vps = this.getResource(`${this.name}-vps`);
    const ip = vps.get('ip');
    const keyPath = this.get('sshPrivateKeyPath');
    const localBinaryPath = this.get('binaryLocalPath');
    const remoteBinaryPath = this.get('binaryRemotePath');
    const serviceName = this.get('serviceName');
    const manageSystemd = this.get('manageSystemd');

    if (!localBinaryPath || !remoteBinaryPath) {
      throw new Error(
        'binaryLocalPath and binaryRemotePath must be set in Node properties'
      );
    }
    await this._waitForPortOpen(ip, 22);
    await this._connect(ip, keyPath);

    // 1. Install / update binary
    await this._installBinary(localBinaryPath, remoteBinaryPath);

    if (manageSystemd) {
      // 2. Install / update systemd unit
      const unit = this._buildSystemdUnit(remoteBinaryPath);
      await this._installSystemdUnit(serviceName, unit);

      // 3. Enable + restart
      await this._ensureServiceEnabledAndRunning(serviceName);
    }

    if (this.ssh) {
      await this.ssh.dispose();
      delete this.ssh;
    }
  }

  /**
   * Launch an interactive `ssh` to root@ip using the generated identity file.
   * @returns {Promise<number>} Exit code from ssh.
   */
  openSSH() {
    // if (this.getStatus() !== Reconcilable.Status.STABLE) throw new Error("node not stable")
    const vps = this.getResource(`${this.name}-vps`);
    const ip = vps.get('ip');
    const keyPath = this.get('sshPrivateKeyPath');
    return new Promise((resolve, reject) => {
      const args = [
        '-i',
        keyPath,
        '-o',
        'IdentitiesOnly=yes',
        '-o',
        'IdentityAgent=none',
        '-o',
        'StrictHostKeyChecking=no',
        '-o',
        'UserKnownHostsFile=/dev/null',
        `root@${ip}`,
      ];
      const child = spawn('ssh', args, { stdio: 'inherit' });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 0));
    });
  }
}

Node.DefaultProperties = {
  binaryRemotePath: '/usr/local/bin/wharfie',
  manageSystemd: true,
  serviceName: 'wharfie',
  serviceUser: 'root',
  serviceWorkingDirectory: '/root',
  serviceRestartPolicy: 'always',
  serviceRestartSeconds: 5,
  serviceEnvironment: {},
  serviceDescription: 'root service',
  serviceArgs: [],
};

module.exports = Node;
