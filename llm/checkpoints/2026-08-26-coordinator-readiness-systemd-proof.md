# Explicit coordinator recovery and interrupted-readiness crash proof

Date: 2026-08-26

Status: the hardened real-VM proof, default two-worker coverage gate, package
verification, audit, and magnetic first-run proof all passed. Checksummed
receipts were retained, and the owned VM, proof task root, and private image
cache were removed. The earlier complete VM run, two failed parallel coverage
runs, and successful serial coverage run remain below as explicitly historical
evidence; none is deleted or reclassified by the current clean gates.

This continues the
[application-state readiness checkpoint](2026-08-26-application-state-readiness.md)
on `agent/coordinator-authority`. It preserves the earlier authority, operator,
schedule, and destination-readiness work in this worktree. The snapshot commit
below belongs only to a private proof repository, not the user's Git history.

## Bounded outcome

The Linux service proof now requires the current explicit recovery policy:
after ungraceful loss, automatic startup must refuse the retained ACTIVE
coordinator. Only exact inspected takeover-and-release permits a fresh
resident, whose READY publication must follow adoption of the same pinned
application-state destination at its new epoch.

Two additional real process kills now bracket destination-authority advancement
from a retained ADOPTED predecessor: one immediately before the destination
advance, and one after that advance but before the control-side ADOPTED CAS.
The last confirmed ADOPTED control floor stays byte-for-byte intact at both
boundaries. Neither path may reset the destination identity, recreate or lower
its barrier, advance from an unconfirmed predecessor, or change retained
completed work.

This is one trusted control lineage and one retained LMDB primary destination
on a single machine. It is not automatic failover, a provider-certified lease,
an atomic transaction across stores, or recovery after losing either volume.

## Proof implementation

| Case                                            | Physical loss and independent observation                                                                                                                                                                                | Required recovery                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Managed resident                                | Actual fixed-unit MainPID receives SIGKILL; systemd reports that exact ExecMainPID with code 2/status 9; a newer automatic attempt stops without READY                                                                   | Stop retries, inspect the unchanged full ACTIVE predecessor, explicitly takeover-and-release, then ordinary service start |
| Host reboot                                     | Lima forcibly stops the VM; changed kernel boot ID; a root observer records a failed automatic startup before any proof-user login                                                                                       | Verify retained authority, pin, timer, and destination; explicitly takeover-and-release; start a fresh service            |
| Retained ADOPTED before destination advance     | Source-bound inspector pauses the exact selected SEA's normal service runtime; fixed systemd unit stays stopped; control and destination independently retain the exact last confirmed ADOPTED floor; real child SIGKILL | Uninstrumented service-runtime retry must fail closed; exact public takeover-and-release; fresh systemd READY             |
| Destination advanced before ADOPTED control CAS | Same direct-child mechanism after the exact higher destination barrier is independently read, while control remains the unchanged confirmed ADOPTED predecessor                                                          | Same explicit recovery, preserving the pin and directly advancing ADOPTED control only from that confirmed floor          |

The two partial-handoff cases are direct packaged service-runtime children,
not additional systemd MainPID kills or VM reboots. They use the normal hidden
service bootstrap, exact selected immutable executable, state working
directory, and sealed data root. They add no production fault hooks or unit
drop-ins. Breakpoints are bound to the installed npm package's exact source
bytes and source-map locations. Runtime PATH has no Node executable.
Neither boundary exposes a PREPARING control row. A successful successor first
verifies that the existing destination barrier covers the retained floor,
advances the destination by exact CAS, reads it back, and only then advances
control directly from the retained ADOPTED predecessor.

The existing fifteen administrative-command crash cases remain: five each
for update, rollback, and failed-target source restoration. Their artifact,
phase, physical selection, response-loss replay, history/output, uninstall,
and pruning assertions remain in the same gate.

All live healthy checkpoints now independently verify current coordinator,
ADOPTED control pin, store identity, exact destination barrier, lifecycle and
local ownership, followed by final control/lifecycle rechecks. Graceful stop
and uninstall must release control authority without deleting or lowering the
destination barrier.

