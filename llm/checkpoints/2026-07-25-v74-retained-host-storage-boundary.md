# V74 retained host storage boundary checkpoint

Date: 2026-07-25

Parent:
[V73 desired service convergence proof](./2026-07-25-v73-desired-service-convergence-proof.md)
(`86768f2a2765470174fe1977fd3f6d15a42954a3`)

Implementation:

- `e493063d939160a27c457364fa71a35a99a7d9d0` — retained-storage
  desired/evidence contracts;
- `5f645fbe792d8ad2a1e12903f6c0704c8003f937` — activation and V66
  transitive validation;
- `9de8f3550a0c2f1a9aec40fed38ae8620100fca4` — closed read-only Linux
  observation; and
- `5ba6e8f6c25258ffdb5c88ba8776931944c6d744` — recoverable host
  deactivation authority.

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

V73 proved that an exact service-status observation may authorize convergent
repair. V74 defines the retained application/control storage identities,
threads their proof through host activation, observes their physical Linux
state without mutation, and defines the recoverable authority required to
remove host projections before a destroy operation may continue.

V74 deliberately stops before formatting, mounting, unmounting, or deleting
anything. It establishes the contracts and fail-closed observation boundary
that those operations must satisfy.

## Retained-storage desired and evidence contracts

Application state and control state remain separate V66 capabilities even
though they share one strict implementation:

- each role binds an exact retained volume and attachment;
- volume and attachment binding IDs are globally distinct;
- volumes must have been created without snapshots;
- filesystem UUIDs are derived from stable
  provider/deployment/incarnation/capability identity rather than from a
  request or application revision;
- the filesystem is fixed to `ext4` and the
  `wharfie-ext4-v1` profile;
- each role has a fixed root-owned mount target and exact mount options;
- the runtime directory is fixed to `wharfie-runtime`, its observed numeric
  UID/GID, and mode `0700`;
- persistent boot wiring must use the actual EBS volume identity rather than
  a requested `/dev/sd*` or transient NVMe path; and
- evidence is content-addressed, exact-keyed, bounded, secret-free, immutable,
  request-bound, and transitively dependent on prior runtime identity and
  application-storage evidence.

Host activation now validates the complete settled evidence chain in order:
runtime identity, application storage, control storage, and then service
convergence. A downstream caller cannot replace an earlier proof with a
shape-compatible document or change a binding, provider resource, runtime
account, filesystem, mount, or boot projection without invalidating the
chain.

## Closed read-only Linux observation

The retained-storage observer has a closed production boundary and a separate
synthetic test port. Production observation uses fixed absolute Linux tools,
fixed arguments and environment, no shell, ignored stdin, bounded UTF-8
stdout/stderr, timeouts, overflow termination, and child reaping. A successful
tool result requires the exact expected exit/signal/output contract, including
empty stderr.

It independently resolves and rechecks:

- the EBS by-id source and underlying block-device identity;
- partitions, holders, filesystem signatures, and exact stable UUID;
- the host and service mount namespaces;
- exact mount target, source, type, options, ownership, mode, and propagation;
- the mount unit, enable link, user-manager dependency projection, and
  systemd's effective state; and
- the request, volume, attachment, runtime-account, and boot-projection
  identities.

Physical state is captured twice and must remain identical before the adapter
may report a stable result. Foreign, ambiguous, partially projected, changing,
or unavailable state fails closed as `conflict` or `unknown`. Blank, offline,
unwired media may be reported `ready`, but the observer never treats that as
format permission and never mints settlement for an unverified filesystem
profile.

No host tool was executed during macOS validation; all physical observations
used the injected synthetic port.

## Recoverable host deactivation authority

The pure deactivation request is derivable only from:

1. the exact prior activation request;
2. the complete, revalidated runtime/application/control evidence chain;
3. an exact destroy plan based after that activation's authorized head;
4. an equal-or-later `DESTROYING` head for the same plan and operation; and
5. a still-running, all-pending intent frontier with the exact settled
   operation and resource bindings.

This allows coordinator recovery to advance durable plan/head generations
without making the original one-generation transition an unreachable
precondition. It does not allow a blocked or partially intended frontier,
different plan or operation, changed binding, changed prior settlement, or
stale head.

The request fixes the service identity, one shared runtime account, and both
retained-storage identities and removal projections. It deliberately omits
transient device paths. Request and receipt IDs use separate content-ID
domains.

The terminal receipt schema requires:

- the exact service projection to be uninstalled and stopped, with no session,
  fragment, drop-ins, main process, or pending manager reload;
