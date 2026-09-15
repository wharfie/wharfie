# Publish the documentation landing page

Deploy [the landing page](../site/index.html) through private S3, CloudFront OAC, and a
CloudFront Function. This manual AWS CLI runbook uses repository templates and local helpers; there is no CI deployment workflow.
Staging verification passes; custom-domain publication remains pending. [Issue 137](https://github.com/wharfie/wharfie/issues/137) stays open until public acceptance and rollback records are complete.

The fixed destination is AWS account `411430101559`, region `us-east-1`, stack
`wharfie-docs`, bucket `wharfie-docs-411430101559-us-east-1`, and certificate stack
`wharfie-docs-certificate`. The bucket blocks public access; its policy permits this distribution to read release HTML through signed [OAC requests](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html).
CloudFront serves HTTPS and the function enforces this route contract:

| Request                                                                | Response                                                               |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `/`, `/index.html`                                                     | `200`, exact reviewed HTML bytes.                                      |
| `/install`, `/install/`, `/install.html`                               | `302` to the current [installation guide](installation.md).            |
| `/quickstart`, `/quickstart/`, `/quickstart.html`                      | `302` to the [recipient guide](recipient-preview.md).                  |
| `/project-structure`, `/project-structure/`, `/project-structure.html` | `302` to [application structure](application-structure.md).            |
| `/install.sh`, `/install.ps1`                                          | `410`, plain text linking to current installation; no executable body. |
| Every other accepted request path                                      | `404`, with a link to current documentation.                           |
| Methods other than GET/HEAD                                            | `405`, `Allow: GET, HEAD`.                                             |

Application HTTPS responses use `Cache-Control: no-store` and security headers. Redirects discard queries; unknown paths cannot reach arbitrary objects or the old origin.
CloudFront can reject malformed paths with `400` before the function runs. The verifier checks 36 application routes and one explicit provider rejection (`/%2e%2e/install`), for 37 total checks; provider errors are outside the application header/body contract.

## Prepare a reviewed bundle

Use the repository-pinned Node.js `24.13.1`, AWS CLI v2 with a working `wharfie` login, and Cloudflare DNS access.
Run blocks in one Bash session from a clean, reviewed checkout. Retain evidence privately outside Git; never commit credentials, emails, or DNS backups.

```bash
set -eu
umask 077
export AWS_PROFILE=wharfie AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
export AWS_DEFAULT_OUTPUT=json AWS_PAGER='' AWS_CLI_AUTO_PROMPT=off
docs_account_guard() {
  test "$(aws sts get-caller-identity --query Account --output text)" = 411430101559
}
docs_account_guard
test -z "$(git status --porcelain --untracked-files=normal)"
docs_run=$(mktemp -d "${TMPDIR:-/tmp}/wharfie-docs.XXXXXX")
docs_bundle="$docs_run/bundle"
docs_evidence="$docs_run/evidence"
mkdir -m 700 "$docs_evidence"
node scripts/prepare-docs-site.js --output-dir "$docs_bundle"
docs_sha=$(node --input-type=module - "$docs_bundle" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(`${dir}/manifest.json`));
assert.equal(m.git.dirty, false);
assert.equal(m.contentSha256, m.files.find(f => f.name === 'index.html').sha256);
for (const f of m.files) {
  const bytes = readFileSync(`${dir}/${f.name}`);
  assert.equal(bytes.length, f.size);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256);
}
console.log(m.contentSha256);
NODE
)
docs_bucket=wharfie-docs-411430101559-us-east-1
```

The bundle contains `manifest.json`, `index.html`, rendered `hosting.template.json`, `certificate.template.json`, and `parameters.json`. The manifest records Git provenance,
file sizes/hashes, and `releases/<contentSha256>/index.html`. Retain accepted bundles.
**Generated `parameters.json` is staging-only:** its empty hostname/certificate values
would detach the production alias if reused in an update.

## Create staging and verify its object

For an absent stack, create this change set; for an existing stack, inspect its outputs/parameters and use the update procedure. Guard the account before mutations.

```bash
docs_account_guard
docs_change="docs-create-$(date -u +%Y%m%dT%H%M%SZ)"
aws cloudformation create-change-set --stack-name wharfie-docs \
  --change-set-name "$docs_change" --change-set-type CREATE \
  --template-body "file://$docs_bundle/hosting.template.json" \
  --parameters "file://$docs_bundle/parameters.json"
aws cloudformation wait change-set-create-complete --stack-name wharfie-docs --change-set-name "$docs_change"
aws cloudformation describe-change-set --stack-name wharfie-docs --change-set-name "$docs_change" > "$docs_evidence/create-change.json"
```

Review `create-change.json` and the template for the expected bucket, OAC, distribution, function, headers, and policy. Stop on unexpected changes.

```bash
docs_account_guard
aws cloudformation execute-change-set --stack-name wharfie-docs --change-set-name "$docs_change"
aws cloudformation wait stack-create-complete --stack-name wharfie-docs
aws cloudformation describe-stacks --stack-name wharfie-docs > "$docs_evidence/staging-stack.json"
docs_distribution=$(aws cloudformation describe-stacks --stack-name wharfie-docs --query "Stacks[0].Outputs[?OutputKey=='DistributionDomainName'].OutputValue | [0]" --output text)
docs_account_guard
if ! aws s3api put-object --bucket "$docs_bucket" --key "releases/$docs_sha/index.html" \
  --body "$docs_bundle/index.html" --content-type 'text/html; charset=utf-8' \
  --cache-control no-store --if-none-match '*' --expected-bucket-owner 411430101559 \
  > "$docs_evidence/upload.json" 2> "$docs_evidence/upload.err"; then
  case "$(cat "$docs_evidence/upload.err")" in
    *'(PreconditionFailed)'*) ;; # Existing immutable object: verify it below.
    *) cat "$docs_evidence/upload.err" >&2; exit 1 ;;
  esac
fi
aws s3api get-object --bucket "$docs_bucket" --key "releases/$docs_sha/index.html" \
  --expected-bucket-owner 411430101559 "$docs_evidence/download.html" > "$docs_evidence/download.json"
node --input-type=module - "$docs_evidence" "$docs_sha" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [dir, sha] = process.argv.slice(2);
assert.equal(createHash('sha256').update(readFileSync(`${dir}/download.html`)).digest('hex'), sha);
const metadata = JSON.parse(readFileSync(`${dir}/download.json`));
assert.equal(metadata.ContentType, 'text/html; charset=utf-8');
assert.equal(metadata.CacheControl, 'no-store');
NODE
node scripts/verify-docs-site.js --url "https://$docs_distribution" \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/staging.json"
```

On [`412 PreconditionFailed`](https://docs.aws.amazon.com/cli/latest/reference/s3api/put-object.html), verify the existing object; never overwrite it. Different bytes or metadata stop publication.
Initial staging can return `403` before its policy/object exist; require stack completion, readback, and **37 passing live verifier checks**.
Validate function changes in the actual AWS runtime and repeat the live gate: Node tests alone do not establish CloudFront compatibility. Initial staging caught a default-parameter syntax error that passed Node checks.
Inspect mobile/desktop rendering, keyboard navigation, and outgoing links.

## Validate the certificate and attach the hostname

CloudFront requires the ACM certificate in [us-east-1](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cnames-and-https-procedures.html).
Inspect `wharfie-docs-certificate` first; it may already be waiting for DNS. Execute
the creation command below only when absent, after reviewing the bundled template.

```bash
# First installation only, after confirming the certificate stack is absent:
docs_account_guard
aws cloudformation create-stack --stack-name wharfie-docs-certificate \
  --template-body "file://$docs_bundle/certificate.template.json"
# For either an existing or newly created stack, once its certificate appears:
docs_certificate=$(aws cloudformation describe-stack-resources --stack-name wharfie-docs-certificate --query "StackResources[?LogicalResourceId=='DocsCertificate'].PhysicalResourceId | [0]" --output text)
aws acm describe-certificate --certificate-arn "$docs_certificate" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
```

Add the exact returned validation CNAME in Cloudflare as **DNS only**; retain it for
renewal. After these waits, confirm ACM status `ISSUED`, domain `docs.wharfie.dev`, and
ARN account `411430101559`/region `us-east-1`. Attach the alias with the content preserved:

```bash
aws acm wait certificate-validated --certificate-arn "$docs_certificate"
aws cloudformation wait stack-create-complete --stack-name wharfie-docs-certificate
docs_account_guard
docs_change="docs-alias-$(date -u +%Y%m%dT%H%M%SZ)"
aws cloudformation create-change-set --stack-name wharfie-docs --change-set-name "$docs_change" \
  --change-set-type UPDATE --use-previous-template --parameters \
  ParameterKey=ContentSha256,UsePreviousValue=true \
  ParameterKey=CustomDomain,ParameterValue=docs.wharfie.dev \
  ParameterKey=CertificateArn,ParameterValue="$docs_certificate"
aws cloudformation wait change-set-create-complete --stack-name wharfie-docs --change-set-name "$docs_change"
aws cloudformation describe-change-set --stack-name wharfie-docs --change-set-name "$docs_change" > "$docs_evidence/alias-change.json"
```

Review `alias-change.json`, execute the exact change set with the guarded command
above, and wait for `stack-update-complete`. Before changing public DNS, run:

```bash
node scripts/verify-docs-site.js --url https://docs.wharfie.dev \
  --connect-host "$docs_distribution" --bundle-dir "$docs_bundle" \
  --output "$docs_evidence/alias-before-dns.json"
```

`--connect-host` changes only the connection destination; verified TLS, SNI, and HTTP Host use `docs.wharfie.dev`. Public DNS remains unchanged.

## Cut over the existing Cloudflare record

Before cutover, merge [PR 169](https://github.com/wharfie/wharfie/pull/169) and check its public guide and feedback links: the landing page targets `master`, where the new `preview-feedback.yml` form was still absent during staging. Confirm the revised recipient and installation guides are visible too.
Prepare the clean committed release bundle and compare its HTML and rendered hosting-template hashes with the verified staging bundle; restage and reverify any changed artifact.

The zone is managed in a personal Cloudflare account. Its existing `docs` CNAME targets
`docs.wharfie.dev.s3-website-us-west-2.amazonaws.com`; the old AWS bucket owner remains
unknown. DNS ownership does not establish S3 ownership. Leave that bucket untouched
and record existing Cloudflare redirect/cache rules.

Privately back up the **exact DNS record**: ID, type, full name, target, proxy state,
TTL, and other editable metadata. In Cloudflare's DNS dashboard update that record:
type `CNAME`, name `docs`, target `$docs_distribution`, **DNS only** (`proxied: false`),
TTL `300`. Save the resulting record and timestamp. Keep validation CNAMEs separate;
leave other records and Cloudflare rules unchanged.

Check DNS with an independent resolver and allow the previous TTL to expire. Run
from a fresh client/network with the bundle and scripts, without a connection override:

```bash
node scripts/verify-docs-site.js --url https://docs.wharfie.dev \
  --bundle-dir "$docs_bundle" --output "$docs_evidence/public.json"
```

Require all 37 checks, including the manifest's root SHA. Repeat after DNS convergence with a new report path.
Check public mobile/desktop rendering, keyboard navigation, links, and the feedback form without submitting an issue.
Until then, give testers the [recipient guide](recipient-preview.md) directly.

## Update content or roll it back

Prepare a new clean bundle/evidence directory and repeat immutable upload/readback before switching content.
Retain current `describe-stacks` output including `ContentSha256` and the accepted bundle for rollback. For **content-only** changes:

```bash
docs_account_guard
docs_change="docs-content-$(date -u +%Y%m%dT%H%M%SZ)"
aws cloudformation create-change-set --stack-name wharfie-docs --change-set-name "$docs_change" \
  --change-set-type UPDATE --use-previous-template --parameters \
  ParameterKey=ContentSha256,ParameterValue="$docs_sha" \
  ParameterKey=CustomDomain,UsePreviousValue=true \
  ParameterKey=CertificateArn,UsePreviousValue=true
```

Wait for change-set completion, inspect it, execute it after an account guard, and wait
for stack-update completion. Verify both endpoints against the new bundle. This recipe
preserves the existing template; router/template changes require a separate reviewed
update. Never use the generated staging parameters in production.

For rollback, select the prior bundle's verified hash in the same content-only change
set and repeat public verification. Prefer this certificate-backed origin or reviewed
maintenance HTML linking to `https://github.com/wharfie/wharfie/blob/master/docs/guides/recipient-preview.md`,
published with the same bundle/upload/update procedure. If DNS rollback is necessary,
verify the destination and TLS first, restore the exact saved record, and recheck after
its TTL. The old origin contains retired installers; returning users there is not a
successful recovery. If no safe origin is available, send testers the repository guide
and record the outage. Retain the bucket, certificate, and rollback releases; do not
use recursive sync, broad deletion, or old-origin cleanup.

Evidence checked on 2026-09-15: `staging-verification-v2.json` finished at 16:35 UTC with all 37 checks passing; `fixed-api-proof.json` records six passing AWS `LIVE` function cases. Retain these bounded reports with the bundle; they do not establish custom-domain publication.

| Acceptance evidence                                                | Status                                                                                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging immutable object and authenticated readback                | Passed; SHA-256 `0c17e89550a07f3ebb05fdff691eb6ba7da8d75abdfaf1168a6e83ccb67cd808` matches bundle, origin readback, and public staging HTML. |
| Clean committed release bundle                                     | Pending; staging records commit `00c5ec4d193b22eca3b609caf16fb0ea6b75609e` with `dirty: true`.                                               |
| CloudFront staging endpoint                                        | [d1sdjfclzv637e.cloudfront.net](https://d1sdjfclzv637e.cloudfront.net/) (`EITEBWLWDGRVN`); **37/37 passed**.                                 |
| AWS `LIVE` function runtime                                        | **6/6 passed** after the default-parameter syntax fix.                                                                                       |
| Issued certificate and pre-DNS hostname/TLS report                 | Pending DNS validation and alias attachment.                                                                                                 |
| PR 169 public guides and feedback form                             | Pending merge and public link verification.                                                                                                  |
| Private DNS backup, cutover record, independent public reports     | Pending; `docs.wharfie.dev` has not been cut over.                                                                                           |
| Public rendering/keyboard/link review and verified rollback record | Pending.                                                                                                                                     |

Attach sanitized evidence before closing issue 137. This cutover does not publish a Wharfie package or prove soak/tester acceptance.
