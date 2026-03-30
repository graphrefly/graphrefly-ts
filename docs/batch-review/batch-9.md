# Batch 9: TypeScript documentation audit rerun

Read first:
- `docs/docs-guidance.md`
- `docs/roadmap.md`

Also checked:
- `website/scripts/gen-api-docs.mjs`
- `examples/basic-counter.ts`
- `website/src/content/docs/api/*` (spot-check + generator check)
- `src/` exports in batch scope
- `../graphrefly/GRAPHREFLY-SPEC.md`
- `llms.txt` and `website/public/llms.txt`

---

## JSDoc completeness (required tags)

Interpretation used for this rerun:
- Required tags (`@param`, `@returns`, `@example`) were enforced for exported functions.
- Exported classes were checked for class-level description/example presence; constructor params are partially documented in some classes but not always in structured class-level tags.

COMPLETE — strong coverage in:
- `src/core/sugar.ts`
- `src/core/meta.ts`
- Most operator/source APIs in `src/extra/operators.ts` and `src/extra/sources.ts`
- `src/extra/reactive-map.ts`, `src/extra/reactive-log.ts` (except `logSlice`), `src/extra/reactive-index.ts`, `src/extra/reactive-list.ts`, `src/extra/pubsub.ts`
- `src/core/node.ts` `node`
- `src/graph/graph.ts` `Graph` has description + example

MISSING (`src/core/batch.ts:batch`) — missing `@returns`.

MISSING (`src/core/batch.ts:emitWithBatch`) — missing `@returns`.

MISSING (`src/core/messages.ts:isKnownMessageType`) — missing `@example`.

MISSING (`src/core/messages.ts:messageTier`) — missing `@example`.

MISSING (`src/core/messages.ts:isPhase2Message`) — missing `@example`.

MISSING (`src/core/messages.ts:isTerminalMessage`) — missing `@example`.

MISSING (`src/core/messages.ts:propagatesToMeta`) — missing `@example`.

MISSING (`src/core/guard.ts:GuardDenied`) — no class-level structured JSDoc (description/tags/example).

MISSING (`src/core/guard.ts:accessHintForGuard`) — missing structured tags (`@param`, `@returns`, `@example`).

MISSING (`src/graph/graph.ts:reachable`) — missing `@example`.

MISSING (`src/extra/resilience.ts:tokenBucket`) — missing `@example`.

MISSING (`src/extra/resilience.ts:tokenTracker`) — missing `@example`.

MISSING (`src/extra/resilience.ts:rateLimiter`) — missing `@example`.

MISSING (`src/extra/resilience.ts:withStatus`) — missing `@example`.

MISSING (`src/extra/backoff.ts:linear`) — missing `@example`.

MISSING (`src/extra/backoff.ts:exponential`) — missing `@example`.

MISSING (`src/extra/backoff.ts:fibonacci`) — missing `@example`.

MISSING (`src/extra/backoff.ts:decorrelatedJitter`) — missing `@example`.

MISSING (`src/extra/backoff.ts:withMaxAttempts`) — missing `@example`.

MISSING (`src/extra/backoff.ts:resolveBackoffPreset`) — missing `@example`.

MISSING (`src/extra/checkpoint.ts:saveGraphCheckpoint`) — missing `@returns`, missing `@example`.

MISSING (`src/extra/checkpoint.ts:restoreGraphCheckpoint`) — missing `@example`.

MISSING (`src/extra/checkpoint.ts:checkpointNodeValue`) — missing `@example`.

MISSING (`src/extra/checkpoint.ts:fromIDBRequest`) — missing `@example`.

MISSING (`src/extra/checkpoint.ts:fromIDBTransaction`) — missing `@example`.

MISSING (`src/extra/checkpoint.ts:saveGraphCheckpointIndexedDb`) — missing `@example`.

MISSING (`src/extra/checkpoint.ts:restoreGraphCheckpointIndexedDb`) — missing `@example`.

