'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');

const SSHKey = require('../../lambdas/lib/actor/resources/local/ssh-key');
const HetznerSSHKey = require('../../lambdas/lib/actor/resources/hetzner/ssh-key');
const HetznerVPS = require('../../lambdas/lib/actor/resources/hetzner/vps');

/**
 * Minimal env-driven configuration.
 * Required:
 *   HETZNER_TOKEN   – Hetzner Cloud API token
 *   BINARY_FILE     – local path to the executable to upload
 *   S3_BUCKET       – target S3 bucket
 * Optional:
 *   VPS_NAME        – server name (default: demo-vps)
 *   SERVER_TYPE     – e.g. cpx11
 *   IMAGE           – e.g. ubuntu-22.04
 *   LOCATION        – e.g. nbg1 | fsn1 | hel1 | ash
 *   KEY_PREFIX      – path prefix for keypair (default: ~/.ssh/<VPS_NAME>)
 *   S3_KEY          – object key in S3 (default: releases/<basename>)
 *   AWS_REGION      – S3 region (default: us-east-1)
 *   S3_PUBLIC       – "1" to make object public-read (stable URL)
 *   PRESIGN_SECONDS – if set (>0), generate presigned URL instead of public URL
 *   SERVICE_NAME    – systemd unit name (default: app)
 *   REMOTE_PATH     – install path on VM (default: /usr/local/bin/app)
 *   SERVICE_USER    – systemd user (default: root)
 *   SERVICE_ARGS    – optional args string, e.g. "--port=8080 --foo"
 */
const HZ_TOKEN = process.env.HETZNER_TOKEN || '';
const VPS_NAME = process.env.VPS_NAME || 'demo-vps';
const SERVER_TYPE = process.env.SERVER_TYPE || 'cpx11';
const IMAGE = process.env.IMAGE || 'ubuntu-22.04';
const LOCATION = process.env.LOCATION || 'nbg1';
const KEY_PREFIX = process.env.KEY_PREFIX || '';

const BINARY_FILE =
  process.env.BINARY_FILE ||
  '/Users/josephvandrunen/Library/Application Support/wharfie-nodejs/actor_binaries/main-build-24-linux-x64';

const SERVICE_NAME = process.env.SERVICE_NAME || 'app';
const REMOTE_PATH = process.env.REMOTE_PATH || '/usr/local/bin/app';
const SERVICE_USER = process.env.SERVICE_USER || 'root';
const SERVICE_ARGS = (process.env.SERVICE_ARGS || '').trim();

/**
 * Ensure required env present.
 */
function requireEnv() {
  const missing = [];
  if (!HZ_TOKEN) missing.push('HETZNER_TOKEN');
  if (!BINARY_FILE) missing.push('BINARY_FILE');
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    process.exit(2);
  }
}

function sshArgs(privateKeyPath, ip, extra = []) {
  return [
    '-i',
    privateKeyPath,
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    `root@${ip}`,
    ...extra,
  ];
}

function spawnP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', ...opts });
    p.on('error', reject);
    p.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))
    );
  });
}

async function sha256File(filePath) {
  const h = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('data', (chunk) => h.update(chunk));
    rs.on('end', resolve);
  });
  return h.digest('hex');
}

// Run a remote shell command and capture stdout (string). Stderr is inherited.
async function sshExecCapture(ip, key, shellCmd) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const p = spawn('ssh', sshArgs(key, ip, [shellCmd]), {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    p.stdout.on('data', (buf) => chunks.push(buf));
    p.on('error', reject);
    p.on('exit', (code) => {
      if (code === 0) resolve(Buffer.concat(chunks).toString('utf8').trim());
      else reject(new Error(`ssh exited ${code}`));
    });
  });
}

// Copy a local file to the remote temp path using scp (fast, resilient).
async function scpCopy(ip, key, localPath, remotePath) {
  await spawnP('scp', [
    '-i',
    key,
    '-o',
    'StrictHostKeyChecking=no',
    '-o',
    'UserKnownHostsFile=/dev/null',
    localPath,
    `root@${ip}:${remotePath}`,
  ]);
}