The root boot observer is schema v2; prepare/final receipts are schema v4.
The boot observer uses read-only handles to pre-existing separate stores,
checks absence of login sessions both before and after observation, and never
performs adoption or implicit recovery. Its receipt explicitly distinguishes
`automaticStartAttempt: true`, `automaticStart: false`, and required explicit
coordinator takeover. All observer reads share one 120-second monotonic
operation deadline beneath `TimeoutStartSec=150s`; wall-clock time is reserved
for the receipt timestamp. Every external reader receives the remaining
budget and runs in an isolated POSIX process group whose timeout hard-kills
the full group and reaps the direct child, with a bounded wrapper backstop.

## Native process-boundary regression

The native subprocess fixture remains the first-adoption counterpart: it
pauses the real production protocol after PREPARING commit and after
destination commit before ADOPTED, using separate control and application-state
LMDB volumes. The parent actually kills and reaps each child, checks ordinary
restart refusal, and performs an explicit exact takeover-and-release. Two
subsequent uninstrumented resident sessions each reach READY and drain
gracefully.

Each case retains terminal managed-effect history, its positive destination
receipt, business value, logical payload bytes, and store identity. This
native proof supplies the typed managed-effect retention evidence; the Linux
service fixture instead verifies a durable timer/signal workflow and its
activity markers, history, and output. Those are distinct evidence scopes.

Cleanup reaps every tracked child before removing fixture directories. A
failed reap retains its fixture rather than deleting stores beneath a live
process. Cleanup errors do not replace the original assertion failure.

## Source and host isolation

The real driver accepts explicit `--snapshot` for this unfinished worktree:

```sh
WHARFIE_SYSTEMD_PROOF_OUTPUT_DIR=llm_artifacts/systemd-proof/2026-08-26-coordinator-readiness \
npm run verify:service:systemd:lima -- --snapshot
```

The current successful captured snapshot is
`a13e21e2a07fea6c0a66b6965921d871ad8c792f`, based on original HEAD
`95ed59be5c78e6336ea93d60f27f3f56db916093`. Its 990-file source archive is
22,753,280 bytes with SHA-256
`fc37a738f71f1002018ecdb3ed8e6c89b3a4659100730f3686f55dba6c1e47c9`.
The canonical source-tree manifest digest is
`be0a08a2f3ef620cc507ee42a7d4b6207461c4b37a6df57c2d60a4946f82a4f6`.

Capture excludes known credential paths, ignored untracked files, and
generated/tool state, including the tracked local `.npmrc`. Both clean-commit
and snapshot modes copy the exact accepted allowlist into a new private Git
repository, require its tree paths, modes, and hashes to equal the manifest,
and archive only that synthetic tree within a fixed size bound. This is
pathname filtering, not a general secret-content scanner. Exact source bytes,
exclusions, original HEAD/status/index-listing hash, Git mode, archive hash,
and config hash are retained. The original repository is never staged or
committed. Git hooks, filters, lazy fetching, and external attribute
transformations cannot alter the captured bytes. Clean-commit mode additionally
refuses tracked credential paths and local export overrides.

Lima uses a short private namespace, no host mounts or agent forwarding, and
the real unchanged HOME. The official pinned cloud image is downloaded into
a private cache, hash-verified, and selected through a strict single-local-
image configuration. The host helper is frozen before capture, checked
against the captured source, and retained with the receipts for cleanup.
Absolute Node and helper execution occurs under a purpose-specific clean
environment without inherited `NODE_OPTIONS` or `NODE_PATH`; curl similarly
uses a clean environment without HOME, proxy, or TLS credential inheritance.

Inside the guest, both proof programs refuse any
`WHARFIE_SYSTEMD_PROOF_ROOT` override and use only the canonical direct leaf
`/var/tmp/wharfie-systemd-proof`. Its parent and root may contain no symlink
components. An existing root is recursively reset only after validating exact
current-UID ownership, mode 0700, and an exclusive one-link mode-0600 JSON
marker that binds its schema, canonical path, and UID; unmarked or malformed
roots fail closed.

Receipt reservation precedes downloads and VM creation. Existing results are
never overwritten. Publication validates canonical `SHA256SUMS` against the
exact sorted regular-file set, exclusively reserves the visible destination,
copies each data file without replacement, and rehashes those copies against
the original seal. Only then is `SHA256SUMS` created as the last visible file
and the published seal revalidated. Failed deletion retains the VM's private
files; default successful deletion verifies instance absence before removing
its owned root. Debug `WHARFIE_SYSTEMD_PROOF_KEEP_VM=1` intentionally retains
both. Failure finalization cannot rewrite evidence behind an already sealed
checksum manifest.

