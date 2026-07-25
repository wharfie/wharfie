# V73 desired service convergence proof checkpoint

Date: 2026-07-25

Parent:
[V72 fixed-user service convergence](./2026-07-25-v72-fixed-user-service-convergence.md)
(`55ca46e33ab511cb716bc5e7f6b5cc45124b2007`)

Implementation: `a761c90d1f8cdb88c649ca002112e0991560b687`

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be packaged
as one portable SEA, run locally, become a durable resident service, and then
be projected into a trusted cloud node without requiring Node, containers,
Kubernetes, or a hosted orchestration service on that node. The broader
purpose is to carry an author's intent beyond one interactive LLM session
while keeping the result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V72 connected an exact root-owned projected SEA to the fixed
`wharfie-runtime` user-service lifecycle. V73 closes the unsafe retry gap:
read-only service status now proves whether the exact invoking SEA is
authorized to converge the observed durable state. The V66 host adapter will
mutate only when that proof and its independently observed physical state
agree.

## Status V3 proof

`wharfie service status --json` is now schema V3 and contains one exact
`desiredConvergence` document:

```json
{
  "schemaVersion": 1,
  "kind": "wharfie.service.desired-convergence",
  "appId": "example",
  "unit": "wharfie-service-example.service",
  "desired": {
    "artifactId": "waf1_...",
    "revisionId": "wrv1_..."
  },
  "disposition": "authorized",
  "basis": "durable-active"
}
```

The exact keys, identifiers, app/unit binding, desired release, disposition,
and basis pairing are validated at every boundary. `conflict` and `unknown`
must carry a null basis. Only `authorized` may carry one of:

- `physical-absence`: there is no activation record and the complete physical
  service projection is absent;
- `durable-install`: the activation coordinator durably records a forward
  first-install transition to the invoking SEA;
- `durable-change`: the coordinator durably records a forward update target,
  including the source-restoration recovery path; or
- `durable-active`: the coordinator has an ACTIVE selected release and the
  present physical state remains inside its exact repair envelope.

Rollback transitions are conflicts. A different in-flight desired target is
unknown rather than implicit supersession authority. The proof authorizes an
exact convergent attempt; it does not claim that a physical mutation executes
exactly once.

## Read-only manager classification

Status holds the existing crash-releasing per-application operation lock and
captures one sequential raw observation. It does not stage releases, write
activation or installation records, repair selectors, publish units, reload
systemd, enable lingering, or start/stop a process.

The activation record is the sole release authority. Its selected, desired,
rollback candidate, transition source, and transition target identities form
the bounded authority set. The classifier independently verifies:

- every authority release's immutable bytes and exact release receipt;
- installed and update-tombstone identities against that authority;
- exact selector, root ownership/type, fixed unit bytes, manager search path,
  effective fragment, absence of drop-ins, enablement, and lingering;
- stable conflict versus transient/unavailable observation;
- the exact live resident owner/session/release/process ID joined to systemd's
  `MainPID`; and
- phase-specific receipt/selector/systemd projections before forward recovery
  is authorized.

A live process must be the exact activation-selected resident in READY or
STARTING lifecycle state. A rollback candidate, manual owner, stale owner,
foreign selector, foreign receipt, foreign unit, drop-in, fragment, root,
release, PID, or uninstall marker is a conflict. Unavailable/transient state
is unknown.

Root inspection evaluates the control, state, and application-state roots
completely. A missing earlier root cannot hide a later symlink, ownership/type
conflict, or transient failure; precedence is conflict, then unknown, then
absence.

Uninstalled tombstones in an UPDATE/source-restoration transition must be
activation-authorized and byte-for-byte verified. The narrow
activation-null/first-install legacy tombstone recovery path remains allowed.

## Convergent repair envelope

The service manager gained only the repairs required to make an authorized
proof actionable:

- an exact stale systemd manager cache can be stopped/refreshed safely;
- an ACTIVE selected release with a missing receipt or selector can be
  reprojected by `service converge`; and
- a newer invoking SEA can first reproject the retained ACTIVE source, then
  resume the durable update.

Every present component of an ACTIVE repair must already match the exact
selected/rollback projection. A different present component is not adopted or
overwritten. Ordinary `install` and `update` commands retain their stricter
operator-facing preconditions; the broader recovery envelope belongs to the
durably authorized `converge` path.

## Host trust joins

The packaged command parser requires schema V3 and the exact proof shape. The
root runtime-service launcher independently verifies the invoking SEA bytes,
then requires the status proof's app, unit, artifact, and revision to match
that verified input.

