#!/usr/bin/env node
/* eslint-disable node/shebang */
/* eslint-disable no-console */

/**
 * Cross-Compile Single Executable App for:
 *   - darwin, windows, linux
 *   - x64, arm64
 *
 * Usage:
 *   1) All combos: ./build.js
 *   2) Single combo: ./build.js --platform windows --arch x64
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const esbuild = require('./lambdas/lib/esbuild');
const https = require('https');
const http = require('http');
const JSZip = require('jszip');
// eslint-disable-next-line node/no-unpublished-require
const tar = require('tar');
const {
  dependencies: { esbuild: esbuildVersion },
} = require('./package.json');

const DEFAULT_BUILDS = [
  ['darwin', 'x64'],
  ['darwin', 'arm64'],
  ['windows', 'x64'],
  ['windows', 'arm64'],
  ['linux', 'x64'],
  ['linux', 'arm64'],
];

// Update this to the "latest Node 22 version" you want to use.
// In reality, you'd confirm what's actually available at nodejs.org.
// const DEFAULT_NODE_VERSION = '22.13.1';
const DEFAULT_NODE_VERSION = '23.9.0';
// const DEFAULT_NODE_VERSION = '23.6.0';

(async () => {
  // Parse CLI args
  const args = process.argv.slice(2);
  let platformArg = '';
  let archArg = '';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform') {
      platformArg = args[i + 1];
      i++;
    } else if (args[i] === '--arch') {
      archArg = args[i + 1];
      i++;
    }
  }

  // If no --platform/--arch provided, build all combos
  const combos = [];
  if (!platformArg && !archArg) {
    for (const combo of DEFAULT_BUILDS) {
      combos.push(combo);
    }
  } else {
    combos.push([platformArg, archArg]);
  }

  // Build each combo in sequence
  for (const [platform, arch] of combos) {
    await runBuild(platform, arch);
  }

  console.log('\n\x1b[32mAll requested builds have finished.\x1b[0m');
})().catch((err) => {
  console.error(err);
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});

/**
 * Build a single (platform, arch) combo.
 * @param {string} platform -
 * @param {string} arch -
 */
