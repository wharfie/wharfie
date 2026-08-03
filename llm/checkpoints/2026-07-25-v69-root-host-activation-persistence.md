# V69 root host activation persistence checkpoint

Date: 2026-07-25

Parent:
[V68 owned host AWS lifetime](./2026-07-25-v68-owned-host-aws-lifetime.md)
(`b5577358bf88d90de9dcafe01fe4f31c183e5550`)

Implementation: `ab931c8db16f8d0967a7f1ad022dad9aadb6eda3`

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be packaged
as one portable SEA, run locally, become a durable resident service, and then
be projected into a trusted cloud node without requiring Node, containers,
Kubernetes, or a hosted orchestration service on that node. Its purpose is to
carry an author's intent beyond one interactive LLM session while keeping the
result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public path remains Node-first; native
bindings or WASM remain available for measured hot paths. Exactly-once claims
remain abstraction-specific and require durable protocol evidence.

V65 defined the immutable controller-to-host request and terminal receipt. V66
implemented the pure durable six-stage activation kernel. V67 implemented
exact live STS EC2 instance-profile identity proof. V68 supplied its fixed
IMDSv2 credential source and pinned owned STS lifetime. V69 now implements the
root-owned local persistence, crash-releasing deployment lock, bounded
retention, fence-aware inspection, and draining lifetime required by V66.

V69 deliberately does **not** implement controller authorization. Its
inspection classification describes only the relationship between a retained
local state and the current local fence. The V66 `authorizeRequest` port still
needs an authenticated, fresh controller-head read before any host effect can
be wired honestly.

## Fixed production boundary

`src/core/runtime/deployment-aws-host-activation-persistence.js` exports:

```text
openAwsSingleNodeHostActivationPersistence({
  deploymentInstanceId
})
```

The production opener accepts exactly that one selector. It requires Linux,
real UID 0, and effective UID 0. Caller input cannot redirect the persistence
root, filesystem implementation, socket implementation, token source,
retention policy, owner, or permissions.

The fixed layout is:

```text
/var/lib/wharfie/host-activation/v1/
  .lock-namespace.<bootId>.json
  <deploymentInstanceId>/
    fence.json
    states/
      <requestId>.json
```

Wharfie validates `/var` and `/var/lib` as concrete root-owned directories
without group or world write permission. It creates each Wharfie-owned
directory one component at a time with mode `0700`, reauthenticates it with
`lstat`, and fsyncs its parent. Durable records are root-owned regular files
with exact mode `0600`.

Reads use `O_NOFOLLOW`, `O_NONBLOCK`, bounded descriptor reads, and `fstat`
before and after reading. File type, owner, mode, link count, inode identity,
size, timestamps, and decoded byte length are checked. Symlinks, FIFOs,
devices, sockets, hard-link surprises, group-writable files, oversized files,
noncanonical JSON, malformed V65/V66 records, and cross-deployment records
fail closed through fixed typed errors.

The lower-level
`createAwsSingleNodeHostActivationPersistence(...)` constructor exposes
explicit filesystem, UID, server, token, path, and retention seams only so
focused tests can exercise the real filesystem safely without writing
`/var/lib`. The strict production opener supplies all of those values itself.

## Exact V66 ports

The returned frozen capability is:

```text
{
  store: {
    readActivationFence(deploymentInstanceId),
    compareAndSetActivationFence({
      deploymentInstanceId,
      expectedFenceId,
      nextFence
    }),
    readActivationState(requestId),
    compareAndSetActivationState({
      requestId,
      expectedStateId,
      nextState
    })
  },
  withHostLock({deploymentInstanceId}, operation),
  inspectActivation({requestId}),
  close()
}
```

Inputs are exact data objects: inherited fields, accessors, symbols, hidden
fields, missing fields, and extra fields are rejected. The store reuses the
V65/V66 canonical validators rather than introducing a second persisted
schema.

CAS behavior is intentionally strict:

- only the process that establishes the exact requested successor returns
  `true`;
- a stale expected ID returns `false`;
- an already-equal next record returns `false`;
- every mutation must be the exact next `recordVersion`;
- a request state's complete immutable request cannot change across versions;
- every successor fence must name a different request at a strictly higher
  authorized head generation; and
- the complete durable state named by a fence must already exist and match its
  deployment, incarnation, node, request, and authorized generation.

This preserves V66's state-before-fence recovery boundary. A response-lost
writer is never falsely told it definitely won; a later read or kernel replay
can establish the durable result.

## Atomic durability and response loss

Every record publication uses a private sibling temporary file created with
`O_CREAT|O_EXCL|O_NOFOLLOW`, writes canonical newline-terminated JSON, fsyncs
the file, renames it over the destination, reauthenticates the published file,
and fsyncs the containing directory.

Directory creation also fsyncs the parent even when the child already exists.
That makes a retry repair the durability boundary after a lost `mkdir`
response or a prior parent-sync failure.

