# Two-provider self-deployment implementation checkpoint

- **Date:** 2026-07-29
- **Status:** AWS live lifecycle complete and cleaned up; Hetzner implementation hardened against the current API contract, live proof pending credentials
- **Branch:** `agent/two-provider-deploy`
- **Base commit:** `a2431716d72f15a1f53ec476690394623d14fa86`
- **Current implementation commit:** `1b7adf4`
- **Decision:** [ADR 0035](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)

## Goal

Build the narrow product journey:

```text
deployment-capable app SEA + ambient AWS or Hetzner credentials
  -> read-only plan
  -> one trusted public Linux node
  -> exact verified Linux app SEA
  -> non-root persistent systemd service
  -> later durable inspection
  -> complete owned-resource cleanup
```

This is not general infrastructure as code. The initial topology has one
coordinator and one trusted node, with durable recovery after coordinator
process failure rather than automatic coordinator or node replacement.

## Current repository truth

- The single-host developer preview is accepted at proof commit `39be8d6`.
- `wharfie app package --self-deployable` now produces one operator SEA with an
  authenticated Linux x64 application SEA embedded inside it.
- The packaged `wharfie deployment apply` and `destroy` surface supports both
  `aws` and `hetzner`; packaged plan, inspect, reconcile, and update remain out
  of scope.
- AWS apply uses an explicit region and the ordinary credential chain. It
  references a qualifying default VPC and subnet, then owns one security group,
  EC2 instance, and encrypted delete-on-termination root volume.
- Hetzner apply uses an explicit location and ambient `HCLOUD_TOKEN`. It owns
  one firewall, primary IPv4, and server.
- Both providers durably fence mutations before sending them, recover ambiguous
  responses through deterministic identity and exact readback, fail closed on
  contradictory ownership, activate the embedded SEA through pinned SSH, and
  resume destroy from the journal.
- Destroy derives the provider region or location from exact durable authority
  instead of accepting a redirecting selector. Root-disk application and
  control data are deliberately destroyed with the preview node.
- The production AWS boundary has now completed one live packaged lifecycle in
  `us-east-2`: plan, create, bootstrap, pinned-SSH activation, systemd health,
  second-process adoption, service restart, destroy, and independent cleanup.
- Hetzner now has current-contract HTTP fixtures, full coordinator and durable
  recovery coverage, and bounded eventual-consistency convergence. Its live
  account behavior, public networking, SSH reachability, and cleanup remain
  empirical release risks because no `HCLOUD_TOKEN` was available for this
  checkpoint.

## Live AWS hello-world proof

The hello-world demo was rebuilt from `83769f6` with:

```text
nvm use 24.13.1
node ../wharfie/bin/wharfie app package . --self-deployable --target node24.13.1-darwin-arm64 --output-dir ./dist --json --no-pretty
```

The arm64 Mach-O operator SEA used for the AWS proof was 307,004,880 bytes with
SHA-256
`6ee201f7d7c4df7395da7a2c58ee4df9e1c4f9882fe0e4ca8bf78ef23a6c7586`.
Its embedded Linux x64 artifact is 156,961,984 bytes. The local ordinary CLI
returned `Hello, Ada!` before cloud authority was used.

Using the ordinary ambient AWS credential chain, an explicit `us-east-2`
region, and one operator IPv4 `/32`, the packaged SEA then:

1. resolved a qualifying default-VPC public path, a Canonical Ubuntu 24.04
   x64 image, and the fixed `t3.small` machine;
2. created exactly one dedicated security group, EC2 instance, encrypted
   delete-on-termination root EBS volume, and no network;
3. returned an `active` receipt after pinned-SSH upload and systemd-user
   convergence;
4. reported service status schema 3 with `health: healthy`, an enabled,
   loaded, active, running `wharfie-hello-world.service`, a `READY` current
   resident, verified artifact integrity, and lingering enabled;
5. ran the remote ordinary CLI and returned `Hello, Ada!`;
6. ran the identical packaged apply from a fresh coordinator process and
   returned the same deployment instance, address, revision, and artifact
   without replacement;
7. restarted the systemd user service, observed a new PID and runtime
   generation with health restored, and returned `Hello, Grace!`; and
8. returned a `destroyed` receipt, after which independent AWS reads found the
   instance terminated and both the root volume and security group absent.

Two earlier diagnostic incarnations were also destroyed and independently
proved absent. No Wharfie-created AWS resource was left running.

The live audit found and fixed six gaps before that successful lifecycle:

