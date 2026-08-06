import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(SCRIPT_ROOT, '..');
export const PACKAGE_NAME = '@wharfie/wharfie';
export const SUPPORTED_NODE_RANGE = '>=24.13.1 <25';
export const CANONICAL_NPM_REGISTRY = 'https://registry.npmjs.org';
const CANONICAL_REPOSITORY = 'https://github.com/wharfie/wharfie';
const RELEASE_WORKFLOW_PATH = '.github/workflows/release-preview.yml';
const INTOTO_STATEMENT_V1 = 'https://in-toto.io/Statement/v1';
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';
const GITHUB_ACTIONS_BUILD_TYPE =
  'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1';
const GITHUB_HOSTED_BUILDER = 'https://github.com/actions/runner/github-hosted';
const DSSE_PAYLOAD_TYPE = 'application/vnd.in-toto+json';
const MAX_DSSE_PAYLOAD_BYTES = 64 * 1024;
// This prefix is part of the copied starter's fail-closed builder-hiding
// contract. Keep it aligned with examples/hello-world/scripts/demo.js.
export const PROOF_PREFIX = 'wharfie-magnetic-first-run-';
export const REQUIRED_STARTER_FILES = Object.freeze([
  'README.md',
  'app/hello.js',
  'app/local.js',
  'app/wharfie.app.js',
  'package.json',
  'playground/README.md',
  'scripts/demo.js',
  'showcase/resumable-hello/README.md',
  'showcase/resumable-hello/app/hello.js',
  'showcase/resumable-hello/app/local.js',
  'showcase/resumable-hello/app/wharfie.app.js',
  'showcase/resumable-hello/test/hello.test.js',
  'test/hello.test.js',
]);

/**
 * @typedef PreviewConsumerOptions
 * @property {string} [candidateTarball] - npm tarball packed by the clean candidate job.
 * @property {string} [registryManifest] - Published release manifest used for registry proof.
 */

/**
 * @param {string[]} argv - Command arguments.
 * @returns {PreviewConsumerOptions} - Bounded consumer-proof options.
 */
export function parsePreviewConsumerArgs(argv) {
  if (argv.length !== 2 || argv[1].length === 0) {
    throw new TypeError(
      'Usage: node scripts/verify-preview-consumer.js (--candidate-tarball <path> | --registry-manifest <path>)',
    );
  }
  if (argv[0] === '--candidate-tarball') {
    return Object.freeze({ candidateTarball: argv[1] });
  }
  if (argv[0] === '--registry-manifest') {
    return Object.freeze({ registryManifest: argv[1] });
  }
  throw new TypeError(
    'Usage: node scripts/verify-preview-consumer.js (--candidate-tarball <path> | --registry-manifest <path>)',
  );
}

/**
 * @param {string} filePath - JSON path.
 * @returns {Record<string, any>} - Parsed JSON.
 */
function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * @param {unknown} value - Candidate object.
 * @param {string} label - Diagnostic label.
 * @returns {Record<string, any>} Object value.
 */
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }
  return /** @type {Record<string, any>} */ (value);
}

/**
 * @param {unknown} value - Candidate canonical SHA-512 SRI.
 * @param {string} label - Diagnostic label.
 * @returns {string} Lowercase SHA-512 hex digest.
 */
function decodeSha512Integrity(value, label) {
  if (typeof value !== 'string' || !value.startsWith('sha512-')) {
    throw new TypeError(`${label} must be an SHA-512 SRI value.`);
  }
  const encoded = value.slice('sha512-'.length);
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      encoded,
    )
  ) {
    throw new TypeError(`${label} must use canonical base64.`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== encoded) {
    throw new TypeError(`${label} must encode exactly one SHA-512 digest.`);
  }
  return bytes.toString('hex');
}

/**
 * @param {unknown} value - Candidate canonical registry URL.
 * @param {string} label - Diagnostic label.
 * @returns {void}
 */