async function runBuild(platform, arch) {
  console.log('');
  console.log('=================================================');
  console.log(` Building for PLATFORM=${platform}, ARCH=${arch}`);
  console.log('=================================================');

  // 1) Prepare directories + names
  const TMP_DIR = path.resolve(path.join('tmp', `${platform}-${arch}`));
  const DIST_DIR = path.join('dist');
  const WHARFIE_BASENAME = 'wharfie';

  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // Decide final binary name (.exe on Windows)
  let outputName = WHARFIE_BASENAME;
  if (platform === 'windows') {
    outputName += '.exe';
  }

  // Dist file name (include platform & arch)
  let distFile = `${WHARFIE_BASENAME}-${platform}-${arch}`;
  if (platform === 'windows') {
    distFile += '.exe';
  }

  // 2) esbuild Lambdas + CLI using Node API
  await buildWithEsbuild('lambdas/daemon.js', path.join(TMP_DIR, 'daemon.js'));
  await buildWithEsbuild('lambdas/events.js', path.join(TMP_DIR, 'events.js'));
  await buildWithEsbuild(
    'lambdas/monitor.js',
    path.join(TMP_DIR, 'monitor.js')
  );
  await buildWithEsbuild(
    'lambdas/cleanup.js',
    path.join(TMP_DIR, 'cleanup.js')
  );
  await buildWithEsbuild('bin/wharfie', path.join(TMP_DIR, 'wharfie.js'));

  console.log(`\x1b[32m✔ esbuild done for ${platform}-${arch}\x1b[0m`);

  // Resolve the directory where esbuild is installed.
  const esbuildBinaryLocation = await fetchEsbuildBinary(platform, arch);

  // 3) SEA blob generation — dynamically create sea-config.json
  const seaConfigPath = path.join(TMP_DIR, 'sea-config.json');
  const seaConfig = {
    main: path.join(TMP_DIR, 'wharfie.js'),
    output: path.join(TMP_DIR, 'wharfie.blob'),
    disableExperimentalSEAWarning: true,
    useSnapshot: true,
    assets: {
      '<WHARFIE_BUILT_IN>/daemon.handler': path.join(TMP_DIR, 'daemon.js'),
      '<WHARFIE_BUILT_IN>/cleanup.handler': path.join(TMP_DIR, 'cleanup.js'),
      '<WHARFIE_BUILT_IN>/events.handler': path.join(TMP_DIR, 'events.js'),
      '<WHARFIE_BUILT_IN>/monitor.handler': path.join(TMP_DIR, 'monitor.js'),
      esbuildBin: esbuildBinaryLocation,
    },
  };
  fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2), 'utf8');
  runCmd('node', ['--no-warnings', '--experimental-sea-config', seaConfigPath]);

  // 4) Fetch or get the Node binary
  const nodeBinary = await fetchOrGetNodeBinary(platform, arch);
  const nodeBinaryPath = path.join(TMP_DIR, outputName);
  fs.copyFileSync(nodeBinary, nodeBinaryPath);

  // 5) Remove signature if macOS (placeholder)
  if (platform === 'darwin') {
    console.log('Removing macOS signature... (placeholder)');
    // For real usage (with osxcross + ldid/codesign):
    runCmd('codesign', ['--remove-signature', nodeBinaryPath]);
    // or:
    // runCmd('ldid', ['-S', nodeBinaryPath]);
  }

  // 6) Inject the SEA blob (postject)
  runPostject(nodeBinaryPath, path.join(TMP_DIR, 'wharfie.blob'), platform);

  // 7) Sign the binary (placeholder)
  if (platform === 'darwin') {
    setupMacKeychain();
    // ---- NEW: Write entitlements.plist to a tmp file ----
    const entitlementsPath = path.join(TMP_DIR, 'entitlements.plist');
    writeEntitlements(entitlementsPath);

    console.log('Signing macOS binary...');
    runCmd('codesign', [
      '--force',
      '--deep',
      '--verify',
      '--options',
      'runtime',
      '--sign',
      // Make sure quotes are correct. Sometimes passing the certificate name with quotes
      // inside the array can be tricky; you might need to remove the extra quotes:
      'Developer ID Application: Joseph Van Drunen (F84MQ242HH)',
      '--entitlements',
      entitlementsPath,
      nodeBinaryPath,
    ]);
  } else if (platform === 'windows') {
    // e.g. osslsigncode usage
  }

  // 8) Copy final artifact to dist/
  fs.copyFileSync(nodeBinaryPath, path.join(DIST_DIR, distFile));
  console.log(
    `\x1b[32m✔ Build complete: ${path.join(DIST_DIR, distFile)}\x1b[0m`
  );
}

/**
 * Build a single entry with esbuild's Node API.
 * @param {string} entryPoint -
 * @param {string} outFile -
 */
async function buildWithEsbuild(entryPoint, outFile) {
  // Generate an entry that requires the module and immediately calls the handler.
  const entryCode = `
  require('v8').startupSnapshot.setDeserializeMainFunction(() => {
    require('./${entryPoint}')
  });`;
  const { errors, warnings } = await esbuild.build({
    stdin: {
      contents: entryCode,
      resolveDir: process.cwd(),
      sourcefile: 'snapshot-entry.js',
    },
    outfile: outFile,
    bundle: true,
    platform: 'node',
    minify: true,
    keepNames: true,
    sourcemap: 'inline',
    target: 'node23',
    logLevel: 'silent',
  });
  if (errors.length > 0) {
    console.error(errors);
    // eslint-disable-next-line no-process-exit
    process.exit(1);
  }
  if (warnings.length > 0) {
    // console.warn(warnings);
  }
}

/**
 * If we already have a esbuild binary for (platform, arch) in ./esbuild_binaries/,
 * use it; otherwise, download from nodejs.org and extract.
 * @param {string} platform -
 * @param {string} arch -
 * @returns {Promise<string>} - Path to the Node binary.
 */
