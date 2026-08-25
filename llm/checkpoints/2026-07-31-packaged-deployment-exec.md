# Packaged journal-bound remote execution checkpoint

- **Date:** 2026-07-31
- **Status:** provider-free remote application execution implemented
- **Branch:** `agent/two-provider-deploy`
- **Starting commit:** `a1f97ca09bccb9fa797925cf51b6cbf394b60ba8`
- **Implementation commit:** the commit containing this checkpoint
- **Decision:**
  [ADR 0035](../../docs/architecture/decisions/0035-two-provider-single-node-self-deployment.md)

## Goal

Make an existing cloud deployment usable through the local application SEA,
without exposing a generic SSH shell or requiring provider credentials:

```text
<app> wharfie deployment exec --deployment-instance <id> [--data-root <absolute>] [-- <application argv...>]
```

The command runs the exact journal-authorized active application artifact. An
empty application argv is valid. Arguments after `--` retain ordinary argv
semantics, including values that begin with `-`.

## Authority and transport boundary

Before executing application code, the command proves all of the following:

1. existing local authority belongs to the embedded application and is in the
   durable `active` phase;
2. the private SSH identity still reproduces the journal-bound cloud-init
   digest;
3. the locally pinned Ed25519 host key matches the journal;
4. the remote bootstrap identity exactly matches the deployment instance,
   incarnation, runtime account, and SSH public-key fingerprint; and
5. the journal-pinned artifact reports the exact expected healthy durable
   service release.

Only then does the strict OpenSSH transport execute
`[journal.activation.artifact.remotePath, ...applicationArgv]`. The caller
cannot choose an executable, SSH user, host, port, option, shell fragment, or
stdin stream. The transport single-quotes every argv element and applies
finite duration and output bounds.

The command performs no provider reads or mutations. It neither reads the
embedded Linux payload nor accepts AWS or Hetzner credential selectors.

## Output semantics

An exact observed remote exit relays bounded stdout and stderr bytes without
JSON or text rewriting and uses the remote exit code locally, including a
nonzero application exit. A timeout, truncation, signal-only result, or other
ambiguous transport outcome fails closed and does not expose a potentially
misleading partial output as a completed command.

## Automated evidence

Under the repository-pinned Node 24.13.1:

- 70 focused runtime and packaged-command tests passed without a Jest cache;
- the source and test typechecks passed; and
- focused ESLint and Prettier checks passed.

No SEA, VM, cloud resource, coverage tree, or retained test/build artifact was
created for this checkpoint.

## Proof boundary and work next

This checkpoint proves the provider-free execution contract with exact mocked
SSH/process boundaries. It does not claim a new live AWS or Hetzner continuity
run. The prior live proofs invoked the guest manually and did not carry an
unfinished durable run across cloud reboot.

Next, add a provider-neutral durable release transition plus packaged
`deployment update` and `deployment recover`. After that surface is stable,
run the bounded two-provider sequence through packaged commands: apply,
status, remote durable submission, fresh-process inspection, reboot, output,
update/recovery, destroy, and independently verified cleanup.
