# Magnetic first-run experience

**Status:** Versioned release candidate · **Last updated:** 2026-08-06

This note defines Wharfie's north-star promise as a concrete first-run
experience. The authoring, packaging, storage, and foreground-resume surfaces,
canonical starter, and complete copied-starter harness are versioned here. The
repository gate runs them against Wharfie's packed npm tarball. Release
acceptance remains open until that same gate passes against the published
preview package.

## The product moment

The first compelling Wharfie demonstration should leave a developer able to
say:

> I wrote ordinary JavaScript, packaged it once, killed it halfway through,
> and the standalone executable resumed exactly where it left off.

Portable packaging is useful, but by itself it resembles an application
bundler. The combination of an ordinary CLI, one portable artifact, and
visible durable continuation is the distinctive Wharfie experience.

## Teach it in two steps

### 1. The smallest application

Keep one canonical hello-world application deliberately unsurprising:

- ordinary JavaScript with ordinary argv, stdout, and exit behavior;
- one small, readable manifest;
- no imports from a Wharfie source checkout;
- one local command, one test command, and one package command; and
- an artifact that runs after it is moved away from its source tree, with Node
  absent from `PATH`.

This application answers **"What is a Wharfie application?"** Its entire
authored application should fit on one screen, and every manifest field should
be explainable in the first read.

The canonical manifest is the complete beginner-facing contract:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  id: 'hello-world',
  main: './hello.js',
});
```

`defineApp()` expands that shorthand into the strict v4 manifest. The full
schema remains available when an application needs its additional controls.

### 2. The polished resumable showcase

Add one equally polished example that reuses the same application shape and
adds the minimum durable behavior needed to answer **"Why Wharfie?"**:

```text
prepare greeting -> wait on a durable timer -> print greeting
```

The showcase kills the foreground durable `run` process after
`prepare greeting`. Repeating the exact named command visibly continues from
the retained timer without preparing the greeting a second time. A graceful
`SIGINT` or `SIGTERM` separately drains without cancelling durable work and
prints that same resume command. The final result remains inspectable from a
later process.

This is a supported showcase, not a playground experiment. Messy probes,
failure injection, provenance tooling, and incomplete ideas should remain in a
separately labeled playground so they do not become part of the beginner's
mental model.

## Target journey

A repository checkout exposes its acceptance gate from the repository root:

```bash
npm ci
npm run verify:magnetic-first-run
```

A copied or published starter exposes its product journey from the starter
directory:

```bash
npm install
npm run demo
```

Both paths require exactly Node 24.13.1. The starter-level `demo` command may
orchestrate the product commands, but it must make those commands and their
results visible. An illustrative transcript is:

```text
  Resolving application and build target
  Preparing resumable-hello for <host-target>
  Building executable artifacts
  Publishing verified artifacts
✓ Packaged resumable-hello
  <host-target> · <size>
  <artifact>
Next: <artifact> wharfie run --name first-run --

$ WHARFIE_DATA_ROOT=<data-root> <artifact> wharfie run --name first-run -- Ada
• resumable-hello · new durable run first-run (<run-id>).
✓ prepare — committed
◷ wait — durable timer, 4.8s remaining
<foreground process receives SIGKILL>

