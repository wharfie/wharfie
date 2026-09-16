# Publish the documentation with Cloudflare Pages

Publish the landing page on Cloudflare Pages' free plan with automatic GitHub deployments.
The migration keeps the working CloudFront origin until the Pages deployment,
custom hostname, and public route checks pass. Pages deployment and AWS removal
are still pending; the evidence table records the completed baseline separately.

The `wharfie.dev` zone is managed in the maintainer's personal Cloudflare account.
Select that account explicitly and retain the account ID, project name, deployment
ID, commit, bundle hashes, and DNS backup in private operator evidence. Do not
commit account email addresses, OAuth credentials, tokens, or DNS backups.

## What is free, and which requests run code

The ordinary `/` landing page bypasses Functions through `_routes.json`. Requests
that do not invoke Functions are free and unlimited. `/index.html`, retired routes,
and unknown paths run the small `_worker.js` handler; their requests share the
Workers Free allowance of **100,000 requests per day across the account**, resetting
at midnight UTC. This is not unlimited Function execution. Keep the project on the
free plan; no database, storage binding, or paid Worker plan is required.
[Cloudflare pricing](https://developers.cloudflare.com/pages/functions/pricing/)

Pages Free also limits Git builds to **500 per month**, one concurrent build, and
20 minutes per build. Its asset limits are 20,000 files and 25 MiB per file; this
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

Responses retain the CSP, `nosniff`, and `Cache-Control: no-store` contract. Redirects
to repository guides discard query strings. Pages normalizes encoded parent segments
before routing: the verifier expects `/%2e%2e/install` to reach the fixed installation
redirect, rather than CloudFront's former `400`. A root HEAD response may omit
`Content-Length`; GET responses must still match the exact bundle SHA-256.

## Prepare a reviewed bundle

Use the repository-pinned Node.js `24.13.1`. The helper uses Node built-ins and does
not need dependency installation. Start from a clean, reviewed commit and retain
the new bundle outside the checkout:

```bash
set -eu
umask 077
test "$(node --version)" = v24.13.1
test -z "$(git status --porcelain --untracked-files=normal)"
docs_run=$(mktemp -d "${TMPDIR:-/tmp}/wharfie-pages.XXXXXX")
docs_bundle="$docs_run/bundle"
docs_evidence="$docs_run/evidence"
mkdir -m 700 "$docs_evidence"
node scripts/prepare-docs-site.js --output-dir "$docs_bundle"
node --input-type=module - "$docs_bundle" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(`${dir}/manifest.json`));
assert.equal(m.version, 2);
assert.equal(m.provider, 'cloudflare-pages');
assert.equal(m.deployDirectory, 'site');
assert.equal(m.git.dirty, false);
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

## Configure automatic GitHub publication

Create a **Git-integrated Pages project**, connected to `wharfie/wharfie`, in the
verified Cloudflare account. Authorize the Cloudflare GitHub app for that repository.
Wrangler OAuth access to Pages does not itself install the GitHub app or grant DNS
editing permission. Keep the existing manual DNS workflow.

Do not create a Direct Upload project as an intermediate step: Cloudflare cannot
convert one to Git integration later. A Git-integrated project can still accept a
manual Wrangler deployment when needed.
[Deployment modes](https://developers.cloudflare.com/pages/get-started/direct-upload/)

During migration, keep automatic production deployments disabled while verifying
the migration branch's preview. The pre-migration `master` helper does not produce
the Pages output directory. After the preview passes, enable production deployments
for the reviewed merge and verify the resulting `master` deployment before DNS
cutover. The table describes the final settings; use the same build and runtime
configuration for production and previews.

| Setting                    | Value                                                                  |
| -------------------------- | ---------------------------------------------------------------------- |
| Repository root            | Repository root; no subdirectory.                                      |
| Framework preset           | None.                                                                  |
| Production branch          | `master`, automatic production deployments enabled.                    |
| Build command              | `node scripts/prepare-docs-site.js --output-dir docs-pages-build`      |
| Build output directory     | `docs-pages-build/site`                                                |
| Environment                | `NODE_VERSION=24.13.1`, `SKIP_DEPENDENCY_INSTALL=true`                 |
| Runtime compatibility date | `2026-09-16` in production and preview deployment settings.            |
| Preview branches           | Enable the migration branch and later reviewed documentation branches. |

The output directory must be new. If a cached build directory unexpectedly exists,
inspect that build's workspace rather than weakening the exclusive-output check.
The build uses no project dependencies; the Node version and skip-install setting
are documented [Pages build controls](https://developers.cloudflare.com/pages/configuration/build-image/).
Record the chosen project name and actual `pages.dev` hostname from the dashboard;
do not infer the hostname if Cloudflare assigns a suffix.

Before merging, verify the migration branch's unique preview deployment. After
merge, wait for the `master` production deployment and verify it again. For each,
retain the deployment ID, environment, Git commit, build result, manifest from the
build log, and exact deployment URL. Reproduce the bundle locally from that same
commit and compare its file hashes before running:

```bash
# Set this to the exact HTTPS deployment URL shown by Pages.
: "${docs_deployment_url:?Set the verified Pages deployment URL}"
node scripts/verify-docs-site.js --url "$docs_deployment_url" \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/pages-deployment.json"
```

All verifier checks must pass in Pages itself; local Node tests alone do not prove
provider behavior. Inspect mobile/desktop rendering, keyboard focus, and outgoing
links. Retain the deployment URL and report; a preview deployment is not yet the
production site. GitHub integration supplies automatic builds and preview URLs;
there is no separate GitHub Actions deployment workflow.
[GitHub integration](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/)

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

A reviewed merge to `master` triggers production publication. Check its deployment
commit and run the verifier against the corresponding bundle and public hostname.
Retain the last verified production deployment ID and bundle before each update.

For rollback, select the previous successful **production** deployment in the
Pages project's **Deployments > All deployments > Rollback to this deployment**
action. Preview deployments cannot be rollback targets. Verify the restored bytes
and routes against the retained bundle. Revert the source change through Git so
the next automatic deployment does not reintroduce it.
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

| Evidence                                                                  | Status                    |
| ------------------------------------------------------------------------- | ------------------------- |
| Cloudflare account/free plan, Git-integrated project, deployment settings | Pending verification.     |
| Clean bundle and preview/production deployment reports                    | Pending Pages runs.       |
| Pages custom-domain association, managed TLS, exact DNS record            | Pending cutover.          |
| Public Pages routes, rendering, links, and rollback record                | Pending acceptance.       |
| Exact AWS resource teardown and independent absence checks                | Pending Pages acceptance. |

Close [issue 137](https://github.com/wharfie/wharfie/issues/137) only after retaining
sanitized public acceptance and cleanup evidence. This migration does not publish
a new Wharfie package or establish soak/tester acceptance.
