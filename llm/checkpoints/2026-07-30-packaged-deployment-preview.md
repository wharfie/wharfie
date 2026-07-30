# Packaged two-provider deployment preview checkpoint

- **Date:** 2026-07-30
- **Status:** AWS and Hetzner packaged read-only preview implemented and live
  proven
- **Branch:** `agent/two-provider-deploy`
- **Starting commit:** `6f36d69257b847dfbb3e9b1bf9ba703e265857ed`
- **Implementation commit:** the commit containing this checkpoint
- **Decision:**
  [ADR 0035](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)

## Goal

Close the first remaining ADR 0035 product gap without creating another
stateful planning lifecycle:

```text
self-deployable application SEA + ambient provider access
  -> authenticate the exact embedded Linux desired state
  -> inspect current provider and optional local journal state
  -> emit one stable redacted preview
  -> perform zero local or cloud mutation
```

Preview is diagnostic rather than durable authority. A later apply always
re-reads provider state and generates and persists its incarnation, ownership
identities, SSH material, cloud-init, and exact mutation requests.

## Implemented surface

Both providers now use the same packaged selectors:

```text
<app> wharfie deployment preview --deployment <logical-id> --provider aws --region <region> --allow-ssh-from <ipv4/32>... [--data-root <absolute>] [--json]
<app> wharfie deployment preview --deployment <logical-id> --provider hetzner --location <name> --allow-ssh-from <ipv4/32>... [--data-root <absolute>] [--json]
```

The stable schema-v1 receipt reports:

- exact embedded app, revision, desired revision, Linux artifact digest/size,
  target, mode, machine class, and access policy;
- provider placement, selected machine and image, and network evidence;
- provider-specific managed roles separately from external/catalog references;
- absent or present local journal state and whether it matches desired state;
- `actionable`, `recovery-required`, or conservative `blocked` status; and
- semantic steps a later apply would evaluate.

It includes no provider authentication value, SSH material, generated ownership
value, cloud-init, artifact bytes, data-root path, raw SDK response, or raw
provider error.

## Structural no-write boundary

- AWS preview opens the existing read authority, which contains only STS
  identity and EC2 `Describe*` capabilities. It validates the exact
  account/partition/region scope, projects only the ten planner reads, validates
  the returned canonical plan, and always closes its SDK clients.
- Hetzner preview constructs a frozen client containing only the six planner
  collection `GET` methods. Create and delete methods never enter the preview
  boundary. Successful reads validate that `HCLOUD_TOKEN` works for its
  project, but the API does not expose a truthful project identity to report.
- The packaged command calls only
  `createSingleNodeDeploymentJournalStore(...).read()`. It never prepares
  storage, acquires the operation lock, initializes or commits a journal,
  creates an SSH identity, or constructs an apply/destroy coordinator.
- Embedded payload authority is closed on success and every failure path.

## Automated evidence

Under the repository-pinned Node 24.13.1:

- full ESLint and Prettier checks passed;
- all source, app, test, and SEA-verifier typechecks passed; and
- 134 focused command, runtime-mount, receipt, provider, API-client, and
  documentation tests passed.

An unfiltered Jest run was also attempted. Large execution-ledger workers
outside this change's import graph aborted with `SIGABRT` in both in-band and
four-worker modes before reporting test assertions; one of those files did the
same when isolated. The test runner's disposable state and generated macOS
crash reports were removed. The focused deployment surface above remained
green.

## Live packaged hello-world proof

The current hello-world source was packaged once as a temporary ad-hoc-signed
Darwin arm64 self-deployable SEA:

```text
revisionId: wrv1_VESnBl6P9WYNyeACaEIO30WDKH53kYiKupmvL_hPWnE
outer artifactId: waf1_WJEjsH1IGZBlAnBrZSqZadwY6ZJcvnLXWBQOTGVhVgU
outer size: 259995216
embedded Linux artifactId: waf1_iScsHJFMFUsGNJxzRjYwM5gQVKKxkPqyuVE-mEc1JKw
embedded Linux size: 133631168
```

That literal packaged SEA completed both live previews:

- AWS in `us-east-2` validated its ambient account scope, selected a usable
  default-VPC public path, current Canonical Ubuntu 24.04 image, `t3.small`,
  three planned managed roles, and two semantic actions. Status was
  `actionable`.
- Hetzner in `fsn1` validated ambient project-scoped reads, selected the
  currently available `cpx12`, Ubuntu 24.04, public networking, three planned
  managed roles, and the same two semantic actions. Status was `actionable`.

Both used fresh proof deployment identities. Their exact ownership inventories
were absent, their journal summaries were absent, and the deliberately
nonexistent `--data-root` paths remained nonexistent after each command.
Because the production preview boundaries contain no mutation capability,
neither proof created a cloud resource.

## Cleanup

- The temporary 248 MiB proof directory, outer SEA, and artifact record were
  removed.
- Empty build temporary directories and the interrupted Jest root were removed.
- Persistent Wharfie `builds`, `applications`, and `actor_binaries`
  directories are empty.
- The pre-existing 230 MiB verified Node-binary cache was retained to avoid an
  unnecessary future download.
- The sibling hello-world demo's pre-existing artifact was not changed.

## Work next

1. Add packaged status/inspection around journal-bound deployments without
   weakening provider ownership checks.
2. Add an approachable update and explicit recovery sequence.
3. Complete the repeatable two-provider ADR 0035 harness for reboot, unfinished
   durable work, fault injection, guest audit, and bounded redacted receipts.
4. Decide the retained-data capability before claiming durability across node
   destruction or replacement.
