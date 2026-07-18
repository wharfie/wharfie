# Wharfie checkpoint — evidence-backed uncertain reconciliation

- **Date:** 2026-07-18
- **Branch:** `agent/strict-manifest`
- **Parent checkpoint:** [authenticated current-owner cancellation](2026-07-18-authenticated-current-owner-cancellation.md)
- **Scope:** resolve a blocked V4 manual attempt only from exact retained
  evidence, expose that action through the common source/SEA operator layer,
  and finish the remaining local branch cleanup without publishing historical
  work.

This is the current restart point after the project-reset conversation. The
project remains deliberately breaking-change friendly, Node-first with future
native/WASI component seams, trusted-node only, and focused on turning a normal
local TypeScript CLI into a portable SEA and eventually a durable service. The
initial coordinator may be singular, but recovery must be explicit and honest;
Wharfie does not claim physical or external exactly-once execution without a
supported persisted effect/destination contract.

## Result: one strict path out of `UNCERTAIN`

V4 now accepts one new append-only event:

```text
uncertain-attempt-reconciled
```

`ledger.reconcileUncertainManualAttempt(...)` accepts only an exact retained
manual attempt when all of these remain true:

1. the run is `BLOCKED`, its invocation is `UNCERTAIN`, and the current attempt
   is `ABANDONED`;
2. run, invocation, attempt, generation, coordinator epoch, fencing token, and
   expected version match the retained state;
3. the supplied event ID and sequence identify the exact prior
   `attempt-became-uncertain` event that produced that retained attempt; and
4. a complete immutable Activity Protocol v1 transcript validates again against
   the stored revision, request input/caller metadata, exact start frame, and
   fence.

The initial verifier is fixed to `wharfie.activity-protocol` version 1. There
is no caller-selected verifier, operator-selected status, retry shortcut, or
"no error observed" acceptance path. Valid transcript terminals establish only
the matching logical `COMPLETED`, `FAILED`, or `CANCELLED` outcome; a
`cancelled` result still requires the matching persisted cancellation request
and host cancel frame. `protocol-failed` after a cancellation frame remains
insufficient.

The reconciliation event advances the run and invocation, removes invocation
uncertainty, and records the terminal summary. It intentionally does **not**
rewrite the physical attempt: it remains byte-equivalent `ABANDONED`, with no
new terminal/evidence projection. Each rebuild re-reads and validates the
immutable evidence reference. Tampered, missing, partial, mismatched, or
reordered evidence fails closed.

`transitionId` is the durable receipt key. The public reconciliation ID is
stable across a response-loss retry; the source-independent helper derives the
receipt identity as `reconcile:<reconciliationId>`. Same-ID exact replay returns
the retained receipt. Changed evidence, reason, actor, target uncertainty
event, fence, or reconciliation ID conflicts; a different reconciliation that
loses to an already terminal run is never reported as success.

## Operator contract

Both forms use the same shared operator implementation and never load app
source or dispatch user code:

```bash
wharfie ops reconcile \
  --run-id <run-id> \
  --reconciliation-id <stable-id> \
  --evidence-file <host-transcript.json> \
  --confirm-runner-stopped \
  [--reason <private-text>] [--json]

<app> wharfie reconcile \
  --run-id <run-id> \
  --reconciliation-id <stable-id> \
  --evidence-file <host-transcript.json> \
  --confirm-runner-stopped \
  [--reason <private-text>] [--json]
```

The evidence is a regular bounded UTF-8 JSON file, limited to the same 16 MiB
referenced-payload ceiling as the ledger. It is read only after exact-run and
packaged-app preflight, so a missing/cross-app run never causes an arbitrary
file read. The command then reacquires local mutation ownership and rechecks
the run before calling the ledger. It cannot race a live LMDB resident session;
packaged reconciliation requires the LMDB ownership protocol. Its output is
redacted: it does not expose input, caller metadata, evidence, evidence
references, terminal result/error, reason text, or fencing token.

This is intentionally a quiescent operator action. It does not contact a live
owner, retry a handler, rebase an old attempt, or provide remote/cross-principal
operator routing. The existing authenticated `ops cancel` command remains the
only external current-owner delivery path; reconciliation addresses the later
blocked state when evidence becomes available.

## Verification completed

- `npm run lint` under Node 24.13.1;
- `npm run typecheck -- --pretty false` under Node 24.13.1;
- the full serial Node 24 suite: **64 passed suites, 1 intentional skip, 775
  passed tests**;
- focused reconciliation coverage across core adapters, source CLI, packaged
  CLI/help, ownership refusal, redaction, error handling, and SEA verifier
  fences;
- `npm run verify:package` (110 files) and `npm run verify:package:sea` under
  Node 24.13.1; the generated clean Darwin SEA exercised the new packaged
  missing-run and cross-app reconciliation fences with Node unavailable on
  `PATH`;
- adapter-matrix core coverage for completion, cancellation authority,
  replay/conflict, wrong linkage, retained attempt identity, rebuild, and
  tampered evidence rejection; and
- `git diff --check`.

This validates the committed behavior, not production readiness. It does not
provide an external-effect exactly-once guarantee or turn the private npm
package into a release certification.

## Cleanup and tracker state

The current remote heads remain `master` and `agent/strict-manifest`; draft PR
#125 is the only open PR and issues #126–#132 are the only open scoped future
issues. The previous current-owner cancellation commit is `7a942cc`; this
reconciliation/cleanup work is still uncommitted at this checkpoint.

All remaining local historical `jvd/*` branch tips were audited and preserved
as annotated **local** archive tags before branch deletion:

```text
archive/2026-07-18/local/jvd/bug-fix
archive/2026-07-18/local/jvd/fixups
archive/2026-07-18/local/jvd/hard-edges
archive/2026-07-18/local/jvd/pr1
archive/2026-07-18/local/jvd/pr2
archive/2026-07-18/local/jvd/pr3
archive/2026-07-18/local/jvd/tsc
```

They are all superseded or absorbed by the strict-manifest/V4 direction; no
safe cherry-pick is pending. They must not be pushed accidentally. The cleanup
inventory records the evidence and exact tag names.

## Known blocker and next work

The clean-install GitHub Actions failure is independently diagnosed: ESLint's
import resolver needs `@typescript-eslint/parser`, but it is not a direct
dependency after `npm ci`. The SEA verifier still passes in that workflow.
Per the CI-repair review boundary, do not change `package.json` or the lockfile
for this until the user explicitly approves the dependency-only repair.

After this slice and the CI metadata repair, the next durable semantic boundary
is persisted managed-effect request/start/outcome state plus destination-backed
evidence. That is the prerequisite for any exactly-once effect claim or effect
reconciliation. Automatic retries, compensation, deadlines, remote command
routing, service installation, and coordinator failover remain separate work.

When resuming: inspect the working tree and this checkpoint, run the complete
verification matrix, commit only the reconciliation/docs/cleanup changes, push
`agent/strict-manifest`, and update draft PR #125 with the final validation and
the CI limitation. Do not reset or discard the worktree.
