# Deployment journal capacity

Run the local near-limit acceptance proof from a checkout using the pinned Node
version:

```sh
node scripts/verify-deployment-journal-capacity.js \
  --report /absolute/new/journal-capacity-report.json
```

The report destination must be new. Without `--report`, the supervisor chooses
a temporary report path and prints it before starting. An independent 45-minute
deadline bounds the worker; its owned temporary journal files are removed after
success, failure, or forced termination. The bounded report survives cleanup.

The proof seeds a valid history close to the 4,096-record limit, then uses fresh
production filesystem stores and update, recovery, and destruction coordinators
to verify:

- An interrupted final allowed update recovers from a fresh controller.
- New updates refuse before remote mutation or any journal write when the
  update budget reaches the 32-record recovery reserve.
- Recovery of the current release remains available without extra journal writes.
- Interrupted destruction resumes from a fresh controller and completes within
  the reserved records.
- Refused operations preserve the exact journal bytes and the owned fixture is
  removed at the end.

This is local evidence: provider and remote activation operations are injected,
and no cloud resources or credentials are used. The report records operation
durations, byte and record counts, refusal checks, and cleanup results. Cloud
soaks and packaged lifecycle acceptance provide separate evidence.

Journal validation reuses only exact immutable objects returned by a successful
complete-document validation in the current process. Mutable inputs, copies,
and newly parsed disk records still receive full validation. Every store read
and commit rereads disk history and verifies canonical bytes, predecessor links,
and allowed transitions. This optimization changes neither the stored journal
format nor its record limits or recovery reserve.
