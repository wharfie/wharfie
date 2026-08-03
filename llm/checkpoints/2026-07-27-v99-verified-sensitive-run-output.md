# V99 verified sensitive run-output checkpoint

- **Date:** 2026-07-27
- **Status:** **IMPLEMENTED, FEATURE-COMMITTED, AND FOCUSED-VERIFIED**
- **Branch:** `agent/strict-manifest`
- **V99 feature commit:**
  `c960c712df09f85f278297ffb40b4d74d63d5a0f`
- **Parent checkpoint commit:**
  `c41487da051eff7d7ac8bf34b7b8f4304230a4af`
- **Parent checkpoint:**
  [V98 local-contract integrity](./2026-07-27-v98-local-contract-integrity.md)

## Restart summary

Wharfie's intended experience remains:

> Start with a normal TypeScript/Node CLI, turn it into one approachable
> portable executable, let it remain resident as a durable service, and carry
> useful work and its results beyond the original coding session.

V99 closes the first bounded public retrieval path for durable logical run
values. Source and packaged operators can now recover a verified workflow
output prefix and logical terminal without loading authored source, exposing
private ledger mechanics, or weakening the ordinary redacted inspection
surface.

Continue with Git CLI, exact Node 24.13.1, focused disposable validation, and
immediate cleanup of every owned test/build root. Breaking internal APIs remain
acceptable.

## What V99 closes

### One verified logical ledger projection

The V10 ledger now rebuilds and verifies one exact app-scoped run, rehashes
every retained workflow output and relevant terminal payload, and projects
only:

- exact application, revision, and run scope;
- run kind, status, version, and last sequence;
- the complete ordered workflow output prefix; and
- a nullable logical terminal result or structured error.

Manual and effect-successor runs retain an empty output array. Completed
workflow terminals repeat the final verified output. Cancellation reports the
durable request reason, while supported activity and managed-effect terminals
are rejoined to their verified evidence or outcomes. Missing,
cross-application, inconsistent, corrupt, or oversized state fails closed.

### Shared source and packaged commands

The new local operator surfaces are:

```text
wharfie ops output --app-id <app-id> --run-id <run-id> --confirm-sensitive-output [--json]
<app> wharfie output --run-id <run-id> --confirm-sensitive-output [--json]
```

Source mode uses the supplied app ID without loading current authored source.
Packaged mode lazily binds the embedded app identity and accepts no app
override. Sensitive-output confirmation precedes packaged identity resolution
and every storage read. The default reader opens existing state read-only and
does not create a missing store.

### One strict sensitive document

Schema-version 1 kind `wharfie.execution-ledger.run-output` is recursively
frozen, bounded to 64 MiB after terminal-safe rendering, reports verified
integrity, and explicitly grants no authority. Human and JSON forms preserve
raw application values while escaping terminal controls; outside those
arbitrary values, Wharfie adds no payload references, evidence, transcripts,
fences, actors, attempt identities, or storage paths.

The entire snapshot is validated and rendered before its first output-port
call. Read or projection failure emits one fixed redacted diagnostic and no
partial snapshot. Redacted schema-v8 `inspect` remains unchanged.

ADR 0031 records this disclosure boundary, and the public README, CLI guide,
quickstart, architecture index, roadmap, source integration, and packaged
command composition now describe or prove the same contract.

## Focused validation completed

All direct TypeScript checks used exact Node 24.13.1. Before the final
documentation edit, all four configurations passed with no emitted output:

- `tsconfig.json`;
- `tsconfig.app-implementation.json`;
- `tsconfig.test.json`; and
- `tsconfig.sea-verifier.json`.

The final documentation-only edit reran `tsconfig.test.json`. Modified-file
ESLint passed. Focused test receipts passed without aggregating overlapping
selections:

- run-output command contract: 28/28;
- source CLI integration: 2/2;
- packaged mount/action coverage: 2 selected cases;
- shared activity-log renderer regression: 12/12;
- documentation command surface: 12/12;
- manual-ledger pre-gate and reconciled terminal: 2 selected cases, plus an
  earlier 3-case lifecycle selection;
- workflow reconciled failures: 2 selected cases, plus an earlier 3-case
  lifecycle selection; and
- managed-effect successor output: 1 selected case.

No full test-suite claim is made.

## Boundaries that remain

- This is a locally invoked read surface, not a served API, resident RPC,
  remote query service, or execution authority.
- Confirmation records disclosure intent; operating-system and configured
  provider access remain the real authorization boundaries.
- Values are unredacted application data and may themselves contain any secret
  or internal-looking value.
- V1 is one complete snapshot with no paging, watch, tail, export, or read
  receipt. Oversized snapshots fail until a later versioned retrieval design.
- Repeated reads make no exactly-once execution, delivery, or display claim.
- No native LMDB, native SEA build or execution, Docker, real systemd,
  block-device, or cloud path was run for V99.
- The committed V93 relocated Linux schedule/restart proof remains unexecuted
  in its required disposable environment.

## Three product outcomes

The roadmap is now organized around three outcomes rather than more numbered
implementation tranches:

1. A useful local TypeScript CLI can become one approachable executable and a
   durable, observable service without an application rewrite.
2. One authoritative coordinator may fail and be replaced from durable truth
   across explicitly enrolled trusted nodes; revision authorization,
   capability placement, fenced leases, and stale-epoch rejection preserve
   control while ambiguous unsafe work remains explicit.
3. A packaged application can use ordinary user-supplied cloud credentials to
   fulfill the narrow nodes and resources required by Wharfie abstractions,
   without becoming a general IaC system.

TypeScript/Node remains the public authoring boundary. Native bindings,
WASI/WASM, or persistent workers may accelerate measured hot paths behind a
versioned boundary.

## Immediate golden-path next slice

Build one tiny intent-carrying CLI whose local behavior is useful on its own,
then exercise one durable workflow, retained result, and scheduled or delayed
continuation through the existing source and packaged surfaces. Use hermetic,
non-privileged tests first. Record every missing capability and every needless
flag, file, or concept; fix only what blocks that path and delete accidental
surface area before expanding coordinator or provider machinery.

The existing relocated-Linux schedule/restart proof remains a separate,
explicitly gated evidence task. Native, Docker, systemd, block-device, and
cloud proofs are not implicit parts of the local slice.

## Resume state

- Branch: `agent/strict-manifest`
- V99 feature: `c960c712df09f85f278297ffb40b4d74d63d5a0f`
- Parent V98 checkpoint:
  `c41487da051eff7d7ac8bf34b7b8f4304230a4af`
- Historical stash remains untouched:
  `stash@{0}: WIP on master: 3dee66b work prompt`
- Exact validation Node:
  `/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`
- Next work: the three-outcome roadmap's local-to-durable golden-path
  application and gap inventory.
