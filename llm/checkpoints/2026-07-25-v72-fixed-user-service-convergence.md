# V72 fixed-user service convergence checkpoint

Date: 2026-07-25

Parent:
[V71 exact host artifact projection](./2026-07-25-v71-exact-host-artifact-projection.md)
(`231c854bc71d1ed7d998c0a6e311fec8a45f7831`)

Implementation: `16ed3cacf66834a945204f39007f4f509126d17a`

## Restart summary

Wharfie's golden path is a normal TypeScript/Node CLI that can be packaged as
one portable SEA, run locally, become a durable resident service, and then be
projected into a trusted cloud node without requiring Node, containers,
Kubernetes, or a hosted orchestration service on that node. It exists to carry
an author's intent beyond one interactive LLM session while keeping the
result inspectable and evolvable.

Nodes are trusted. One coordinator is acceptable initially when its durable
authority can be recovered after coordinator loss. V1 and backward
compatibility are abandoned. Wharfie is not general cloud IaC, but its finite
abstractions may use the operator's ordinary cloud credentials to create the
specific resources needed by a portable application. Node/TypeScript remains
the public application and framework language; native Node bindings or WASM
may implement measured hot paths without widening that authoring model.
Logical exactly-once outcomes require durable intent, exact observation,
conditional settlement, and destination-side idempotency. Physical effects
remain at-least-once and replayable.

V72 connects the V71 projected SEA to the existing packaged `service status`
and `service converge` commands without ever executing authored bytes as root.
The bootstrap establishes one exact fixed runtime principal, the privileged
launcher verifies the projected SEA and enters its systemd user manager with
no retained root capability, and one pure adapter maps exact V64 status into
the V66 activation kernel. A real integration test recovers a lost convergence
response from fresh healthy observation and settles the durable activation
exactly once.

The host still lacks application/control-storage adapters, selector delivery,
the V3 health publisher, a root host command, a packaged host SEA, and a live
clean-account proof. V72 defines the production command boundary but does not
yet compose or deploy that complete host process.

## Bootstrap contract V2

The exact bootstrap is now:

```text
version: 2
domain: wharfie:aws-single-node-bootstrap:v2
raw bytes: 12992
base64 characters: 17324
sha256: 2wVex9gsS0vcLFvb6FJX0_PvtfRLXMxbXNuFltpsPzg
```

It fixes `PATH` and locale, then supports only three preflighted identity
states: exact absence, exact group-only recovery, and an already exact
principal. A user without the fixed group is rejected. Before mutation it
enumerates NSS records and refuses duplicate names, duplicate UID/GID use,
supplementary membership, the nobody IDs, out-of-range IDs, and bare or
plus-prefixed numeric names that could redirect name/ID parsing.

Group and user creation are ordered and revalidated around each mutation.
Password and group-password markers are normalized to locked `!` records and
the account databases are synced. The fixed user has:

```text
name: wharfie-runtime
group: wharfie-runtime
home: /var/lib/wharfie-runtime
shell: /usr/sbin/nologin
supplementary groups: none
```

Only root creates the home leaf. All descendants are created and chmodded by
the runtime principal through `setpriv` with empty supplementary groups,
empty capability sets, and `no_new_privs`; every final owner and mode is
rechecked. `/opt/wharfie/app` is `root:wharfie-runtime` mode `0750`.

The `/etc`, `/opt`, and `/etc/systemd` ancestry is verified before root-managed
leaf creation. Symlinks, wrong owners/modes, non-directories, and hard-linked
drop-ins fail closed. The user-manager IMDS drop-in is built in a private
`mktemp` file, synced, atomically renamed, directory-synced, and byte-checked
before daemon reload. Bootstrap then enables lingering, restarts the exact
`user@UID.service`, and enables SSM. The drop-in denies the IPv4 IMDS endpoint;
the provider launch contract already disables the IMDS IPv6 endpoint.

