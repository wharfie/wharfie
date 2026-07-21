<h1 align="center">
  <img src="./assets/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
</h1>

Wharfie is an experimental, local-first TypeScript application runtime. Its
goal is to turn an ordinary CLI into a portable executable, then let that same
application become a durable, observable service across trusted machines
without an architectural rewrite.

The project is being reset around that goal. Wharfie v1's Athena and table
framework is no longer part of the product, and breaking changes are expected.

## The intended path

1. Write and run a normal TypeScript or JavaScript CLI locally.
2. Declare named activities that can be run and observed durably.
3. Package the application as a Node SEA executable for a specific target.
4. Promote that executable to a persistent single-node service.
5. Enroll more trusted nodes when placement or recovery requires them.

The current implementation proves the first four steps on Linux, including a
packaged single-node systemd service that recovers after process death and an
abrupt machine reboot in a disposable Ubuntu environment. That packaged
service also supports serialized, crash-recoverable update and rollback:
Wharfie closes admission, refuses while any durable run remains nonterminal,
retains one exact prior release, and resumes interrupted activation through
`service recover`. Update runs from the new target SEA and a fresh rollback
runs from the currently selected SEA. After an ambiguous rollback response,
recovery verifies or finishes the durable transition without toggling releases.
These activation semantics have focused unit and packaged-manager evidence;
the earlier disposable-host proof did not exercise update or rollback. A
source or packaged command can durably submit one
revision-pinned activity while the worker is offline; the matching single-node
resident later executes requests serially and recovers conservatively after a
process restart. A stale unstarted claim can be rescheduled, while work that
crossed `STARTED` becomes blocked `UNCERTAIN` rather than being redispatched.
Any unresolved managed-effect siblings settle atomically through receipt-only
recovery before that block. The public worker command and hidden packaged
service runtime share this implementation and consume an exact-revision
transactional ready-work locator rather than scanning run history. The strict
manifest also accepts the bounded linear workflow definition from ADR 0019.
The resident executes exact manifest-bound activity continuations, fires
persisted due timers as framework work, persists their outputs, and
conservatively releases `CLAIMED` or blocks lost `STARTED` workflow attempts.
Source `wharfie ops start` and packaged `<app> wharfie start` persist bounded
activity/timer/signal workflow plans. Source `wharfie ops signal` and packaged
`<app> wharfie signal` consume only the current declared signal wait under a
caller-stable delivery ID. The shared exact-run inspection, confirmed recovery,
cancellation, and evidence-reconciliation commands understand the redacted
activation-aware workflow cursor.

This is not yet a complete durable workflow engine. Packaged Linux artifacts
implement a systemd user-service lifecycle with real reboot evidence,
recoverable local activation, and explicit orphan-wiring reconciliation.
Durable activation state is the only authority for reconstructing missing
service projections; physical wiring without it is never adopted. First
install admits already queued work only when it matches the target revision,
and uninstall deliberately retains the `ACTIVE` selection and same-revision
admission so the service can later be rehydrated. An intentional-uninstall
tombstone lets a new target SEA automatically reproject and prove the retained
source before it requests the normal durable update; unexplained missing
projection state still requires the exact selected SEA. Workflow cancellation
has durable cursor authority and
active-owner delivery. Branches,
an early-signal inbox, managed-effect workflow successors, schedules,
provider-backed deployment, multi-host leases/heartbeats, and the trusted-node
mesh remain roadmap work; Wharfie is not production ready.

## Start locally

```bash
wharfie app manifest ./path/to/app
wharfie app run <activity-id> --dir ./path/to/app --input '{"who":"cli-user"}'
wharfie ops submit --activity <activity-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
wharfie ops start --workflow <workflow-id> --dir ./path/to/app \
  --idempotency-key <stable-key> --input '{"who":"cli-user"}'
wharfie ops worker --dir ./path/to/app
wharfie ops signal --run-id <run-id> --signal <signal-step-id> \
  --delivery-id <stable-delivery-id> --payload '{"approved":true}'
wharfie app package ./path/to/app
```

The packaged equivalents are `<app> wharfie submit ...`, `<app> wharfie start
...`, `<app> wharfie worker`, and `<app> wharfie signal ...`; they are bound to
the manifest and revision embedded in that artifact and do not accept `--dir`.
Signal delivery accepts only the current wait. `early-signal`,
`unexpected-signal`, and `late-signal` are durable, exactly replayable
rejections rather than a buffered inbox. Exact-run `inspect --json` emits the shared schema-v7 redacted trigger,
activation-aware cursor, timer, signal-wait, and signal-delivery lifecycle;
confirmed `recover` and evidence-backed `reconcile` use the same safe view.

The shipped top-level CLI contains `app` and `ops`. Continue with the
[installation guide](./guides/installation.md), [quickstart](./guides/quickstart.md),
and [application structure guide](./guides/application-structure.md). The
[project charter](../PROJECT.md), [roadmap](../ROADMAP.md), [architecture
decisions](./architecture/decisions/README.md), and [project-reset
record](./project-reset/2026-07-16-cleanup-inventory.md) remain the authoritative
contract, delivery sequence, design constraints, and historical cleanup
evidence.

The current restart handoff is the [exact AWS provider-spec resolution
checkpoint](../llm/checkpoints/2026-07-21-v25-exact-aws-provider-spec-resolution.md).
Its parent is the [provider-visible service-health
checkpoint](../llm/checkpoints/2026-07-21-v24-provider-visible-service-health.md).
