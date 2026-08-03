# 0003 — Capability fulfillment, not general IaC

**Status:** Accepted · **Date:** 2026-07-16

## Context

A portable Wharfie executable should be able to become a durable service in a clean environment. That requires machines, state, artifacts, identity, networking, and sometimes ingress. Exposing arbitrary provider resource graphs would turn Wharfie into another infrastructure-as-code system and erase the portability of the application model.

## Decision

Applications declare a finite set of portable Wharfie runtime capabilities. Deployment profiles bind those requirements to provider-specific choices. Provider drivers plan, apply, inspect, reconcile, and destroy only resources that implement those capabilities.

Initial capability families include:

- nodes and placement constraints;
- durable application state;
- control state with linearizable conditional writes, transactions, store-authoritative lease expiry, and fencing validation;
- artifact storage;
- runtime identity and secret references;
- networking; and
- optional ingress.

Provider-native application resources are outside this model. For example, an application requests durable key/value application state from Wharfie; a custom DynamoDB schema with provider-specific indexes belongs in application code or external IaC. Control state is a distinct capability with stronger semantics than generic durable key/value storage. An external control store must be validated against that semantic contract.

Every proposed change is represented by a plan, while acknowledging values that a provider cannot know until apply time. `apply`, `reconcile`, and `destroy` are retry-safe and revalidate drift, resource identity, and ownership when they execute. The provider's normal credential chain supplies operator credentials at deploy time; broad credentials are never embedded in the artifact. A deployment records ownership receipts, distinguishes managed resources from external references, bootstraps narrowly scoped runtime identities, and destroys only resources it owns.

## Consequences

- The executable can self-deploy without claiming to model a whole cloud account.
- Capability contracts must stay small, versioned, and portable even when providers expose richer options.
- Some provider-specific tuning belongs in deployment profiles, but provider-native resource topology cannot leak into the application manifest.
- Users remain free to provide external resources or run separate IaC alongside Wharfie.
