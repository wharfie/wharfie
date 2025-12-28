import { existsSync } from 'node:fs';
import { mkdir, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
// eslint-disable-next-line import/no-named-as-default
import Arborist from '@npmcli/arborist';
import pacote from 'pacote';

/**
 * @typedef {import('node:process')['platform']} TargetPlatform
 * @typedef {import('node:process')['arch']} TargetArch
 * @typedef {'glibc' | 'musl'} TargetLibc
 * @typedef BuildTarget
 * @property {string} nodeVersion -
 * @property {TargetPlatform} platform -
 * @property {TargetArch} architecture -
 * @property {TargetLibc} [libc] -
 * @typedef ExternalDep
 * @property {string} name -
 * @property {string} version -
 * @typedef NpmConfigShim
 * @property {(k: string) => unknown} get -
 */

/**
 * Install externals for a specific build target into a temp workspace.
 * @param {{
 *   buildTarget: BuildTarget,
 *   externals: ExternalDep[] | undefined,
 *   tmpBuildDir: string
 * }} params -
 * @returns {Promise<void>}
 */
async function installForTarget({ buildTarget, externals, tmpBuildDir }) {
  if (!externals?.length) return;

  // fresh workspace
  await rmSafe(join(tmpBuildDir, 'node_modules'), {
    recursive: true,
    force: true,
  });
  await rmSafe(join(tmpBuildDir, 'package-lock.json'), { force: true });
  await mkdir(tmpBuildDir, { recursive: true });
  await writeFile(
    join(tmpBuildDir, 'package.json'),
    JSON.stringify({ name: 'install-sandbox', private: true }, null, 2),
  );

  // .npmrc for the target triplet; omit optionals in main pass; don’t run scripts
  await writeFile(
    join(tmpBuildDir, '.npmrc'),
    [
      `platform=${buildTarget.platform}`,
      `arch=${buildTarget.architecture}`,
      `os=${buildTarget.platform}`,
      `cpu=${buildTarget.architecture}`,
      ...(buildTarget.platform === 'linux' && buildTarget.libc
        ? [`libc=${buildTarget.libc}`]
        : []),
      'include=prod',
      'optional=false',
      'omit=optional',
      'ignore-scripts=true',
    ].join('\n'),
  );

  /** @type {NpmConfigShim} */
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
  const specs = (externals || []).map((e) => `${e.name}@${e.version}`);
  const { normalSpecs, prebuiltSpecs } = await splitPrebuiltSpecs(
    specs,
    npmConfig,
  );

  // Build + reify normal specs (no optionals in this pass)
  // eslint-disable-next-line no-console
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

  // eslint-disable-next-line no-console
  console.log('installed', JSON.stringify(normalSpecs), 'in', tmpBuildDir);

  // Explicit user-requested prebuilds (e.g. @img/sharp-linux-x64@0.34.4): extract directly
  if (prebuiltSpecs.length) {
    await extractPrebuiltSpecs(
      tmpBuildDir,
      prebuiltSpecs,
      npmConfig,
      /* _buildTarget: */ buildTarget,
    );
  }

  // OPTIONAL: now scan and add only target-matching optional deps (general)
  const optionals = await discoverOptionalDeps(
    join(tmpBuildDir, 'node_modules'),
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

/**
 * rm but ignore "not exists" and similar errors.
 * @param {string} p -
 * @param {import('node:fs').RmOptions} opts -
 * @returns {Promise<void>}
 */
async function rmSafe(p, opts) {
  try {
    await rm(p, opts);
  } catch {
    // intentionally ignore errors from rm (e.g., ENOENT)
  }
}

/**
 * Decide which specs are “platform-gated” and should be extracted (not added).
 * @param {string[]} specs -
 * @param {NpmConfigShim} npmConfig -
 * @returns {Promise<{ normalSpecs: string[], prebuiltSpecs: Array<{ name: string, spec: string }> }>} -
 */
async function splitPrebuiltSpecs(specs, npmConfig) {
  /** @type {string[]} */
  const normalSpecs = [];
  /** @type {Array<{ name: string, spec: string }>} */
  const prebuiltSpecs = [];

  for (const spec of specs) {
    /** @type {any} */
    let mani;
    try {
      // eslint-disable-next-line import/no-named-as-default-member
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
      /-(linux|darwin|win|musl|glibc)/i.test(String(mani.name));

    if (hasPlatformConstraints) prebuiltSpecs.push({ name: mani.name, spec });
    else normalSpecs.push(spec);
  }
  return { normalSpecs, prebuiltSpecs };
}

/**
 * Extract user-requested platform packages directly to node_modules (bypasses EBADPLATFORM).
 * @param {string} tmpBuildDir -
 * @param {Array<{ name: string, spec: string }>} prebuiltSpecs -
 * @param {NpmConfigShim} npmConfig -
 * @param {BuildTarget} _buildTarget - unused; reserved for future logic
 * @returns {Promise<void>}
 */
async function extractPrebuiltSpecs(
  tmpBuildDir,
  prebuiltSpecs,
  npmConfig,
  _buildTarget,
) {
  for (const { name, spec } of prebuiltSpecs) {
    // sanity: if present already, skip
    const dest = join(tmpBuildDir, 'node_modules', name);
    if (existsSync(dest)) continue;
    await mkdir(dest, { recursive: true });
    // eslint-disable-next-line import/no-named-as-default-member
    await pacote.extract(spec, dest, { npmConfig });
    // eslint-disable-next-line no-console
    console.log(`[prebuilt+] ${spec}`);
  }
}

/**
 * Recursively merge optionalDependencies from installed packages.
 * @param {string} nodeModulesRoot -
 * @returns {Promise<Map<string, string>>} -
 */
async function discoverOptionalDeps(nodeModulesRoot) {
  /** @type {Map<string, string>} */
  const merged = new Map();
  /** @type {string[]} */
  const q = [nodeModulesRoot];

  while (q.length) {
    const dir = q.shift();
    if (!dir) break;

    /** @type {import('node:fs').Dirent[]} */
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      // intentionally ignore unreadable directories
      continue;
    }

    for (const ent of ents) {
      if (!ent.isDirectory()) continue;
      const full = join(dir, ent.name);

      if (ent.name.startsWith('@')) {
        q.push(full);
        continue;
      }

      const pkgJson = join(full, 'package.json');
      if (existsSync(pkgJson)) {
        try {
          /** @type {any} */
          const pkg = JSON.parse(await readFile(pkgJson, 'utf8'));
          if (
            pkg &&
            pkg.optionalDependencies &&
            typeof pkg.optionalDependencies === 'object'
          ) {
            /** @type {Record<string, unknown>} */
            const opt = pkg.optionalDependencies;
            for (const [n, r] of Object.entries(opt)) {
              if (!merged.has(n)) merged.set(n, String(r));
            }
          }
        } catch {
          // intentionally ignore invalid package.json
        }
        const nested = join(full, 'node_modules');
        if (existsSync(nested)) q.push(nested);
      } else {
        q.push(full);
      }
    }
  }

  return merged;
}

/**
 * npm semantics helpers for os/cpu/libc lists.
 * @param {string} value -
 * @param {unknown[]} list -
 * @returns {boolean} -
 */
function listMatches(value, list) {
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes('!' + value)) return false;
  const positives = list.filter((x) => !String(x).startsWith('!'));
  return positives.length ? positives.includes(value) : true;
}

/**
 * libc matcher variant.
 * @param {TargetLibc | undefined} value -
 * @param {unknown[]} list -
 * @returns {boolean} -
 */
function libcMatches(value, list) {
  if (!value) return true;
  if (!Array.isArray(list) || list.length === 0) return true;
  if (list.includes('!' + value)) return false;
  const positives = list.filter((x) => !String(x).startsWith('!'));
  return positives.length ? positives.includes(value) : true;
}

/**
 * Heuristic name check for target (@img/sharp-linux-x64, etc.).
 * @param {string} name -
 * @param {{ os: TargetPlatform, cpu: TargetArch, libc?: TargetLibc }} target -
 * @returns {boolean} -
 */
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
    // glibc: reject musl variants
    return !hasMusl || hasGlibc;
  }

  return true;
}

