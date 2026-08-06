# Preview releases

Wharfie preview releases are experimental, intentionally outside npm's
`latest` channel, and supported only for evaluation. The npm package requires
Node `>=24.13.1 <25`. A provider-free, Node-free standalone CLI is produced for
Linux x64 glibc; other standalone targets remain application-build targets,
not Wharfie CLI release downloads.

After the first preview completes reviewed promotion, install the Node-hosted
CLI with:

```bash
npm install --save-dev @wharfie/wharfie@preview
npx wharfie --help
```

Do not omit `@preview`: no preview workflow publishes to `latest`. For a
Node-free Linux x64 glibc installation, download the versioned binary, its
artifact record, `preview-release.json`, and `SHA256SUMS` from the matching
GitHub prerelease. Verify the checksums before running the binary:

```bash
sha256sum --ignore-missing --check SHA256SUMS
chmod +x wharfie-v0.0.15-linux-x64
./wharfie-v0.0.15-linux-x64 --version
```

GitHub also records build-provenance attestations for every release asset.
With a current GitHub CLI, verify a downloaded asset against this repository:

```bash
gh attestation verify wharfie-v0.0.15-linux-x64 \
  --repo wharfie/wharfie
```

`preview-release.json` binds one exact four-artifact set: the core npm tarball,
AWS companion tarball, Linux x64 glibc standalone CLI, and its adjacent native
Wharfie `.artifact.json` record. It records the package version and tag, source
commit, npm integrity, standalone target, artifact/revision identities, byte
sizes, and SHA-256 digests.

Every release also carries a checksummed and attested
`wharfie-aws-<version>.tgz` companion. Its exact package name, version, npm
integrity, npm shasum, size, and SHA-256 are recorded in
`preview-release.json`. This is a GitHub-release handoff, not a second npm
publication: the preview workflow publishes only `@wharfie/wharfie`. A
provider-enabled evaluator must download and checksum the matching companion
tarball, then install that exact local tarball alongside the matching core
version. Publishing `@wharfie/aws` later requires its own deliberately
configured trusted-publisher boundary.

The downloadable standalone Wharfie CLI is deliberately sealed provider-free.
Putting the companion beside that finished executable cannot add AWS support.
To build an AWS-enabled self-deployable application, use the Node-hosted core
package with this exact companion in the builder: only the outer operator may
embed it. Ordinary application SEAs and the nested Linux deployment payload
remain provider-free.

For example, after downloading the matching companion asset and
`SHA256SUMS`:

```bash
sha256sum --ignore-missing --check SHA256SUMS
npm install --save-dev @wharfie/wharfie@0.0.15 ./wharfie-aws-0.0.15.tgz
```

`--ignore-missing` verifies the subset downloaded into the current directory;
omit it only when every asset listed by `SHA256SUMS` is present.

## Maintainer release boundary

Ordinary CI runs `npm run verify:release:preview`. It validates publishable
metadata, the exact self-host target, the publication guard, and a real npm
tarball without publishing or creating release state. On Linux x64 under the
exact contributor Node/npm pins, the artifact set can be built locally with:

```bash
npm run build:release:preview -- \
  --tag "v$(node --print "require('./package.json').version")"
```

The builder packs Wharfie and the required AWS handoff once, installs only the
core tarball into a clean consumer, invokes the self-package seam from the
installed package with an explicit provider-free policy, and smoke-tests the
result with an empty `PATH`. The smoke includes an AWS command that must fail
with the exact sealed not-embedded error before creating state. Before granting
the installed self-host seam its
narrow runtime-graph authority, it hashes and independently extracts the
candidate tarball and compares the installed package's complete regular-file
tree and bytes. The source checkout still owns release orchestration and
contract validation; the actual self-package transaction runs through the
installed candidate. The output directory must not already exist, so a
previous artifact set cannot be overwritten accidentally.

The tag workflow accepts only `v<package version>` tags whose commit remains on
`master`. Its unprivileged build job tests, builds, checksums, manifests, and
retains the candidate artifacts. A small downstream job holds the attestation
identity only long enough to attest those retained bytes. A separate consumer
matrix proves the packed starter on the minimum supported Node 24 version and
the current Node 24 release without first installing the repository dependency
graph. Candidate publication waits for those jobs and fails closed unless all
of these controls agree:

