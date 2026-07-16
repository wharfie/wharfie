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

> **Project reset:** Wharfie is experimental and is intentionally abandoning its v1 Athena/table APIs. Breaking changes are expected while the new application model is made coherent.

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

Local and single-node use should require no external Wharfie control plane. The initial automatic coordinator-failover design does depend on a linearizable durable store.

The repository contains useful v2 runtime and Node SEA packaging foundations, but its release wiring and several implementation paths are still being consolidated. It is not ready for production use.

## Start here

- [Project charter](PROJECT.md) — the canonical problem, scope, public concepts, boundaries, and success test.
- [Architecture decisions](docs/architecture/decisions/README.md) — accepted constraints on trusted nodes, coordination, provisioning, effects, and language boundaries.
- [Roadmap](ROADMAP.md) — the live ordered cleanup and implementation plan.
- [July 2026 checkpoint](llm/checkpoints/2026-07-16-project-reset.md) — immutable historical evidence of the pre-reset state and conversation handoff.

The charter and accepted decisions are authoritative; the roadmap is expected to evolve, and dated checkpoints are historical snapshots. Older material under `docs/` and `llm/design/` describes prior iterations and can be stale.

## Current development checks

Use the pinned versions in `package.json` (currently Node 24.13.1 and npm 11.12.0), install dependencies, and run:

```bash
npm run test:ci
```

Current source is organized as follows:

- `src/cli/` — the current developer and operator CLI implementation.
- `src/core/` — runtime, durable graph, resource, provider, and packaging foundations.
- `apps/` — buildable reference and dogfood applications; v1 content is scheduled for removal.
- `llm/` — design notes, prompt templates, and dated project checkpoints.
