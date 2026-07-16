# 0002 — One recoverable authoritative coordinator

**Status:** Accepted · **Date:** 2026-07-16

## Context

Multiple simultaneous coordinators would add consensus and conflict-resolution complexity before Wharfie has proven a durable single-node execution model. A coordinator tied permanently to one process or host, however, would make the promised service stop when that machine fails.

## Decision

The initial distributed architecture has one coordinator that is authoritative at the durable-store boundary at a time, but no irreplaceable coordinator machine. A partitioned or paused process may continue believing it is leader and issuing messages; the protocol does not depend on stopping it.

Coordination truth lives in durable storage outside the coordinator process. Lease acquisition, renewal, and epoch increment are a single linearizable conditional operation evaluated against store-authoritative expiry. Scheduling decisions and commits carry the coordinator epoch. An attempt's fencing identity composes that epoch with a monotonically increasing generation scoped to its invocation. Durable storage rejects stale values.

After leadership expires, an eligible trusted node can acquire the next epoch, reconstruct the deployment from the ledger, and reschedule unfinished work. A previous coordinator that wakes up or survives a partition cannot commit current state.

The durability progression is:

1. SQLite or LMDB for local development and restart on the same durable volume.
2. Synchronously durable, re-attachable volumes for single-node restart or replacement. Snapshots are backup with an explicit recovery-point objective and can lose work committed after the snapshot.
3. A provider-backed linearizable transactional store for automatic coordinator replacement.
4. A peer-quorum control store only if later evidence justifies removing the provider dependency.

## Consequences

- The coordinator process can remain conceptually simple while failover correctness is explicit.
- Local-only state cannot claim automatic recovery after loss of its host.
- Every mutating path must carry and validate fencing information at the durable boundary; a heartbeat alone is insufficient.
- Provider-backed control state is an intentional initial dependency for safe automatic failover.
- Active-active scheduling is deferred and may never be needed.
