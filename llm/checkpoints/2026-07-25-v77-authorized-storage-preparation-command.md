# V77 authorized storage preparation command checkpoint

Date: 2026-07-25

Parent:
[V76 closed blank-format preparation](./2026-07-25-v76-closed-blank-format-preparation.md)
(`031a726566048a1d6e2d0ea2079c7f1979a94b54`)

Implementation:
`48ca500d1b49078a533abba006062fda418f2555` — integrate durable
storage preparation.

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

V76 closed the root/Linux blank-media observer and durable `null -> prepared`
journal protocol without formatting anything. V77 exposes that protocol as
the application-storage adapter's exact command surface and proves it runs
under the V66 kernel's definite claim, fresh dispatch authorization, current
local fence, and V69 host lock. Activation deliberately remains pending:
preparation history is useful progress, not live storage state, formatter
authority, or settlement.

## Closed preparation command

The new production factory is:

```text
createAwsSingleNodeHostRetainedStoragePreparationCommand({ journalStore })
```

Its options must be a plain exact own-data one-key object. The journal store
must be the exact two-method
`{ readRetainedStorageFormatJournal,
compareAndSetRetainedStorageFormatJournal }` port. The factory captures those
methods once while retaining their original receiver, constructs the
production `createAwsSingleNodeHostRetainedStorageObserver()` internally, and
returns only an exact frozen `{ inspect, converge }` facade. Production callers
cannot inject a physical observer or add a mutation capability.

The separate test-only factory is:

```text
createAwsSingleNodeHostRetainedStoragePreparationCommandForTest({
  observer,
  journalStore
})
```

Its observer must be the exact
`{ inspect, inspectBlankFormat }` port. It exists only to prove the same command
semantics over synthetic physical observations.

`inspect(desired)` receiver-preservingly delegates to the coarse retained
storage observer. `converge({ desired, intentId, attemptGeneration })` passes
that exact input to the V76 preparer, waits for it, discards its
`prepared`/`formatted`/`unknown`/`conflict` result, and returns `undefined`.
The facade exposes no CAS winner, formatter, settlement, authority, or
evidence surface.

That discarded result is intentional. The application-storage adapter must
make its next decision from a fresh physical observation. A durable format
journal records history; it is not live state, permission to mutate, or proof
that activation may advance.

The command is deliberately not an authority boundary. The authenticated host
lock protects local journal access, but possession of that lock cannot
authorize controller work. The V66 kernel must independently establish a
definite attempt-state CAS winner, freshly authorize the dispatch, and verify
the current local fence before calling `converge`.

## Authorized kernel and persistence composition

The real integration regression composes:

- the actual V66 activation kernel;
- the actual V69 activation persistence, format-journal store, and
  `withHostLock` admission;
- the application-storage adapter;
- the V77 command through its test-only observer seam; and
- a fake abstract-socket registry plus synthetic physical observations.

For the first admitted application-storage attempt, the exact significant
order is:

1. enter the active host lock;
2. win the definite application attempt-state CAS;
3. receive fresh `dispatch` authorization;
4. reread and match the current local fence;
5. read the durable format journal;
6. obtain the closed blank-media observation and proof;
7. win the real `null -> prepared` journal CAS;
8. reread the exact durable journal;
9. perform the adapter's post-effect coarse observation; and
10. leave the host lock.

The resulting activation is still `pending`; application storage remains
`intended` at attempt generation 1, and control storage plus every later stage
remain untouched. Replay and an authorized higher-generation request for the
same stable storage target reuse the original prepared journal without a
second blank proof or CAS.

The negative paths remain distinct and fail closed:

- dispatch denial permits the earlier read-only coarse inspection but stops
  before the post-dispatch fence read, blank inspection, journal read, or CAS;
- claim denial stops before every command observation and journal access;
- a stale request whose fence has been superseded stops before every command
  observation and journal access; and
- a coarse storage conflict durably blocks at application storage, at attempt
  generation 0, before dispatch, blank proof, journal access, or downstream
  work.

The real persistence layer deliberately sanitizes errors escaping its admitted
callback to the fixed
`AwsSingleNodeHostActivationPersistenceOperationError`. The integration proves
that public error plus the exact decision, fence, and no-effect events; it does
not depend on a hidden internal cause.

## Observer liveness correction

V76's coarse and blank-proof inspections share one physical snapshot, but
activation ignores preparation convergence results. They therefore cannot
classify blank media with role-specific boot wiring differently: coarse
`ready` followed by fine `conflict` would otherwise replay forever as pending.

Blank media now conflicts in that shared snapshot when it is mounted or when
its boot projection is role-specific. The tested classification is:

```text
absent boot projection     -> safe
shared gate only           -> coarse ready / fine blank
role unit only             -> coarse conflict / fine conflict
gated role unit            -> coarse conflict / fine conflict
enabled role unit          -> coarse conflict / fine conflict
```

