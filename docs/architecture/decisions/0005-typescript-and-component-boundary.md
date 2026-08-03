# 0005 — TypeScript control plane with a component boundary

**Status:** Accepted · **Date:** 2026-07-16

## Context

TypeScript and Node provide the shortest authoring path for the intended CLI-first experience and for software produced in coding sessions. Some Wharfie internals and user activities will eventually need faster execution, stronger isolation, or libraries written in Rust, Go, Zig, or another language. Supporting several equal application models now would multiply packaging, schema, debugging, and runtime complexity.

## Decision

TypeScript/Node is the sole initial application-authoring and orchestration model. Commands, manifests, workflows, schemas, deployment requirements, and inspection APIs use that model.

Named activities form a versioned, serializable component boundary. Handler implementations may be:

1. in-process JavaScript, the default, with target-specific Node-API modules available as implementation dependencies;
2. WASI/WASM modules, the preferred portable hot-path escape hatch; or
3. persistent subprocess workers speaking a small Wharfie activity protocol.

WASM and subprocess handlers use the serialized activity protocol. Their effect operations are mediated by the Wharfie host; component workers do not receive coordinator or provider credentials.

Runs bind immutable application revisions, including handler artifacts. Native handlers can require a platform artifact matrix; WASM is the portable option. Build steps outside Wharfie may produce these artifacts, and Wharfie validates and packages the outputs.

## Consequences

- There is one public authoring and control-plane story to learn and document.
- The activity protocol must define serialization, cancellation, deadlines, logging, errors, and effect access without depending on JavaScript function calls.
- Wharfie is not a general multi-language build system.
- A faster-language implementation can be introduced where measurements justify it without changing workflow semantics.
- Dynamic LLM-generated code is not evaluated inside the coordinator; it becomes part of an immutable revision first.
