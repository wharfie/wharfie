# Packaged deployment update and recovery checkpoint

- **Date:** 2026-07-31
- **Status:** provider-neutral release update and journal-directed recovery implemented
- **Branch:** `agent/two-provider-deploy`
- **Starting commit:** `2bb578b`
- **Implementation commit:** the commit containing this checkpoint
- **Decision:**
  [ADR 0035](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)

## Goal

Let a newly packaged application SEA evolve or recover one existing single-node
deployment without exposing provider choices, SSH controls, or a generic remote
shell:

```text
<next-app> wharfie deployment update --deployment-instance <id> [--data-root <absolute>] [--json]
<app> wharfie deployment recover --deployment-instance <id> [--data-root <absolute>] [--json]
```

Update gets its target only from the invoking SEA's authenticated embedded
Linux payload. Recovery gets its action only from durable local authority.

## Journal v3 release model

Journal schema v3 creates a new `v3` storage namespace and `wsnj3` content-ID
domain. V2 journals are not migrated or reinterpreted; this repository has no
compatibility requirement.

Provider intent remains the immutable substrate authority. Release state is:

```text
release.current
release.rollback
release.transition = null | {
  kind: install | update,
  target: { desired, artifact, activation }
}
```

The committed current release stays authoritative throughout an update. A
target can settle only after exact artifact and healthy activation evidence are
durable. Settlement atomically promotes the target, retains the previous
current release in one rollback slot, and clears the transition. The transition
survives a lost remote response, journal commit response, or coordinator
process; replay accepts only the same target.

Application revision, artifact bytes, and Node version may change. Deployment,
application, provider, placement, mode, machine, access, platform,
architecture, and libc must remain identical to the provisioned substrate.

## Public command behavior

`deployment update` requires an active journal for the same embedded app. It
reuses the existing deployment SSH identity and pinned host key, uploads and
converges the invoking SEA's Linux payload, records exact activation evidence,
and settles the release. It performs no provider read or mutation.

`deployment recover` dispatches from durable state:

- `planned`, `provisioning`, `provisioned`, or `activating` resumes provider
  apply with the exact journal-selected install artifact;
- active with an update transition resumes that exact update;
- active with an update transition and the committed-current SEA first
  reconverges current, then abandons the failed target;
- stable active repairs the exact committed current release;
- `destroying` resumes journal-selected provider destruction; and
- `destroyed` returns a no-op recovery receipt.

The command accepts no action, provider, region, location, access, machine, or
artifact selector. Apply recovery requires the selected install artifact.
Update recovery accepts only the in-flight target or committed current; a
third release cannot replace an unresolved choice. Packaged destroy now also
derives its provider entirely from the journal.

Status schema v2 projects the release transition and reports `resume-update`
when appropriate. Remote status executes the committed current artifact while
comparing observed service state with the effective transition target.
`deployment exec` remains pinned to committed current authority; if the guest
advanced before local settlement, exact service validation fails closed until
recovery completes.

Remote activation lists only the fixed artifact root with bounded output,
validates every entry as an exact artifact-ID directory, and removes stale
wrappers with exact argv. Normal update retains current, rollback, and target;
repair or failed-target restoration retains current and rollback. Guest
wrapper storage is therefore bounded to three application SEAs.

## Validation boundary

The final automated pass ran 220 focused tests across 13 suites without a Jest
cache. They cover journal creation and successor legality, install
settlement in both providers, new update settlement, replay after lost remote
or journal responses, conflicting-target rejection before SSH,
failed-target restoration before a later update, stable-release repair,
bounded wrapper pruning, current-versus-target remote status, exec refusal
across an unsettled guest advance, packaged command dispatch, selector
rejection, secret-free receipts, and the documented command surface. Source,
application, test, and SEA-verifier typechecks passed. Full ESLint and Prettier
checks passed, and package-content verification accepted all 341 expected npm
package files.

No SEA, VM, provider resource, coverage tree, Jest cache, or retained build
artifact is required by this automated checkpoint.

## Proof boundary and work next

This is an automated contract proof, not a new live AWS or Hetzner update run.
There is no public deployment rollback command yet, although one prior release
is retained durably. Root-disk application state still does not survive node
destruction or replacement.

The append-only v3 journal reserves final records for recovery and destruction
but still has no authenticated checkpoint/epoch rollover. New updates
eventually fail before that reserve is consumed; a later milestone must add
bounded compaction before claiming an indefinitely evolving coordinator.

Next, exercise the bounded packaged sequence on both providers: preview,
apply, status, remote durable work, fresh-process inspection, reboot, update,
injected recovery, exec/output, destroy, and independently verified cleanup.
Then decide whether public rollback or retained data is the next product
capability.