The V66 service-convergence adapter:

- maps manager `conflict` and `unknown` decisions directly;
- refuses malformed, unsupported, contradictory, foreign, or incomplete
  status even when a forged proof says authorized;
- treats a conflicting selector and any foreign update tombstone as conflict;
- permits only narrowly authorized inactive transition-source residue during
  source restoration;
- returns `settled` only for the complete healthy ACTIVE desired projection;
  and
- otherwise returns `ready` only when the proof and independent physical
  guard jointly authorize repair.

The converge result remains the existing strict proof-free V1 result. Durable
intent is persisted by V66 before mutation, while exact post-effect status is
the settlement evidence. Response loss therefore resumes from durable
activation and live state rather than from a command return value.

Linux/package verifiers and the boot check now assert the exact V3 proof
through fresh absence, install, healthy/stopped service state, activation
recovery, and retained post-uninstall state.

## Verification and disk hygiene

Final validation used pinned Node **24.13.1**, serial Jest, and disabled
coverage/cache:

- **337 tests passed**, **2 platform/native tests skipped**, across the manager,
  command, root launcher, host adapter, V66 activation integration, and CLI
  documentation suites;
- the adapter's final isolated regression pass was **51/51**;
- all four TypeScript configurations passed;
- every changed JavaScript file passed ESLint;
- every changed file passed Prettier;
- verifier/boot scripts passed `node --check`;
- `git diff --check` passed; and
- the independent whole-diff review and follow-up review found no remaining
  concrete issue after three fail-open edge cases were fixed.

No full-repository Jest gate, SEA/native package build, native LMDB execution,
disposable Linux host, live AWS call, or clean-account proof was run. Native
LMDB remains excluded on this Mac because prior execution terminated the
process with an allocator double-free.

Every dedicated `/private/tmp/wharfie-v73-*` tree and the recreated
`$TMPDIR/jest_dx` cache was removed immediately after its test run. No new
coverage, Jest cache, tarball, distribution, TypeScript build-info, or other
generated validation output remains.

## Honest boundaries

V73 proves exact service-convergence authority; it is not yet the whole
privileged-host lifecycle:

- a different in-flight desired SEA is unknown and requires explicit
  coordinator recovery rather than automatic supersession;
- rollback remains conflict and must use the recovery operation;
- the host still lacks concrete application- and control-storage adapters;
- storage still lacks real guest volume identity resolution, blank-only
  formatting, fixed root-owned mounts, quiesce/unmount ordering, and reboot
  proof;
- V3 health publication and terminal V65 receipt settlement are not composed;
- there is no production root host command/SEA, selector delivery, SSM wakeup,
  disposable Linux proof, or complete clean-account lifecycle;
- the V71 immutable projection retention bound is entry-count based and has no
  byte quota/final-version garbage collector; and
- the remaining bootstrap/packaging/provider-realism boundaries recorded in
  V69-V72 still apply.

## V74 retained-storage slice

Implement application and control storage as separate concrete V66 adapters:

1. define one strict role-specific request/evidence contract over the existing
   exact retained volume and attachment bindings;
2. resolve the guest block device from the actual EBS volume identity, never a
   requested `/dev/sd*` alias;
3. derive stable filesystem identity from volume/incarnation/capability
   identity rather than request or application revision;
4. format only media independently proven blank and reject foreign
   filesystem/signature/mount state;
5. mount at fixed root-owned application and control locations with exact
   source, filesystem, options, ownership, and propagation evidence;
6. make observation read-only and converge safe after crash or lost response;
7. establish service quiesce/unmount ordering before a retained volume may
   detach or be superseded; and
8. prove the two adapters first through V66 with injected native seams, then on
   a disposable Linux/NVMe host.

Keep the two roles separate even if they share a private implementation. Do
not allow one retained volume, mount, or capability identity to satisfy both
roles.

## Repository state and resume instructions

The V73 implementation is
`a761c90d1f8cdb88c649ca002112e0991560b687` on
`agent/strict-manifest` and was pushed to
`origin/agent/strict-manifest` before this checkpoint was written. The commit
containing this file is the V73 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from `origin/agent/strict-manifest` at the checkpoint commit, confirm a
clean synchronized branch, and begin V74 at the retained-storage adapter
boundary above. Continue to pin Node 24.13.1, avoid native LMDB on this Mac,
disable Jest cache/coverage for focused runs, and remove every generated test
or build artifact immediately.