async function fetchEsbuildBinary(platform, arch) {
  const buildMap = {
    'darwin-x64': '@esbuild/darwin-x64',
    'darwin-arm64': '@esbuild/darwin-arm64',
    'windows-x64': '@esbuild/win32-x64',
    'windows-arm64': '@esbuild/win32-arm64',
    'linux-x64': '@esbuild/linux-x64',
    'linux-arm64': '@esbuild/linux-arm64',
  };
  const esbuildBinariesDir = path.join(__dirname, 'esbuild_binaries');
  if (!fs.existsSync(esbuildBinariesDir)) {
    fs.mkdirSync(esbuildBinariesDir, { recursive: true });
  }

  let binaryName = `esbuild-${platform}-${arch}`;
  if (platform === 'windows') {
    binaryName += '.exe';
  }
  const localPath = path.join(esbuildBinariesDir, binaryName);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  console.log(`esbuild binary not found locally: ${binaryName}`);
  // @ts-ignore
  const packageName = buildMap[`${platform}-${arch}`];
  const metadataUrl = `https://registry.npmjs.org/${packageName}/${esbuildVersion}`;

  console.log(`Downloading metadata from npm.org ${metadataUrl}...`);
  const packageMetadata = JSON.parse(await download(metadataUrl));
  console.log(packageMetadata);
  const tarballUrl = packageMetadata.dist.tarball;

  const archiveName = `esbuild-${platform}-${arch}.tar.gz`;
  const archivePath = path.join(esbuildBinariesDir, archiveName);

  console.log(`Downloading tar from npm.org ${tarballUrl}...`);
  await downloadFile(tarballUrl, archivePath);
  console.log(`Extracting ${archivePath}...`);

  // Extract esbuild binary
  const extractDir = `${archivePath}-extract`;
  fs.mkdirSync(extractDir, { recursive: true });

  await tar.extract({
    file: archivePath,
    cwd: extractDir,
    strict: true,
  });

  const subDirs = fs.readdirSync(extractDir);
  if (subDirs.length !== 1) {
    throw new Error(
      `Expected exactly 1 top-level dir in tar, got: ${subDirs.length}`
    );
  }
  let esbuildBinary;
  if (platform === 'windows') {
    esbuildBinary = path.join(extractDir, subDirs[0], 'esbuild.exe');
  } else {
    esbuildBinary = path.join(extractDir, subDirs[0], 'bin', 'esbuild');
  }
  if (!fs.existsSync(esbuildBinary)) {
    throw new Error(`esbuild binary not found at: ${esbuildBinary}`);
  }

  // Move out of the temp extraction to localPath
  fs.renameSync(esbuildBinary, localPath);

  // Cleanup archive
  fs.unlinkSync(archivePath);

  console.log(`✔ Downloaded & extracted esbuild binary to ${localPath}`);
  return localPath;
}

/**
 * If we already have a Node binary for (platform, arch, version) in ./node_binaries/,
 * use it; otherwise, download from nodejs.org and extract.
 * @param {string} platform -
 * @param {string} arch -
 * @returns {Promise<string>} - Path to the Node binary.
 */
async function fetchOrGetNodeBinary(platform, arch) {
  const nodeBinariesDir = path.join(__dirname, 'node_binaries');
  if (!fs.existsSync(nodeBinariesDir)) {
    fs.mkdirSync(nodeBinariesDir, { recursive: true });
  }

  let binaryName = `node-${platform}-${arch}-${DEFAULT_NODE_VERSION}`;
  if (platform === 'windows') {
    binaryName += '.exe';
  }
  const localPath = path.join(nodeBinariesDir, binaryName);

  if (fs.existsSync(localPath)) {
    return localPath;
  }

  console.log(`Node binary not found locally: ${binaryName}`);

  // Construct official Node download URL
  const nodeDownloadUrl = getNodeDownloadUrl(
    DEFAULT_NODE_VERSION,
    platform,
    arch
  );
  console.log(`Downloading from nodejs.org ${nodeDownloadUrl}...`);
  const archiveExt = platform === 'windows' ? '.zip' : '.tar.gz';
  const archiveName = `node-${platform}-${arch}${archiveExt}`;
  const archivePath = path.join(nodeBinariesDir, archiveName);

  // Download the archive
  await downloadFile(nodeDownloadUrl, archivePath);
  console.log(`Extracting ${archivePath}...`);

  // Extract node binary
  let extractedBinary;
  if (platform === 'windows') {
    extractedBinary = await extractNodeWindowsZip(archivePath);
  } else {
    extractedBinary = await extractNodeUnixTar(archivePath);
  }

  // Move out of the temp extraction to localPath
  fs.renameSync(extractedBinary, localPath);

  // Cleanup archive
  fs.unlinkSync(archivePath);

  console.log(`✔ Downloaded & extracted Node binary to ${localPath}`);
  return localPath;
}

