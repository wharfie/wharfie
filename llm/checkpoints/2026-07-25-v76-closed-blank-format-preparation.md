# V76 closed blank-format preparation checkpoint

Date: 2026-07-25

Parent:
[V75 retained-storage format journal](./2026-07-25-v75-retained-storage-format-journal.md)
(`6de4bc312fdb48821b9dbf4bef20b1698995fa38`)

Implementation:

- `4c9bfe27b43972301f947a3e58708d6be4f1e4c1` — closed blank proof
  and durable preparation protocol; and
- `f1cab827a759b07fafffc251db41e6560bf41909` — real
  host-lock/persistence composition proof.

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be
packaged as one portable SEA, run locally, become a durable resident service,
and be projected into a trusted cloud node without requiring Node,
containers, Kubernetes, or a hosted orchestration service on that node. Its
larger purpose is to carry an author's intent beyond one interactive LLM
session while keeping the resulting service understandable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V75 established the fixed two-mount runtime gate, fixed host runtime account,
immutable format-history contract, and authenticated journal store. V76
connects that durable history to the closed read-only Linux observer. It can
now prove stable blank media and publish the recoverable `prepared`
prerequisite without formatting anything.

## Closed blank-media proof

The production retained-storage observer remains a closed root/Linux boundary
with fixed absolute tools, arguments, environment, timeouts, output bounds,
files, and namespace reads. Its synthetic-port factory remains test-only.

Both factories now expose frozen `{ inspect, inspectBlankFormat }`.
`inspect()` retains its V74 activation behavior. `inspectBlankFormat(desired)`
validates and clones desired state before its first await, settles udev, then
captures the complete physical snapshot twice. The two snapshots must be
identical.

A blank proof is minted internally only when the observations establish:

- one exact EBS NVMe disk, size, model, serial, device number, and canonical
  by-id target;
- no partitions and no holders;
- no blkid or wipefs signature;
- no mount of the device and no foreign occupant at the target;
- one shared mount namespace between the observer and PID 1;
- exact safe target ancestry and an absent or empty target;
- no legacy or malformed boot projection; and
- either no boot projection or only the fixed shared two-mount runtime gate.

The shared gate alone is allowed because it is deliberately staged before
either role mount unit. A role mount unit, gated role unit, enabled link,
mounted media, holder, partition, foreign signature, changed device, changed
namespace, or changed snapshot prevents proof publication. Existing ext4
without the complete offline profile proof remains `unknown`, never blank.

The result is exact and deeply frozen:

```text
{ status: "blank", proof }
{ status: "unknown" }
{ status: "conflict" }
```

The proof factory is called only inside the closed observer. Its content ID
binds the exact asserted history bytes, but does not independently authenticate
their provenance, provide controller authorization, or grant permission to
format.

## Durable preparation protocol

`createAwsSingleNodeHostRetainedStorageFormatPreparation` accepts only the
exact observer and journal-store method surfaces, snapshots their methods, and
returns frozen `{ prepare }`.

`prepare({ desired, intentId, attemptGeneration })`:

1. snapshots the exact wrapper, desired document, intent, and attempt before
   its first await;
2. reads and independently validates current durable journal truth;
3. returns an existing prepared or terminal formatted history without
   observing or writing;
4. when absent, asks only `inspectBlankFormat` for closed blank proof;
5. returns `unknown` or `conflict` without a write;
6. creates the exact request/intent/attempt-bound prepared journal;
7. attempts only the legal `null -> prepared` CAS; and
8. always rereads and validates durable truth before returning.

The public durable outcomes are:

```text
{ status: "prepared", journal }
{ status: "formatted", journal }
```

They deliberately expose no CAS winner or dispatch flag. A `false`, thrown,
lost, or malformed CAS response is not authority. Exact durable readback may
recover an already-published journal; conclusive absence fails closed.
Readback corruption or failure takes precedence over an earlier ambiguous
publication response.

Prepared, formatted-from-blank, and adopted-profile histories are immutable
fast paths. Stable-target request churn returns the original journal and its
original attempt history rather than rewriting it for the new request.

The preparation layer neither acquires a host lock nor formats media. Its
production store refuses reads and writes without a live
`withHostLock` admission. A returned `prepared` record does not prove that the
media is still blank; every returned journal is historical durable truth
only, not live physical proof, formatter authority, or current controller
authorization.

## Real composition proof

The integration regression composes the actual authenticated activation
persistence and retained journal store with the preparation protocol:

- outside `withHostLock`, preparation fails before blank observation;
- inside the lock, it observes blank media and durably publishes `prepared`;
- after close and reopen, it reads the same canonical journal without another
  observation; and
- a new activation request for the same stable media target reuses that prior
  journal.

