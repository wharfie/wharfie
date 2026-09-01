# Application-state snapshot real-process-kill checkpoint

- **Date:** 2026-08-31
- **Status:** **ALL ELEVEN INTERNAL SNAPSHOT PHASES PROVED UNDER REAL SIGKILL; PRODUCT GATES CLOSED**
- **Source base:** `dca642a`
- **Decision:** [ADR 0041](../../docs/architecture/decisions/0041-sealed-lmdb-application-state-snapshot-transport.md)

## Restart summary

ADR 0041's injected interruption matrix now has a real process-death
counterpart. A parent test starts a separate pinned-Node child, waits until the
production `observePhase` callback reports one exact durable boundary, issues
`SIGKILL`, reaps the child, and independently reopens the control and
application-state stores. Recovery never depends on the killed process running
cleanup or returning a provider response.

The proof covers all six publication callbacks and all five
hydration/activation callbacks. It uses LMDB for both crash-durable control
state and application state, plus a test-only filesystem distribution that
publishes immutable bytes through a synchronized hard link and exact readback.
The generic child harness bounds IPC, stdout, stderr, phase waits, exit waits,
and cleanup without changing the repository-wide Jest timeout. These native
subprocess matrix cases have an explicit 15-second budget so the intentional
two-second fail-close wait and process reaping remain stable under CI scheduler
pauses. The harness strips ambient Node injection, provider credentials, and
Wharfie routing from the child environment.

The internal reconstructed-resident wrapper remains gated. Its existing tests
still prove the order close/adopt → reconstruction → settled application-state
history → transport → exact `ADOPTED` readiness → authority check → exact
reopen → authority check → handler. The new process proof establishes the
transport prerequisite while retaining the exact `CLOSED` barrier throughout;
it does not add a public or production call site.

## Publication process-death contract

| Killed after         | Independently retained state                                                                                                     | Exact recovery                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `source-adopted`     | The exact destination-authority row exists; no checkpoint marker, source seal, provider artifact, or central publication exists. | Reprove history, barrier, and authority; persist the remaining exact cut.         |
| `marker-persisted`   | The exact marker exists; the source is not sealed and no artifact or central publication exists.                                 | Replay the marker, seal the source, and continue.                                 |
| `source-sealed`      | The marker and whole-physical-store retirement seal exist. A write with the still-current token is rejected before retry.        | Reopen the sealed bytes read-only and continue exact publication.                 |
| `backup-complete`    | The source remains sealed and unwritable; no provider artifact or central publication exists.                                    | Reread the same sealed `data.mdb` and continue.                                   |
| `snapshot-published` | Exact immutable provider bytes exist after verified readback; central publication evidence does not.                             | Verify the retained object and conditionally write exact fenced central evidence. |
| `source-retired`     | Marker, seal, artifact, and exact central publication evidence exist.                                                            | Recover or exactly replay the same transport; no new identity is created.         |

Every case begins with an absent application-state destination-authority row,
so `source-adopted` proves a real durable transition rather than a same-token
read-only replay. Every case retains the same active source authority, exact
closed barrier, and business value across death and retry. Every sealed case
performs its still-current-token write rejection before recovery changes any
state.

## Hydration and activation process-death contract

| Killed after                | Independently retained state                                                                                                    | Exact recovery                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `hydration-staged`          | One unreachable private stage and physical replica ID exist; the target, claim, and activation do not.                          | True target absence permits a fresh exact hydration. The killed private stage is never interpreted as a target.                    |
| `hydration-target-created`  | The durable exact claim and exclusive partial `lmdb` root exist without data or evidence.                                       | Retry fails closed. It does not overwrite, remove, reclassify, or activate the partial target.                                     |
| `hydration-evidence-linked` | Exact data and snapshot-scoped evidence links exist with the retained claim.                                                    | Retry verifies the evidence, completes synchronization, releases the claim, and resumes as `HYDRATED`.                             |
| `hydration-committed`       | Exact data and evidence exist and the claim is released; no activation exists.                                                  | Retry validates the committed target and performs the one allowed activation.                                                      |
| `destination-adopted`       | The central one-shot claim, local activation intent, application-state authority adoption, and local activation evidence exist. | Retry recognizes the exact active replica and returns the same readiness. A second physical replica loses before local activation. |

