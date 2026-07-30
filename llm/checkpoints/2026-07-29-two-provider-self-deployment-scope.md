# Two-provider self-deployment implementation checkpoint

- **Date:** 2026-07-29
- **Status:** packaged local proof complete; live provider proofs pending
- **Branch:** `agent/two-provider-deploy`
- **Base commit:** `a2431716d72f15a1f53ec476690394623d14fa86`
- **Current proof commit:** `ae94fc8`
- **Decision:** [ADR 0035](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)

## Goal

Build the narrow product journey:

```text
deployment-capable app SEA + ambient AWS or Hetzner credentials
  -> read-only plan
  -> one trusted public Linux node
  -> exact verified Linux app SEA
  -> non-root persistent systemd service
  -> later durable inspection
  -> complete owned-resource cleanup
```

This is not general infrastructure as code. The initial topology has one
coordinator and one trusted node, with durable recovery after coordinator
process failure rather than automatic coordinator or node replacement.

## Current repository truth

- The single-host developer preview is accepted at proof commit `39be8d6`.
- `wharfie app package --self-deployable` now produces one operator SEA with an
  authenticated Linux x64 application SEA embedded inside it.
- The packaged `wharfie deployment apply` and `destroy` surface supports both
  `aws` and `hetzner`; packaged plan, inspect, reconcile, and update remain out
  of scope.
- AWS apply uses an explicit region and the ordinary credential chain. It
  references a qualifying default VPC and subnet, then owns one security group,
  EC2 instance, and encrypted delete-on-termination root volume.
- Hetzner apply uses an explicit location and ambient `HCLOUD_TOKEN`. It owns
  one firewall, primary IPv4, and server.
- Both providers durably fence mutations before sending them, recover ambiguous
  responses through deterministic identity and exact readback, fail closed on
  contradictory ownership, activate the embedded SEA through pinned SSH, and
  resume destroy from the journal.
- Destroy derives the provider region or location from exact durable authority
  instead of accepting a redirecting selector. Root-disk application and
  control data are deliberately destroyed with the preview node.
- The production AWS boundary was checked against installed AWS SDK request,
  response, credential-provider, and bundle shapes. A real-shape audit caught
  and fixed the separate `DescribeInstanceAttribute` reads required for stop
  protection, termination protection, and shutdown behavior.
- There is still no successful live AWS or Hetzner lifecycle proof. Default
  networking, account policy, provider behavior, SSH reachability, and cleanup
  therefore remain empirical release risks.

## Local packaged proof

The hello-world demo was rebuilt from the proof commit with:

```text
nvm use 24.13.1
node ../wharfie/bin/wharfie app package . --self-deployable --target node24.13.1-darwin-arm64 --output-dir ./dist --json --no-pretty
```

The resulting arm64 Mach-O operator SEA is 309,250,512 bytes with SHA-256
`ea980014b97a60d7f7a7aac01d2f128dc7d94060e02e1a48cf2b079223070408`.
It ran the ordinary hello application, exposed only packaged apply and destroy,
passed macOS code-signature verification, and reached the expected
credential-resolution failure for each provider under an isolated empty
environment. No live provider credentials were used.

Focused final validation passed 16 suites and 263 tests. Full source,
application, test, and SEA-verifier typechecks passed; full lint and package
content verification also passed. Test and package temporary payloads were
removed, leaving only the final demo SEA and its artifact record.

## Work next

1. Run a bounded live Hetzner hello-world apply, readiness check, coordinator
   restart recovery, and destroy; independently check provider cleanup.
2. Repeat the same bounded proof in a disposable AWS scope with a qualifying
   default public subnet.
3. Fix any empirical provider mismatch before expanding the public surface.
4. Add approachable preview/status/update/recovery commands only after both
   provider lifecycles pass.
5. Decide an explicit retained-data capability before claiming durability
   beyond the node root-disk lifecycle.
6. Delete or quarantine superseded general AWS graph code that does not serve
   this narrow lifecycle.

## Security and recovery defaults

- AWS credentials come only from the ordinary SDK chain.
- Hetzner credentials come only from `HCLOUD_TOKEN`.
- Provider credentials never reach the remote host or serialized evidence.
- SSH is limited to explicit IPv4 `/32` sources.
- A generated deployment client private key stays in owner-only local state.
- Initial SSH host authentication is pinned TOFU after provider-ID/address
  cross-check, not provider attestation.
- Provider creates recover through exact idempotency or ownership readback.
- Multiple or contradictory matches fail closed.
- Destroy purges all preview-owned billable resources; root-disk data is not
  retained.

## Stop conditions

Do not expand into persistent volumes, custom networks, object stores, general
provider plugins, multiple nodes, cloud application secrets, ingress beyond
restricted SSH, mesh enrollment, or coordinator leases before both bounded
single-node live proofs pass and clean up.
