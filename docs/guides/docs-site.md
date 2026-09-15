# Publish the current documentation landing page

This is the publication plan for [docs/site/index.html](../site/index.html).
The artifact is ready for local review. It has not been deployed by this PR.
[Issue 137](https://github.com/wharfie/wharfie/issues/137) remains open until the
public endpoint and legacy routes have been independently checked.

## Prepared artifact

`docs/site/index.html` is a single HTML file with inline CSS. It needs no build,
JavaScript, third-party fonts, package install, or runtime service. It links to
one canonical repository journey,
[Build, share, and run a preview](recipient-preview.md), and the exact
[v0.0.15 release](https://github.com/wharfie/wharfie/releases/tag/v0.0.15).
The repository guides remain the source of command examples.

Review it locally without publishing:

```bash
python3 -m http.server 8765 --bind 127.0.0.1 --directory docs/site
```

Open `http://127.0.0.1:8765/`, check a narrow and wide viewport, tab through the
links, and follow the guide and release links. Stop the server when finished.
This review does not establish that any public URL changed.

## Current origin and remaining authority

The proposed public entry point remains `https://docs.wharfie.dev/`. A fresh
read on 2026-09-15 returned the retired v0.0.14 Athena/table documentation and
links to removed installers. The maintainer confirmed that Cloudflare's `docs`
record targets `docs.wharfie.dev.s3-website-us-west-2.amazonaws.com` and that the
zone is currently managed through a personal Cloudflare account. Deployment
access to that account has not yet been established.

The removed historical deploy script targeted a bucket named
`docs.wharfie.dev`, matching the confirmed website endpoint in `us-west-2`.
The current repository contains no active docs deployment workflow. Public
reads of the regional S3 endpoint succeed, but ownership checks have not
identified the bucket's AWS account. The available Wharfie and personal AWS
profiles have no verified authority to manage it. Cloudflare account ownership
does not establish S3 bucket ownership or grant access to its contents.

The proposed next hosting change is a replacement origin in a Wharfie-owned
AWS account, with its deployment configuration kept in this repository. Stage
and verify that origin before changing the `docs` record. The current DNS
account can perform that scoped cutover; broader zone ownership changes are a
separate task. Retiring the old bucket requires establishing its owner and
verifying the replacement first.

Before a publication change, record the actual owner and available operator
access for:

- The replacement origin: AWS account, bucket, region, and serving endpoint.
- The Cloudflare zone and current DNS, origin, redirect, and cache rules.
- The exact object keys and route rules this change will replace.
- A named maintainer who can apply and roll back those changes.

Record the selected serving mechanism and exact cutover commands in the
hosting follow-up before deployment. A DNS CNAME alone is not a complete origin
configuration: verify the incoming hostname, certificate, and route handling
at the replacement endpoint. Until the cutover passes, send testers directly
to the repository guide.

## Route map

Apply these explicit routes at the established serving layer. During initial
verification, use temporary redirects so a correction is not locked into a
browser's permanent redirect cache. Query strings must not be forwarded to a
different origin.

This response contract needs a serving layer that can enforce every route.
Replacing an S3 index object leaves other existing objects reachable; an
[S3 error document](https://docs.aws.amazon.com/AmazonS3/latest/userguide/CustomErrorDocSupport.html)
only handles requests that already fail. Cloudflare's ordinary
[Single Redirects](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/)
return redirect statuses, so they do not implement the installer `410`
responses below. Select and verify an explicit response handler before the
cutover; unrecognized paths must never fall through to old origin content.

| Public request                                                         | Intended response                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/` and `/index.html`                                                  | Serve the reviewed landing page as `text/html; charset=utf-8`.                                                |
| `/install`, `/install/`, `/install.html`                               | Redirect to `https://github.com/wharfie/wharfie/blob/master/docs/guides/installation.md`.                     |
| `/quickstart`, `/quickstart/`, `/quickstart.html`                      | Redirect to `https://github.com/wharfie/wharfie/blob/master/docs/guides/recipient-preview.md`.                |
| `/project-structure`, `/project-structure/`, `/project-structure.html` | Redirect to `https://github.com/wharfie/wharfie/blob/master/docs/guides/application-structure.md`.            |
| `/install.sh` and `/install.ps1`                                       | Return `410 Gone` as plain text, with a link to the current installation guide and no executable body.        |
| Every other path on the retired docs host                              | Return a small `404` page linking to the new landing page; do not fall through to the retired origin content. |

Inventory the current redirects and old installer link destinations before
applying the map. The plan above controls only `docs.wharfie.dev`; any installer
links on another hostname require that hostname's owner to retire them. URL
fragments do not reach the server, so redirect each page to a useful guide
without assuming the old fragment has a matching new section.

## Bounded publication and rollback

1. Record the reviewed Git commit, SHA-256 of `docs/site/index.html`, and an
   explicit deployment manifest containing only the objects and route rules
   being changed. Read back and retain the current values, content types,
   cache headers, and any origin/DNS configuration affected by the change.
   Confirm those backups are readable before writing anything.
2. Upload the landing page to a new, private staging key or preview host under
   the confirmed authority. Compare its downloaded SHA-256 with the reviewed
   file and inspect its rendered content. A staging key must not accidentally
   become the default public page. Verify private S3 staging through an
   authenticated read: an obscure key does not make a publicly readable object
   private. [S3 website endpoints](https://docs.aws.amazon.com/AmazonS3/latest/userguide/WebsiteEndpoints.html)
   serve public content over HTTP; the replacement endpoint must establish its
   own verified HTTPS serving path.
3. Publish only the manifest's exact keys and route rules. Serve HTML with a
   short cache lifetime during the cutover. Purge only the affected public
   URLs from the CDN, then check the responses below. Do not restore the old
   broad-prefix S3 deletion script or use an unrestricted recursive sync.
4. If checks fail, restore the backed-up exact objects and rules, invalidate
   those same URLs, and independently verify rollback. If the previous page
   would expose retired installation commands, prefer a prepared maintenance
   page linking directly to the repository guide; record that choice before
   the cutover. Avoid a partial rollback that leaves redirects and origin
   objects pointing at different documentation generations.
5. Retain the deployment manifest, before/after hashes, response evidence, and
   rollback location with the issue. Remove only the explicitly recorded
   staging object once the cutover is accepted.

The final origin-specific commands belong in a reviewed follow-up once the
actual account, bucket, and CDN controls are established. This plan grants no
new account access and changes no hosting resources.

## Independent public acceptance

From a fresh client outside the publisher's session, GET the root and every
route in the map. Retain status, redirect location, content type, and final URL;
verify redirects do not preserve a sample query string. Check both ordinary
requests and a cache-busting request, with redirects followed separately so
the initial response remains visible.

The root must identify the TypeScript CLI product and v0.0.15 preview, link to
the current single handoff and exact release, and retain its preview limits.
Its downloaded bytes must match the published artifact. The old tutorial
paths must reach their mapped current guides. Both installer paths must return
410 with no shell or PowerShell body, and an unknown path must return 404
without serving retired content. Repeat the checks after the CDN's configured
cache lifetime has elapsed.

Inspect the public page at mobile and desktop widths and with keyboard-only
navigation. Check all outgoing links and the feedback form. Open its preview
without submitting an issue. Record any checks that could not run rather than
marking them successful.

Only after these public checks and a confirmed rollback record should issue
137 close. This documentation cutover neither publishes a new Wharfie package
nor establishes completion of the operational soak or unfamiliar-tester runs.
