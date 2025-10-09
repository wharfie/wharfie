#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');

/**
 * Wait until TCP port is open.
 * @param {string} host
 * @param {number} port
 * @param {{ timeoutMs?: number, intervalMs?: number }} [opts]
 */
async function waitForPortOpen(
  host,
  port,
  { timeoutMs = 5 * 60 * 1000, intervalMs = 1500 } = {}
) {
  const start = Date.now();
  let delay = intervalMs;

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
    await new Promise((r) => setTimeout(r, delay));
    if (delay < 8000) delay += 500;
  }
}

/**
 * EDIT THESE PATHS to match your repo structure.
 */
const SSHKey = require('../../lambdas/lib/actor/resources/local/ssh-key');
const HetznerSSHKey = require('../../lambdas/lib/actor/resources/hetzner/ssh-key');
const HetznerVPS = require('../../lambdas/lib/actor/resources/hetzner/vps');

/**
 * Minimal env-driven configuration.
 * Required:
 *   HETZNER_TOKEN  – your Hetzner Cloud API token
 * Optional:
 *   VPS_NAME       – server name (default: demo-vps)
 *   SERVER_TYPE    – e.g. cpx11
 *   IMAGE          – e.g. ubuntu-22.04
 *   LOCATION       – e.g. nbg1
 *   KEY_PREFIX     – path prefix for keypair (default: ~/.ssh/<VPS_NAME>)
 */
const HZ_TOKEN =
  process.env.HETZNER_TOKEN ||
  'P9LtyppMddGiGAUYkxB3klBIRncm3xyIXbLmuxxO41h1lKnu7UfYiBk3OnpRgOtS';
if (!HZ_TOKEN) {
  console.error('HETZNER_TOKEN env var is required.');
  process.exit(1);
}
const VPS_NAME = process.env.VPS_NAME || 'demo-vps';
const SERVER_TYPE = process.env.SERVER_TYPE || 'cpx11';
const IMAGE = process.env.IMAGE || 'ubuntu-22.04';
const LOCATION = process.env.LOCATION || 'ash';
const KEY_PREFIX = process.env.KEY_PREFIX || ''; // if empty, SSHKey defaults to ~/.ssh/<name>

/**
 * Launch an interactive `ssh` to root@ip using the generated identity file.
 * @param {string} ip
 * @param {string} privateKeyPath
 * @returns {Promise<number>} exit code from ssh
 */
function openSSH(ip, privateKeyPath) {
  return new Promise((resolve, reject) => {
    // Harden initial connection UX: skip hostkey prompt for demo flows.
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
  // 1) Ensure local SSH keypair exists (idempotent)
  const sshKey = new SSHKey({
    name: VPS_NAME, // drives default path/comment when KEY_PREFIX not provided
    properties: {
      keyPrefix: KEY_PREFIX || undefined, // let class choose default when empty
      overwrite: false, // do not clobber existing keys
      passphrase: '', // unencrypted for automation
      rounds: 64,
      comment: `${VPS_NAME}@local`,
    },
  });

  await sshKey._reconcile();
  const keyPrefix = sshKey.get('path'); // absolute path without .pub
  const publicKeyPath = `${keyPrefix}.pub`;

  // 2) Ensure the public key is present in Hetzner under the same name (idempotent)
  const hzKey = new HetznerSSHKey({
    name: VPS_NAME, // key name in Hetzner
    properties: {
      hetznerToken: HZ_TOKEN,
      publicKeyPath,
    },
  });
  await hzKey._reconcile();

  // 3) Create or find the VPS, injecting the SSH key by name (idempotent)
  const vps = new HetznerVPS({
    name: VPS_NAME,
    properties: {
      hetznerToken: HZ_TOKEN,
      serverType: SERVER_TYPE,
      image: IMAGE,
      location: LOCATION,
      sshKeyName: VPS_NAME, // instruct VPS create to attach our key by name
    },
  });
  await vps._reconcile();

  const ip = vps.get('ip');
  if (!ip) {
    throw new Error('VPS is missing an IPv4 address after reconcile.');
  }

  await waitForPortOpen(ip, 22); // <— new
  // 4) Open an interactive SSH session
  console.log(`\nConnecting: ssh -i ${path.resolve(keyPrefix)} root@${ip}\n`);
  const exitCode = await openSSH(ip, keyPrefix);
  await vps._destroy();
  await hzKey._destroy();
  await sshKey._destroy();
  process.exit(exitCode);
})().catch((err) => {
  // TS/strict-safe error reporting
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? /** @type {any} */ (err).message
      : String(err);
  console.error('Fatal:', msg);
  process.exit(1);
});

// const { HetznerCloud } = require('../../lambdas/lib/hetzner');

// // const api = new HetznerCloud({
// //   token: 'P9LtyppMddGiGAUYkxB3klBIRncm3xyIXbLmuxxO41h1lKnu7UfYiBk3OnpRgOtS',
// // });

// (async () => {
//   // Instantiate the client with your Hetzner Cloud API token
//   const client = new HetznerCloud({
//     token: 'P9LtyppMddGiGAUYkxB3klBIRncm3xyIXbLmuxxO41h1lKnu7UfYiBk3OnpRgOtS',
//   });

//   // Server + execution options
//   const options = {
//     server: {
//       name: 'demo-vm-1',
//       server_type: 'cpx11',
//       image: 'ubuntu-22.04',
//       location: 'nbg1', // or "fsn1" / "hel1"
//     },

//     exec: {
//       // Simple inline script (base64 encoded)
//       inline_b64: Buffer.from(
//         `#!/bin/bash
// echo "Hello from inside the VM" > /root/hello.txt
// `
//       ).toString('base64'),
//       remote_path: '/root/startup.sh',
//       args: [],
//       env: { DEMO_ENV: 'world' },
//       background: false,
//       stdout: '/var/log/startup.log',
//     },
//     wait_for_action: true, // wait until the server creation finishes
//   };

//   const { create, server } = await client.createServerAndRun(options);

//   console.log('Server created:', server.id, server.name);
//   console.log('Root password (if provided):', create.root_password);

//   const ready = await client.waitForServerRunning(server.id);
//   console.log('Server ready at', ready.public_net.ipv4.ip);

//   // Destroys server 12345 fast: force-off, remove & delete attached Floating IPs, delete server.
//   const result = await client.terminateServerFast(server.id);

//   console.log(
//     'Final delete action status:',
//     result.deleteAction?.action?.status
//   );
// })();
