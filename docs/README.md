# Wharfie documentation

Wharfie turns a TypeScript or JavaScript CLI into a portable executable, then
lets that application run as a persistent service on a trusted Linux machine.

**Start with [Build, share, and run a preview](guides/recipient-preview.md).**
It follows one application from a fresh builder to a recipient without Node,
through a durable timer, reconnect, and cleanup. Use an existing Linux server
first, or follow its optional AWS and Hetzner routes.

The published preview is
[v0.0.15](https://github.com/wharfie/wharfie/releases/tag/v0.0.15), built from
[`aae74e0de018fe340564c08c0c820ff590de1894`](https://github.com/wharfie/wharfie/commit/aae74e0de018fe340564c08c0c820ff590de1894).
The guide pins the matching downloads and checksums. npm's `preview` channel is
separate from `latest`; use the exact version when reporting results.

## Find the right guide

| Task                                               | Guide                                                                                           |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Build a CLI, share it, and keep it running         | [Recipient preview](guides/recipient-preview.md)                                                |
| Install the builder or matching AWS companion      | [Installation](guides/installation.md)                                                          |
| Write your own application                         | [Quickstart](guides/quickstart.md) and [application structure](guides/application-structure.md) |
| Inspect and recover a crashed cloud deployment     | [Remote recovery](guides/remote-recovery.md)                                                    |
| Operate an existing Linux service                  | [Single-host developer preview](guides/developer-preview.md)                                    |
| Look up packaged commands and persistence behavior | [CLI and runtime reference](../README.md)                                                       |
| Share what worked or where you got stuck           | [Preview feedback](https://github.com/wharfie/wharfie/issues/new?template=preview-feedback.yml) |

## Preview boundaries

Wharfie is experimental and breaking changes are expected. Use disposable
hosts and sample data. Persistent service operation currently requires Linux
with a working systemd user manager. Generated applications do not require
Node on the recipient; their platform and architecture must match the package.
Windows packaging is unsupported.

Closing a submitting shell leaves work with the resident service. A resident
crash or host reboot can require explicit coordinator inspection and recovery;
reconnecting alone does not replace a live coordinator. Preserve the
application's data and, for cloud deployments, the controller's deployment
journal and SSH authority. Destroying a cloud host removes its root-disk data.
This preview does not provide automatic recovery from loss of that disk.

Published-download and recipient acceptance passed for v0.0.15. The full
72-hour operational soak and unfamiliar-tester acceptance are still pending.
The merged journal-capacity performance fix is newer than v0.0.15; results for
that preview do not establish results for the newer runtime. The
[handoff's evidence record](guides/recipient-preview.md) keeps these boundaries
next to the version being tested.

## Maintainers and contributors

- [Development validation](guides/development-validation.md): clean installs,
  required checks, and retained failure reports.
- [Preview releases](guides/preview-release.md): package identity, provenance,
  publication, and recipient gates.
- [Live deployment acceptance](guides/live-deployment-acceptance.md): disposable
  provider runs and independent cleanup evidence.
- [Deployment journal capacity](guides/deployment-journal-capacity.md): limits,
  refusal behavior, and recovery reserve.
- [Publish the public docs](guides/docs-site.md): manual S3 uploads, verification,
  and rollback through Cloudflare.
- [Architecture decisions](architecture/decisions/README.md),
  [product direction](product/magnetic-first-run.md), and
  [implementation checkpoints](../llm/checkpoints/): design and historical
  evidence. Check each checkpoint's date and source before applying its claims
  to a release.

The old Athena/table product and its installers are retired. The repository guides
above are the current instructions. The [publication runbook](guides/docs-site.md)
records the public site's hosting migration and remaining acceptance checks.