## Current hardened Linux run and retained evidence

Snapshot `a13e21e2a07fea6c0a66b6965921d871ad8c792f` completed the hardened
real-VM proof at `2026-08-26T21:28:18Z` and exited 0. It built three distinct
Linux arm64/glibc SEAs from the installed 364-file
`@wharfie/wharfie@0.0.15` tarball. The tarball SHA-256 is
`c8b38826bc4b238c814ce1896e6b45f7a6653dc8d74446269fff6d436207bce4`.
Each executable is 155,323,520 bytes:

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Source                      | `17535e55991279132a95b55c42fb639d712c8a82a33e4e8dc3814775bf3af450` |
| Healthy target              | `fb3039d2d7922acf9e21dc2bf064f473b42d998546cf000f17a8053a797f617d` |
| Deliberately failing target | `d1f88d36849aa781edfb72acb33783e04e262c14e1d70b28cef98200947413ef` |

The two retained-ADOPTED process-kill boundaries produced these independently
read control/destination epoch pairs:

| Boundary                                      | Baseline | Frozen after SIGKILL | Fresh READY |
| --------------------------------------------- | -------- | -------------------- | ----------- |
| Before destination advance                    | 6 / 6    | 6 / 6                | 9 / 9       |
| After destination advance, before control CAS | 9 / 9    | 9 / 10               | 12 / 12     |

Both exact selected-service-runtime children exited from SIGKILL. Each
ordinary uninstrumented retry then refused the retained ACTIVE coordinator
with status 1. Exact inspected takeover-and-release permitted the fresh
recovery shown above. The completed workflow's verified history and output
were unchanged across both refusals and recoveries.

The forced host cycle changed the kernel boot ID. The pre-login observer
recorded `automaticStartAttempt: true` and `automaticStart: false`; only
explicit coordinator recovery permitted the lifecycle generation to advance
from 4 to 7. The durable timer workflow completed across the two boots. All
fifteen administrative crash cases passed. Uninstall preserved verified
history and output reads. Prune scanned three releases, retained two, and
removed the one unreferenced release.

Retained receipts are local-only evidence under the ignored
`llm_artifacts/systemd-proof/2026-08-26-coordinator-readiness/a13e21e2a07fea6c0a66b6965921d871ad8c792f/`
directory. All fifteen entries named by `SHA256SUMS` independently verify; the
checksum manifest itself has SHA-256
`07d3e80fd815c80735c4aa88b482595886dd8d031529ff8a4d7154e8513752a0`.
Cleanup exited 0 and proved instance `wfs-51431`, the private image cache, and
the proof task root absent.

## Earlier complete Linux run (historical evidence)

The receipts and observations in this section predate the retained-ADOPTED
boundary, monotonic/process-group supervision, canonical proof-root, exact
archive, host-environment, and no-replace publication hardening described
above. They remain exact historical evidence and are not reclassified as the
current hardened receipt.

That run used snapshot `2c53cdf26cf9cdf3afeb1bb1be2ac66bf1d96a3c`, based
on the same original HEAD `95ed59be5c78e6336ea93d60f27f3f56db916093`. Its
987-file source archive was 22,579,200 bytes with SHA-256
`a6001ae6c0e2cc61597fbdefba1ad3a4e74fb9c98812018b9c7345ea6fa8cec9`;
the canonical source-tree manifest digest was
`c73a448c1292acd1853e0f0b05c6f924315800267b74d23d1c57687340b49eef`.

The complete run finished at `2026-08-26T17:24:33.474Z` and exited 0. It built
three distinct Linux arm64/glibc SEAs from the installed 364-file
`@wharfie/wharfie@0.0.15` tarball using Node 24.13.1 and npm 11.12.0.
The tarball SHA-256 is
`ad02759c2c70a602489c3fbb47024293267aa16fe48ffc56808714b5355d4aa0`.
Each executable is 155,257,984 bytes:

