// install-deps.js
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const Arborist = require('@npmcli/arborist');
const pacote = require('pacote');

/**
 * @typedef {NodeJS.Process["platform"]} TargetPlatform
 * @typedef {NodeJS.Architecture} TargetArch
 * @typedef {'glibc'|'musl'} TargetLibc
 * @typedef {{ nodeVersion: string, platform: TargetPlatform, architecture: TargetArch, libc?: TargetLibc }} BuildTarget
 * @typedef {{ name: string, version: string }} ExternalDep
 */

async function installForTarget({ buildTarget, externals, tmpBuildDir }) {
  if (!externals?.length) return;

  // fresh workspace
  await rmSafe(path.join(tmpBuildDir, 'node_modules'), {
    recursive: true,
    force: true,
  });
  await rmSafe(path.join(tmpBuildDir, 'package-lock.json'), { force: true });
  await fsp.mkdir(tmpBuildDir, { recursive: true });
  await fsp.writeFile(
    path.join(tmpBuildDir, 'package.json'),
    JSON.stringify({ name: 'install-sandbox', private: true }, null, 2)
  );

  // .npmrc for the target triplet; omit optionals in main pass; don’t run scripts
  await fsp.writeFile(
    path.join(tmpBuildDir, '.npmrc'),
    [
      `platform=${buildTarget.platform}`,
      `arch=${buildTarget.architecture}`,
      `os=${buildTarget.platform}`,
      `cpu=${buildTarget.architecture}`,
      ...(buildTarget.platform === 'linux' && buildTarget.libc
        ? [`libc=${buildTarget.libc}`]
        : []),
      `include=prod`,
      `optional=false`,
      `omit=optional`,
      `ignore-scripts=true`,
    ].join('\n')
  );

  // npmConfig shim (constructor only)
  const npmConfig = {
    get: (k) => {
      switch (k) {
        case 'platform':
        case 'os':
          return buildTarget.platform;
        case 'arch':
        case 'cpu':
          return buildTarget.architecture;
        case 'libc':
          return buildTarget.platform === 'linux'
            ? buildTarget.libc
            : undefined;
        case 'include':
          return ['prod'];
        case 'optional':
          return false;
        case 'omit':
          return ['optional'];
        case 'ignore-scripts':
          return true;
        case 'audit':
          return false;
        case 'fund':
          return false;
        default:
          return undefined;
      }
    },
  };

  // Split user specs: normal vs platform-gated “prebuilt” specs that would EBADPLATFORM
  const specs = externals.map((e) => `${e.name}@${e.version}`);
  const { normalSpecs, prebuiltSpecs } = await splitPrebuiltSpecs(
    specs,
    npmConfig
  );

  console.log('INSTALLING(normal), ', JSON.stringify(normalSpecs));
  const arb = new Arborist({
    path: tmpBuildDir,
    npmConfig,
    ignoreScripts: true,
  });

  await arb.buildIdealTree({
    add: normalSpecs,
    saveType: 'prod',
    update: { all: true },
  });
  await arb.reify({
    save: true,
    omit: ['optional'], // no optionals in this pass
  });
  console.log('installed', JSON.stringify(normalSpecs), 'in', tmpBuildDir);

  // Explicit user-requested prebuilds (e.g. @img/sharp-linux-x64@0.34.4): extract directly
  if (prebuiltSpecs.length) {
    await extractPrebuiltSpecs(
      tmpBuildDir,
      prebuiltSpecs,
      npmConfig,
      buildTarget
    );
  }

  // OPTIONAL: now scan and add only target-matching optional deps (general)
  const optionals = await discoverOptionalDeps(
    path.join(tmpBuildDir, 'node_modules')
  );
  await installMatchingOptionals({
    tmpBuildDir,
    optionals,
    target: {
      os: buildTarget.platform,
      cpu: buildTarget.architecture,
      libc: buildTarget.platform === 'linux' ? buildTarget.libc : undefined,
    },
    npmConfig,
  });
}

/* ---------------- helpers ---------------- */

async function rmSafe(p, opts) {
  try {
    await fsp.rm(p, opts);
  } catch {}
}

// Decide which specs are “platform-gated” and should be extracted (not added)
async function splitPrebuiltSpecs(specs, npmConfig) {
  const normalSpecs = [];
  const prebuiltSpecs = [];

  for (const spec of specs) {
    let mani;
    try {
      mani = await pacote.manifest(spec, { npmConfig });
    } catch {
      normalSpecs.push(spec);
      continue;
    }

    const os = Array.isArray(mani.os) ? mani.os : [];
    const cpu = Array.isArray(mani.cpu) ? mani.cpu : [];
    const hasPlatformConstraints =
      os.length ||
      cpu.length ||
      /-(linux|darwin|win|musl|glibc)/i.test(mani.name);

    if (hasPlatformConstraints) prebuiltSpecs.push({ name: mani.name, spec });
    else normalSpecs.push(spec);
  }
  return { normalSpecs, prebuiltSpecs };
}

// Extract user-requested platform packages directly to node_modules (bypasses EBADPLATFORM)
async function extractPrebuiltSpecs(
  tmpBuildDir,
  prebuiltSpecs,
  npmConfig,
  buildTarget
) {
  for (const { name, spec } of prebuiltSpecs) {
    // sanity: if present already, skip
    const dest = path.join(tmpBuildDir, 'node_modules', name);
    if (fs.existsSync(dest)) continue;
    await fsp.mkdir(dest, { recursive: true });
    await pacote.extract(spec, dest, { npmConfig });
    console.log(`[prebuilt+] ${spec}`);
  }
}