function assertCanonicalRegistry(value, label) {
  if (typeof value !== 'string') {
    throw new TypeError(`${label} must be a canonical registry URL.`);
  }
  let registry;
  try {
    registry = new URL(value);
  } catch (error) {
    throw new TypeError(`${label} must be a canonical registry URL.`, {
      cause: error,
    });
  }
  assert.equal(
    registry.origin,
    CANONICAL_NPM_REGISTRY,
    `${label} must use the canonical npm registry`,
  );
  assert.equal(registry.pathname, '/', `${label} must name the registry root`);
  assert.equal(registry.username, '', `${label} must not contain credentials`);
  assert.equal(registry.password, '', `${label} must not contain credentials`);
  assert.equal(registry.search, '', `${label} must not contain a query`);
  assert.equal(registry.hash, '', `${label} must not contain a fragment`);
}

/**
 * Strictly decode one bounded DSSE JSON payload after pinned npm has verified
 * its Sigstore bundle.
 * @param {unknown} value - Candidate Sigstore bundle.
 * @returns {Record<string, any>} Strict JSON statement.
 */
function decodeVerifiedDsseStatement(value) {
  const bundle = requireObject(value, 'npm verified attestation bundle');
  const envelope = requireObject(
    bundle.dsseEnvelope,
    'npm verified attestation DSSE envelope',
  );
  assert.equal(
    envelope.payloadType,
    DSSE_PAYLOAD_TYPE,
    'npm verified attestation must use the in-toto DSSE payload type',
  );
  assert.ok(
    Array.isArray(envelope.signatures) && envelope.signatures.length > 0,
    'npm verified attestation DSSE envelope must contain a signature',
  );
  for (const signature of envelope.signatures) {
    const candidate = requireObject(
      signature,
      'npm verified attestation DSSE signature',
    );
    assert.equal(
      typeof candidate.sig === 'string' && candidate.sig.length > 0,
      true,
      'npm verified attestation DSSE signature must be nonempty',
    );
  }

  const payload = envelope.payload;
  const maximumEncodedLength = Math.ceil(MAX_DSSE_PAYLOAD_BYTES / 3) * 4;
  if (
    typeof payload !== 'string' ||
    payload.length === 0 ||
    payload.length > maximumEncodedLength ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      payload,
    )
  ) {
    throw new TypeError(
      'npm verified attestation DSSE payload must be bounded canonical base64.',
    );
  }
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_DSSE_PAYLOAD_BYTES) {
    throw new TypeError(
      'npm verified attestation DSSE payload must be bounded canonical base64.',
    );
  }
  if (bytes.toString('base64') !== payload) {
    throw new TypeError(
      'npm verified attestation DSSE payload has a noncanonical encoding.',
    );
  }
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new TypeError(
      'npm verified attestation DSSE payload must be canonical UTF-8.',
    );
  }
  let statement;
  try {
    statement = requireObject(
      JSON.parse(text),
      'npm verified attestation statement',
    );
  } catch (error) {
    throw new TypeError(
      'npm verified attestation DSSE payload must contain one JSON statement.',
      { cause: error },
    );
  }
  if (JSON.stringify(statement) !== text) {
    throw new TypeError(
      'npm verified attestation DSSE payload must use compact unambiguous JSON.',
    );
  }
  return statement;
}

/**
 * @param {string} command - Executable.
 * @param {string[]} args - Arguments.
 * @param {{cwd: string, env?: NodeJS.ProcessEnv, capture?: boolean, timeout?: number}} options - Spawn options.
 * @returns {{stdout: string, stderr: string}} - Command output.
 */