- both filesystems to be synced and unmounted;
- both mount units, physical unit files, local-fs enable links, and storage
  dependency projections to be absent;
- one identical request-bound runtime UID/GID;
- no remaining effective user-manager dependency on either retained mount;
  and
- an equal-or-later live destroy head that still carries the exact request
  authority when the receipt is consumed.

The receipt is intentionally named and documented as a normalized terminal
assertion. Pure construction and validation do not authenticate who observed
the host. A controller must not accept it as teardown provenance until a
future closed, authenticated host execution/readback boundary supplies the
assertion.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**. The final observer regression pass was
**57/57**. The deactivation contract was independently rerun as **7/7** with
serial Jest, coverage disabled, and the Jest cache disabled.

For the final deactivation slice:

- source and test TypeScript configurations passed twice, once by the author
  agent and once by the root agent;
- targeted ESLint and Prettier passed twice;
- whitespace checks passed; and
- an independent semantic review found no remaining blocker in recovery
  fencing, prior-evidence binding, alias rejection, request-bound terminal
  assertions, or projection validation.

No full-repository Jest gate, SEA/native package build, native LMDB execution,
Linux block-device operation, live AWS call, or disposable-host proof was run.
Native LMDB remains excluded on this Mac because prior execution terminated
the process with an allocator double-free.

Every dedicated `/private/tmp/wharfie-*v74*` test tree was removed immediately
after use and verified absent. No new coverage, Jest cache, tarball,
distribution, TypeScript build-info, or other generated validation artifact
remains. The repository measured about **530 MiB** after cleanup.

## Honest boundaries

V74 is a contract and read-only-observation milestone, not a production
storage lifecycle:

- no component yet persists a blank-media overwrite authorization;
- no component formats or independently verifies the complete
  `wharfie-ext4-v1` on-disk profile;
- no component atomically publishes mount units/links, reloads systemd,
  mounts, quiesces the runtime user manager, or safely resumes those effects;
- the existing per-role `60`/`61` user-manager drop-ins have a sequential
  convergence hole and must be replaced before they are ever mutated on a
  host;
- the observer's public status is intentionally too coarse to recover
  partially formatted media without a durable format journal;
- the deactivation receipt lacks a closed authenticated producer and is not
  controller settlement evidence yet;
- path/device retarget races still need a stronger native mutation boundary
  or an independently proven equivalent;
- no disposable AL2023/NVMe/EBS, reboot, detach/reattach, power-loss, or
  complete activation/deactivation proof exists; and
- the remaining provider, packaging, health, garbage-collection, and
  clean-account boundaries from V69-V73 still apply.

## V75 blank-only format and persistent-mount slice

Begin V75 by fixing the static projection before adding mutation:

1. move the pure boot projection out of the closed observer boundary;
2. replace the role-specific `60`/`61` drop-ins with one fixed
   `60-wharfie-retained-storage.conf` gate whose `BindsTo` and `After` name
   both application and control mount units;
3. stage and reload that common gate first, stop and prove the dedicated
   `user@UID.service` inactive, and keep it stopped until both mounts settle;
4. add a root-owned, content-addressed, atomically durable format journal keyed
   by stable filesystem UUID, reusing the V69 authenticated store and host
   lock;
5. persist and reread a `prepared` record containing the stable blank proof
   before `mkfs`, then reobserve the same device before mutation;
6. make `formatted` terminal with respect to overwrite authority: after that
   record is durable, no physical state may automatically invoke `mkfs`
   again;
7. define and independently verify the exact offline
   `wharfie-ext4-v1` profile before publishing `formatted`;
8. publish each mount unit and its enable link atomically, reload and verify
   systemd's effective cache, mount both volumes, then start the user manager
   only after both mounts are active; and
9. prove recovery across every journal, format, flush, unit publication,
   reload, mount, manager-start, response-loss, process-kill, and reboot
   boundary.

Synthetic macOS tests may prove protocol logic only. A disposable AL2023 host
with real EBS/NVMe storage is mandatory before making production safety
claims.

## Repository state and resume instructions

The V74 implementation tip is
`5ba6e8f6c25258ffdb5c88ba8776931944c6d744` on
`agent/strict-manifest` and was pushed to
`origin/agent/strict-manifest` before this checkpoint was written. The commit
containing this file is the V74 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from `origin/agent/strict-manifest` at the checkpoint commit, confirm a
clean synchronized branch, and begin V75 with the common two-mount gate and
format-journal contract above. Continue to pin Node 24.13.1, avoid native LMDB
on this Mac, disable Jest cache/coverage for focused runs, and remove every
generated test or build artifact immediately.
