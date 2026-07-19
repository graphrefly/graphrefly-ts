# @graphrefly/ts

## 0.4.1

### Patch Changes

- 058bf08: Accept bounded canonical tuple identifiers produced by GraphReFly admission authority when validating managed PostgreSQL proposal source references and exact authorization coordinates.

## 0.4.0

### Minor Changes

- 1264045: Revise the managed-cloud PostgreSQL driver compatibility, control-store schema, and worker wire contracts to v2. Attempt credential drivers now use a two-phase prepare/cleanup seam around host-owned workload execution and receive the exact D419 admission envelope plus a clock-correlated D618 authorization result, including principal/session, tenant/workspace, resource, policy/model, request/route, admission, run and attempt coordinates. Credential execution requires a host-validated issued/injected prefix, active lifecycle facts carry one immutable effective-use cutoff equal to the admitted attempt deadline, per-lease lifecycle transitions and streamed settlement prefixes are fenced, pre-injection cleanup uncertainty is represented explicitly, and store/wire boundaries reject stale or forged v1 material.

## 0.3.0

### Minor Changes

- 5f980a7: update blueprint to v2
- 6bb2f1b: Emit GraphBlueprint v2 with stable graph-owned subgraph mount identities, retain strict v1 evidence reads, and add portable parsing, caller-owned hash verification, Blueprint-direct Mermaid rendering, and deterministic fail-closed structural deltas for repository review tools.

## 0.2.2

### Patch Changes

- 7e3646f: Add the focused ClickHouse trusted-query evaluation subpath with D610-aligned contracts and a host-injected ordinary-D419 execution, outcome, timeout, and admitted-cancellation runtime.

## 0.2.1

### Patch Changes

- 11c52f6: Add the focused ClickHouse trusted-query evaluation subpath for D610-aligned campaign and scenario result contracts.
- d003d0f: add clickhouse surface

## 0.2.0

### Minor Changes

- 9a67c58: new focused executor/runtime/certification surface

## 0.1.1

### Patch Changes

- d8a9650: update readme

## 0.1.0

### Minor Changes

- b74069f: add agentic memory solution

## 0.0.3

### Patch Changes

- 666225e: update document