function runCommand(command, args, options) {
  const capture = options.capture === true;
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: capture ? 'utf8' : undefined,
    stdio: capture ? 'pipe' : 'inherit',
    timeout: options.timeout,
    ...(options.timeout === undefined ? {} : { killSignal: 'SIGKILL' }),
    maxBuffer: capture ? 20 * 1024 * 1024 : undefined,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = [
      `${command} ${args.join(' ')} exited with status ${String(result.status)}`,
      capture && result.stdout ? `stdout:\n${String(result.stdout)}` : '',
      capture && result.stderr ? `stderr:\n${String(result.stderr)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    throw new Error(details);
  }
  return {
    stdout: capture ? String(result.stdout || '') : '',
    stderr: capture ? String(result.stderr || '') : '',
  };
}

/**
 * @param {Record<string, any>} candidate - `npm pack --json` result.
 * @param {Record<string, any>} packageMetadata - Repository package metadata.
 * @returns {void}
 */
export function assertCandidatePackage(candidate, packageMetadata) {
  assert.equal(candidate.name, PACKAGE_NAME);
  assert.equal(candidate.version, packageMetadata.version);
  assert.match(candidate.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/u);
  const candidateFiles = /** @type {Array<{path?: string}>} */ (
    candidate.files || []
  );
  const packedFiles = new Set(candidateFiles.map((entry) => entry.path));
  for (const relativePath of REQUIRED_STARTER_FILES) {
    assert.ok(
      packedFiles.has(`examples/hello-world/${relativePath}`),
      `Candidate package is missing hello-world starter file ${relativePath}.`,
    );
  }
}

/**
 * @param {Record<string, any>} manifest - Downloaded release manifest.
 * @param {Record<string, any>} packageMetadata - Checked-out package metadata.
 * @returns {Record<string, any>} - Exact core npm artifact.
 */
export function assertRegistryReleaseManifest(manifest, packageMetadata) {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.kind, 'wharfie.preview-release');
  assert.equal(manifest.package, PACKAGE_NAME);
  assert.equal(manifest.version, packageMetadata.version);
  assert.equal(manifest.tag, `v${packageMetadata.version}`);
  const source = requireObject(manifest.source, 'Registry release source');
  assert.equal(
    source.repository,
    CANONICAL_REPOSITORY,
    'Registry release source repository must be authoritative',
  );
  assert.match(
    source.commit,
    /^[a-f0-9]{40}$/u,
    'Registry release source commit must be a full lowercase Git commit ID',
  );
  assert.ok(Array.isArray(manifest.artifacts));
  const npmArtifacts = manifest.artifacts.filter(
    (artifact) => artifact?.kind === 'npm-package',
  );
  assert.equal(npmArtifacts.length, 1);
  const [artifact] = npmArtifacts;
  assert.equal(artifact.package, PACKAGE_NAME);
  assert.equal(artifact.version, packageMetadata.version);
  assert.equal(artifact.publication, 'npm-preview');
  decodeSha512Integrity(artifact.integrity, 'Registry npm artifact integrity');
  assert.match(artifact.npmShasum, /^[a-f0-9]{40}$/u);
  return artifact;
}

/**
 * Join pinned npm's successfully verified attestation output to the exact
 * authoritative release manifest and reject any provenance ambiguity.
 * @param {unknown} rawAudit - `npm audit signatures --json --include-attestations` output.
 * @param {Record<string, any>} manifest - Authoritative release manifest.
 * @param {Record<string, any>} artifact - Exact manifest npm artifact.
 * @returns {Record<string, any>} Validated SLSA v1 statement.
 */
export function assertRegistryAuditProvenance(rawAudit, manifest, artifact) {
  const audit = requireObject(rawAudit, 'npm signature audit');
  assert.deepEqual(
    audit.invalid,
    [],
    'npm signature audit must not contain invalid packages',
  );
  assert.deepEqual(
    audit.missing,
    [],
    'npm signature audit must not contain packages with missing signatures',
  );
  assert.ok(
    Array.isArray(audit.verified),
    'npm signature audit must expose verified attestation details',
  );
  const packageEntries = audit.verified.filter(
    (entry) => entry?.name === PACKAGE_NAME,
  );
  assert.equal(
    packageEntries.length,
    1,
    `npm signature audit must contain one verified ${PACKAGE_NAME} entry`,
  );
  const entry = requireObject(
    packageEntries[0],
    `npm signature audit ${PACKAGE_NAME} entry`,
  );
  assert.equal(
    entry.version,
    manifest.version,
    'npm verified package version must match the release manifest',
  );
  assert.equal(
    entry.location,
    `node_modules/${PACKAGE_NAME}`,
    'npm verified package location must select the installed release package',
  );
  assertCanonicalRegistry(entry.registry, 'npm verified package registry');

  const attestations = requireObject(
    entry.attestations,
    'npm verified package attestation metadata',
  );
  const provenanceMetadata = requireObject(
    attestations.provenance,
    'npm verified package provenance metadata',
  );
  assert.equal(
    provenanceMetadata.predicateType,
    SLSA_PROVENANCE_V1,
    'npm verified package metadata must advertise SLSA provenance v1',
  );
  assert.ok(
    Array.isArray(entry.attestationBundles),
    'npm verified package must expose its verified attestation bundles',
  );
  const provenanceBundles = entry.attestationBundles.filter(
    (candidate) => candidate?.predicateType === SLSA_PROVENANCE_V1,
  );
  assert.equal(
    provenanceBundles.length,
    1,
    'npm verified package must contain one SLSA provenance v1 bundle',
  );
  const provenanceBundle = requireObject(
    provenanceBundles[0],
    'npm verified SLSA provenance bundle',
  );
  const statement = decodeVerifiedDsseStatement(provenanceBundle.bundle);
  assert.equal(
    statement._type,
    INTOTO_STATEMENT_V1,
    'npm provenance must be an in-toto Statement v1',
  );
  assert.equal(
    statement.predicateType,
    SLSA_PROVENANCE_V1,
    'npm provenance statement must use SLSA provenance v1',
  );

  assert.ok(
    Array.isArray(statement.subject) && statement.subject.length === 1,
    'npm provenance statement must contain one exact package subject',
  );
  const subject = requireObject(
    statement.subject[0],
    'npm provenance package subject',
  );
  assert.equal(
    subject.name,
    `pkg:npm/%40wharfie/wharfie@${manifest.version}`,
    'npm provenance subject must bind the exact package and version',
  );
  const subjectDigest = requireObject(
    subject.digest,
    'npm provenance package subject digest',
  );
  assert.deepEqual(
    subjectDigest,
    {
      sha512: decodeSha512Integrity(
        artifact.integrity,
        'Registry npm artifact integrity',
      ),
    },
    'npm provenance subject must bind the manifest SHA-512',
  );

  const predicate = requireObject(
    statement.predicate,
    'npm SLSA provenance predicate',
  );
  const buildDefinition = requireObject(
    predicate.buildDefinition,
    'npm SLSA build definition',
  );
  assert.equal(
    buildDefinition.buildType,
    GITHUB_ACTIONS_BUILD_TYPE,
    'npm provenance must use the GitHub Actions workflow build type',
  );
  const externalParameters = requireObject(
    buildDefinition.externalParameters,
    'npm SLSA external parameters',
  );
  assert.deepEqual(
    Object.keys(externalParameters).sort(),
    ['workflow'],
    'npm provenance external parameters must contain only the workflow identity',
  );
  const workflow = requireObject(
    externalParameters.workflow,
    'npm SLSA workflow parameters',
  );
  const tagRef = `refs/tags/${manifest.tag}`;
  assert.deepEqual(
    workflow,
    {
      ref: tagRef,
      repository: CANONICAL_REPOSITORY,
      path: RELEASE_WORKFLOW_PATH,
    },
    'npm provenance must bind the exact repository, tag, and release workflow',
  );
  const internalParameters = requireObject(
    buildDefinition.internalParameters,
    'npm SLSA internal parameters',
  );
  const github = requireObject(
    internalParameters.github,
    'npm SLSA GitHub parameters',
  );
  assert.equal(
    github.event_name,
    'push',
    'npm provenance must bind a GitHub push event',
  );
  assert.ok(
    Array.isArray(buildDefinition.resolvedDependencies) &&
      buildDefinition.resolvedDependencies.length === 1,
    'npm provenance must contain one resolved source dependency',
  );
  assert.deepEqual(
    buildDefinition.resolvedDependencies[0],
    {
      uri: `git+${CANONICAL_REPOSITORY}@${tagRef}`,
      digest: { gitCommit: manifest.source.commit },
    },
    'npm provenance must bind the manifest source commit and tag ref',
  );
  const runDetails = requireObject(
    predicate.runDetails,
    'npm SLSA run details',
  );
  const builder = requireObject(
    runDetails.builder,
    'npm SLSA builder identity',
  );
  assert.deepEqual(
    builder,
    { id: GITHUB_HOSTED_BUILDER },
    'npm provenance must identify a GitHub-hosted builder',
  );
  return statement;
}

/**
 * @param {Record<string, any>} lock - Generated consumer lock.
 * @param {string} version - Expected exact version.
 * @param {string} integrity - Expected manifest integrity.
 * @returns {void}
 */
export function assertRegistryLock(lock, version, integrity) {
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages?.['']?.devDependencies?.[PACKAGE_NAME], version);
  const installed = lock.packages?.[`node_modules/${PACKAGE_NAME}`];
  assert.equal(installed?.version, version);
  assert.equal(
    installed?.integrity,
    integrity,
    'The generated consumer lock must bind the registry install to preview-release.json integrity.',
  );
  for (const [packagePath, entry] of Object.entries(lock.packages || {})) {
    if (typeof entry?.resolved !== 'string') continue;
    let resolved;
    try {
      resolved = new URL(entry.resolved);
    } catch (error) {
      throw new TypeError(
        `Consumer lock has a non-URL resolution for ${packagePath}.`,
        { cause: error },
      );
    }
    assert.equal(
      `${resolved.protocol}//${resolved.host}`,
      CANONICAL_NPM_REGISTRY,
      `Consumer lock resolved ${packagePath} outside the canonical npm registry.`,
    );
    assert.equal(resolved.username, '');
    assert.equal(resolved.password, '');
    assert.equal(resolved.search, '');
    assert.equal(resolved.hash, '');
  }
}