## Privileged runtime command

`createAwsSingleNodeHostRuntimeServiceCommand()` accepts no production
options. It requires Linux real and effective UID 0, then independently
resolves and cross-checks the exact fixed passwd/group projection through
bounded absolute `getent` and `id` calls. It rejects duplicate or ambiguous
numeric identities and any supplementary membership.

For every metadata, status, or convergence launch it:

1. requires the exact eleven-field V66/V71 command input;
2. derives the only accepted V71 path from deployment and request IDs;
3. opens that path with `O_NOFOLLOW`, requires
   `root:<runtimeGid>`/`0550`/one link, and hashes the complete held file;
4. runs the SEA metadata command and joins embedded application revision,
   runtime target, artifact ID, byte digest, and length to the request;
5. repeats the held-file verification immediately before the service action;
6. drops to the numeric fixed user/group through `setpriv`, clearing
   supplementary groups, all capability sets, and ambient environment;
7. enters a bounded transient systemd user unit with `Type=exec`,
   `NoNewPrivileges=yes`, `UMask=0077`, `KillMode=control-group`,
   `RuntimeMaxSec=300s`, and `TimeoutStopSec=30s`; and
8. accepts only a bounded canonical JSON object followed by one newline.

The outer process environment and the unit manager's dynamic-loader-sensitive
environment are scrubbed before the artifact is reached. Metadata uses a
separate namespace from service actions so back-to-back launches do not depend
on synchronous systemd garbage collection.

Every transient launch receives a fresh 256-bit hexadecimal unit suffix.
Names are never deliberately reused, so delayed cleanup cannot stop or inspect
a successor through a stable-name ABA. V64 `status` and `converge` already
acquire the same app-scoped Linux abstract-socket operation lock before
observing or mutating service state and hold it across all durable and physical
effects. A replacement worker therefore fails closed while a predecessor is
still running; the predecessor either completes or its runtime maximum kills
its cgroup and kernel-releases the lock.

An ambiguous launcher result and every finite nonzero `systemd-run` result are
treated as potentially post-dispatch. The launcher repeatedly stops its exact
unique unit and refuses to return until `systemctl show` proves
`ActiveState=inactive` (including exact not-found/inactive). `failed` is not
accepted as terminal because systemd may retain processes in a failed unit.
Broken cleanup timing fails stop rather than weakening the boundary.

## Pure V66 convergence adapter

The adapter revalidates the exact V66 service-convergence context and all four
predecessor evidence records, including the strict V71 artifact projection.
It exposes only:

```text
observe(context)
converge(context)
validateEvidence(value, context)
```

The injected command port has exactly `inspectExactService` and
`convergeExactService`. The frozen eleven-field port input contains request,
intent, attempt, deployment, app, release, target, projected path, length, and
digest authority; it contains no argv, environment, user, UID, GID, cloud
credential, or provider identifier.

Status V2 classification is deliberately conservative:

- exact physical absence is mutation-ready;
- a first install interrupted before any physical projection is
  mutation-ready when its durable desired release exactly matches;
- a fully healthy exact requested release settles;
- a fully healthy exact other release is ready for an authorized update;
- an exact ACTIVE projection with only a stale systemd daemon cache is
  repairable when lingering remains enabled;
- explicit disabled lingering never becomes ready; otherwise managed disabled
  lingering, foreign unit/drop-in/runtime state, manual ownership, rollback,
  release contradictions, and live sessions without exact current
  owner/release/MainPID proof block as conflict;
- malformed finite values, unavailable state, ambiguous selector/receipt
  residue, non-ACTIVE stale-cache transitions, and unsupported runtime shapes
  remain unknown.

Settlement evidence is pure and request-derived. It states only the fixed
runtime identity, expected unit, exact release/path, healthy target outcome,
and boot persistence. Command output cannot mint durable authority and raw
diagnostics never enter the V66 record.

## Response-loss proof