- AWS SDK clients now receive one immutable credential snapshot through a
  provider function instead of mutating the frozen snapshot object.
- Canonical Ubuntu discovery is EC2-only, avoiding an unnecessary SSM
  permission; it strictly handles the live three-entry block-device mapping.
- `DescribeRouteTables` uses AWS's live maximum page size of 100.
- EC2 CPU-credit evidence uses the exact instance-ID request shape rather than
  a filter that returns no rows.
- Linux upload uses GNU `dd`'s portable `conv=excl,fsync` form.
- Cloud-init explicitly creates the Wharfie data root as the non-root service
  account before creating its deployment child.

Final validation for the last activation fixes passed 13 suites and 175 tests,
source and test typechecks, targeted ESLint and Prettier, and
`git diff --check`. Temporary payloads, detached worktrees, and local live
authority were removed.

## Hetzner implementation hardening

Commit `1b7adf4` reconciles the implementation with the current official
Hetzner Cloud OpenAPI contract and closes the mock-only lifecycle gaps found
before live testing:

- server-type discovery no longer sends the unsupported `architecture` query;
  x86 selection remains a strict local check;
- exact server-type and image IDs are serialized as the required decimal
  strings, while firewall and Primary IP references remain numeric;
- official `pending` firewall state, nullable transient public-network fields,
  and nullable pagination totals are decoded without weakening exact ownership
  checks or pagination bounds;
- apply polls only explicitly recognized asynchronous states for up to 60
  seconds, without replaying a create;
- destroy polls exact ownership to absence for up to 60 seconds and preserves
  the server → Primary IP → firewall dependency order without replaying a
  delete;
- a definite provider 4xx now durably releases its prepared create fence, so a
  rejected server create cannot permanently block retry or cleanup of an
  already-created Primary IP; ambiguous transport and 5xx outcomes remain
  fenced and fail closed; and
- concurrent first credential binds accept only the legitimate hard-link
  publication cleanup transition and converge on one immutable winner.

The combined Hetzner provider and journal validation passed 11 suites and 208
tests. All source, app, test, and SEA-verifier typechecks passed, as did
targeted ESLint, Prettier, and `git diff --check`.

The hello-world self-deployable SEA was rebuilt from `1b7adf4` and locally
returned `Hello, Ada!`. The retained artifact is 307,021,392 bytes with SHA-256
`952baa8148b417addde8d5edf920249f23aff1bd847893a732b67639550479e5`
and artifact ID
`waf1_lSuqgUi0F63d6NXt-SAknyOv8b2EeJOnMrZ2OVUEeeU`. The superseded 307 MB SEA
and build temporaries were removed.

No ambient `HCLOUD_TOKEN` or installed authenticated Hetzner CLI was available,
so this checkpoint makes no live-resource claim. No Hetzner resource was
created or billed.

## Known recovery loose end

Rebuilding an earlier logical revision reproduced its revision ID and byte
length but not its final SEA byte digest. The journal correctly rejected the
substitute and no cloud mutation occurred. Current recovery is sound when the
original self-deployable SEA is retained—the successful second apply proved
that path—but byte-for-byte packaging reproducibility remains unresolved and
should be fixed or made an explicit artifact-retention contract.

## Work next

1. Run the same bounded hello-world lifecycle against Hetzner and independently
   verify cleanup.
2. Resolve final SEA byte reproducibility or formalize retention of the
   original operator SEA as recovery authority.
3. Add approachable preview/status/update/recovery commands only after the
   Hetzner lifecycle passes.
4. Decide an explicit retained-data capability before claiming durability
   beyond the node root-disk lifecycle.
5. Delete or quarantine superseded general AWS graph code that does not serve
   this narrow lifecycle.

## Security and recovery defaults

- AWS credentials come only from the ordinary SDK chain.
- Hetzner credentials come only from `HCLOUD_TOKEN`.
- Provider credentials never reach the remote host or serialized evidence.
- SSH is limited to explicit IPv4 `/32` sources.
- A generated deployment client private key stays in owner-only local state.
- Initial SSH host authentication is pinned TOFU after provider-ID/address
  cross-check, not provider attestation.
- Provider creates recover through exact idempotency or ownership readback.
- Multiple or contradictory matches fail closed.
- Destroy purges all preview-owned billable resources; root-disk data is not
  retained.

## Stop conditions

Do not expand into persistent volumes, custom networks, object stores, general
provider plugins, multiple nodes, cloud application secrets, ingress beyond
restricted SSH, mesh enrollment, or coordinator leases before both bounded
single-node provider paths pass and clean up.
