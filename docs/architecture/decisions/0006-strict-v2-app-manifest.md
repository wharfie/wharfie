# 0006 — One strict version 2 application manifest

**Status:** Accepted · **Date:** 2026-07-16

## Context

Wharfie's reset needs one small public application model that can survive local execution, packaging, and later durable deployment without preserving v1 concepts. The previous compatibility loader accepted several unrelated authoring shapes, including actor-system instances, nested aliases, functions, workflows, scheduler configuration, and build options. Different consumers then derived different projections of an application. That made the serialized contract ambiguous and allowed packaging or runtime behavior that could not be reconstructed from one inspectable value.

The first portable proof needs less surface area: a developer-owned CLI, named activities, exact target inputs, and a finite set of portable resources. Durable workflows, schedules, deployment profiles, and provider fulfillment still need their own designs. They should not be smuggled through permissive manifest fields while those designs remain unsettled.

## Decision

`wharfie.app.js` default-exports one plain-data object with an explicit `schemaVersion: 2`. One source compiler validates that object and produces one JSON-compatible canonical runtime manifest. Embedded, loaded, and externally supplied manifests pass through the same canonical validator. Unknown fields, aliases, lossy normalization, accessors, non-data values, and unsupported schema versions are rejected rather than translated.

The version 2 manifest has these boundaries:

- `app.id` is the sole application identity. Application and activity IDs use the canonical logical-ID grammar `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$` and are at most 63 ASCII bytes. Inputs are rejected rather than trimmed or case-folded.
- Every application has a developer-owned CLI entrypoint. CLI and activity entrypoints are explicitly `{ kind: 'node', path, export }`. Authored paths are app-relative, must resolve to existing files inside the application directory without symbolic-link escape, and become normalized relative paths in the canonical manifest.
- Targets are optional but exact when declared: an exact Node semantic version, `darwin`, `linux`, or `win32`, `arm64` or `x64`, and explicit `libc: 'glibc'` for Linux. Wharfie does not silently select target defaults in the manifest compiler.
- Portable resource declarations are limited to the exact versioned adapter shapes currently understood by Wharfie: `db` with `vanilla` or `dynamodb`, `queue` with `vanilla` or `sqs`, and `objectStorage` with `vanilla` or `s3`. Adapter options are exact data fields, not arbitrary provider configuration.
- Target-specific external activity packages use exact, canonically ordered `{ name, version }` records. Version ranges and package-manager tags are not manifest inputs.
- The public manifest does not accept `ActorSystem` graphs, workflow definitions, scheduler configuration, provider infrastructure graphs, credentials, secrets, or compatibility names such as `name`, `functions`, and `capabilities`. Actor systems may remain private implementation machinery, but are not an application-authoring model.
- Signing, additional packaged assets, and other build-host settings are packaging inputs, separate from the runtime application manifest.

TypeScript/Node remains the only application-authoring model for this schema. Node-API packages can supply target-specific native hot paths now. Future versions can add WASI/WASM or subprocess-backed activity entrypoint kinds behind the versioned activity protocol described in [0005](0005-typescript-and-component-boundary.md), without making version 2 a general multi-language build format.

## Consequences

- A manifest printed for inspection is the same application contract embedded in an artifact and consumed by the runtime.
- Packaging and runtime consumers can fail at one validation boundary instead of carrying compatibility branches and partially normalized shapes.
- Application source stays approachable and ordinary while remaining deterministic enough to serialize, inspect, and bind to future immutable revisions.
- Workflows, schedules, revisions, deployment profiles, and provider fulfillment must gain explicit versioned contracts before becoming public authoring surface.
- Adding a field or entrypoint kind is a schema decision. Unsupported inputs fail loudly; there is no v1 fallback or backward-compatibility promise during the reset.
