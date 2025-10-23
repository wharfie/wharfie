'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

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

const BINARY_FILE = process.env.BINARY_FILE || '';
const S3_BUCKET = process.env.S3_BUCKET || 'wharfie-artifacts-us-east-2';
const S3_KEY =
  process.env.S3_KEY ||
  (BINARY_FILE ? `releases/${path.basename(BINARY_FILE)}` : '');
const AWS_REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
const S3_PUBLIC = process.env.S3_PUBLIC === '1';
const PRESIGN_SECONDS = Number(process.env.PRESIGN_SECONDS || 0);

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
  if (!S3_BUCKET) missing.push('S3_BUCKET');
  if (missing.length) {
    console.error(`Missing env: ${missing.join(', ')}`);
    process.exit(2);
  }
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

/**
 * Compute streaming SHA256 (hex) for a file.
 * @param {string} filePath - Local path to hash.
 * @returns {Promise<string>} Hex digest.
 */
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

/**
 * Guess content-type for common artifact extensions.
 * @param {string} key - S3 object key.
 * @returns {string} MIME type.
 */
function guessContentType(key) {
  if (key.endsWith('.gz')) return 'application/gzip';
  if (key.endsWith('.zip')) return 'application/zip';
  if (key.endsWith('.tar')) return 'application/x-tar';
  if (key.endsWith('.tgz')) return 'application/gzip';
  return 'application/octet-stream';
}

/**
 * Build a public HTTPS URL for an S3 object.
 * @param {string} bucket - S3 bucket.
 * @param {string} key - Object key.
 * @param {string} region - AWS region.
 * @returns {string} URL.
 */
function publicUrl(bucket, key, region) {
  const encKey = encodeURI(key).replace(/#/g, '%23');
  return region && region !== 'us-east-1'
    ? `https://${bucket}.s3.${region}.amazonaws.com/${encKey}`
    : `https://${bucket}.s3.amazonaws.com/${encKey}`;
}

/**
 * Upload (or no-op if identical) a file to S3 and return a download URL.
 * If S3_PUBLIC=1 → returns a stable public URL.
 * Else if PRESIGN_SECONDS>0 → returns a presigned URL valid for that many seconds.
 * Else throws (since you'd have no way to download in cloud-init).
 * @param {object} p - Params.
 * @param {string} p.file - Local file path.
 * @param {string} p.bucket - S3 bucket.
 * @param {string} p.key - S3 key.
 * @param {string} p.region - AWS region.
 * @param {boolean} p.makePublic - Whether to set ACL public-read.
 * @param {number} p.presignSeconds - Presign expiry in seconds (0 to skip).
 * @returns {Promise<string>} Download URL to use in cloud-init.
 */
async function uploadAndGetUrl({
  file,
  bucket,
  key,
  region,
  makePublic,
  presignSeconds,
}) {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error(`Not a regular file: ${file}`);
  if (stat.size > 5 * 1024 * 1024 * 1024) {
    throw new Error(
      'File > 5GB; add multipart upload if you need larger artifacts.'
    );
  }

  const s3 = new S3Client({ region });
  const checksumHex = await sha256File(file);
  const body = fs.createReadStream(file);

  // Idempotent HEAD check
  let upToDate = false;
  try {
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: key })
    );
    const sizeMatches = Number(head.ContentLength || -1) === stat.size;
    const remoteSha =
      head.Metadata && head.Metadata.sha256 ? String(head.Metadata.sha256) : '';
    upToDate = sizeMatches && remoteSha === checksumHex;
  } catch {
    // not found → upload
  }

  if (!upToDate) {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: guessContentType(key),
        ContentLength: stat.size,
        ChecksumSHA256: Buffer.from(checksumHex, 'hex').toString('base64'),
        Metadata: { sha256: checksumHex },
        // Cache forever-ish if public; tweak if you serve mutable keys.
        ACL: makePublic ? 'public-read' : undefined,
        CacheControl: makePublic
          ? 'public, max-age=31536000, immutable'
          : undefined,
      })
    );
    // eslint-disable-next-line no-console
    console.log(`Uploaded s3://${bucket}/${key} (${stat.size} bytes)`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`S3 object up-to-date: s3://${bucket}/${key}`);
  }

  if (makePublic) {
    return publicUrl(bucket, key, region);
  }

  if (presignSeconds > 0) {
    const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(s3, cmd, { expiresIn: presignSeconds });
  }

  throw new Error(
    'Object is private and PRESIGN_SECONDS not set — no usable download URL.'
  );
}

(async () => {
  requireEnv();

  // 0) Upload artifact and get a URL suitable for cloud-init to curl
  const downloadUrl = await uploadAndGetUrl({
    file: BINARY_FILE,
    bucket: S3_BUCKET,
    key: S3_KEY,
    region: AWS_REGION,
    makePublic: S3_PUBLIC,
    presignSeconds: PRESIGN_SECONDS,
  });

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
      // Use the structured service spec; HetznerVPS will generate cloud-init and systemd unit.
      service: {
        url: downloadUrl,
        remote_path: REMOTE_PATH,
        args: argsArray,
        user: SERVICE_USER,
        service_name: SERVICE_NAME,
        wantsNetworkOnline: true,
        stdout_log: `/var/log/${SERVICE_NAME}.out`,
        stderr_log: `/var/log/${SERVICE_NAME}.err`,
        restart: 'always',
        restart_sec: 3,
      },
    },
  });

  let exitCode = 0;
  try {
    await vps._reconcile();

    const ip = vps.get('ip');
    if (!ip) throw new Error('VPS is missing an IPv4 address after reconcile.');

    await waitForPortOpen(ip, 22);

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