If rename reports an error after it may have committed, the implementation
first attempts a recovery fsync of the parent. When that succeeds, readback can
discover the result safely. When even the recovery sync fails, durability is
unknowable: the capability is poisoned and all later operations fail closed
instead of letting V66 mistake merely readable bytes for durable state.

Temporary cleanup is name-, type-, owner-, and mode-constrained. It never
guesses that an arbitrary unexpected file is safe to unlink.

## Locks and network-namespace claim

`src/core/runtime/linux-abstract-operation-lock.js` now provides one shared
domain-separated Linux abstract AF_UNIX lock. The address is a SHA-256
projection of an exact domain and bounded scope. Kernel bind is the atomic
winner, the address disappears when its process dies, release is idempotent,
and no PID file, timestamp, stale-file deletion, or PID-reuse heuristic is
involved.

V69 uses separate domains for:

- the whole-deployment host operation; and
- short local store transactions.

The host lock prevents two activation operations for the same deployment from
running concurrently. The transaction lock gives the four independent V66
store calls exact cross-process read/CAS exclusion. A busy host operation has
its own fixed typed error; bounded transaction-lock exhaustion becomes a fixed
operation error.

Linux abstract sockets are scoped to a network namespace while `/var/lib` can
be shared across namespaces. The strict production opener therefore requires
its network namespace to match PID 1 and publishes one filesystem-wide,
per-boot claim under the fixed V1 root. The complete claim is written and
fsynced at a unique temporary path, then published with atomic hard-link
no-replace semantics and a parent fsync. Recovery accepts the safe two-link
crash gap and validates the exact boot ID and namespace device/inode before
trusting abstract locks.

The generic lock also replaces the former inline systemd user-service
operation lock. The systemd manager preserves its established external busy
error and behavior.

## Admission and shutdown

An `AsyncLocalStorage` admission token binds nested store work to its owning
host-lock callback.

- Nested operations admitted before callback completion drain before the host
  lock is released, even when the callback forgot to await them.
- Detached descendants are revoked after callback completion and cannot use
  their inherited token later.
- `close()` synchronously fences unrelated new work, drains all admitted work,
  and is memoized for external callers.
- A callback carrying any inherited admission token is always rejected from
  calling `close()`, including after an external close has already begun. This
  avoids a self-deadlock where close waits for the callback while the callback
  waits for close.
- Operations already admitted by the host callback may finish while external
  close is draining.

Raw backend and socket detail is reduced to fixed typed public errors.

## Retention and local inspection

`inspectActivation({requestId})` returns either `null` or:

```text
{
  authority: "current" | "superseded" | "unclaimed" | "ambiguous",
  fence,
  state
}
```

Despite the field name inherited from the inspection design, this is local
durable truth only:

- `current`: the fence exactly names the state;
- `superseded`: the state's authorized generation is below the fence;
- `unclaimed`: there is no fence or the state is above it; and
- `ambiguous`: a different request exists at the same generation.

It is never evidence that the controller still authorizes the request.

Retention keeps the current state and the eight newest states that the local
fence proves superseded. It never deletes same-generation ambiguous states or
higher-generation state-before-fence records. Ordering uses authorized head
generation and request ID, never wall-clock time, file timestamps, or random
tokens.

The state directory admits at most 128 durable state files. Initialization may
additionally encounter and clean at most 16 correctly patterned private stale
temporary files. The separate allowance matters at exact durable capacity:
entry 129 may be a crash temp that must be removed before the 128-state bound
can be re-established. Unexpected entries or larger namespaces fail closed.

## Verification and disk hygiene

Final V69 verification used pinned Node 24.13.1 and serial Jest with coverage
and cache disabled:

- the focused V69 persistence/lock suite passed **17 tests**, with the one real
  Linux `SIGKILL` abstract-lock case skipped on macOS;
- the combined V65 request, V66 kernel, V67 identity, V68 credentials/client
  family, and V69 persistence matrix passed **100 tests across 6 suites**, with
  that same one platform skip;
- the complete systemd user-service-manager regression passed **92 tests**,
  with its Linux native lock and production LMDB cases skipped;
- all four TypeScript configurations passed;
- all changed JavaScript passed ESLint with zero warnings and Prettier;
- package-content verification retained exactly **247 files**;
- whitespace and syntax checks passed; and
- two final adversarial reviews found no remaining medium-or-higher blocker
  after the inherited-close race fix.

The focused suite covers exact CAS and successors, state-before-fence reopen
and real V66 resume, rename response loss, durability poisoning, private
permissions, symlink and group-writable corruption, bounded FIFO rejection,
all four inspection classes, deterministic retention, exact-capacity stale-temp
recovery, cross-instance lock exclusion and release, detached descendant
revocation, external close draining, and the inherited-close deadlock race.
The Linux-only child fixture additionally kills a real abstract-lock owner and
reacquires its address on Linux.

