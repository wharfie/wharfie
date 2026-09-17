# Publish the documentation from S3

Publish the reviewed HTML files manually to the S3 bucket we control. Cloudflare's
free [Cloud Connector (Beta)](https://developers.cloudflare.com/rules/cloud-connector/)
serves `docs.wharfie.dev` over HTTPS and fetches this S3 website over HTTP. The rule
matches only this hostname; do not change the zone's overall TLS mode. S3 storage,
requests, and transfer still use AWS billing. A Git commit or merge does not publish.

The fixed destination is AWS account `411430101559`, region `us-east-1`, stack
`wharfie-docs`, bucket `wharfie-docs-411430101559-us-east-1`. Its website endpoint is
`wharfie-docs-411430101559-us-east-1.s3-website-us-east-1.amazonaws.com`.
Only `index.html` and `404.html` are public. Release copies remain private; there
is no public bucket listing. S3 website endpoints do not support HTTPS, while
operator uploads and private-object reads use the authenticated HTTPS S3 API.
[Cloud Connector origin transport](https://developers.cloudflare.com/rules/cloud-connector/providers/),
[S3 website endpoints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html)

| Request                                                                     | Result                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| GET/HEAD `/`, `/index.html`                                                 | `200`, the reviewed landing page.                                              |
| GET/HEAD `/404.html`                                                        | `200`, the reviewed error page.                                                |
| Missing paths, including old guide URLs and `/install.sh` or `/install.ps1` | `403`, the HTML error page linking to current guides; no executable installer. |
| Private release objects                                                     | Access denied; never expose rollback files.                                    |

The HTML carries its reviewed CSP and referrer policy in meta tags. Uploaded
objects use `Cache-Control: no-store`. This static site has no redirect handler;
old guide URLs lead to the error page. With this narrow policy, S3 returns `403`
for missing/private keys, even though the custom error document is named
`404.html`. Unsupported requests use S3's own error handling.

## Prepare and inspect

Use Node.js `24.13.1`, AWS CLI v2, and the `wharfie` profile. Run the following in
one Bash session from a clean reviewed checkout. Keep bundles, readbacks, and DNS
backups privately outside Git; never commit credentials or personal account email.

```bash
set -eu
umask 077
test "$(node --version)" = v24.13.1
export AWS_PROFILE=wharfie AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
export AWS_DEFAULT_OUTPUT=json AWS_PAGER='' AWS_CLI_AUTO_PROMPT=off
docs_account_guard() {
  test "$(aws sts get-caller-identity --query Account --output text)" = 411430101559
}
docs_account_guard
test -z "$(git status --porcelain --untracked-files=normal)"
docs_run=$(mktemp -d "${TMPDIR:-/tmp}/wharfie-s3-docs.XXXXXX")
docs_bundle="$docs_run/bundle"
docs_evidence="$docs_run/evidence"
mkdir -m 700 "$docs_evidence"
node scripts/prepare-docs-site.js --output-dir "$docs_bundle"
docs_bucket=wharfie-docs-411430101559-us-east-1
docs_origin="$docs_bucket.s3-website-us-east-1.amazonaws.com"
docs_sha=$(node --input-type=module - "$docs_bundle" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(`${dir}/manifest.json`));
assert.equal(m.version, 2);
assert.equal(m.provider, 's3-website');
assert.equal(m.git.dirty, false);
assert.equal(m.account, '411430101559');
assert.equal(m.region, 'us-east-1');
assert.equal(m.stack, 'wharfie-docs');
assert.equal(m.bucket, 'wharfie-docs-411430101559-us-east-1');
assert.equal(m.objectKey, 'index.html');
assert.equal(m.releaseKey, `releases/${m.contentSha256}/index.html`);
for (const file of m.files) {
  const bytes = readFileSync(`${dir}/${file.name}`);
  assert.equal(bytes.length, file.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
}
assert.equal(m.contentSha256, m.files.find(f => f.name === 'index.html').sha256);
console.log(m.contentSha256);
NODE
)
```

The bundle contains only `manifest.json`, `index.html`, `404.html`, and
`hosting.template.json`. Retain its source commit and all hashes. Upload individual
HTML objects below; do not sync the bundle directory or upload its manifest/template.
Before any infrastructure change, inspect account and organization public-access
controls. If they prevent the narrow website policy, stop; this procedure does not
disable account-level S3 Block Public Access.

## One-time migration: keep the working origin

The current fallback is CloudFront `d1sdjfclzv637e.cloudfront.net`, distribution
`EITEBWLWDGRVN`. Save its stack template, parameters, physical resource IDs, bucket
policy, and the exact Cloudflare DNS/rule records before changing anything.
The zone is in the maintainer's personal Cloudflare account; verify that zone and
keep the backup private. DNS ownership does not establish ownership of other S3 buckets.

First use a reviewed **transitional UPDATE** to the existing `wharfie-docs` stack:
enable website index `index.html` and error document `404.html`, allow public reads
of exactly those two keys, and keep all existing CloudFront resources and OAC
access intact. Preserve the current distribution parameters. Inspect the change
set before execution, guard the AWS account, and wait for `UPDATE_COMPLETE`.
**Do not apply the final bundled template yet:** it removes the fallback resources.
The final template retains the same bucket and policy; it must never replace them.

## Upload exact objects and verify

Before replacing a public object, retain the currently accepted bundle and its
readback for rollback. For an initial migration, record any absent public keys.
Create the immutable private release first:

```bash
docs_account_guard
if ! aws s3api put-object --bucket "$docs_bucket" --key "releases/$docs_sha/index.html" \
  --body "$docs_bundle/index.html" --content-type 'text/html; charset=utf-8' \
  --cache-control no-store --if-none-match '*' --expected-bucket-owner 411430101559 \
  > "$docs_evidence/release-put.json" 2> "$docs_evidence/release-put.err"; then
  case "$(cat "$docs_evidence/release-put.err")" in
    *'(PreconditionFailed)'*) ;; # Verify the existing immutable object below.
    *) cat "$docs_evidence/release-put.err" >&2; exit 1 ;;
  esac
fi
docs_readback() {
  aws s3api get-object --bucket "$docs_bucket" --key "$1" \
    --expected-bucket-owner 411430101559 "$docs_evidence/$3.html" \
    > "$docs_evidence/$3.json"
  node --input-type=module - "$2" "$docs_evidence/$3" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [source, output] = process.argv.slice(2);
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
assert.equal(hash(`${output}.html`), hash(source));
const metadata = JSON.parse(readFileSync(`${output}.json`));
assert.equal(metadata.ContentType, 'text/html; charset=utf-8');
assert.equal(metadata.CacheControl, 'no-store');
NODE
}
docs_publish() {
  local docs_file="$1" docs_match
  local -a docs_condition
  if aws s3api get-object --bucket "$docs_bucket" --key "$docs_file" \
    --expected-bucket-owner 411430101559 "$docs_evidence/$docs_file-before.html" \
    > "$docs_evidence/$docs_file-before.json" 2> "$docs_evidence/$docs_file-before.err"; then
    docs_match=$(node --input-type=module - "$docs_evidence/$docs_file-before.json" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { ETag } = JSON.parse(readFileSync(process.argv[2]));
assert.equal(typeof ETag, 'string');
assert.ok(ETag.length > 0);
console.log(ETag);
NODE
)
    docs_condition=(--if-match "$docs_match")
  else
    case "$(cat "$docs_evidence/$docs_file-before.err")" in
      *'(NoSuchKey)'*) docs_condition=(--if-none-match '*') ;;
      *) cat "$docs_evidence/$docs_file-before.err" >&2; exit 1 ;;
    esac
  fi
  docs_account_guard
  aws s3api put-object --bucket "$docs_bucket" --key "$docs_file" \
    --body "$docs_bundle/$docs_file" --content-type 'text/html; charset=utf-8' \
    --cache-control no-store --expected-bucket-owner 411430101559 \
    "${docs_condition[@]}" \
    > "$docs_evidence/$docs_file-put.json"
  docs_readback "$docs_file" "$docs_bundle/$docs_file" "$docs_file-readback"
}
docs_readback "releases/$docs_sha/index.html" "$docs_bundle/index.html" release-readback
for docs_file in 404.html index.html; do
  docs_publish "$docs_file"
done
node scripts/verify-docs-site.js --url "http://$docs_origin" \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/origin.json"
```

An existing release key is acceptable only when its readback bytes and metadata
match. Public replacements retain the previous bytes/metadata and use their ETag;
absent keys require `If-None-Match: *`. A conditional-write failure stops the run:
inspect the concurrent change before retrying in a new evidence directory. The two
public writes are separate. [S3 conditional writes](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html)
Any other upload error or mismatch stops publication. Require every live
origin check to pass, including missing installers and denied private releases.
Retain the exact objects' receipts, readback hashes, and verifier report.

## Point Cloudflare at the verified website

Back up the existing `docs` CNAME completely, including its ID, target, proxy state,
TTL, and metadata. Preserve all unrelated rules. Configure this one Cloud Connector
rule through **Rules > Cloud Connector** in the verified `wharfie.dev` zone:

```json
{
  "description": "Wharfie documentation S3 website",
  "enabled": true,
  "expression": "http.host eq \"docs.wharfie.dev\"",
  "provider": "aws_s3",
  "parameters": {
    "host": "wharfie-docs-411430101559-us-east-1.s3-website-us-east-1.amazonaws.com"
  }
}
```

If using the [Cloud Connector API](https://developers.cloudflare.com/rules/cloud-connector/create-api/),
its PUT replaces the complete rule list: include all existing rules unchanged.
Change only the existing `docs` CNAME to the exact website hostname above, set
**Proxied** (`proxied: true`), and use **Auto TTL**. Cloud Connector supplies the
Host override and HTTP origin connection for matching requests. Leave other hosts'
TLS settings unchanged. Confirm Cloudflare's visitor certificate covers
`docs.wharfie.dev`; retain the rule/DNS readbacks and cutover timestamp.

Verify from a fresh client after DNS convergence, without a connection override:

```bash
node scripts/verify-docs-site.js --url https://docs.wharfie.dev \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/public.json"
```

All checks must pass with exact landing/error bytes and valid visitor TLS. Repeat
with a new report path after the previous DNS TTL; inspect mobile/desktop rendering,
keyboard focus, and outgoing guide/release/feedback links. Do not submit an issue.
Ensure existing cache rules do not override `no-store`; investigate stale responses
before accepting the cutover. Keep the working CloudFront fallback until this passes.

## Finish migration, then publish later changes

After public acceptance, create an **UPDATE** change set for the existing
`wharfie-docs` stack using `bundle/hosting.template.json`, with no parameters.
Inspect it: the same `DocsBucket` and `DocsBucketPolicy` remain; only the obsolete
CloudFront distribution, function, OAC, and response-header policy are removed.
Stop on bucket replacement/removal or any unrelated resource. Execute after an
account guard and wait for stack update completion. **Do not delete the hosting
stack or bucket.** Independently verify the removed physical IDs are absent and
the website still passes its public checks.

Delete the separate `wharfie-docs-certificate` stack only after the old distribution
is gone and its recorded ACM certificate has no remaining users. Verify deletion
and retain the receipt. Leave the historical `docs.wharfie.dev` bucket in
`us-west-2` untouched; its owner is unknown. Other applications and soak resources
are outside this migration.

For later content changes, prepare a clean bundle and repeat only the exact upload,
readback, and origin/public verification steps. Keep the previous accepted bundle.
For rollback, verify that retained bundle's hashes, select it as `docs_bundle`, and
use a fresh evidence directory. Run the same conditional `docs_publish` function for
its `404.html` and `index.html`, then verify both endpoints. Keep each publication's
`*-before.html` and metadata as additional exact pre-change recovery copies.
The private release copy provides an additional authenticated landing-page readback.
Source edits or merges alone do not deploy.

Before the old distribution is removed, DNS rollback also requires restoring the
saved connector rules and exact DNS record, then checking its TLS and content.
After removal, use the S3 content rollback; the former CloudFront endpoint is no
longer a fallback. Never use broad sync, recursive deletion, or whole-bucket removal.

## Evidence

The current CloudFront site passed its public browser/TLS checks on 2026-09-16;
PR 169's guides and feedback links are already merged. These are the migration
baseline, not proof of the new S3/Cloudflare route.

| Evidence                                                            | Status   |
| ------------------------------------------------------------------- | -------- |
| Transitional stack update; exact object readbacks                   | Pending. |
| S3 website verifier                                                 | Pending. |
| Scoped Cloud Connector rule, proxied DNS, public TLS/routes/browser | Pending. |
| Final stack update, old-resource absence, repeat public checks      | Pending. |

Retain sanitized acceptance and rollback evidence before closing
[issue 137](https://github.com/wharfie/wharfie/issues/137). This does not publish a
Wharfie package or establish soak/tester acceptance.