/**
 * @param {string} packedPackageRoot - Extracted npm package root.
 * @param {Record<string, any>} packageMetadata - Repository package metadata.
 * @returns {void}
 */
export function assertExtractedCandidate(packedPackageRoot, packageMetadata) {
  const packedMetadata = readJson(path.join(packedPackageRoot, 'package.json'));
  assert.equal(packedMetadata.name, PACKAGE_NAME);
  assert.equal(packedMetadata.version, packageMetadata.version);
  assert.equal(packedMetadata.engines?.node, SUPPORTED_NODE_RANGE);
  for (const relativePath of REQUIRED_STARTER_FILES) {
    const filePath = path.join(
      packedPackageRoot,
      'examples',
      'hello-world',
      relativePath,
    );
    const stats = lstatSync(filePath);
    assert.equal(
      stats.isFile() && !stats.isSymbolicLink(),
      true,
      `Candidate package has an invalid hello-world starter file ${relativePath}.`,
    );
  }
}

/**
 * @param {Record<string, any>} starterMetadata - Copied starter package metadata.
 * @param {Record<string, any>} packageMetadata - Candidate package metadata.
 * @returns {void}
 */
export function assertStarterMetadata(starterMetadata, packageMetadata) {
  assert.equal(starterMetadata.name, 'wharfie-hello-world-demo');
  assert.equal(starterMetadata.private, true);
  assert.equal(starterMetadata.engines?.node, SUPPORTED_NODE_RANGE);
  assert.equal(
    Object.hasOwn(starterMetadata, 'packageManager'),
    false,
    'The consumer starter must not require an exact npm patch.',
  );
  assert.equal(
    Object.hasOwn(starterMetadata.engines || {}, 'npm'),
    false,
    'The consumer starter must not declare an npm engine pin.',
  );
  assert.equal(
    starterMetadata.devDependencies?.[PACKAGE_NAME],
    packageMetadata.version,
    'The starter must pin the exact candidate package version.',
  );
  assert.equal(starterMetadata.scripts?.demo, 'node ./scripts/demo.js');
}