| Artifact                    | SHA-256                                                            |
| --------------------------- | ------------------------------------------------------------------ |
| Source                      | `5794267dc0c44cb1c22e58d44a047383ca9d1df96a67f4060a6d0995b04bc424` |
| Healthy target              | `bdfaf761a2754e663e453780f234024b3031ccad4bb0a7122050c4ba46148c81` |
| Deliberately failing target | `65de5e8e9d5bcf1d1ad36da4ca663e9410c4042fff7dc48dfd6d2a099d6a055a` |

Observed results:

- Eighteen actual process kills in this Linux gate: one systemd MainPID, two
  direct selected-service-runtime handoffs, and fifteen administrative
  activation commands. The forced VM power cycle is separate; the two native
  subprocess tests are also not part of this Linux count.
- Managed crash recovery advances lifecycle generation 1 to 3 and authority
  epoch 2 to 4. The pre-login boot observer records a blocked generation 4
  with no login sessions before or after observation; explicit recovery
  reaches generation 7 at authority epoch 6. Lifecycle generations and
  coordinator epochs are deliberately not treated as interchangeable.
- Before destination adoption, control is PREPARING at epoch 7 while the
  destination still carries epoch 6. After confirmed replacement, fresh READY
  adopts epoch 9. At the second kill, control remains PREPARING at epoch 10
  and the destination already carries epoch 10; fresh READY later adopts
  epoch 12. Both unconfirmed retries exit 1. The identical pinned store
  survives both, with unchanged completed history and output.
- The original three-minute timer fires after its retained due time across
  the changed boot ID. Its signal is consumed and the workflow completes,
  with exactly the expected activity marker on each side of the reboot.
- All five update, five rollback, and five failed-target restoration
  boundaries pass, including lost-response replay and stale-retry refusal.
- Graceful restart and stop/start pass. Uninstall leaves systemd
  `LoadState=not-found`, `ActiveState=inactive`, and `MainPID=0`, while retaining
  inspectable history, output, state, selected release, and rollback candidate.
  Prune removes only the unreferenced failing artifact.

Retained receipts are local-only evidence under the ignored
`llm_artifacts/systemd-proof/2026-08-26-coordinator-readiness/2c53cdf26cf9cdf3afeb1bb1be2ac66bf1d96a3c/`
directory: `prepare.json`, `boot-receipt.json`, `final.json`, `cleanup.json`,
and `SHA256SUMS`. They are deliberately not repository links or PR artifacts.

All fifteen SHA256SUMS entries verify. Key SHA-256 values are:

```text
2c007c073aa2067473f4dcb41b7acb2053adcebfb2a43394c35cb3fa62414f0e  prepare.json
02de92466350faeb47963a615ee4b6ec9bd9363fcf2974b1cbf4e8baab4ca56b  boot-receipt.json
a005e7cf236ca3e476a567cd872347019c5737c6ad1d1322df2518f86b50d69f  final.json
953d680d2d37553c3698bc1c30d47a85e7c90f748dc965ff2b9132d4281c80b3  cleanup.json
9e8f4dd06f1fd4ea303e603865de7b6d954e3a685c8a443625b99151486e71c6  SHA256SUMS
```

Cleanup reports `instanceAbsent: true`, `instanceRetained: false`,
`taskRootAbsent: true`, and `privateImageCacheAbsent: true`, with exit status 0.
The exact instance was `wfs-10622`; `/private/tmp/wfs.FrEJVO` is absent.
The pre-existing global Lima cache's paths, types, sizes, modification times,
and change times exactly match the pre-run snapshot. All 987 captured files
and the original HEAD/index-listing hash matched an independent readback;
only documentation was subsequently updated to record these results.

## First real attempt and harness correction

Snapshot `5082f638b0f18e85c3b3cf7c843ac7ff978ab7d9` passed real managed-
resident crash refusal/recovery, pre-login forced-reboot refusal/recovery,
and retained workflow completion. Its new partial-handoff probe then timed
out waiting for a debugger pause. The probe had launched public `wharfie
worker`, which intentionally omits the installed service's artifact identity;
the existing activation fence rejects it before readiness preparation.

The corrected probe uses the exact generated unit's normal service-runtime
entrypoint for both inspected execution and the uninstrumented refused
retry. It also retains child stdout/stderr on failures and emits bounded
phase markers. No production admission check or behavioral assertion was
weakened, and the timeout was not increased.

