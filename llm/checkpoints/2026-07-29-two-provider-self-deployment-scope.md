# Two-provider self-deployment implementation checkpoint

- **Date:** 2026-07-29
- **Status:** implementation started
- **Branch:** `agent/two-provider-deploy`
- **Base commit:** `a2431716d72f15a1f53ec476690394623d14fa86`
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

This is not general infrastructure as code and does not claim coordinator or
node replacement.

## Current repository truth

- The single-host developer preview is accepted at proof commit `39be8d6`.
- The current public deployment model is AWS-specific despite generic names.
- There are approximately 92 AWS deployment runtime files and roughly 74,000
  lines, with extensive mock evidence but no successful clean-account
  lifecycle.
- AWS bootstrap does not currently deliver, install, and prove the application
  service ready.
- The current graph requires DynamoDB, S3, IAM, custom networking, and retained
  EBS resources before proving one useful remote application.
- A Darwin SEA cannot run on Linux. Cross-platform self-deployment needs one
  separately bound Linux payload.

## Accepted implementation order

1. Introduce a secret-free two-provider deployment intent and small provider
   invocation contract.
2. Make plan strictly read-only and persist exact action intent before
   mutations.
3. Implement shared cloud-init and SSH host activation.
4. Implement Hetzner server/firewall/IP convergence and destroy. The generated
   SSH public key enters cloud-init only for the non-root runtime user; do not
   create a provider SSH-key resource that also grants the image's default
   account access.
5. Cut a live disposable Hetzner hello-world proof.
6. Implement reduced AWS instance/security-group convergence using an external
   default VPC/subnet.
7. Cut the equivalent live disposable AWS proof.
8. Package one local SEA containing one verified Linux x64 application payload
   and repeat both proofs from that SEA.
9. Delete or quarantine superseded AWS graph code.

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
