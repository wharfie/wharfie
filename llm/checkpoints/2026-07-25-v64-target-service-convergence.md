# V64 target service convergence checkpoint

Date: 2026-07-25

Parent:
[V63 deployment command surface](./2026-07-24-v63-deployment-command-surface.md)
(`511e49b`)

Implementation: `7df2c380abb428db2c7242038ffa8917880514cb`

An intervening loose-end commit,
`85604f4050d76b91023994a2ba15cc8b0feabe46`, makes the AWS single-node
provider factory reject an invalid region before returning a provider.

## Restart summary

Wharfie's golden path remains a normal TypeScript/Node CLI that can be packaged
as one portable SEA, run locally, become a durable resident service, and later
be projected into a trusted cloud node without requiring Node, containers,
Kubernetes, or a hosted orchestrator on that node. The larger purpose is to
carry an author's intent beyond one interactive LLM session while keeping the
result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its
abstractions may use the operator's ordinary cloud credentials to create the
specific resources they require. The public authoring/runtime path remains
Node-first while native bindings or WASM may later serve measured hot paths.
Exactly-once claims remain abstraction-specific and must be backed by durable
protocol evidence. Trustless mesh semantics and a web UI remain out of scope
ahead of the CLI golden path.

V63 mounted the experimental deployment lifecycle, but provider convergence
still ends at attached storage. It cannot yet make a resident service ready on
the guest. V64 closes the local application-side prerequisite: a host agent
that owns one exact desired SEA no longer has to guess whether to install,
recover, repair, or update it.

## Exact desired-service operation

Every generated Linux SEA now exposes:

```text
<desired-app> wharfie service converge [--json]
```

The invoking executable is the complete desired-release authority. The command
accepts no application ID, unit name, executable path, environment override,
shell fragment, source directory, or alternative artifact.

One invocation:

1. derives the invoking artifact ID and embedded revision ID;
2. refuses an in-flight rollback and requires direction-neutral
   `service recover`;
3. resumes another in-flight transition, except that a different desired
   artifact may replace an unfinished first install through the coordinator's
   explicit `replaceInstall` transition;
4. returns a still-pending/refused/failed recovery without beginning another
   transition;
5. otherwise installs an absent activation, re-proves or repairs the exact
   selected target, or makes one ordinary update attempt from an exact active
   source; and
6. reports fulfilled only after independently proving `target-active`,
   `healthy`, and the exact invoking artifact/revision pair.

Repeating the same desired SEA after response loss cannot express the opposite
transition. `update` and `rollback` remain explicit directional operations.
After ambiguous rollback, `recover` remains the only accepted public command.

Machine-readable activation results retain the finite request statuses
`fulfilled`, `refused`, `failed`, and `pending`, separate from settlement
outcomes. Non-fulfilled results exit nonzero. The command boundary rejects a
malformed fulfilled convergence result unless it includes a nonempty exact
active pair, `target-active`, and `healthy`. Manager-side proof additionally
compares that pair with the actual invoking release.

Errors expose only action-appropriate static remediation. Ambiguous install or
update work tells automation to retry the exact desired SEA. Rollback ambiguity
tells it to run `service recover` first. Convergence-only remediation is never
trusted on another service action.

## Liveness repair and the remaining safety boundary

Convergence may reconstruct or restart only an exact projection authorized by
the durable ACTIVE selection, immutable release bytes, installation receipt,
fixed unit bytes, and live manager's effective unit. Missing, corrupt,
foreign, or contradictory authority still fails closed before a resident is
stopped or new bytes are selected.

Once that authority is proved, stopped, failed, or degraded liveness enters the
bounded reinstall path. Wharfie:

1. stops the fixed user unit and proves it inactive;
2. runs fixed-argv `systemctl --user reset-failed <unit>` when the observed
   unit was failed, clearing the failed flag and start-rate counter;
3. re-proves the selector and unit projection;
4. crosses the durable service-start fence;
5. starts the exact selected release; and
6. requires exact independent health before settlement.

