---
"@graphrefly/ts": minor
---

Revise the managed-cloud PostgreSQL driver compatibility, control-store schema, and worker wire contracts to v2. Attempt credential drivers now use a two-phase prepare/cleanup seam around host-owned workload execution and receive the exact D419 admission envelope plus a clock-correlated D618 authorization result, including principal/session, tenant/workspace, resource, policy/model, request/route, admission, run and attempt coordinates. Credential execution requires a host-validated issued/injected prefix, active lifecycle facts carry one immutable effective-use cutoff equal to the admitted attempt deadline, per-lease lifecycle transitions and streamed settlement prefixes are fenced, pre-injection cleanup uncertainty is represented explicitly, and store/wire boundaries reject stale or forged v1 material.
