# Publish the documentation with Cloudflare Pages

Publish the landing page on Cloudflare Pages by explicitly uploading a reviewed
folder with Wrangler. The intended configuration uses the free plan; confirm the
account's Workers plan before treating Function usage as free.
The migration keeps the working CloudFront origin until the Pages deployment,
custom hostname, and public route checks pass. Public-domain acceptance and AWS removal
are still pending; the evidence table records the completed baseline separately.

The `wharfie.dev` zone is managed in the maintainer's personal Cloudflare account.
Select that account explicitly and retain the account ID, project name, deployment
ID, commit, bundle hashes, and DNS backup in private operator evidence. Do not
commit account email addresses, OAuth credentials, tokens, or DNS backups.

## What is free, and which requests run code

The ordinary `/` landing page bypasses Functions through `_routes.json`. Requests
that do not invoke Functions are free and unlimited. `/index.html`, retired routes,
and unknown paths run the small `_worker.js` handler. On Workers Free, their requests
share the allowance of **100,000 requests per day across the account**, resetting
at midnight UTC. This is not unlimited Function execution. Confirm the account's
Workers plan in the dashboard: a zone's Free Website plan does not establish its
Workers billing plan. No database, storage binding, or paid Worker plan is required
by this site; no paid plan has been activated for this migration.
[Cloudflare pricing](https://developers.cloudflare.com/pages/functions/pricing/)

Pages Free permits 20,000 assets and 25 MiB per asset; this manually uploaded
bundle contains five small deployment files.
[Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

Set the project's **Settings > Runtime > Fail open / closed** option to **Fail
closed** so exhausted Function capacity does not bypass the handler. Retain the
`_routes.json` root exclusion; moving `/` into the Function would consume the daily
allowance for ordinary visits. Static responses receive `_headers`; the Worker
sets its response headers itself.
[Invocation routes](https://developers.cloudflare.com/pages/functions/routing/),
[static headers](https://developers.cloudflare.com/pages/configuration/headers/)

| Request                                                                | Response                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET/HEAD `/`                                                           | Static `200`, reviewed HTML; no Function invocation.                                                 |
| GET/HEAD `/index.html`                                                 | Worker `200`, the same HTML bytes.                                                                   |
| `/install`, `/install/`, `/install.html`                               | `302` to the current [installation guide](installation.md).                                          |
| `/quickstart`, `/quickstart/`, `/quickstart.html`                      | `302` to the [recipient guide](recipient-preview.md).                                                |
| `/project-structure`, `/project-structure/`, `/project-structure.html` | `302` to [application structure](application-structure.md).                                          |
| `/install.sh`, `/install.ps1`                                          | `410`, fixed plain text; no executable body.                                                         |
| Other accepted paths                                                   | `404` linking to current documentation.                                                              |
| Unsupported methods                                                    | `405`; the static root has Pages' empty response, while Worker responses include `Allow: GET, HEAD`. |

Application responses retain the CSP, `nosniff`, and `Cache-Control: no-store`
contract. Redirects to repository guides discard query strings. Cloudflare's public
edge rejects the raw encoded-parent probe `/%2e%2e/install` with `400` before the
Worker, while local Wrangler normalizes it to the installation redirect. The live
verifier checks that narrow provider rejection separately; it must not redirect or
reflect the query. A root HEAD response may omit `Content-Length`; GET responses
must still match the exact bundle SHA-256.

## Prepare a reviewed bundle

Use the repository-pinned Node.js `24.13.1`. The helper uses Node built-ins and does
not need dependency installation. Start from a clean, reviewed commit and retain
the new bundle outside the checkout. Run the blocks in one Bash session:

```bash
set -eu
umask 077
test "$(node --version)" = v24.13.1
test -z "$(git status --porcelain --untracked-files=normal)"
docs_run=$(mktemp -d "${TMPDIR:-/tmp}/wharfie-pages.XXXXXX")
docs_bundle="$docs_run/bundle"
docs_evidence="$docs_run/evidence"
mkdir -m 700 "$docs_evidence"
docs_commit=$(git rev-parse --verify HEAD)
node scripts/prepare-docs-site.js --output-dir "$docs_bundle"
node --input-type=module - "$docs_bundle" "$docs_commit" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(`${dir}/manifest.json`));
assert.equal(m.version, 2);
assert.equal(m.provider, 'cloudflare-pages');
assert.equal(m.deployDirectory, 'site');
assert.equal(m.git.dirty, false);
assert.equal(m.git.commit, process.argv[3]);
for (const file of m.files) {
  const bytes = readFileSync(`${dir}/${file.name}`);
  assert.equal(bytes.length, file.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
}
assert.equal(m.contentSha256, m.files.find(f => f.name === 'site/index.html').sha256);
console.log(JSON.stringify({ commit: m.git.commit, contentSha256: m.contentSha256 }));
NODE
```

The version-2 `manifest.json` records provenance and every file's size/hash. Only
`bundle/site/` is deployable: it contains `index.html`, `404.html`, `_headers`,
`_routes.json`, and `_worker.js`. Keep the manifest and evidence outside that directory.
The explicit `404.html` prevents Pages' implicit single-page-app fallback.
[Serving Pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)

## Select the Direct Upload project

The project is `wharfie-docs`, served at `wharfie-docs.pages.dev`. Its source is
unset (`source: null`), production branch is `master`, and both environments use
compatibility date `2026-09-16` with `fail_open: false`. Keep Git integration,
automatic publishing, and deploy hooks disabled. A commit or merge does not upload
anything. Source-less projects still support explicit branch previews.
[Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)

Use Wrangler **4.131.2** as an isolated operator tool through `npx`, outside the
checkout; do not add it to Wharfie's dependencies. Use the existing OAuth session
or an operator-provided token. Set `CLOUDFLARE_ACCOUNT_ID` to the account ID already
verified for this zone, then inspect the account and project before any upload:

```bash
: "${CLOUDFLARE_ACCOUNT_ID:?Set the verified Cloudflare account ID}"
docs_account_id="$CLOUDFLARE_ACCOUNT_ID"
docs_project=wharfie-docs
docs_wrangler() (
  cd "$docs_run"
  CLOUDFLARE_ACCOUNT_ID="$docs_account_id" npx --yes wrangler@4.131.2 "$@"
)
docs_wrangler whoami
docs_wrangler pages project list --json > "$docs_evidence/projects.json"
```

Confirm the selected account, exact project, source-less mode, production branch,
compatibility date, and fail-closed setting using the dashboard/API readback.
Retain that record privately. The existing project needs no GitHub app or build
configuration. DNS remains a separate manual operation.

## Upload and verify a preview

The source commit and clean-state check above bind the upload metadata to the
prepared bytes. An explicit non-production branch prevents an accidental production
upload; retain the bundle and every file hash after this command:

```bash
docs_preview_bundle="$docs_bundle"
docs_preview_branch="docs-preview-${docs_commit:0:12}"
docs_wrangler pages deploy "$docs_bundle/site" \
  --project-name "$docs_project" --branch "$docs_preview_branch" \
  --commit-hash "$docs_commit" --commit-dirty=false
docs_wrangler pages deployment list --project-name "$docs_project" \
  --environment preview --json > "$docs_evidence/preview-deployments.json"
# Set this to the exact unique deployment URL in the upload receipt.
: "${docs_deployment_url:?Set the verified preview deployment URL}"
node scripts/verify-docs-site.js --url "$docs_deployment_url" \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/pages-preview.json"
```

Retain the exact deployment ID/URL, account, project, branch, commit, manifest, and
report; confirm the deployment environment is `preview`. Require all **40 live
checks**, then inspect rendering, keyboard focus, and links. Local Node/Wrangler
checks alone do not establish live acceptance. Upload only `bundle/site/`, never
the manifest or evidence directory. [Wrangler Pages commands](https://developers.cloudflare.com/workers/wrangler/commands/pages/)

## Upload production after the reviewed merge

From a clean checkout of the exact reviewed merge on `master`, repeat **Prepare a
reviewed bundle** into a new run directory. Keep `docs_preview_bundle` pointing to
the retained accepted preview. Compare all five deployment files before publishing:

```bash
node --input-type=module - "$docs_preview_bundle" "$docs_bundle" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const [preview, production] = process.argv.slice(2).map(dir =>
  JSON.parse(readFileSync(`${dir}/manifest.json`)));
assert.equal(production.git.dirty, false);
assert.equal(production.contentSha256, preview.contentSha256);
assert.deepEqual(production.files, preview.files);
NODE
docs_wrangler pages deploy "$docs_bundle/site" \
  --project-name "$docs_project" --branch master \
  --commit-hash "$docs_commit" --commit-dirty=false
docs_wrangler pages deployment list --project-name "$docs_project" \
  --environment production --json > "$docs_evidence/production-deployments.json"
node scripts/verify-docs-site.js --url https://wharfie-docs.pages.dev \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/pages-production.json"
```

A merge can change the source commit while leaving all deployment bytes identical.
If any file hash changes, stop and preview that new bundle first. Check the upload
receipt says `production` and records the reviewed merge commit. Retain both bundles,
upload receipts, and reports. Require all live checks before custom-domain cutover;
merging the PR alone never publishes the site.

## Associate the hostname, then change DNS

The working migration source is `d1sdjfclzv637e.cloudfront.net`, distribution
`EITEBWLWDGRVN`. Before changes, back up the exact `docs` DNS record: ID, full name,
CNAME target, proxy state, TTL, and editable metadata. The current record is DNS
only, TTL `300`. Keep its AWS certificate and origin available through acceptance.

First associate `docs.wharfie.dev` with the verified Pages project using **Custom
domains > Set up a domain**, or the Pages domain-association API. Confirm the
association belongs to that project and retain its status. Association must precede
the CNAME switch; a CNAME alone can produce `522`. For a zone already in Cloudflare,
the dashboard can update DNS after confirmation. Keep association and DNS updates
separate, verify the DNS record remains unchanged, and stop before DNS confirmation
until the candidate checks pass.
[Custom-domain setup](https://developers.cloudflare.com/pages/configuration/custom-domains/)

Once the production deployment passes, manually edit only the existing `docs`
record to the project's verified production `pages.dev` hostname. Use DNS only and
TTL `300` for the controlled migration unless Pages explicitly requires a different
setting; record the exact resulting record. Do not point the custom domain at a
single preview deployment or branch alias. Wait for Pages to report the custom
domain active and for its managed HTTPS certificate to validate.

From a fresh client, check authoritative/public DNS and run without a connection
override:

```bash
node scripts/verify-docs-site.js --url https://docs.wharfie.dev \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/public-pages.json"
```

Repeat after DNS convergence with a new report path. Require exact root bytes,
all route checks, valid TLS, and a mobile/desktop/keyboard review. Follow the current
guides, release, license, and feedback links; anonymous GitHub users must sign in
to see the feedback form. Do not submit an issue as part of acceptance.

## Update and roll back

For each update, prepare and verify a new preview, merge the reviewed source, then
explicitly upload matching production bytes as above. Retain the current production
deployment ID and bundle for rollback, and verify both Pages and the public hostname
after the upload. There are no Git-triggered deployments or deploy hooks.

For rollback, select the previous successful **production** deployment in the
Pages project's **Deployments > All deployments > Rollback to this deployment**
action. Preview deployments cannot be rollback targets. Verify the restored bytes
and routes against the retained bundle. Correct or revert the source through Git
for the next manual release; that source correction does not deploy anything.
[Pages rollbacks](https://developers.cloudflare.com/pages/configuration/rollbacks/)

During migration, the saved CloudFront record remains a fallback only while that
origin and certificate still exist. Verify them before restoring the exact DNS
backup, then recheck public HTTPS after the previous TTL. Changing DNS away from
Pages can deactivate its custom-domain association; switching back requires waiting
for activation and checking TLS again. Prefer Pages deployment rollback after the
migration. After AWS teardown, there is no CloudFront DNS rollback target.

## Remove only the replacement AWS documentation resources

Perform this phase only after the Pages custom domain passes public acceptance and
its deployment rollback record is retained. Scope is limited to AWS account
`411430101559`, region `us-east-1`, hosting stack `wharfie-docs`, certificate stack
`wharfie-docs-certificate`, distribution `EITEBWLWDGRVN`, and retained bucket
`wharfie-docs-411430101559-us-east-1`.

```bash
export AWS_PROFILE=wharfie AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
export AWS_DEFAULT_OUTPUT=json AWS_PAGER='' AWS_CLI_AUTO_PROMPT=off
test "$(aws sts get-caller-identity --query Account --output text)" = 411430101559
aws cloudformation describe-stacks --stack-name wharfie-docs > "$docs_evidence/aws-hosting-before.json"
aws cloudformation list-stack-resources --stack-name wharfie-docs > "$docs_evidence/aws-resources-before.json"
aws cloudformation describe-stacks --stack-name wharfie-docs-certificate > "$docs_evidence/aws-certificate-before.json"
```

Bind teardown to those saved stack ARNs and physical resource IDs, recheck the
account before mutations, and stop on any identity mismatch. Retain the old
CloudFront configuration, bucket policy, certificate ARN, and object inventory.
Compare every object's authenticated readback hash with an accepted deployment
manifest using `--expected-bucket-owner 411430101559`. Stop on unrecorded keys,
versions, or resources; never use recursive deletion or `--force` bucket removal.

Delete the exact hosting stack and wait for deletion, including CloudFront's
distribution removal. The bucket's retention policy leaves it behind: delete only
its verified object keys, then remove that exact empty bucket with the expected
owner guard. Delete the exact certificate stack after the distribution no longer
uses it. Independently verify both stack deletions and the absence of the recorded
distribution, bucket, certificate, function, OAC, and response-header policy.
Re-run public Pages verification after cleanup and retain bounded receipts.

Do not touch the historical `docs.wharfie.dev` bucket in `us-west-2`: its owner
remains unknown. The Cloudflare zone, other applications, and unrelated AWS or
soak resources are outside this cleanup.

## Migration evidence

The AWS-hosted public baseline on 2026-09-16 served reviewed SHA-256
`0c17e89550a07f3ebb05fdff691eb6ba7da8d75abdfaf1168a6e83ccb67cd808` with valid TLS,
expected headers, and successful mobile/desktop/keyboard checks. PR 169 is merged;
its guides and feedback form match the reviewed bytes, and public links resolve.
These results establish the working migration source, not Pages acceptance.

| Evidence                                                       | Status                                                                                                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct Upload project and runtime settings                     | Verified `wharfie-docs` / `wharfie-docs.pages.dev`, `source: null`, production `master`, both environments `2026-09-16` and fail closed.       |
| Workers account plan                                           | Unverified: account subscriptions read returned `403`; the zone's Free Website plan is insufficient evidence. No paid plan activated.          |
| Clean bundle and preview/production deployment reports         | Preview `58d2f12c.wharfie-docs.pages.dev` passed all 40 live checks and browser review with the reviewed HTML hash; production upload pending. |
| Pages custom-domain association, managed TLS, exact DNS record | Pending cutover.                                                                                                                               |
| Public Pages routes, rendering, links, and rollback record     | Pending acceptance.                                                                                                                            |
| Exact AWS resource teardown and independent absence checks     | Pending Pages acceptance.                                                                                                                      |

Close [issue 137](https://github.com/wharfie/wharfie/issues/137) only after retaining
sanitized public acceptance and cleanup evidence. This migration does not publish
a new Wharfie package or establish soak/tester acceptance.