The first VM and its private cache/root were removed. All seventeen checksums
in its separately retained local-only failure bundle under
`llm_artifacts/systemd-proof/2026-08-26-coordinator-readiness/failures/5082f638b0f18e85c3b3cf7c843ac7ff978ab7d9-7d8d1e7b-0177-4d04-82b5-018d4d5b216c/`
were independently verified. That ignored bundle is not a repository link or
PR artifact, and the attempt is not a successful complete proof.

## Validation

All local checks use Node 24.13.1.

The current merge gates are clean:

- The default two-worker `test:ci` gate exited 0 after 755.272 seconds. All 328
  active suites and 7,578 active tests passed; one suite and five tests retained
  their existing skips. Coverage passed the normal global thresholds at 84.06%
  statements, 80.89% branches, 91.45% functions, and 84.79% lines.
- Package verification passed with the expected 364 files, and the dependency
  audit reported zero vulnerabilities.
- The magnetic first-run proof passed with explicit inspected coordinator
  takeover-and-release before the identical named invocation resumed the
  retained workflow.
- Darwin package/SEA verification produced a 155,538,992-byte executable with
  SHA-256
  `1e085d1f20b43e6bdfef481beef54d26fff4f236b97fc7d9e7ba2ac385265cf2`.

### Earlier validation chronology (historical evidence)

The following focused results, two failed parallel runs, and successful serial
run are retained because they record the path to the hardened supervision and
clean default gate. The failed runs remain failures, and the serial run remains
a different runner configuration; none describes the current merge-gate
status.

- Focused proof helpers and boot observer: 3 suites, 123 tests passed in
  3.115 seconds; boot observer includes actual generated child-source
  execution and has 39 positive/negative cases.
- Native readiness/operator regression: 8 suites, 201 tests passed in
  15.311 seconds with handle detection and a normal exit.
- Source snapshot/image/receipt safety: 49 tests passed, including exact
  frozen-helper binding. Executable offline driver matrix: 15 tests passed,
  including deletion failures, existing/concurrent receipts, unchanged
  original Git state, legacy scenario compatibility, and sealed failure
  publication under KEEP_VM.
- Service-entrypoint/admission regression: 2 suites, 22 tests passed in
  2.587 seconds with handle detection. The native tests require execution
  outside this host's restrictive sandbox; an initial sandbox run aborted
  before tests completed, and the permitted rerun exited normally.
- All four type programs, repository lint/format checks, 364-file package
  verification, and scoped checks after the entrypoint correction passed.
- The corrected real-VM run exited 0. The first complete coverage run exited 1
  after 1,020.784 seconds: 7,507 tests passed, one failed, and five were skipped;
  326 suites passed, one failed, and one was skipped. The sole failure was the
  unchanged `test/helpers/isolated-authored-app.test.js` aggregate three-app
  import test exceeding its default 5,000 ms deadline, followed by an import
  after Jest teardown. Coverage still met all global thresholds: statements
  84.07%, branches 80.88%, functions 91.44%, and lines 84.79%.
- A focused coverage rerun of that fixture and the documentation-command checks
  passed all 21 tests in two suites in 26.649 seconds, with handle detection,
  unchanged assertions, and the original per-test deadline. Global percentage
  thresholds were disabled only for this diagnostic subset, not the complete
  gate. The fixture also passed alone with a fresh runner-owned cache: five
  tests in one suite, 31.057 seconds including coverage collection, normal exit,
  and no leaked handles. Neither the fixture, runtime, assertions, nor deadline
  was changed. Independent read-only review found no premature cleanup: Jest's
  timeout does not cancel the pending async import, which can then encounter
  environment teardown. A load-sensitive aggregate deadline fits the evidence,
  but the precise competing workload is unproven.
- The second complete two-worker run exited 1 after 1,278.562 seconds, again
  with 7,507 passed/one failed/five skipped tests and 326 passed/one failed/one
  skipped suites. The original app fixture passed. This time the unchanged
  `test/cli/cmds/ops-logs-command.test.js` retained-page case exceeded 5,000 ms;
  Jest also reported one forcibly exited worker. Global coverage percentages
  were unchanged and all thresholds were met, but this was not a clean gate.
  Its sole asynchronous test boundary is durable fixture seeding, which makes
  26 file/directory sync attempts plus verification reads. Read-only review
  found no added product work in that unbound manual path. The existing
  synchronous CLI children lack a hard timeout, and `afterEach` cleanup can
  race a seed after Jest times out; both are separate harness follow-ups, not
  demonstrated causes of the original five-second delay.