// Idempotent systemd unit writer (only rewrites when changed).
async function upsertSystemdUnit(
  ip,
  key,
  { serviceName, execPath, user, args }
) {
  const unitPath = `/etc/systemd/system/${serviceName}.service`;
  const unit = `[Unit]
Description=${serviceName}
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=${user}
ExecStart=${execPath}${args ? ' ' + args : ''}
Restart=always
RestartSec=3
StandardOutput=append:/var/log/${serviceName}.out
StandardError=append:/var/log/${serviceName}.err
# Hardening (tweak as needed)
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=true
PrivateTmp=yes
AmbientCapabilities=

[Install]
WantedBy=multi-user.target
`;

  // Write to a temp file, compare, then move atomically if different
  const tmp = `/tmp/.${serviceName}.service.new`;
  // Use base64 to avoid quoting issues in heredocs
  const b64 = Buffer.from(unit, 'utf8').toString('base64');
  await sshExecCapture(
    ip,
    key,
    `set -e; umask 022; echo ${b64} | base64 -d > ${tmp}`
  );

  const remoteSum = await sshExecCapture(
    ip,
    key,
    `test -f ${unitPath} && sha256sum ${unitPath} | awk '{print $1}' || echo ""`
  );
  const newSum = await sshExecCapture(
    ip,
    key,
    `sha256sum ${tmp} | awk '{print $1}'`
  );

  if (remoteSum !== newSum) {
    await sshExecCapture(
      ip,
      key,
      `set -e; mv ${tmp} ${unitPath}; chmod 0644 ${unitPath}`
    );
    await sshExecCapture(ip, key, `systemctl daemon-reload`);
    // If first install, enable; otherwise just restart
    if (!remoteSum) {
      await sshExecCapture(ip, key, `systemctl enable ${serviceName}`);
    }
    await sshExecCapture(ip, key, `systemctl restart ${serviceName}`);
  } else {
    await sshExecCapture(ip, key, `rm -f ${tmp}`);
  }
}

// Full install: copy → verify → install → chown/chmod atomically
async function installBinaryOverSSH({
  ip,
  privateKeyPath,
  localBinaryPath,
  remoteInstallPath,
  serviceName,
  serviceUser,
  serviceArgs,
}) {
  const basename = path.basename(remoteInstallPath);
  const remoteTmp = `/tmp/.${basename}.${Date.now()}.new`;
  const localSha = await sha256File(localBinaryPath);

  // 1) Copy to temp
  await scpCopy(ip, privateKeyPath, localBinaryPath, remoteTmp);

  // 2) Verify SHA on remote
  const remoteSha = await sshExecCapture(
    ip,
    privateKeyPath,
    `sha256sum ${remoteTmp} | awk '{print $1}'`
  );
  if (remoteSha !== localSha) {
    await sshExecCapture(ip, privateKeyPath, `rm -f ${remoteTmp}`);
    throw new Error(
      `Checksum mismatch after transfer: local=${localSha} remote=${remoteSha}`
    );
  }

  // // 3) Install atomically with proper mode/owner
  // // Use 'install' for atomic write & perms; then mv to final path.
  // // If user != root, chown after move.
  await sshExecCapture(
    ip,
    privateKeyPath,
    `
    set -e
    chmod 0755 ${remoteTmp}
    mkdir -p $(dirname ${remoteInstallPath})
    # preserve old binary as .bak once (best-effort)
    if [ -f ${remoteInstallPath} ] && [ ! -f ${remoteInstallPath}.bak ]; then cp -pf ${remoteInstallPath} ${remoteInstallPath}.bak || true; fi
    mv -f ${remoteTmp} ${remoteInstallPath}
    chown ${serviceUser}:${serviceUser} ${remoteInstallPath} || chown ${serviceUser}:root ${remoteInstallPath} || true
  `
  );

  // // 4) (Re)create/refresh the systemd unit and restart
  // await upsertSystemdUnit(ip, privateKeyPath, {
  //   serviceName,
  //   execPath: remoteInstallPath,
  //   user: serviceUser,
  //   args: serviceArgs,
  // });

  // // 5) Final sanity: print status & version
  // try {
  //   const status = await sshExecCapture(ip, privateKeyPath, `systemctl is-active ${serviceName} || true`);
  //   const sum = await sshExecCapture(ip, privateKeyPath, `sha256sum ${remoteInstallPath} | awk '{print $1}'`);
  //   console.log(`[remote] ${serviceName}=${status} sha256=${sum}`);
  // } catch (_) { } // non-fatal
}

