# V37 runtime-identity resource-graph checkpoint

Date: 2026-07-21
Branch: `agent/strict-manifest`
Remote parent preserved at:
`8bd0217ab1ca045151fe7adb4e24170eaab70678`

This checkpoint follows the
[V36 direct EC2 security-group resource checkpoint](./2026-07-21-v36-direct-ec2-security-group-resource.md).
It corrects the fixed graph boundary before any IAM driver is implemented.

## Product direction remains unchanged

Wharfie is a Node-first framework for turning approachable TypeScript CLI
programs with named activities into portable Node SEA executables that can run
locally, remain resident as durable workers, and coordinate work across trusted
machines without requiring Node, containers, Kubernetes, or a hosted
orchestration service at the destination.

The executable may use the operator's ordinary provider credentials to create
the resources required by Wharfie's fixed abstractions. This is not general
cloud IaC, v1 compatibility is abandoned, and there are no known downstream
users. Breaking internal APIs are allowed when they shorten the path to the
intended design. One coordinator is acceptable initially if its durable state
and fencing permit robust recovery after coordinator loss.

## Why the runtime identity is four effects

The previous graph modeled runtime identity as one `instance-profile` role.
Creating the usable AWS identity actually crosses four independently visible
provider effects:

1. create an IAM role;
2. put the role's least-privilege inline policy;
3. create an instance profile; and
4. associate the role with the profile.

A compound driver could complete any strict prefix of those effects and lose
its response or process before writing one durable binding. Recovery would
then have no graph-level intent or receipt for the partial provider state.
Wharfie therefore models each effect separately. Every mutation can now be
intended, observed, settled, retried, and reversed at its own durable action
boundary without claiming provider exactly-once execution.

## Fresh fixed graph

`AwsSingleNodeResourceGraphV2` uses domain
`wharfie:aws-single-node-resource-graph:v2`, prefix `wrg2`, and exact identity:

```text
wrg2_0nVAsGNMkDIrzYDO8vwXhI_NGwF_50XLJl-4b-HS-Hw
```

Its canonical apply order contains exactly 18 roles:

1. `artifact`
2. `application-state`
3. `control-state`
4. `network-vpc`
5. `network-internet-gateway`
6. `network-internet-gateway-attachment`
7. `network-subnet`
8. `network-route-table`
9. `network-default-ipv4-route`
10. `network-subnet-route-table-association`
11. `network-security-group`
12. `runtime-role`
13. `runtime-role-policy`
14. `runtime-identity`
15. `runtime-identity-role-association`
16. `substrate`
17. `application-state-attachment`
18. `control-state-attachment`

Destroy uses the exact reverse order.

The new role contracts are:

| Resource key | Role | Provider type | Ownership | Direct dependencies |
| --- | --- | --- | --- | --- |
| `runtime-role` | `role` | `iam-role` | direct | none |
| `runtime-role-policy` | `inline-policy` | `iam-role-inline-policy` | derived | `artifact`, `runtime-role` |
| `runtime-identity` | `instance-profile` | `instance-profile` | direct | none |
| `runtime-identity-role-association` | `instance-profile-role-association` | `iam-instance-profile-role-association` | derived | `runtime-role`, `runtime-role-policy`, `runtime-identity` |

All four effects are managed and purged. The resident `substrate` directly
depends on the policy, instance profile, and role/profile association in
addition to its existing artifact and network dependencies. This makes both
least-privilege policy installation and usable profile membership explicit
preconditions of EC2 creation.

## Authority namespaces

The fixed graph's meaning changed, so no V1 document or `wrg1` identity is
accepted as the current graph. `AwsSingleNodeProviderSpecV4` similarly moves to
domain `wharfie:aws-single-node-provider-spec:v4` and prefix `wap4` because it
pins the new graph.

The public profile/provider contract remains version 3. Plan/Action V3,
Inspection V4, Binding V2, and Head/Operation V2 keep their namespaces: their
serialized fields and meanings did not change, and their identities already
bind the changed provider specification, graph projections, or action payloads
transitively. There is no compatibility reader for the superseded graph or
provider-spec documents.

## Focused proof and disk hygiene

The graph tests pin all 18 exact resources, dependency order, reverse destroy
order, ownership modes, lifecycle, V2 content identity, and rejection of V1
schema or identity authority. Provider-spec tests pin V4/`wap4` and explicitly
reject V3/`wap3` authority. Graph-sensitive plan, binding, head, inspection,
health, controller, resolver, and control-store fixtures exercise the expanded
lineage. Health context validation recursively proves the complete transitive
dependency-binding closure rooted at `substrate`, with visited and cycle
guards, so internally consistent policy or association edges cannot hide a
malformed IAM-role binding.

Verification used pinned Node 24.13.1 with `--runInBand`,
`--coverage=false`, and `--no-cache`:

- broader graph-sensitive gate: 9 suites and 292 tests;
- final graph/provider-spec regression: 2 suites and 62 tests;
- recursive health-authority audit gate: 3 suites and 86 tests;
- all source, application, test, and SEA-verifier TypeScript configurations;
- targeted ESLint and Prettier checks; and
- `git diff --check` plus generated-artifact and repository-size scans.

No coverage tree, Jest cache, build tree, distribution tree, TypeScript
build-info file, or package tarball is retained by this slice.

## What is intentionally absent

- No IAM API is added to the AWS authority.
- No role, inline-policy, instance-profile, or association driver is
  implemented.
- Service-health remains V2; its context validator now recursively proves the
  graph-driven transitive dependency closure without changing receipt shape or
  identity.
- No provider router, production composition, operator command, or live AWS
  proof is added.

## Ordered next work

1. Advance service-health addressing/publication so the first receipt can be
   conditionally inserted without `s3:ListBucket` and one runtime identity can
   be authorized for exactly its own current object.
2. Define the exact IAM names, trust policy, inline permissions, intrinsic
   state digests, direct versus derived provider identities, and derived policy
   contract digest.
3. Extend the credential-bound authority with only the IAM and EC2 reads and
   IAM mutations required by those four roles.
4. Implement `runtime-role`, then `runtime-role-policy`, then
   `runtime-identity`, then `runtime-identity-role-association`, preserving
   graph order and independently recoverable settlement.
5. Continue with managed artifact publication, substrate creation, and the two
   volume attachments before composing the complete provider path.

## Copy-paste resume prompt

> Continue Wharfie from
> `llm/checkpoints/2026-07-21-v37-runtime-identity-resource-graph.md` on branch
> `agent/strict-manifest`. Use only the local git CLI; breaking changes are
> allowed and v1 compatibility is abandoned. The fixed graph is
> ResourceGraph V2/`wrg2` with 18 actions, and ProviderSpec V4/`wap4` pins it;
> downstream document namespaces remain unchanged. First close the exact
> service-health address and first-publication prerequisite, then implement the
> four IAM effects in graph order, beginning with the directly owned
> `runtime-role`.
> Keep every provider effect independently recoverable, run focused pinned
> Node tests with coverage and caches disabled, and remove generated artifacts.