- The log suite passed alone with fresh-cache coverage and handle detection:
  two tests in 32.819 seconds including coverage collection; its retained-page
  case took 1,782 ms and safe-failure case 633 ms. It exited normally without
  leaked-handle warnings and kept the default deadline. As with the other
  diagnostic subsets, only aggregate percentage thresholds were disabled.
- A complete serial coverage run (`--runInBand`) then exited 0 after 1,898.233
  seconds: all 327 active suites and 7,508 active tests passed; one suite and
  five tests retained their existing skips. Both previously timed-out suites
  passed under their original deadlines. Statements were 84.07%
  (50,953/60,607), branches 80.88% (43,237/53,457), functions 91.44%
  (7,591/8,301), and lines 84.79% (49,366/58,218), all over the normal global
  thresholds. Assertions and per-test deadlines were unchanged. This is a
  different runner configuration, not a successful retry of the default
  two-worker gate; neither failed parallel run is reclassified as successful.
  Counts above overlap broader suites and must not be summed into a distinct
  test total.
- After recording the final README/roadmap state, the documentation-command
  suite passed all 16 tests in 2.516 seconds with handle detection, and package
  contents reverified at 364 files.

## Remaining boundaries and next slice

- Automatic takeover still requires provider-certified, store-authoritative
  lease expiry; no authority follows from heartbeat age or process silence.
- Control takeover alone does not revoke destination writes. The separate
  destination barrier does so when the successor adopts it; READY follows
  exact adoption, but the two stores do not share an atomic transaction.
- Both volumes, complete trusted authority lineage, and intact indexed
  history must survive. Legacy writers must be stopped at upgrade cutover.
- This does not certify live DynamoDB, reconstruct a missing store, support
  arbitrary destination sets, or demonstrate another machine taking over.
- Next, decide the admission/scheduling provenance contract. Current v10
  admission epochs remain zero; transaction fencing must not be misrepresented
  as historical coordinator provenance. Provider-certified renewable leases
  and a later trusted two-node recovery proof remain separate follow-on work.

No cloud resources or user repository commits are part of this slice.

## Next-slice handoff (proposal only)

The admission write fence already exists. The next product slice would record
internal admission authorship for manual runs, workflows, and managed-effect
successors, plus matching scheduled-occurrence provenance. Decide the
versioned representation before changing durable bytes; this proof slice does
not implement it, add public fields, or introduce a complete cursor audit log.

Acceptance criteria for that follow-up:

1. Preserve retained v10 admission and schema-v1 schedule reads. Legacy or
   unbound history has unknown coordinator authorship; neither epoch zero nor
   today's coordinator may be used to invent it.
2. Derive new provenance from the exact token fencing the write. Scheduled
   occurrence and workflow admission must agree in their existing atomic
   transaction; paired successor records need an explicit consistency rule.
3. After takeover or response loss, exact replay returns the original receipt
   and provenance without writes, a new logical occurrence, or conflicts caused
   only by a different current coordinator. A stale opaque preparation still
   cannot be consumed by a different bound ledger.
4. Verified history readers reject malformed or tampered provenance while
   retaining compatibility. Existing public history redaction remains unchanged.
5. Retain stale-write rejection and the distinction between a new assignment's
   epoch and settlement of a predecessor's attempt. Extend the existing admission
   and schedule-cutover tests without introducing leases or automatic failover.

Provider-certified renewable leases and a later trusted two-node recovery
proof remain separate future work after that provenance contract; the current
clean gates do not imply either capability.

Start from the
[ledger writers and verified readers](../../src/core/lib/db/tables/execution-ledger.js),
[schedule preparation and replay](../../src/core/lib/db/tables/schedule-control.js),
[atomic cutover tests](../../test/runtime/schedule-workflow-admission-cutover.test.js),
and [public history boundary](../../src/core/runtime/operator/execution-ledger-view.js).
