# Wharfie checkpoint — authenticated current-owner cancellation

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Remote branch tip before this local slice:** `aa994f4`
- **Parent checkpoints:** [V4 durable cancellation](2026-07-17-durable-cancellation-v4.md)
  and [shared source/SEA ledger operator](2026-07-17-shared-source-sea-ledger-operator.md)
- **Scope:** expose a narrow external cancellation command without weakening
  the V4 durable-before-signal contract or introducing a second ledger writer.

Read this after the two parent checkpoints. Wharfie remains free to make
breaking changes, Node-first with future native/WASI component seams,
trusted-node only, and focused on carrying an ordinary local CLI into a
portable executable and then a durable service.

## Result

Source `wharfie ops cancel` and packaged `<app> wharfie cancel` now share one
exact-run current-owner client. The packaged spelling is deliberately flat:
`cancel` is a direct child of `<app> wharfie`.

The command requires both `--run-id` and a caller-chosen stable `--request-id`.
The request ID is the retry identity: after a lost response, retry with exactly
the same value. The raw external request ID is not reused as a ledger transition
identifier; the active owner derives a namespaced internal transition ID for
the exact run and attempt.

Cancellation is intentionally much narrower than a generic V4 transition:

- it first opens the exact run and local-owner record read-only;
- a packaged command rejects a different app's run before output or mutation;
- it routes only to a same-principal, same-scope LMDB owner whose durable
  generation still matches;
- that owner accepts only its exact active manual run and `STARTED` attempt;
- the owner persists or rereads durable cancellation intent before beginning
  physical delivery; and
- a missing, inactive, unstarted, stale, moved, malformed, unauthenticated,
  timed-out, or unreachable owner never receives a direct-write fallback.

The owner endpoint is a distinct per-session local endpoint. It authenticates
bounded canonical-JSON request and response frames with a session-keyed HMAC,
and checks the ordinary live-session fence as well as the durable owner
generation. A resident lifecycle owner is not an active work owner. The local
transport is deliberately unavailable on Windows until named-pipe ACL semantics
are designed and tested.

The redacted cancellation response is schema v1 and carries only the run ID,
request ID, outcome, delivery state, and safe lifecycle statuses. It is not the
schema-v2 redacted run view used by `inspect` and wrapped by `recover`.

## Operator contract

`inspect` is read-only and cannot materialize a missing local control volume or
run. `recover` is an explicit mutation gated by `--confirm-runner-stopped`; it
can release an unstarted claim or expose a begun abandoned attempt as
`UNCERTAIN`, but never replays code. Packaged recovery requires LMDB ownership;
source recovery retains the documented behavior of its selected adapter.

External `cancel` cannot directly cancel `RUNNABLE`, `CLAIMED`, or other
unstarted work. Only an active foreground LMDB `ops run` that owns the exact
`STARTED` attempt can accept it. A terminal run reports its already
authoritative outcome with delivery not required; a blocked uncertain run
remains blocked. For a started attempt, matching cancellation evidence is still
required to commit `CANCELLED`; verified completion or failure can win the
race, and unconfirmed post-cancellation termination becomes `UNCERTAIN`.

The first foreground `SIGINT` or `SIGTERM` remains a local durable cancellation
request. It uses the same persist-before-signal ordering but is not evidence
that a separate external caller can cancel an inactive run.

## Still deliberately absent

- remote, cross-principal, or cross-host owner-command routing;
- cancellation delivery through the resident ledger service, scheduler, or
  future coordinator;
- a direct external mutation path for pre-start work;
- evidence-backed reconciliation of blocked `UNCERTAIN` work;
- durable deadlines/timers, managed-effect records, compensation, and
  exactly-once effect claims; and
- public history/listing or a scan-based replacement for the retired list
  command.

## Verification and handoff

This is a working-tree checkpoint, not a release certification. The earlier
V4 checkpoint's complete-suite and SEA counts predate this authenticated-owner
slice and must not be reused as final verification for it. Before committing,
run the focused owner-command, active-run cancellation, LMDB read-only, source
CLI, package, and SEA checks, then the full serial suite, lint, typecheck, and
diff check. In this environment LMDB socket/mmap tests require an unsandboxed
run.

The remote state was preserved before reset work; the last pushed branch tip is
`aa994f4`. The wider cancellation/operator work remains uncommitted in this
working tree until Git metadata writes are approved. Do not discard or reset
the worktree. Once verification and Git permission are available, review the
complete diff, make one coherent commit, and push `agent/strict-manifest`.
