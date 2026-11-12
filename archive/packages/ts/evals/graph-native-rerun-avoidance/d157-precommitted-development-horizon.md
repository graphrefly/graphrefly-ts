# D157 — precommitted development horizon

Status: package-local implementation and no-network qualification. No provider request, credential
access, browser action, spend, live generation, efficacy result, or held-out execution is authorized
or reported by this closeout.

## Architecture

D157 adds one finite registry containing development-1 through development-5. The only new
efficacy-eligible banks are development-4 and development-5, with five orthogonal mechanisms in
each. There is no development-6 registry entry or fallback generator.

Before any future provider qualification or campaign entry can proceed, both new manifests are
created in memory, checked against all five registered banks, written mode-0600 into one mode-0700
staging directory, fsynced, and published by one directory rename. The v3 receipt binds both slots,
task-set refs, manifest digests, D157, and its own canonical digest; the development-4 manifest also
binds the development-5 manifest digest, so the first future ledger entry pins the entire horizon.
An existing malformed or partial horizon fails closed and is never repaired in place.
The earlier v2 no-network materialization was rejected before any external capability because the
complete-history semantic audit found three development-5 mechanisms too close to historical
development-3 mechanisms. It is left untouched only as non-authoritative local residue; v3 neither
imports nor relies on it. The separately sealed v3 bank replaces those tasks; its receipt digest is
`sha256:2fbf99acecde8f1a4ffe3a494479e5ab7dfc1de2bee5f5947312dda7f6c5025b`.

Production preparation derives eligibility only from the canonical D145/D152 ledgers, checks that
exactly three development entries and no development-4 outcome state exist, acquires the existing
D152 execution lock, and rechecks the same authority before publication. The explicit test-only
preparation seam is unavailable outside `NODE_ENV=test`, requires an isolated manifest directory,
and is not imported by either external-capability runner.

Frozen development-1 through development-3 evidence predates D156's executable manifest shape.
D157 therefore separates two authorities: the historical reader checks those original bytes,
schema, task-set binding and digest for audit only; the executable reader still rejects them under
the current shape. Development-4 and development-5 must pass both the frozen-evidence audit and the
complete current executable contract. No historical manifest is rewritten or reopened for use.

The live campaign entry also checks ledger order and every prior ledger task-set/manifest digest.
Both live and provider-qualification entries only read and validate the pre-existing receipt; neither
can create it. Validation occurs before their control-plane, credential, or provider paths.
The consumed development-3 execution token remains unchanged and closed; a later live generation
still requires a new exact non-decision execution and spend grant.

The obsolete general manifest generator was removed because it could mint historical or
confirmatory slots outside the finite registry. D145-era recovery scripts remain historical forensic
utilities but are intentionally excluded from the D157 current executable closure; designing D152
recovery for both finite slots would require separate review rather than a compatibility shim.

## Acceptance matrix

| Requirement | No-network evidence |
|---|---|
| One immutable finite registry | Exact development-1..5 keys; ordinal 6 rejected |
| Five new mechanisms per bank | development-4/5 source and target frozen-workspace verifiers |
| Orthogonality and leakage control | Ten pairwise audits per current bank plus all-bank mechanism, fixture and hidden-verifier disjointness |
| Outcome-independent precommit | development-4 and development-5 share one atomic directory publication and v3 receipt; D4 also binds D5 |
| No late extension | development-6 manifest admission fails without creating a file |
| Historical integrity | pre-D156 bytes are audit-only; current executable reader rejects them; prior ledger digests are rechecked |
| External capability ordering | runners are receipt-read-only; validation precedes stage planning, settings, credentials and every request path |
| Private-file identity | same-handle no-follow read, exact mode-0600, one hard link and bounded size; symlink/hardlink mutations fail |
| Legacy closure | general generator removed; D145 recovery excluded as historical-only |
| Existing Eval architecture | root Graph, real Work Item/Agentic Memory composition and candidate-tool topology unchanged |
| Governance boundary | D157 implementation/no-network only; no provider, live, spend, model, protocol or public API change |

Ownership testing was skipped at the user's request. Delivery gates are reported in the final
handoff after the complete test, lint, build, artifact, authority and dashboard checks finish.
