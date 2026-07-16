<h1 align="center">
  <img src="./docs/src/assets/svgs/beanie.svg" alt="Wharfie Beanie Logo" width="200">
  <br>
  Wharfie
  <br>
  <br>
</h1>

<p align="center">
  <a href="https://github.com/wharfie/wharfie/actions/workflows/ci.yml"><img src="https://github.com/wharfie/wharfie/actions/workflows/ci.yml/badge.svg" alt="Wharfie CI"></a>
</p>

> **Project reset:** Wharfie's v1 Athena/table implementation has been removed. Wharfie remains experimental, and breaking changes are expected while the new application model is made coherent.

Wharfie is a local-first TypeScript application runtime that turns an ordinary CLI into a portable executable, then lets that same application become a durable, observable service across trusted machines without an architectural rewrite.

The product goal is continuity:

1. Write and run a normal CLI locally.
2. Mark named operations as durable activities.
3. Package the application as one approachable executable.
4. Promote it to a persistent service on one machine.
5. Add schedules, workflows, retries, and durable state.
6. Enroll more trusted nodes when placement or resilience requires them.
7. Inspect, intervene in, update, and roll back the application through the same executable.

No separate service rewrite, preinstalled Node runtime, Dockerfile, Kubernetes cluster, or hosted orchestration service should be required on the target machine.

Inside a packaged application, normal argv belongs to the application. Wharfie
reserves only `<app> wharfie <command>` for operator commands; internal service
startup uses hidden environment-selected bootstrap instead of consuming public
commands.

Local and single-node use should require no external Wharfie control plane. The initial automatic coordinator-failover design does depend on a linearizable durable store.

The repository contains useful runtime and Node SEA packaging foundations. The
abandoned v1 source and dependency graph have been deleted, but the public
manifest, durable execution model, and release boundary still need focused
review. The npm package remains deliberately private. It is not ready for
production use.

## Start here

- [Project charter](PROJECT.md) — the canonical problem, scope, public concepts, boundaries, and success test.
- [Architecture decisions](docs/architecture/decisions/README.md) — accepted constraints on trusted nodes, coordination, provisioning, effects, and language boundaries.
- [Roadmap](ROADMAP.md) — the live ordered cleanup and implementation plan.
- [July 2026 checkpoint](llm/checkpoints/2026-07-16-project-reset.md) — immutable historical evidence of the pre-reset state and conversation handoff.
- [Packaging salvage checkpoint](llm/checkpoints/2026-07-16-packaging-salvage.md) — historical first implementation proof and the release blockers that existed before v1 deletion.
- [V1 deletion checkpoint](llm/checkpoints/2026-07-16-v1-deletion.md) — current restart point, verification evidence, remaining hard edges, and ordered next work.

The charter and accepted decisions are authoritative; the roadmap is expected to evolve, and dated checkpoints are historical snapshots. Older material under `docs/` and `llm/design/` describes prior iterations and can be stale.

## Current application contract

A source application is a default-exported plain object in `wharfie.app.js`.
The v2 boundary is deliberately small and strict:

```js
import { defineApp } from '@wharfie/wharfie/app';

export default defineApp({
  schemaVersion: 2,
  app: { id: 'my-app' },
  cli: {
    entrypoint: {
      kind: 'node',
      path: './src/cli.js',
      export: 'main',
    },
  },
  activities: {
    greet: {
      entrypoint: {
        kind: 'node',
        path: './src/activities/greet.js',
        export: 'greet',
      },
    },
  },
});
```

Application and activity IDs are lowercase kebab identifiers matching
`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`, with a maximum of 63 ASCII bytes. Wharfie
does not trim or rewrite them. The CLI is required; activities, resources, and
package targets are optional. Workflows and schedules are intentionally not in
this schema until their durable semantics are ready. Build credentials, signing
material, and extra asset configuration are also outside the public manifest.

See the [quickstart](docs/src/assets/markdown/quickstart.md) and [application
structure](docs/src/assets/markdown/project-structure.md) for the complete
authoring rules.

## Current development checks

Use the Node version in `engines` and the contributor npm version in
`packageManager` (currently Node 24.13.1 and npm 11.12.0), install dependencies,
and run:

```bash
npm ci
npm run test:ci
```

Current source is organized as follows:

- `src/cli/` — the current developer and operator CLI implementation.
- `src/core/` — runtime, durable graph, resource, provider, and packaging foundations.
- `apps/` — buildable reference and dogfood applications.
- `llm/` — design notes, prompt templates, and dated project checkpoints.