Generated coverage, Jest cache, tarball, distribution, and TypeScript
build-info output was not retained. The repository remained about 527 MiB and
the workspace volume had about 19 GiB available during final validation. No
full-repository Jest gate, SEA build, native package build, production
`/var/lib` write, disposable Linux proof, live IMDS/AWS call, or native LMDB
test was run. Native LMDB remains excluded on this Mac because its addon has
previously terminated the process with an allocator double-free.

## Security-review fixes to preserve

The final implementation includes fixes for:

- parent fsync after private-directory creation;
- post-rename recovery sync and capability poisoning when durability remains
  unknowable;
- draining unawaited admitted children and revoking detached descendants;
- preventing disjoint abstract locks across network namespaces that share the
  same state filesystem;
- nonblocking descriptor reads before regular-file validation;
- bounded incremental `opendir` scans instead of unbounded `readdir`;
- complete hard-link publication of the per-boot namespace claim;
- rejection of `close()` from inherited callbacks before returning any
  memoized external close promise; and
- recovery of a patterned stale temp beside exactly 128 durable states.

## Honest boundaries

V69 is a production-quality local persistence boundary, not a complete
privileged host:

- no controller request is minted or persisted through a production path yet;
- no DynamoDB authority adapter or V66 `authorizeRequest` wiring exists;
- local fence inspection cannot authenticate controller freshness;
- the namespace claim and native process-death lock still need disposable
  root/Linux proof;
- a process in the selected network namespace can prebind a deterministic
  abstract address for denial of service, but binding it grants no durable
  store or effect authority;
- old per-boot namespace claims and rare crash-orphan claim temporaries are not
  pruned;
- more than 16 stale temporaries, 128 durable states, or enough
  ambiguous/future states to consume that bound intentionally halt recovery;
- the systemd helper retains its pre-existing same-network-namespace
  assumption; only the strict activation opener adds the filesystem claim;
- application and control storage, exact artifact projection, fixed-user
  service convergence, health publication, and final receipt minting remain
  injected ports; and
- there is no privileged root command/SEA, SSM delivery, reboot proof, or
  clean-account lifecycle proof.

Wharfie still promises exact-convergent, at-least-once-safe host effects, not
physical exactly-once execution.

## V70 authenticated current-head authority

The next slice must span the whole authority path rather than add a misleading
transport-only adapter:

1. After V65 derives a request from the running all-actions-settled head and
   fresh managed-artifact evidence, persist the complete canonical request at
   one stable DynamoDB control-table key:
   `host-activation-authority/v1/<deploymentInstanceId>`. The document ID is
   the request ID. Keep only the current mutable authority record.
2. Let SSM or another wakeup carry only the deployment instance ID and request
   ID. Transported bytes never grant authority.
3. On the host, perform strongly consistent `GetItem` reads of the stable
   authority record and `head/v1/<deploymentInstanceId>`, reading the current
   head last.
4. Extend the runtime role with only the required DynamoDB `GetItem` permission
   on the fixed control table and those exact partition-key families.
5. Add one pinned commercial-regional DynamoDB client to the V68 owned host
   lifetime. Reuse its fixed IMDS credentials, explicit
   `https://dynamodb.<region>.amazonaws.com` endpoint, one-attempt policy,
   silent logger, cancellation, draining, and owned destruction.
6. Implement the exact V66
   `authorizeRequest({request,purpose,step,receipt})` checks for `claim`,
   `dispatch`, `settle`, and `replay`.

The stored request must match exactly. Reject an older head, a same-generation
different head ID, a different incarnation, destroy, or another active
operation. A higher generation may remain authoritative only while it is the
same all-settled active operation targeting the same revision, or its READY
successor whose `lastOperation` and settled revision match. Replay must also
validate the exact terminal receipt and request correlation.

Do not add an S3 current-head pointer or ad hoc request signatures. DynamoDB
already owns strongly consistent controller head and conditional mutation
semantics; duplicating current authority in S3 creates a second source that
still needs a DynamoDB cross-check. Existing content hashes prove integrity,
not writer authenticity.

This protects against forged or replayed wakeups, cross-deployment selectors,
stale requests, application-user messages, ambient endpoint redirection, and
unavailable authority. It does not protect against root compromise, a
principal allowed to mutate the control table, or stolen still-valid instance
credentials; those remain explicit trust roots.

## Repository state

The V69 implementation recorded here is commit
`ab931c8db16f8d0967a7f1ad022dad9aadb6eda3` on
`agent/strict-manifest` and was pushed before this checkpoint was written. Its
parent restart marker is the V68 checkpoint commit
`b5577358bf88d90de9dcafe01fe4f31c183e5550`. The commit containing this file is
the V69 restart marker. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remains untouched.