Every phase retains the exact replacement authority, immutable publication,
and replacement-owned `CLOSED` barrier. Recoverable cases return identical
`HYDRATED` readiness on replay, preserve the seeded business state, remove the
source retirement only on the selected replica, and retain exact local
activation evidence. The partial pre-evidence case leaves no central activation
and requires explicit recovery; silent repair would destroy evidence.

## Broader boundary audit

The scoped audit also reread the adjacent crash matrix:

- renewal ambiguity, takeover races, stale predecessor fencing, and supervisor
  fail-close behavior have deterministic coverage;
- assignment claim/reclaim and authored pre-entrypoint start have deterministic
  and existing real-`SIGKILL` coverage;
- managed-effect request, destination, settlement, compound commit, and response
  loss have real-process coverage; and
- workflow and managed-successor intermediate terminal commits have real-process
  coverage, while wrapper sequencing and closed-on-failure behavior are
  comprehensive deterministic tests.

No primitive regression was missing inside this snapshot-transport slice.
Automatic DynamoDB RVN renewal/takeover under OS death, killing authored code
while it is actually running, the final authored run terminal, and a claimed
activity crossing the complete reconstructed product wrapper remain separate
activation work. They require a production provider/call-site boundary that
this proof deliberately does not create.

## Validation

Observed on Node `24.13.1` and npm `11.12.0`:

- publication real-`SIGKILL` proof: 1 suite and 6 tests passed;
- hydration/activation real-`SIGKILL` proof: 1 suite and 5 tests passed;
- both final real-`SIGKILL` suites: 11 tests passed in 8.349 seconds;
- `npm run test:replacement-input`: 14 suites and 302 tests passed;
- `npm run test:ci`: 355 suites and 8,087 tests passed, with 1 suite and 5
  tests deliberately skipped, in 930.962 seconds;
- aggregate coverage passed at 84.11% statements, 80.74% branches, 91.64%
  functions, and 84.83% lines;
- package verification checked all 382 files;
- the provider boundary remained within its 170-package and 89,128,960-byte
  budgets; and
- the production dependency audit found zero vulnerabilities.

One initial full coverage run encountered the unchanged five-second timeout in
the pre-existing `linux/arm64` dependency-lock planning test. That suite passed
all 7 tests in an isolated coverage reproduction; the one-file command then
failed only the intentionally repository-wide coverage threshold. The complete
unchanged gate passed on rerun. Native LMDB tests on this macOS host abort only
inside the filesystem sandbox; identical reused and clean installs pass all
focused suites outside it. Lockfile, package, and native-binary hashes matched,
so no dependency or production-timeout change was made. Only the native
subprocess cases use the explicit local deadline described above.

## Honest boundary

- This is real process loss, not host power loss, volume loss, machine loss, or
  a two-node provider proof.
- The test filesystem distribution synchronizes immutable bytes for process
  death. It is not a production provider adapter or a machine-loss durability
  certification.
- A private pre-claim stage may remain after uncatchable process death, but it
  is unreachable as a target. A claimed partial target remains deliberately
  fail-closed for explicit recovery.
- The cold checkpoint still requires deliberate quiescence and settled exact
  application-state history across separate transaction domains.
- Loss of the snapshot and every valid physical copy remains unrecoverable.
- Trusted-node enrollment, revision authorization, capability placement,
  machine-loss evidence, product activation, deployment, publication, release,
  and promotion remain open or explicitly out of scope.

## Next handoff

Define the explicit operator recovery contract for a retained pre-evidence
partial hydration, finish the remaining system crash boundaries at the future
production/provider seam, then implement trusted-node and revision
authorization plus capability placement. Only after those prerequisites should
Wharfie run one bounded machine-loss/two-node replacement proof or consider a
public DynamoDB resident gate.
