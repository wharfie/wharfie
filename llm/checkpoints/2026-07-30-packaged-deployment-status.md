# Packaged journal-bound deployment status checkpoint

- **Date:** 2026-07-30
- **Status:** AWS and Hetzner packaged read-only deployment status implemented
- **Branch:** `agent/two-provider-deploy`
- **Starting commit:** `c354cd48180d08de3ea965f43ad8469f3e8e5a6d`
- **Implementation commit:** the commit containing this checkpoint
- **Decision:**
  [ADR 0035](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)

## Goal

Give a self-deployable application SEA one approachable, provider-neutral way
to answer what happened after apply or coordinator exit:

```text
<app> wharfie deployment status --deployment-instance <id> [--data-root <absolute>] [--json]
```

Status starts from existing durable local authority. It derives the provider
and scope from the journal, joins that authority with one exact provider
observation and the pinned guest's packaged `service status`, and emits one
bounded nonsecret receipt. It is deliberately app-bound rather than bound to
the current outer SEA revision, so a newer SEA for the same app can inspect an
older deployment.

## Stable receipt

The schema-v1 `wharfie.single-node-deployment.status` receipt contains:

- the exact app, logical deployment, deployment instance, desired revision,
  application revision, artifact digest/size/target, mode, machine, and access
  policy;
- journal ID, generation, incarnation, and phase;
- the journal-derived provider and all three provider resource roles, each
  classified as `absent`, `settling`, `exact`, or `conflict`;
- pinned guest address and host-key evidence plus a narrow service projection
  containing health, active artifact/revision, and whether it matches desired;
  and
- one disposition: `converging`, `healthy`, `degraded`,
  `recovery-required`, `destroying`, or `destroyed`, with a bounded reason and
  next action.

The disposition distinguishes provider drift/conflict, guest reachability or
invalid evidence, unhealthy service, old active release, and effects that are
ahead of the durable journal. In particular, exact provider or guest effects
behind a prepared mutation fence remain exact evidence, allowing status to say
`journal-behind-effects` instead of masking recovery as ordinary convergence.

## Structural no-write boundary

- The packaged command constructs a journal store and captures only its
  existing `read()` capability. Missing authority is an error; status never
  prepares storage, initializes, commits, or acquires an operation lock.
- AWS re-authenticates the journal's exact account/partition/region through the
  existing read authority, projects only five `Describe*` capabilities, takes
  one evidence snapshot, and always closes the authority.
- Hetzner requires the already-published local token binding before creating a
  frozen client containing only six resource list/get methods. It reuses the
  provisioning ownership and exact-spec verifiers without polling, waiting, or
  exposing create/delete capabilities.
- Existing SSH identity and known-host evidence are opened read-only. Status
  recomputes cloud-init authority, requires the enrolled Ed25519 host key,
  verifies the remote bootstrap identity, and invokes only the pinned
  artifact's `wharfie service status --json`.
- Provider credentials, SSH key material, raw provider/SSH errors, raw guest
  receipts, data-root paths, and ambiguous conflicted addresses are never
  projected into the public receipt.

Credential absence or scope/binding mismatch is a command failure rather than
being mislabeled as deployment drift. Once exact provider state is available,
an unreachable guest is a valid degraded status receipt.

## Automated evidence

Under the repository-pinned Node 24.13.1:

- all source, app, test, and SEA-verifier typechecks passed;
- full-repository ESLint passed and all JavaScript/JSON matched Prettier;
- 225 focused command, runtime-mount, receipt, SSH, guest, provider,
  API-client, provisioning, and documentation tests passed across 12 suites;
- the package-content verifier passed for 339 files; and
- `git diff --check` passed.

The focused Jest run used `--no-cache`, and no SEA or cloud resource was built
for this proof. The already-known unrelated execution-ledger `SIGABRT` prevents
using an unfiltered Jest run as acceptance evidence; it was not retried here.

## Proof boundary

This checkpoint proves the status composition and provider/guest boundaries
through automated exact-contract tests. It does not claim a new live AWS or
Hetzner status run, certificate-signed packaging reproducibility, cross-host
reproducibility, coordinator failover, node replacement, or retained data
across destroy. The prior live apply/activate/adopt/restart/destroy and
read-only preview proofs remain the provider substrate evidence.

One reason-classification limitation remains: the current SSH transport does
not distinguish a connection failure from every nonzero remote command exit,
so status conservatively reports both as `guest-unreachable`. Splitting those
cases safely requires a richer transport outcome rather than interpreting an
ambiguous SSH exit code.

## Work next

1. Add an approachable packaged update and explicit recovery sequence using
   this status receipt as the operator-facing diagnosis.
2. Complete the repeatable two-provider ADR 0035 harness for guest audit,
   reboot, unfinished durable work, lost responses, ownership conflicts, and
   bounded redacted proof receipts.
3. Decide and implement a retained-data capability before claiming durability
   across node destruction or replacement.