The integration uses the real filesystem envelope, transaction lock, journal
CAS, and reopen recovery over a fake abstract-socket registry. Only the
physical observer is synthetic. It executes no host storage tool.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**.

- the observer suite passed **52/52**;
- the pure preparation suite passed **18/18**;
- the two suites passed together as **70/70**;
- the real persistence composition passed **1/1**, and the pure preparation
  plus integration pair passed **19/19**;
- source and test TypeScript configurations passed;
- targeted ESLint, Prettier, syntax, and whitespace checks passed; and
- independent reviews found no remaining blocker in snapshot timing, closed
  observer proof production, boot-gate classification, CAS/readback recovery,
  request churn, receiver preservation, or authority wording.

No full-repository Jest gate, SEA/native package build, native LMDB execution,
Linux block-device operation, live AWS call, or disposable-host proof was run.
Native LMDB remains excluded on this Mac because prior execution terminated
the process with an allocator double-free.

Every dedicated `/private/tmp/wharfie-v76-*` tree was removed immediately
after use and verified absent. Coverage and the Jest cache were disabled. No
new build, coverage, cache, package, or TypeScript build-info artifact remains.
The repository measured about **530 MiB** and the host had about **4.5 GiB**
free at checkpoint time.

## Honest boundaries

V76 is preparation, not a storage lifecycle:

- no production retained-storage command composes the observer and preparer
  into the activation adapter yet;
- no formatter, exact-profile verifier, mount mutator, or deactivation
  executor exists;
- a prepared journal is not fresh blank-media proof and cannot dispatch a
  formatter;
- no component freshly reauthorizes the current controller request
  immediately before a destructive device operation;
- no component rereads `prepared` and immediately reobserves the exact
  EBS/by-id/device/rdev/mount namespace at the mutation boundary;
- path-retarget-safe destructive device access remains unproven;
- exact AL2023/e2fsprogs arguments and complete `wharfie-ext4-v1` readback
  remain unproven;
- `prepared` plus partial, foreign, or otherwise unknown media remains a hard
  block;
- persistent mount-unit publication, systemd reload/readback, mounting,
  runtime user-manager quiescence/restart, and recovery remain unimplemented;
- the deactivation receipt still lacks a closed authenticated producer; and
- no disposable AL2023/NVMe/EBS, reboot, detach/reattach, interruption, or
  power-loss proof exists.

The remaining provider, packaging, health, garbage-collection, and
clean-account boundaries from earlier checkpoints also still apply.

## V77 non-destructive activation command

Do not add `mkfs`, mount, or systemd mutation.

1. Add a retained-storage preparation command exposing the adapter-compatible
   exact frozen `{ inspect, converge }` surface.
2. Production construction accepts only the host-lock-admitted journal store
   returned by activation persistence and closes over the production observer
   plus V76 preparation. A separate synthetic factory owns test seams.
3. `inspect(desired)` delegates to the existing coarse observer.
4. `converge({ desired, intentId, attemptGeneration })` delegates to
   preparation and exposes no winner, formatter port, or settlement claim.
5. Prove out-of-lock rejection, in-lock journal-read/blank-observe/CAS/readback
   ordering, existing-history fast paths, fail-closed observation, ambiguous
   response recovery, and request churn.
6. Integrate the synthetic command with the real V66 activation kernel and
   persistence. Prove current controller dispatch authorization, current local
   fence, and active host lock precede preparation.
7. Prove unauthorized dispatch and a stale local fence separately perform no
   storage observation or journal write; replay reuses `prepared`; and
   activation remains pending at storage rather than advancing to later
   effects.
8. Prove the facade and captured methods are exact, frozen, and
   receiver-preserving.

This command intentionally makes useful durable progress while remaining
unable to format or claim settlement. The facade itself is not an authority
boundary: possession of it, or even possession of the host lock, cannot
replace the activation kernel's fresh controller authorization and current
fence.

Before any destructive runner is implemented, use a disposable AL2023 host
with real EBS to prove e2fsprogs availability/output, exact profile arguments
and readback, device-path race containment, flush/interruption/power-loss
semantics, reboot/detach/reattach behavior, and real systemd
`BindsTo`/linger/user-manager races.

## Repository state and resume instructions

The V76 implementation tip is
`f1cab827a759b07fafffc251db41e6560bf41909` on
`agent/strict-manifest` and was pushed to
`origin/agent/strict-manifest` before this checkpoint was written. The commit
containing this file is the V76 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from `origin/agent/strict-manifest` at the checkpoint commit, confirm a
clean synchronized branch, and implement only the V77 non-destructive
preparation command above. Continue to pin Node 24.13.1, never run native LMDB
on this Mac, disable Jest cache and coverage for focused runs, avoid real
block-device tools locally, and remove every generated test or build artifact
immediately.