The V66 integration uses the real V71 artifact adapter and real V72 service
adapter. Its fake command activates the desired service and then loses the
convergence response. A fresh exact healthy observation produces the
request-derived settlement receipt. The test proves:

- intent CAS precedes dispatch;
- one convergence dispatch occurs;
- post-effect observation precedes settlement CAS;
- the exact eleven-field frozen projection reaches the command port;
- lost error text does not enter durable evidence; and
- terminal replay launches nothing.

This is logical exactly-once settlement over an at-least-once physical
boundary, not a claim that the operating system executed one process exactly
once.

## Immediate V73 recovery proof

Status V2 intentionally cannot distinguish every authorized crash residue from
foreign selector bytes. Do not widen V72's heuristics. The next slice should
bump `wharfie.service.status` to V3 and add one required read-only decision:

```json
{
  "desiredConvergence": {
    "schemaVersion": 1,
    "kind": "wharfie.service.desired-convergence",
    "appId": "app-id",
    "unit": "wharfie-app-id.service",
    "desired": {
      "artifactId": "artifact-id",
      "revisionId": "revision-id"
    },
    "disposition": "authorized",
    "basis": "durable-change"
  }
}
```

`disposition` is exactly `authorized | conflict | unknown`. Authorized basis
is exactly `physical-absence | durable-install | durable-change |
durable-active`; conflict/unknown use `null`.

The V64 manager should compute this under its existing operation lock without
mutation by joining activation, authorized release records, selector,
installation receipt, exact unit bytes, live manager wiring, and resident
runtime ownership. The root launcher must join the proof to its independently
verified desired SEA. The adapter then maps conflict/unknown directly,
authorized healthy state to settlement, and other authorized state to ready.

Until V73:

- exact prephysical first-install recovery works;
- completed convergence response loss works;
- selector/receipt/ACTIVE partial residue stays pending as unknown;
- non-ACTIVE stale-cache transition residue stays unknown; and
- positive foreign contradictions block.

## Validation and operational notes

Validation used Node
`/Users/josephvandrunen/.nvm/versions/node/v24.13.1/bin/node`.

The final focused run used `--runInBand --cache=false --coverage=false`:

```text
6 suites passed
244 tests passed
```

It covered bootstrap, privileged launcher, pure adapter, real V66 integration,
provider specification, and node resource. Source and test type checks,
changed-file ESLint, Prettier, `git diff --check`, and Bash syntax also passed.
No native LMDB test ran on this Mac. Coverage and Jest cache output were
removed immediately after validation.

Live AL2023 gates remain:

- account creation/replay and failure injection against real NSS tools;
- real systemd transient-unit, abstract-lock, lingering, and restart behavior;
- cgroup-BPF enforcement of the user-manager IMDS drop-in; and
- a complete disposable-node V66/V71/V72 activation.

Two low bootstrap residuals remain for a later hardening pass: SIGKILL between
`mktemp` and rename can leave an inactive root-only drop-in temp, and Bash
`read` does not itself distinguish additional empty trailing NSS fields
(normal glibc NSS is expected to reject malformed records first).

V71 immutable projection retention is still entry-count bounded without a byte
quota or final-version garbage collector.

## Resume instructions

Resume from `origin/agent/strict-manifest` after the V72 checkpoint commit that
adds this file. The implementation commit is
`16ed3cacf66834a945204f39007f4f509126d17a`.

Do not touch the historical stash:

```text
stash@{0}: WIP on master: 3dee66b work prompt
```

Do not run native LMDB on this Mac; previous native execution triggered an
allocator double-free. Keep focused Jest runs cache- and coverage-free, then
remove any recreated `jest_*`, Wharfie temp, coverage, or build outputs.

Implement V73 desired-convergence proof before application/control storage.
After V73, add the two retained-storage adapters, V3 health publication and
success receipt, then the production root host command/SEA and disposable
clean-account proof.