/**
 * Add only optionals that match the TARGET; then prune build/ dirs for their bases.
 * @param {{
 *   tmpBuildDir: string,
 *   optionals: Map<string, string> | undefined,
 *   target: { os: TargetPlatform, cpu: TargetArch, libc?: TargetLibc },
 *   npmConfig: NpmConfigShim
 * }} args -
 * @returns {Promise<void>}
 */
async function installMatchingOptionals({
  tmpBuildDir,
  optionals,
  target,
  npmConfig,
}) {
  if (!optionals || optionals.size === 0) return;

  /** @type {string[]} */
  const extracted = [];

  for (const [name, range] of optionals.entries()) {
    /** @type {any} */
    let mani;
    try {
      // eslint-disable-next-line import/no-named-as-default-member
      mani = await pacote.manifest(`${name}@${range}`, { npmConfig });
    } catch {
      // skip unresolved optional
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

    const dest = join(tmpBuildDir, 'node_modules', name);
    if (existsSync(dest)) continue;

    await mkdir(dest, { recursive: true });
    // eslint-disable-next-line import/no-named-as-default-member
    await pacote.extract(`${name}@${range}`, dest, { npmConfig });
    extracted.push(name);
    // eslint-disable-next-line no-console
    console.log(`[optional+] ${name}@${range}`);
  }

  await pruneBuildDirsForInstalledOptionals(tmpBuildDir, extracted);
}

/**
 * Infer a base package from an optional’s platform-specific name.
 * @param {string} pkgName -
 * @returns {string | null} -
 */
function inferBaseFromOptional(pkgName) {
  const m = pkgName.match(
    /^(@[^/]+\/)?([^/]+?)(?:[-_](?:linux|linuxmusl|darwin|mac|win|win32).*)$/i,
  );
  if (!m) return null;
  const scope = m[1] || '';
  const base = m[2];

  // e.g. @lmdb/lmdb (scope equals base)
  if (scope && base && scope.toLowerCase() === `@${base}`) return base;

  return scope && pkgName.startsWith('@parcel/watcher')
    ? '@parcel/watcher'
    : base;
}

/**
 * Remove build/ directories from the base packages of installed optionals.
 * @param {string} tmpBuildDir -
 * @param {string[]} installedOptionals -
 * @returns {Promise<void>} -
 */
async function pruneBuildDirsForInstalledOptionals(
  tmpBuildDir,
  installedOptionals,
) {
  const bases = new Set(/** @type {string[]} */ ([]));

  for (const name of installedOptionals) {
    const base = inferBaseFromOptional(name);
    if (base) bases.add(base);
  }

  for (const base of bases) {
    const buildDir = join(tmpBuildDir, 'node_modules', base, 'build');
    try {
      await rm(buildDir, { recursive: true, force: true });
    } catch {
      // ignore failures removing build dir
    }
  }
}

export { installForTarget };