/**
 * Generate official Node download URL from nodejs.org.
 * E.g. node-v22.0.0-linux-x64.tar.xz or node-v22.0.0-win-x64.zip
 * @param {string} version -
 * @param {string} platform -
 * @param {string} arch -
 * @returns {string} - Download URL.
 */
function getNodeDownloadUrl(version, platform, arch) {
  let platformPart = platform;
  if (platform === 'windows') {
    platformPart = 'win';
  }
  const fileArch = arch;
  const filename = `node-v${version}-${platformPart}-${fileArch}`;
  const suffix = platform === 'windows' ? '.zip' : '.tar.gz';

  return `https://nodejs.org/dist/v${version}/${filename}${suffix}`;
}

/**
 * Download a file from HTTP/HTTPS, store at destPath.
 * @param {string} url -
 * @param {string} destPath -
 */
async function downloadFile(url, destPath) {
  const fileStream = fs.createWriteStream(destPath);
  const protocol = url.startsWith('https:') ? https : http;

  await new Promise((resolve, reject) => {
    protocol
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed with status: ${res.statusCode}`));
          return;
        }
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close(resolve);
        });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Download a file from HTTP/HTTPS, return as string
 * @param {string} url -
 * @returns {Promise<string>} - File contents as string.
 */
async function download(url) {
  const protocol = url.startsWith('https:') ? https : http;
  return await new Promise((resolve, reject) => {
    protocol
      .get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve(data);
        });
      })
      .on('error', (err) => {
        reject(err);
      });
  });
}

/**
 * Extract a .tar.xz and return the path to the extracted 'node' binary.
 * @param {string} archivePath -
 * @returns {Promise<string>} - Path to the extracted 'node' binary.
 */
async function extractNodeUnixTar(archivePath) {
  // Extract to a new folder
  const extractDir = `${archivePath}-extract`;
  fs.mkdirSync(extractDir, { recursive: true });

  await tar.extract({
    file: archivePath,
    cwd: extractDir,
    strict: true,
  });

  // e.g. node-v22.0.0-linux-x64/bin/node
  const subDirs = fs.readdirSync(extractDir);
  if (subDirs.length !== 1) {
    throw new Error(
      `Expected exactly 1 top-level dir in tar, got: ${subDirs.length}`
    );
  }

  const nodeBinary = path.join(extractDir, subDirs[0], 'bin', 'node');
  if (!fs.existsSync(nodeBinary)) {
    throw new Error(`Node binary not found at: ${nodeBinary}`);
  }

  return nodeBinary;
}

/**
 * Extract a .zip for Windows, returning path to the 'node.exe'.
 * Uses JSZip for in-memory extraction.
 * @param {string} archivePath -
 * @returns {Promise<string>} - Path to the extracted 'node.exe' binary.
 */
async function extractNodeWindowsZip(archivePath) {
  const zipData = fs.readFileSync(archivePath);
  const jszip = new JSZip();
  const zip = await jszip.loadAsync(zipData);

  // Typically: node-v22.0.0-win-x64/node.exe
  let nodeExePath = '';
  const extractDir = `${archivePath}-extract`;
  fs.mkdirSync(extractDir, { recursive: true });

  // Iterate through zip files
  const fileNames = Object.keys(zip.files);
  // We want something like: "node.exe" in "node-v22.0.0-win-x64/"
  for (const fname of fileNames) {
    if (/\/node\.exe$/.test(fname)) {
      nodeExePath = fname;
      break;
    }
  }
  if (!nodeExePath) {
    throw new Error('Could not find node.exe in the downloaded zip');
  }

  // Extract just node.exe
  const fileData = await zip.files[nodeExePath].async('nodebuffer');

  // We'll place it in extractDir/node.exe
  const finalPath = path.join(extractDir, 'node.exe');
  fs.writeFileSync(finalPath, fileData);

  return finalPath;
}

/**
 * Inject the SEA blob into the provided binary, using postject.
 * @param {string} binaryPath -
 * @param {string} blobPath -
 * @param {string} platform -
 */
function runPostject(binaryPath, blobPath, platform) {
  const args = [
    binaryPath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  ];
  if (platform === 'darwin') {
    args.push('--macho-segment-name', 'NODE_SEA');
  }
  runCmd('npx', ['postject', ...args]);
}

/**
 * Run a shell command and throw on error.
 * @param {string} cmd -
 * @param {string[]} args -
 */
function runCmd(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
}

/**
 * Setup the macOS keychain for signing.
 */
function setupMacKeychain() {
  const { MACOS_CERT_BASE64, MACOS_CERT_PASS, MACOS_KEYCHAIN_PASS } =
    process.env;

  if (!MACOS_CERT_BASE64 || !MACOS_CERT_PASS || !MACOS_KEYCHAIN_PASS) {
    console.warn(
      'Skipping keychain setup: environment variables not set (MACOS_CERT_BASE64, MACOS_CERT_PASS, MACOS_KEYCHAIN_PASS).'
    );
    return;
  }

  // Path to keychain
  const keychainPath = '/tmp/build.keychain';

  // Check if this keychain is already listed
  // We'll parse the output of `security list-keychains`
  const listResult = spawnSync('security', ['list-keychains'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  if (listResult.status !== 0) {
    throw new Error('Failed to run "security list-keychains"');
  }

  const stdout = listResult.stdout.toString();
  if (stdout.includes(keychainPath)) {
    console.log(
      `Keychain ${keychainPath} already exists. Skipping keychain setup.`
    );
    return; // Early return, so we don’t recreate or re-import.
  }

  // 1) Create a temporary keychain (in /tmp or in memory)
  runCmd('security', [
    'create-keychain',
    '-p',
    MACOS_KEYCHAIN_PASS,
    '/tmp/build.keychain',
  ]);

  // 2) Unlock it
  runCmd('security', [
    'unlock-keychain',
    '-p',
    MACOS_KEYCHAIN_PASS,
    '/tmp/build.keychain',
  ]);

  // 3) Make it the default keychain (so codesign uses it)
  runCmd('security', ['default-keychain', '-s', '/tmp/build.keychain']);

  // 4) Set timeout so it doesn’t lock immediately
  runCmd('security', [
    'set-keychain-settings',
    '-t',
    '3600',
    '-u',
    '/tmp/build.keychain',
  ]);

  // 5) Decode & import the p12
  fs.writeFileSync(
    '/tmp/devcert.p12',
    Buffer.from(MACOS_CERT_BASE64, 'base64')
  );
  runCmd('security', [
    'import',
    '/tmp/devcert.p12',
    '-k',
    '/tmp/build.keychain',
    '-P',
    MACOS_CERT_PASS,
    '-T',
    '/usr/bin/codesign',
  ]);

  // 6) Allow codesign to access the key
  runCmd('security', [
    'set-key-partition-list',
    '-S',
    'apple-tool:,apple:',
    '-s',
    '-k',
    MACOS_KEYCHAIN_PASS,
    '/tmp/build.keychain',
  ]);

  console.log('✔ macOS keychain setup complete.');
}

/**
 * write entitlements
 * @param {string} entitlementsPath -
 */
function writeEntitlements(entitlementsPath) {
  const contents = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
</dict>
</plist>
`;
  fs.writeFileSync(entitlementsPath, contents, 'utf8');
  console.log(`✔ Wrote entitlements to ${entitlementsPath}`);
}