Only `absent` and the fixed shared `gate-only` projection are safe before
dispatch. This correction does not add mutation or claim that blank media is
ready storage.

## Verification and disk hygiene

Validation used pinned Node **24.13.1**.

- the observer, pure V76 preparation, and real V76 persistence suites passed
  **73/73**: 54 observer, 18 pure preparation, and 1 real
  preparation/persistence test;
- the V77 command suites passed **15/15**: 10 command-unit and 5 real
  activation/persistence integration tests;
- the combined focused storage gate passed **88/88**;
- source and test TypeScript configurations passed;
- targeted ESLint, Prettier, JavaScript syntax, and whitespace checks passed;
  and
- focused runs disabled Jest coverage and cache.

No full-repository Jest gate, broad build, SEA/native package build, native
LMDB execution, host storage tool, `mkfs`, block-device mutation, live AWS
call, or disposable AL2023/EBS proof was run. Native LMDB remains excluded on
this Mac because prior execution terminated the process with an allocator
double-free.

Every dedicated `/private/tmp/wharfie-v77-*` tree was removed and verified
absent. No generated build, coverage, cache, package, or TypeScript build-info
artifact remains. The repository measured about **531 MiB**, with about
**11 GiB** free on the host volume at checkpoint time.

## Honest boundaries

V77 is an authorized non-destructive preparation step, not a storage
lifecycle:

- the production command exists but is not yet wired into the owned host
  bootstrap, host lifetime, or production activation-kernel assembly;
- the integration uses the real kernel and persistence but a synthetic
  physical observer through the explicit test-only factory;
- no formatter, complete exact-profile verifier, mount mutator, or
  deactivation executor exists;
- a prepared or formatted journal remains immutable history, not current
  physical proof, live authority, or settlement;
- the authorization and fence proven here precede only non-destructive
  preparation; any future destructive operation needs a new authorization and
  fence check immediately at its own mutation boundary;
- that mutation boundary must also reread the prepared journal and immediately
  reobserve the exact EBS volume, by-id target, device number, rdev, and mount
  namespace through path-retarget-safe access or an equivalent stable handle;
- blank media behind an absent or shared gate-only projection remains coarse
  `ready`, so activation intentionally remains pending and repeat dispatch
  takes the idempotent prepared-history fast path;
- role-specific projections conflict in both observer views rather than
  producing an unproductive pending loop;
- existing ext4 cannot be adopted without a complete offline exact
  `wharfie-ext4-v1` profile verifier; partial, foreign, or unknown media stays
  fail-closed and cannot advance activation;
- exact AL2023/e2fsprogs behavior, device identity and path races,
  flush/interruption/power-loss behavior, reboot, and detach/reattach behavior
  remain unproven;
- persistent mount units, systemd reload/readback, mounting, runtime
  user-manager quiescence/restart, health publication and receipt minting, and
  deactivation execution remain unimplemented; and
- the remaining provider, packaging, selector-delivery, garbage-collection,
  and clean-account boundaries still apply.

## Next slice: disposable host evidence before a formatter

Do **not** implement formatter code yet.

Use a disposable AL2023 host with a real disposable EBS volume to establish:

1. installed e2fsprogs/tool versions, absolute executable paths, bounded
   outputs, and failure behavior;
2. exact `mkfs` arguments and complete offline readback for
   `wharfie-ext4-v1`;
3. EBS NVMe serial, canonical by-id, device/rdev, and path-retarget race
   containment;
4. udev settlement, I/O flush, mount-namespace, and runtime quiescence
   semantics;
5. interruption, partial-format, and power-loss classifications; and
6. reboot plus detach/reattach identity and recovery behavior.

Capture the evidence and deterministic fixtures first, then design the
destructive runner. Its mutation must occur under the same active host lock
only after a fresh controller authorization, a current local-fence read, a
prepared-journal reread, and an immediate exact-media reobservation using a
path-retarget-safe handle or proven equivalent.

After that boundary is proven, implement formatting and full profile
verification, then persistent mount projection/readback and recovery, then
control storage, health publication/receipt minting, and deactivation.

## Repository state and resume instructions

The V77 implementation tip is
`48ca500d1b49078a533abba006062fda418f2555`. It was pushed to
`origin/agent/strict-manifest` before this checkpoint was finalized. The commit
containing this file is the V77 restart marker.

The historical stash remains untouched:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Resume from the V77 checkpoint commit, verify its implementation hash and
remote synchronization, and perform the disposable AL2023/real-EBS evidence
slice above before writing a formatter. Continue to pin Node 24.13.1, never
run native LMDB on this Mac, disable Jest cache and coverage for focused runs,
avoid real block-device tools locally, and remove every generated test or
build artifact immediately.
