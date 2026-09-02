# Production-seam process-death checkpoint

- **Date:** 2026-09-01
- **Status:** **INTERNAL PROCESS-DEATH SCOPE COMPLETE; ACTIVATION NO-GO**
- **Decisions:**
  [ADR 0037](../../docs/architecture/decisions/0037-single-region-dynamodb-rvn-coordinator-replacement.md),
  [ADR 0038](../../docs/architecture/decisions/0038-authority-bound-replacement-reconstruction.md),
  [ADR 0039](../../docs/architecture/decisions/0039-retained-coordinator-quiescence-barrier.md),
  [ADR 0040](../../docs/architecture/decisions/0040-provisioned-replacement-input-and-payload-distribution.md),
  and
  [ADR 0041](../../docs/architecture/decisions/0041-sealed-lmdb-application-state-snapshot-transport.md)

## Restart summary

The future production seam now has one-host independent-process evidence for
the coordinator and authored-work loss boundaries that remained open after the
complete reconstructed-wrapper crossing.

A predecessor runs the production DynamoDB RVN coordinator protocol and real
resident authority supervisor against a durable provider-shaped test adapter.
It acquires epoch `N`, completes automatic renewal, and is killed with
`SIGKILL`. After that process is reaped, a successor observes the same exact RVN
across the required local monotonic stability window and performs the exact-CAS
takeover to epoch `N+1`. No operator-forced takeover substitutes for that
automatic path.

The successor enters the full reconstructed resident wrapper. It validates the
predecessor's exact durable `CLOSED` barrier, adopts it once into a
successor-owned `CLOSED` version, and keeps that adopted record unchanged
through execution reconstruction, application-state transport, and exact
readiness. Only the successor reopens the barrier, and the reopened state is
durable after its process exits. A retained predecessor token cannot commit a
protected mutation after takeover.

Two authored-work process boundaries complete the scope:

- an fsynced marker proves that the first child entered real authored code
  before it was killed. The successor reconstructs the retained `STARTED`
  attempt as `STARTED_OUTCOME_UNKNOWN`, leaves the run
  `BLOCKED`/`UNCERTAIN`, retains no invented terminal, and does not redispatch
  the authored function; and
- a separate child durably commits the real authored terminal, then pauses
  before the caller can observe that response. After `SIGKILL`, the successor
  reconstructs the terminal and exact replay returns the retained outcome
  without a second authored entry or terminal commit.

This closes the bounded repository scope for automatic coordinator process
loss, authored execution loss, and terminal-response loss. It does not activate
the public DynamoDB resident path.

## Coordinator loss and exact takeover

The process proof uses production authority behavior rather than a hand-written
takeover simulation:

1. the predecessor acquires one application authority at epoch `N`;
2. the resident supervisor renews that authority and exposes the committed RVN
   advance as durable evidence;
3. the parent kills and reaps the predecessor process;
4. the successor first observes one exact active tuple, waits the configured
   local monotonic window, and observes that tuple unchanged;
5. the successor takes authority only through the protocol's exact-CAS
   transition, producing epoch `N+1`; and
6. a delayed write using the predecessor's retained epoch-`N` token fails its
   authority fence while successor work remains valid.

The durable adapter has the same client brand and conditional transaction
shape required by the production protocol, so the real supervisor,
stable-observation, takeover, and ledger-fencing code runs in the children. The
test injects the wrapper's existing topology-validation boundary with the
receipt-pinned table identity. This is test infrastructure, not evidence from
AWS, a disposable DynamoDB table, a provider outage, or a second machine.

## Closed-barrier reconstruction

The predecessor leaves one exact retained `CLOSED` replacement barrier. The
successor conditionally adopts that exact predecessor into one successor-owned
`CLOSED` version and does not reopen early. The full
`withReconstructedExecutionLedgerResidentAuthority` composition:

1. validates the provisioned replacement input and topology;
2. obtains successor authority through automatic stable-RVN takeover;
3. adopts the exact inherited closed predecessor once;
4. completes two-pass execution-ledger reconstruction;
5. completes application-state transport and exact destination readiness while
   the barrier is still closed;
6. reopens only the adopted generation under epoch `N+1`; and
7. persists that exact `OPEN` state before resident handling proceeds.

Observations at reconstruction, transport, and readiness prove that fresh
admission remains unavailable throughout those phases. A later protected write
presented with the predecessor token is rejected while the successor remains
live.

## Authored code killed while running

The activity writes and fsyncs an attempt-scoped entry marker from inside its
authored function. The parent does not send `SIGKILL` until that marker is
durable, so a retained `STARTED` record alone is not being mistaken for proof
that user code ran.

After the killed child is reaped, successor reconstruction reports
`STARTED_OUTCOME_UNKNOWN`. Recovery preserves the conservative
`BLOCKED`/`UNCERTAIN` disposition and retains zero terminal outcome. Starting
the successor worker does not append another authored marker: work with an
ambiguous external outcome is not silently retried.

## Terminal commit whose response is lost

The second boundary wraps the real final-attempt terminal commit only to expose
a post-commit pause. The child executes the authored function once, commits its
terminal outcome through the authority-bound ledger, and is killed before that
call can return to its caller.

The successor reconstructs the already terminal run. Repeating the exact
invocation takes the committed-replay path and returns the retained logical
outcome. The authored marker remains singular, the retained start and terminal
remain singular, and no executor dispatch is needed to manufacture the replay.

## Validation scope

The repository's focused process-death suites cover the coordinator, running
authored attempt, and post-terminal-response-loss cases and are part of the
replacement-input regression lane. They use pinned Node and cleanup-owned child
processes.

Observed on Node `24.13.1` and npm `11.12.0`:

- `npm run test:replacement-input` passed 19 suites and 347 tests in 47.836
  seconds;
- the three new crash suites passed 6 tests together under
  `--detectOpenHandles` in 12.342 seconds;
- `npm run test:ci` passed 360 active suites and 8,132 active tests, with 1
  suite and 5 tests skipped under the existing policy;
- global coverage remained above every configured threshold; and
- source, app, test, and SEA-verifier typechecks, 382-file package
  verification, the provider-boundary budget, and the production dependency
  audit all passed, with zero production vulnerabilities.

Native LMDB children on this macOS host must run outside the filesystem sandbox
because sandboxed LMDB initialization aborts. That host constraint changes no
production or release configuration.

## Activation decision and next handoff

The activation-readiness decision is **NO-GO**. The public DynamoDB resident
gate remains closed because the repository still lacks:

- trusted-node enrollment;
- per-application-revision execution authorization;
- finite capability advertisement and compatible placement;
- a fenced node lease and bounded two-node machine-loss proof; and
- an explicit successor-authority repair for an incomplete partial-hydration
  recovery receipt whose original authority or barrier has become stale.

That final receipt state is deliberately fail-closed today: the original scope
is no longer authorized, the successor scope cannot mutate its attempt, and the
bounded global registry prevents a new claim. Silent deletion, compaction, or
authority substitution remains forbidden. The next slice must design and prove
an explicit repair before activation can be reconsidered.

No release, deployment, publication, promotion, live-provider run, public gate
change, or cloud resource mutation is claimed by this checkpoint. Those actions
remain deferred.