// Recursively merge optionalDependencies from installed packages
async function discoverOptionalDeps(nodeModulesRoot) {
  const merged = new Map();
  const q = [nodeModulesRoot];
  while (q.length) {
    const dir = q.shift();
    let ents;
    try {
      ents = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const full = path.join(dir, ent.name);
      if (ent.name.startsWith('@')) {
        q.push(full);
        continue;
      }
      const pkgJson = path.join(full, 'package.json');
      if (fs.existsSync(pkgJson)) {
        try {
          const pkg = JSON.parse(await fsp.readFile(pkgJson, 'utf8'));
          if (
            pkg &&
            pkg.optionalDependencies &&
            typeof pkg.optionalDependencies === 'object'
          ) {
            for (const [n, r] of Object.entries(pkg.optionalDependencies)) {
              if (!merged.has(n)) merged.set(n, String(r));
            }
          }
        } catch {}
        const nested = path.join(full, 'node_modules');
        if (fs.existsSync(nested)) q.push(nested);
      } else {
        q.push(full);
      }
    }
  }
  return merged;
}

// npm semantics helpers (os/cpu/libc)
function listMatches(value, list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes('!' + value)) return false;
  const positives = list.filter((x) => !String(x).startsWith('!'));
  return positives.length ? positives.includes(value) : true;
}
function libcMatches(value, list) {
  if (!value) return true;
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes('!' + value)) return false;
  const positives = list.filter((x) => !String(x).startsWith('!'));
  return positives.length ? positives.includes(value) : true;
}
function nameMatchesTarget(name, { os, cpu, libc }) {
  const n = name.toLowerCase();
  const osOk =
    (os === 'linux' && n.includes('linux')) ||
    (os === 'darwin' && (n.includes('darwin') || n.includes('mac'))) ||
    (os === 'win32' && (n.includes('win32') || n.includes('windows'))) ||
    (!n.includes('linux') &&
      !n.includes('darwin') &&
      !n.includes('mac') &&
      !n.includes('win'));
  const cpuOk =
    (cpu === 'x64' && (n.includes('x64') || n.includes('amd64'))) ||
    (cpu === 'arm64' && n.includes('arm64')) ||
    (cpu === 'arm' && /\barm(?!64)\b/.test(n)) ||
    (!n.includes('x64') && !n.includes('amd64') && !n.includes('arm'));
  if (!osOk || !cpuOk) return false;
  if (os === 'linux') {
    const hasMusl = n.includes('musl');
    const hasGlibc = n.includes('glibc') || n.includes('gnu');
    if (libc === 'musl') return hasMusl; // require musl
    return !hasMusl; // glibc: reject musl variants
  }
  return true;
}

// Add only optionals that match the TARGET; remove stale build/ after
async function installMatchingOptionals({
  tmpBuildDir,
  optionals,
  target,
  npmConfig,
}) {
  if (!optionals || optionals.size === 0) return;
  const extracted = [];
  for (const [name, range] of optionals.entries()) {
    let mani;
    try {
      mani = await pacote.manifest(`${name}@${range}`, { npmConfig });
    } catch {
      continue;
    }
    const os = Array.isArray(mani.os) ? mani.os.map(String) : [];
    const cpu = Array.isArray(mani.cpu) ? mani.cpu.map(String) : [];
    const libc = Array.isArray(mani.libc) ? mani.libc.map(String) : [];
    const matches =
      listMatches(target.os, os) &&
      listMatches(target.cpu, cpu) &&
      libcMatches(target.libc, libc) &&
      nameMatchesTarget(name, target);
    if (!matches) continue;
    const dest = path.join(tmpBuildDir, 'node_modules', name);
    if (fs.existsSync(dest)) continue;
    await fsp.mkdir(dest, { recursive: true });
    await pacote.extract(`${name}@${range}`, dest, { npmConfig });
    extracted.push(name);
    console.log(`[optional+] ${name}@${range}`);
  }
  await pruneBuildDirsForInstalledOptionals(tmpBuildDir, extracted);
}

function inferBaseFromOptional(pkgName) {
  const m = pkgName.match(
    /^(@[^/]+\/)?([^/]+?)(?:[-_](?:linux|linuxmusl|darwin|mac|win|win32).*)$/i
  );
  if (!m) return null;
  const scope = m[1] || '';
  const base = m[2];
  if (scope && base && scope.toLowerCase() === `@${base}`) return base; // @lmdb/lmdb
  return scope && pkgName.startsWith('@parcel/watcher')
    ? '@parcel/watcher'
    : base;
}
async function pruneBuildDirsForInstalledOptionals(
  tmpBuildDir,
  installedOptionals
) {
  const bases = new Set();
  for (const name of installedOptionals) {
    const base = inferBaseFromOptional(name);
    if (base) bases.add(base);
  }
  for (const base of bases) {
    const buildDir = path.join(tmpBuildDir, 'node_modules', base, 'build');
    try {
      await fsp.rm(buildDir, { recursive: true, force: true });
    } catch {}
  }
}

module.exports = { installForTarget };
