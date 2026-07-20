# CLI

The shipped Wharfie source CLI lives here. Its top-level command groups are
`app` and `ops`. Durable source workflow creation is the flat command
`wharfie ops start --workflow <workflow-id> --idempotency-key <stable-key>`;
the packaged equivalent is `<app> wharfie start ...` and deliberately has no
`--dir` override. Only plans composed entirely of ordinary activity steps are
accepted today. Generic exact-run `inspect`, confirmed `recover`, and
evidence-backed `reconcile` are workflow-aware; workflow `cancel`, timers,
signals, and managed-effect successor steps remain unsupported.