/**
 * Exercise the packed candidate as a clean consumer without installing the
 * repository's contributor dependency graph.
 * @param {PreviewConsumerOptions} options - Consumer proof inputs.
 * @returns {void}
 */
export function verifyPreviewConsumer(options) {
  assert.equal(
    existsSync(path.join(REPO_ROOT, 'node_modules')),
    false,
    'Preview consumer verification must start before any root npm install.',
  );
  const packageMetadata = readJson(path.join(REPO_ROOT, 'package.json'));
  assert.equal(packageMetadata.name, PACKAGE_NAME);
  assert.equal(packageMetadata.engines?.node, SUPPORTED_NODE_RANGE);
  const candidateMode = typeof options.candidateTarball === 'string';
  const registryMode = typeof options.registryManifest === 'string';
  assert.notEqual(
    candidateMode,
    registryMode,
    'Consumer proof requires exactly one candidate or registry input.',
  );

  const proofRoot = mkdtempSync(path.join(os.tmpdir(), PROOF_PREFIX));
  const unpackedRoot = path.join(proofRoot, 'unpacked');
  const starterRoot = path.join(proofRoot, 'hello-world');
  const npmCache = path.join(proofRoot, 'npm-cache');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  mkdirSync(unpackedRoot);

  try {
    const commandEnvironment = { ...process.env };
    delete commandEnvironment.NODE_PATH;
    delete commandEnvironment.NODE_ENV;
    delete commandEnvironment.npm_config_omit;
    delete commandEnvironment.npm_config_production;
    delete commandEnvironment.NPM_CONFIG_REGISTRY;
    commandEnvironment.npm_config_cache = npmCache;
    commandEnvironment.npm_config_registry = CANONICAL_NPM_REGISTRY;
    commandEnvironment.npm_config_ignore_scripts = 'true';
    commandEnvironment.npm_config_update_notifier = 'false';

    /** @type {Record<string, any> | undefined} */
    let registryArtifact;
    /** @type {Record<string, any> | undefined} */
    let registryManifest;
    /** @type {string} */
    let tarballPath;
    if (registryMode) {
      const packageManagerMatch = /^npm@(\d+\.\d+\.\d+)$/u.exec(
        String(packageMetadata.packageManager || ''),
      );
      assert.ok(
        packageManagerMatch,
        'Registry proof requires one exact npm packageManager version.',
      );
      const npmVersion = runCommand(npmCommand, ['--version'], {
        cwd: proofRoot,
        env: commandEnvironment,
        capture: true,
        timeout: 30_000,
      }).stdout.trim();
      assert.equal(
        npmVersion,
        packageManagerMatch[1],
        'Registry proof must run with the repository-pinned npm version.',
      );
      const manifestPath = path.resolve(
        /** @type {string} */ (options.registryManifest),
      );
      const manifestStats = lstatSync(manifestPath);
      assert.equal(
        manifestStats.isFile() && !manifestStats.isSymbolicLink(),
        true,
        'The registry proof manifest must be a non-symlink regular file.',
      );
      registryManifest = readJson(manifestPath);
      registryArtifact = assertRegistryReleaseManifest(
        registryManifest,
        packageMetadata,
      );
      const registryPackRoot = path.join(proofRoot, 'registry-pack');
      mkdirSync(registryPackRoot);
      const packed = runCommand(
        npmCommand,
        [
          'pack',
          '--json',
          '--ignore-scripts',
          `--registry=${CANONICAL_NPM_REGISTRY}`,
          '--pack-destination',
          registryPackRoot,
          `${PACKAGE_NAME}@${packageMetadata.version}`,
        ],
        {
          cwd: proofRoot,
          env: commandEnvironment,
          capture: true,
          timeout: 240_000,
        },
      );
      const packedResults = JSON.parse(packed.stdout);
      assert.equal(Array.isArray(packedResults), true);
      assert.equal(packedResults.length, 1);
      const [registryCandidate] = packedResults;
      assertCandidatePackage(registryCandidate, packageMetadata);
      assert.equal(registryCandidate.integrity, registryArtifact.integrity);
      assert.equal(registryCandidate.shasum, registryArtifact.npmShasum);
      tarballPath = path.join(registryPackRoot, registryCandidate.filename);
      const tarballIntegrity = `sha512-${createHash('sha512')
        .update(readFileSync(tarballPath))
        .digest('base64')}`;
      assert.equal(tarballIntegrity, registryArtifact.integrity);
    } else {
      tarballPath = path.resolve(
        /** @type {string} */ (options.candidateTarball),
      );
    }
    const tarballStats = lstatSync(tarballPath);
    assert.equal(
      tarballStats.isFile() && !tarballStats.isSymbolicLink(),
      true,
      'The clean candidate tarball must be a non-symlink regular file.',
    );

    runCommand(
      'tar',
      [
        '--extract',
        '--gzip',
        '--file',
        tarballPath,
        '--directory',
        unpackedRoot,
      ],
      { cwd: proofRoot, env: commandEnvironment, timeout: 120_000 },
    );
    const packedPackageRoot = path.join(unpackedRoot, 'package');
    assertExtractedCandidate(packedPackageRoot, packageMetadata);
    const packedStarterRoot = path.join(
      packedPackageRoot,
      'examples',
      'hello-world',
    );
    cpSync(packedStarterRoot, starterRoot, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });

    const starterMetadataPath = path.join(starterRoot, 'package.json');
    const starterMetadataBefore = readFileSync(starterMetadataPath, 'utf8');
    assertStarterMetadata(JSON.parse(starterMetadataBefore), packageMetadata);
    assert.equal(
      existsSync(path.join(starterRoot, '.npmrc')),
      false,
      'The copied starter must not carry repository npm policy.',
    );

    process.stdout.write(
      `Installing ${PACKAGE_NAME}@${packageMetadata.version} from ${registryMode ? 'the public registry' : 'the candidate tarball'} with npm ${process.env.npm_config_user_agent || 'bundled'}\n`,
    );
    runCommand(
      npmCommand,
      registryMode
        ? [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            `--registry=${CANONICAL_NPM_REGISTRY}`,
          ]
        : [
            'install',
            '--ignore-scripts',
            '--no-audit',
            '--no-fund',
            '--no-save',
            '--package-lock=false',
            `--registry=${CANONICAL_NPM_REGISTRY}`,
            tarballPath,
          ],
      {
        cwd: starterRoot,
        env: commandEnvironment,
        timeout: 240_000,
      },
    );
    assert.equal(
      readFileSync(starterMetadataPath, 'utf8'),
      starterMetadataBefore,
      'Candidate installation must not rewrite the versioned starter.',
    );

    const installedRoot = path.join(
      starterRoot,
      'node_modules',
      '@wharfie',
      'wharfie',
    );
    const installedMetadata = readJson(
      path.join(installedRoot, 'package.json'),
    );
    assert.equal(installedMetadata.version, packageMetadata.version);
    if (registryArtifact) {
      assertRegistryLock(
        readJson(path.join(starterRoot, 'package-lock.json')),
        packageMetadata.version,
        registryArtifact.integrity,
      );
      const signatureAudit = runCommand(
        npmCommand,
        [
          'audit',
          'signatures',
          '--json',
          '--include-attestations',
          `--registry=${CANONICAL_NPM_REGISTRY}`,
        ],
        {
          cwd: starterRoot,
          env: commandEnvironment,
          capture: true,
          timeout: 240_000,
        },
      );
      let auditResult;
      try {
        auditResult = JSON.parse(signatureAudit.stdout);
      } catch (error) {
        throw new TypeError(
          'Pinned npm signature audit did not return valid JSON.',
          { cause: error },
        );
      }
      assertRegistryAuditProvenance(
        auditResult,
        /** @type {Record<string, any>} */ (registryManifest),
        registryArtifact,
      );
      process.stdout.write(signatureAudit.stdout);
      process.stderr.write(signatureAudit.stderr);
    }
    assert.ok(
      realpathSync(installedRoot).startsWith(
        `${realpathSync(starterRoot)}${path.sep}`,
      ),
      'The consumer resolved Wharfie outside the copied starter.',
    );

    process.stdout.write('Running the complete copied magnetic demo\n');
    runCommand(npmCommand, ['run', 'demo', '--', 'Ada'], {
      cwd: starterRoot,
      env: {
        ...commandEnvironment,
        WHARFIE_MAGNETIC_ACCEPTANCE_BUILDER_ROOT: starterRoot,
      },
      timeout: 360_000,
    });
    process.stdout.write(
      `Verified the full magnetic path with ${registryMode ? `${PACKAGE_NAME}@${packageMetadata.version} from npm` : path.basename(tarballPath)}\n`,
    );
  } finally {
    rmSync(proofRoot, { recursive: true, force: true });
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  verifyPreviewConsumer(parsePreviewConsumerArgs(process.argv.slice(2)));
}
