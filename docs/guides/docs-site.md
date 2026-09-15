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

## Target and authority to establish

The proposed public entry point remains `https://docs.wharfie.dev/`. A fresh
read on 2026-09-15 returned the retired v0.0.14 Athena/table documentation and
links to removed installers. Response headers indicate Cloudflare with an S3
origin; they do not establish ownership or the complete routing configuration.

The removed historical deploy script targeted a bucket named
`docs.wharfie.dev`. The current repository contains no active docs deployment
workflow. Read-only bucket-location and website checks using the current
`wharfie` AWS profile returned `AccessDenied`. No deployment authority follows
from that result.

Before a publication change, record the actual owner and available operator
access for:

- The serving origin: AWS account, bucket and region, or its replacement.
- The Cloudflare zone and current DNS, origin, redirect, and cache rules.
- The exact object keys and route rules this change will replace.
- A named maintainer who can apply and roll back those changes.

Once those facts are available, choose whether to replace the existing origin
or retire it in favor of another static host. The same one-file artifact works
for either choice. Record that decision in this guide before deployment. Until
then, send testers directly to the repository guide.

## Route map

Apply these explicit routes at the established serving layer. During initial
verification, use temporary redirects so a correction is not locked into a
browser's permanent redirect cache. Query strings must not be forwarded to a
different origin.

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
   become the default public page.
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