$ <same command>
↻ Resuming first-run (<run-id>).
✓ prepare — retained; not run again
◷ wait — same durable timer, 1.2s remaining
✓ wait — committed
✓ say-hello — committed
✓ Completed first-run; result retained.
Hello, Ada!
```

The exact wording is not normative. The important sequence is authored source,
artifact creation, relocation, interruption, resumption, and an inspectable
result. A developer should reach that sequence in under two minutes on a warm
development machine.

## Experience requirements

### Minimize ceremony

- Installation and the first demo each have one obvious command.
- The beginner path does not expose custom provenance scripts, hand-built
  package tarballs, internal receipts, or repository-relative toolchain wiring.
- The default package command infers the host target. Cross-target packaging
  remains an explicit advanced operation.
- The smallest manifest is `defineApp({ id, main })`; the helper expands it to
  the strict runtime contract.
- Local execution does not require a second application entrypoint solely for
  Wharfie.
- The first durable handoff uses ordinary application arguments rather than
  requiring the user to construct workflow JSON or repeat internal IDs.
- One `WHARFIE_DATA_ROOT` keeps packaged execution and service stores under the
  same explicit root. Self-deployable cloud commands select their separate
  deployment journal with `--data-root`.

### Make the artifact feel approachable

- Packaging reports what it is doing, where the artifact was written, and its
  target and size. A matching supported macOS or glibc Linux host receives the
  exact next command. Windows SEA packaging is rejected until its runtime
  extraction boundary is supported.
- Human handoff is the package default; the stable v1 machine receipt is
  explicitly selected with `--json`. Compact callers use `--json --no-pretty`;
  bare `--no-pretty` implies JSON only as a compatibility bridge.
- The demo proves that the artifact works outside its source tree without an
  ambient Node installation or sibling Wharfie checkout.
- Ordinary artifact argv does not pay the native durable-runtime preparation
  cost; the reserved Wharfie path prepares it lazily.
- Artifact size and build time are tracked as product metrics. They should not
  become the first objection a developer has after the demo succeeds.

### Make durability visible and honest

- The interruption happens after one committed step and before the timer
  completes.
- Repeating the exact named foreground command resumes the run and does not
  repeat that committed step.
- The timer remains framework-owned state rather than a sleep hidden inside
  application code.
- The transcript distinguishes a resumed durable run from a new invocation.
- The example does not imply that arbitrary physical execution is exactly
  once; it demonstrates Wharfie's actual retained-state and recovery
  guarantees.

## Acceptance check

The showcase earns an experience-level acceptance when an automated harness
can prove all of the following from only a copied starter and an installed,
pinned Wharfie package:

1. Run the ordinary CLI and its tests.
2. Compile and display the application manifest.
3. Package exactly one host-target artifact.
4. Copy the artifact to a clean temporary directory and run it without source
   files or Node on `PATH`.
5. Start the named foreground durable greeting and observe its first committed
   step.
6. Interrupt the foreground process before the timer becomes due.
7. Repeat the exact command with the same artifact and data root.
8. Observe the greeting complete without the first step running twice.
9. Read and verify the retained terminal result from a later process with the
   explicit sensitive-output command.

The harness is evidence for the experience, not part of the application users
must understand.

**Versioned candidate gate:** `npm run verify:magnetic-first-run` packs
Wharfie, copies only `examples/hello-world` into a temporary workspace,
installs that tarball rather than linking a source checkout, and invokes the
starter's `npm run demo -- Ada`. The demo begins with the root two-field
manifest, packages the separate durable showcase, relocates one artifact,
hides the disposable copied builder and its installed dependencies, runs with
Node absent from `PATH`, kills the first foreground process with
`SIGKILL`, repeats the exact artifact/name/arguments/data-root command, proves
one physical preparation attempt and the original timer, and finally runs
`wharfie output --confirm-sensitive-output --json` from a later process to
verify `Hello, Ada!` as the retained terminal result. CI runs this gate in its
own visible job.

The 2026-08-06 versioned gate passed on Darwin arm64 against the locally
packed 0.0.15 candidate. Installation added 205 packages, packaging took 9.7
seconds and produced one 148.5 MiB artifact, and the relocated ordinary CLI
started in 1.764 seconds. The earlier 2026-08-01 external prototype established
the 119.0 MiB baseline before the final magnetic runtime slice.

## Dogfood baseline

The external hello-world dogfood project was evaluated on 2026-07-31. Its
canonical application was 24 authored lines and successfully passed local CLI,
test, manifest, package, relocated-artifact, and Node-absent execution checks.
That established a sound **B- / 7 out of 10** baseline.

The experience was not yet magnetic because installation expanded to 202 npm
packages (about 138 MB), the Darwin arm64 artifact was about 119 MB, the
private-package tarball and exact Node/npm pins were visible setup concerns,
and the canonical application demonstrated packaging but not Wharfie's durable
continuity.

The versioned implementation candidate addresses the product-side friction:
compact `defineApp()` authoring, automatic exact-host targeting for a
targetless manifest, human-first package output with an unchanged `--json`
receipt, lazy native-runtime preparation for ordinary argv, one
`WHARFIE_DATA_ROOT`, and the repeatable packaged
`wharfie run --name <name> -- <args>` foreground workflow. The consumer starter
requires exactly Node 24.13.1, matching the installed Wharfie package's engine,
without pinning an npm patch. The
canonical app, polished showcase, hidden harness, and explicitly noncanonical
playground now have separate in-repository boundaries.

The versioned path is an **A- / 9 out of 10 release candidate**: the beginner
path preserves the small application and adds the polished
interruption-and-resumption moment without presenting harness machinery as
application architecture. It earns that grade as a shipped experience only
after the same gate passes against the published preview.
The other main first-run objection is weight: this candidate installed 205 npm
packages and produced a 148.5 MiB Darwin executable.