This also lets an authorized source recover from a transient failure before a
safe update. A source that deterministically fails again after restart still
blocks switching to a different artifact. That boundary is intentional for
now: silently abandoning source/rollback authority would weaken the durable
update contract. A later emergency-replacement design must state that tradeoff
explicitly rather than smuggling it into ordinary convergence.

## Test-store and native LMDB boundary

The high-cardinality systemd manager suite now injects a persisted vanilla-JSON
control DB while asserting that production code still requests the fixed
`lmdb` selector. This preserves durable reopen and state-machine coverage
without loading the native LMDB addon on this machine.

A Linux-only smoke test retains direct coupling to the production LMDB manager
path and reopens desired-target state across an update. It is intentionally
skipped on macOS. Native LMDB was not run locally because its addon currently
terminates this Mac in `ExtendedEnv::~ExtendedEnv` with an allocator
double-free. Do not reinterpret the JSON-backed manager suite as native-LMDB
evidence.

## Verification and disk hygiene

Final V64 verification used pinned Node 24.13.1, serial Jest execution, no
coverage, and no Jest cache:

- complete systemd manager contract: **92 passed, 2 intentionally skipped** in
  **9.184 seconds**;
- packaged service command plus docs surface: **79 passed** in **2.943
  seconds**;
- all four TypeScript configurations passed;
- changed JavaScript passed ESLint with zero warnings and Prettier;
- package-content verification retained exactly **240 files**;
- two independent final code reviews found no blocking safety, settlement, or
  documentation issue; and
- `git diff --check` plus repository and temporary-output scans passed.

No coverage, dist, build, cache, TypeScript build-info, package archive,
package-verification directory, systemd-manager temp directory, or LMDB-test
temp directory remained. The final scan showed **21 GiB available** on the
workspace volume. No SEA or native package build and no full-repository Jest
gate was run in V64; those expensive proofs would not add proportional
confidence to this command-local change on the nearly full workstation.

For future npm-spawning verification, placing only the pinned `node` executable
on the command line is insufficient: `npm` resolves its runtime through
`PATH`. Put the Node 24.13.1 `bin` directory first in `PATH`, or npm 10 may run
under the older ambient Node and fail the package's `devEngines` check.

## Next implementation slice

The next coherent boundary is a framework-owned privileged host agent, not an
AWS graph resource yet. The root process must never execute application bytes
as root. Build the following in order:

1. Add a strict, content-addressed, secret-free AWS single-node host activation
   request/receipt contract in
   `src/core/runtime/deployment-aws-host-agent-contract.js`, with exact
   deployment/head/action, node, role, versioned artifact, volume, target, and
   desired-release identity.
2. Add a pure durable activation kernel in
   `src/core/runtime/deployment-aws-host-activation.js`. Persist intent before
   each storage, artifact, and service effect; verify before replay; settle
   only from independent evidence. Claim at-least-once effects with exact
   convergence, not generic exactly-once execution.
3. Add a privilege-safe host command that invokes the exact root-owned
   application artifact as the fixed `wharfie-runtime` user through a
   transient systemd user unit and fixed argv:
   `wharfie service converge --json`. Use no shell, a clean bounded
   environment, no inherited capabilities, and no root application execution.
4. Implement exact local storage, artifact, and STS-session projections. Resolve
   EBS devices from volume identity rather than requested `/dev/sd*` names;
   fetch one mandatory S3 `VersionId`; verify artifact bytes before atomic
   publication; and bind the live assumed-role session to the expected account,
   runtime role, and instance ID.
5. Package the framework-only host agent as its own Linux SEA, excluding the
   developer application, activity assets, ActorSystem, and application LMDB
   closure.
6. Only after safe service deactivation and filesystem unmount exist, add the
   resident-service graph role. Use SSM only as an eventual wakeup mechanism:
   `SendCommand` has no client idempotency token, so immutable durable
   request/receipt objects—not command delivery—must define replay and
   settlement.

Start with the contract and pure kernel tests. Keep AWS delivery, graph
mutation, mount syscalls, and SEA construction out of that first slice.

## Repository state

The V64 implementation is pushed on `agent/strict-manifest` at
`7df2c380abb428db2c7242038ffa8917880514cb`. At implementation publication,
local HEAD and `origin/agent/strict-manifest` matched. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