/**
 * Wait until TCP port is open.
 * @param {string} host - Host/IP to probe.
 * @param {number} port - TCP port number.
 * @param {{ timeoutMs?: number, intervalMs?: number }} [opts] - Timing options.
 */
async function waitForPortOpen(
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
 * Launch an interactive `ssh` to root@ip using the generated identity file.
 * @param {string} ip - IPv4 address of the VM.
 * @param {string} privateKeyPath - Local private key path.
 * @returns {Promise<number>} Exit code from ssh.
 */
function openSSH(ip, privateKeyPath) {
  return new Promise((resolve, reject) => {
    const args = [
      '-i',
      privateKeyPath,
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

(async () => {
  requireEnv();

  // 0) Upload artifact and get a URL suitable for cloud-init to curl
  // const downloadUrl = await uploadAndGetUrl({
  //   file: BINARY_FILE,
  //   bucket: S3_BUCKET,
  //   key: S3_KEY,
  //   region: AWS_REGION,
  //   makePublic: S3_PUBLIC,
  //   presignSeconds: PRESIGN_SECONDS,
  // });

  // 1) Ensure local SSH keypair exists (idempotent)
  const sshKey = new SSHKey({
    name: VPS_NAME,
    properties: {
      keyPrefix: KEY_PREFIX || undefined,
      overwrite: false,
      passphrase: '',
      rounds: 64,
      comment: `${VPS_NAME}@local`,
    },
  });
  await sshKey._reconcile();
  const keyPrefix = sshKey.get('path'); // absolute path without .pub
  const publicKeyPath = `${keyPrefix}.pub`;

  // 2) Ensure the public key is present in Hetzner under the same name (idempotent)
  const hzKey = new HetznerSSHKey({
    name: VPS_NAME,
    properties: {
      hetznerToken: HZ_TOKEN,
      publicKeyPath,
    },
  });
  await hzKey._reconcile();

  // 3) Create or find the VPS, injecting the SSH key and systemd service (idempotent)
  const argsArray = SERVICE_ARGS
    ? SERVICE_ARGS.split(/\s+/).filter(Boolean)
    : [];
  const vps = new HetznerVPS({
    name: VPS_NAME,
    properties: {
      hetznerToken: HZ_TOKEN,
      serverType: SERVER_TYPE,
      image: IMAGE,
      location: LOCATION,
      sshKeyName: VPS_NAME,
    },
  });

  let exitCode = 0;
  try {
    await vps._reconcile();

    const ip = vps.get('ip');
    if (!ip) throw new Error('VPS is missing an IPv4 address after reconcile.');

    await waitForPortOpen(ip, 22);

    // === NEW: direct transfer & install (no intermediate storage) ===
    await installBinaryOverSSH({
      ip,
      privateKeyPath: sshKey.get('path'),
      localBinaryPath: BINARY_FILE,
      remoteInstallPath: REMOTE_PATH, // e.g. /usr/local/bin/app
      // serviceName: SERVICE_NAME,                 // e.g. app
      // serviceUser: SERVICE_USER,                 // e.g. root or appuser
      // serviceArgs: SERVICE_ARGS,                 // e.g. "--port=8080"
    });

    // 4) Open an interactive SSH session
    // eslint-disable-next-line no-console
    console.log(`\nConnecting: ssh -i ${path.resolve(keyPrefix)} root@${ip}\n`);
    exitCode = await openSSH(ip, keyPrefix);
    // eslint-disable-next-line no-console
    console.log(`SSH session ended with code ${exitCode}`);
  } finally {
    // 5) Teardown (always)
    // eslint-disable-next-line no-console
    console.log('Tearing down resources...');
    try {
      await vps._destroy();
    } catch (e) {
      console.error('Error destroying VPS:', e);
    }
    try {
      await hzKey._destroy();
    } catch (e) {
      console.error('Error destroying Hetzner SSH key:', e);
    }
    try {
      await sshKey._destroy();
    } catch (e) {
      console.error('Error destroying local SSH key:', e);
    }
  }

  process.exit(exitCode);
})().catch((err) => {
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? /** @type {{message: string}} */ (err).message
      : String(err);
  console.error('Fatal:', msg);
  process.exit(1);
});
