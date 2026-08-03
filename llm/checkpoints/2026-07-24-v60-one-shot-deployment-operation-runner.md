# V60 one-shot deployment operation runner checkpoint

Date: 2026-07-24

Parent:
[V59 read-only deployment inspection](./2026-07-24-v59-read-only-deployment-inspection.md)

## Restart summary

Wharfie's first golden path remains one approachable TypeScript/Node SEA that
can run locally, become a durable single-node AWS service through the user's
ordinary credential chain, and later be inspected, reconciled, updated, or
destroyed without a hosted orchestrator. Nodes are trusted. One coordinator is
acceptable initially, provided its durable authority is recoverable. V1,
backward compatibility, trustless mesh, general-purpose cloud IaC, and a web UI
remain outside the current scope.

V59 completed the invocation-owned AWS lifetime and read-only deployment
inspection. V60 adds a finite non-callback operation runner around that
invocation. It makes retained-control policy explicit, admits exactly one
controller operation, and owns unconditional invocation cleanup without yet
mounting a CLI or weakening artifact identity.

## Exact request and finite dispatch

`runAwsSingleNodeDeploymentOperation()` accepts one exact four-key request:

- `region`;
- `controlPolicy`;
- `operation`; and
- `input`.

The three supported control policies are:

- `require-active`, which calls the invocation's read-only `requireControl`;
- `reconcile-existing`, which calls its existing-only `reconcileControl`; and
- `bootstrap`, which calls its explicitly create-capable `bootstrapControl`.

The four supported operations are `inspect`, `plan`, `converge`, and `resume`.
After policy preparation, the runner calls exactly the selected invocation
method with the request input and returns that method's result unchanged. The
runner never exposes the invocation, accepts no callback, and cannot admit a
second controller operation in the same lifetime.

The controller operation still performs its own fresh require-active
preflight. This is deliberate. Reconcile or bootstrap prepares the retained
controls; the operation's later read closes disappearance between preparation
and controller work.

## Admission snapshot

The public runner is intentionally not declared `async`. Before calling the
credential-opening boundary, it synchronously validates and
descriptor-snapshots the exact top-level request. It independently deep-clones
and freezes the complete JSON operation input.

Symbols, accessors, non-enumerable properties, class instances, extra or
missing top-level keys, non-JSON nested values, and empty or padded regions are
rejected before opening credentials. Later caller mutation cannot redirect
either the selected policy or the admitted controller input.

The credential opener is a closed module dependency rather than a public
callback seam. Its result must be the exact frozen ten-key AWS invocation
surface before ownership transfers to the runner. Every method is captured as
an enumerable own data property before policy work and invoked with the
invocation as its receiver.

## Cleanup and failure precedence

Once an opener result passes the exact frozen invocation validation and
ownership transfers, the runner closes it exactly once after policy or
operation settlement. Close never begins while controller work is still
pending. A malformed opener result is rejected before ownership and its
methods, including `close`, are never invoked.

Failure precedence is fixed:

- operation success plus close success returns the exact operation result;
- operation or policy failure plus close success throws the original primary
  failure unchanged;
- operation success plus close failure throws the close failure unchanged;
- simultaneous primary and close failures throw one AggregateError whose
  `errors` are `[primaryError, closeError]`; and
- invocation-open failure or malformed opener result performs no runner-owned
  close because no invocation was transferred.

The bookkeeping uses explicit settlement booleans rather than an `undefined`
sentinel, so even undefined or non-Error rejection reasons retain this exact
precedence.

## Selected-SEA boundary remains next

V60 does not claim source-mode artifact authority. The current artifact stager
still opens and validates the running executable and its embedded
revision/runtime pair. Under Node source execution that executable is Node,
not the application SEA, so source apply or reconcile must continue to fail
closed.

The next slice must mint one non-serializable, one-shot selected-SEA capability
directly from a fresh in-process `packageLocalApp()` result and a held artifact
descriptor. That fresh builder result is currently the only source-side
authority that binds successful SEA generation—including the deterministic
embedded revision and runtime assets—to exact final bytes.

An arbitrary executable path plus ArtifactRecord sidecar is deliberately
insufficient. The sidecar is unsigned and does not retain the build
generation's embedded-asset evidence, and Wharfie has no static arbitrary or
off-target Node SEA asset extractor. A future generic import boundary therefore
needs either static extraction or a signed/attested persisted generation
receipt.

Source and packaged `plan`, `apply`, `inspect`, `reconcile`, and `destroy`
commands remain unmounted until that capability exists. A standalone source
plan must also persist its content-addressed selected SEA for later converge;
reproducible rebuilds are not currently claimed. Source reconcile must select
the exact existing artifact rather than silently rebuilding a different
revision.

## Other explicit non-claims

V60 also does not provide:

- guest formatting, mounting, quiescence, artifact installation, or resident
  service projection;
- the privileged host observer and publisher or live STS role/session proof;
- external-resource configuration;
- fresh apply from a retained-binding DESTROYED tombstone;
- clean-account lifecycle proof; or
- provider API-call or lifetime-effect exactly-once execution.

## Verification and disk hygiene

Final assembled verification passed:

- focused V60 runner suite: **1 suite, 53 tests, 0 snapshots** in **0.278
  seconds**;
- complete deployment regression gate: **78 suites, 2,787 tests, 0
  snapshots** in **303.635 seconds**;
- all four TypeScript configurations passed with `--noEmit`;
- full repository ESLint passed with zero warnings;
- repository JavaScript/JSON and changed-document Prettier checks passed;
- `git diff --check` passed; and
- the artifact scan excluding `node_modules` found no coverage, dist, build,
  cache, TypeScript build-info, or package archive output.

Both Jest gates used pinned Node 24.13.1, serial execution, no coverage, and no
Jest cache. The repository occupied **524 MB**, including **249 MB** for
`node_modules`, after verification. The historical
`stash@{0}: WIP on master: 3dee66b work prompt` remained untouched.