MISSING (`src/extra/cron.ts:parseCron`) — missing structured tags (`@param`, `@returns`, `@example`).

MISSING (`src/extra/cron.ts:matchesCron`) — missing structured tags (`@param`, `@returns`, `@example`).

MISSING (`src/extra/reactive-log.ts:logSlice`) — missing `@example`.

Note: `fromCron` overload declarations are not separate docs targets; implementation-level JSDoc is present.

---

## `gen-api-docs` registry coverage

`website/scripts/gen-api-docs.mjs` REGISTRY was compared against real exports in mapped files.

COMPLETE — no stale/extra REGISTRY keys were found (every registered key maps to an existing export in its configured file).

MISSING (registry coverage vs exports) — many exported symbols in audited files are not registered. Key callable/class gaps:
- `src/core/guard.ts:policy`
- `src/core/guard.ts:GuardDenied`
- `src/core/guard.ts:accessHintForGuard`
- `src/core/batch.ts:isBatching`
- `src/core/batch.ts:partitionForBatch`
- `src/core/batch.ts:emitWithBatch`
- `src/core/meta.ts:metaSnapshot`
- `src/core/meta.ts:describeNode`
- `src/extra/backoff.ts:decorrelatedJitter`
- `src/extra/backoff.ts:withMaxAttempts`
- `src/extra/cron.ts:parseCron`
- `src/extra/cron.ts:matchesCron`
- `src/graph/graph.ts:reachable`

(Type-only exports/constants are also unregistered; list above is focused on callable/class docs pages.)

---

## Generated API pages staleness (spot-check + check run)

`pnpm --filter @graphrefly/docs-site docs:gen:check` reports 8 stale generated pages.

STALE (`website/src/content/docs/api/switchMap.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/exhaustMap.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/concatMap.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/mergeMap.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/flatMap.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/circuitBreaker.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/reactiveMap.md`) — flagged stale by generator.

STALE (`website/src/content/docs/api/fromAny.md`) — flagged stale by generator.

Spot-checked pages (5 requested): `switchMap.md`, `mergeMap.md`, `circuitBreaker.md`, `reactiveMap.md`, `fromAny.md`; all are stale per generator check and need regeneration.

---

## Example audit (`examples/basic-counter.ts`)

COMPLETE — `examples/basic-counter.ts` uses current public API shape correctly:
- imports `DATA`, `state`, `derived`
- uses `node.subscribe(...)`
- emits via `count.push(...)`

MISSING (`examples/`) — areas that likely warrant dedicated runnable examples:
- `Graph` guard/actor-scoped `describe` + `observe`
- checkpoint adapters (`FileCheckpointAdapter`, `SqliteCheckpointAdapter`, IndexedDB helpers)
- structured observe/timeline/causal inspector options
- reactive data structures beyond counter-level quickstarts

---

## Roadmap checkboxes vs implementation state

COMPLETE — sampled checked roadmap items align with implementation:
- Phase 0.3b `dynamicNode` exists (`src/core/dynamic-node.ts` + tests)
- Graph persistence/introspection APIs exist (`snapshot`, `restore`, `fromSnapshot`, `toJSON`, `toJSONString`, `observe`, `describe`)
- Inspector gating exists (`Graph.inspectorEnabled`)
- `llms.txt` checked item aligns with files present

No clear false-positive checked item was found during this rerun in sampled implementation verification.

---

## Spec alignment (docs-relevant)

DIVERGENCE — no direct implementation-vs-spec divergences were identified in this rerun that require documentation correction beyond normal regeneration/doc coverage work.

Noted for doc context: spec and implementation both use `::` path qualification; no mismatch found in current `docs/roadmap.md` wording for that item.

---

## `llms.txt` existence and currency

COMPLETE — `llms.txt` exists at repo root and `website/public/llms.txt`.

STALE (`llms.txt`) — content is minimal and likely behind current user-facing surface (newer APIs/features are not enumerated; mostly pointer text).

STALE (`website/public/llms.txt`) — same content/currency concern as root file.
