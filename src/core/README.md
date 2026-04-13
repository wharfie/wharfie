# Core

The previous runtime tree has been flattened into a clearer layout:

- `actors/` keeps serialization helpers and actor-specific support code.
- `resources/` keeps resource abstractions and build artifacts.
- `runtime/` keeps runtime service orchestration.
- `lib/` holds the remaining shared subsystems: db, graph, queue, object storage, AWS helpers, code execution, and similar cross-cutting utilities.