- the repository variable `WHARFIE_PREVIEW_PUBLISH_ENABLED` is exactly `true`;
- the `npm-preview` GitHub environment admits the job;
- the workflow runs in `wharfie/wharfie` on the exact version tag; and
- the publication helper's explicit release flag and environment guard pass.

The workflow runs a visible fail-closed guard step, and the repo-owned
publication helper repeats the same authorization before its first remote
mutation. The guard is not an npm package lifecycle hook: publishing a
prebuilt tarball does not give that hook a useful safety boundary.

All third-party actions in the release workflow are pinned to full commit IDs.
Immediately before each remote mutation, the helper resolves the exact tag
from the canonical Wharfie GitHub URL, peels annotated tags to the manifest
source commit, and rechecks that commit against the current canonical `master`.
It repeats those checks before GitHub finalization, so a mutable local `origin`,
moved tag, or force-pushed release authority cannot redirect publication.

Publication is a convergent sequence with a quarantine boundary. The helper
first validates `preview-release.json`, `SHA256SUMS`, the exact four artifacts,
and both packed package manifests. A stable-form candidate version must be
greater than every published Wharfie version and the current `preview` target,
preventing a stale tag from rolling the channel backward. The first phase
creates or reconciles a draft GitHub prerelease, uploads only missing assets,
and rejects any existing metadata, size, or digest mismatch. Only after that
exact draft is complete does an explicit missing-version response permit one
trusted publish. npm receives the immutable version under the deliberately
unsupported `preview-candidate` dist-tag; the automated publisher never moves
`preview`. A recovery read must match the manifest's integrity, shasum, and
attestation metadata exactly. This phase deliberately leaves the GitHub release
as a draft.

While the release is still a draft, a minimum/current Node 24 matrix packs the
exact version back from the canonical public npm registry, checks its integrity
against the retained release manifest, copies the versioned hello-world
starter, and runs a plain consumer `npm install`. It requires every resolved
registry URL and the generated lockfile's installed `@wharfie/wharfie`
integrity to match the release contract before running pinned npm's
cryptographic signature verification. The verifier inspects the verified SLSA
statement and binds its package digest, repository, commit, workflow file, tag
ref, push event, and GitHub-hosted builder to `preview-release.json`; it then
runs the complete magnetic demo. This is the registry-byte-and-provenance
proof, while the earlier matrix remains the prepublication candidate-byte
proof.

After both registry jobs pass, a maintainer with an interactive, short-lived
npm session promotes only that immutable version:

```bash
npm dist-tag add @wharfie/wharfie@0.0.15 preview \
  --registry=https://registry.npmjs.org
```

No npm credential or long-lived write token belongs in the workflow. Configure
the `npm-preview-promotion` GitHub environment with required reviewers, and
approve its finalizer only after that exact command succeeds. The finalizer has
GitHub contents authority but no npm trusted-publishing identity. It revalidates
the local artifact set, exact npm bytes and provenance metadata, `preview`
dist-tag, current source authority, and complete matching draft before its sole
permitted mutation: changing that draft to a prerelease with `--latest=false`.
Without the reviewed npm promotion it fails closed and the GitHub release stays
a draft.

A rerun resumes a matching draft, accepts a matching npm publication when an
earlier command response was lost, and treats an already finalized exact
release as success. It never overwrites release assets, republishes an existing
version, or treats an ambiguous read as absence. Promotion to `latest`, if it
is later authorized, likewise moves only that dist-tag to the already-verified
version; it never rebuilds or republishes existing bytes. Any source, declared
dependency contract, package metadata, or artifact change requires a new,
higher version and a fresh preview cycle. Compatible transitive ranges retain
ordinary npm resolution semantics, so the registry matrix is a release-time
closure proof rather than a permanent shrinkwrap guarantee.

Configure the npm trusted publisher for `@wharfie/wharfie` as GitHub Actions
organization/user `wharfie`, repository `wharfie`, workflow filename
`release-preview.yml`, and environment `npm-preview`. That identity is used
only by the phase-one `npm publish`; do not provision a workflow token or
separate automation with `npm dist-tag` authority. Disabling the repository
variable leaves tag builds as attested, downloadable workflow artifacts
without changing npm or GitHub Releases.
