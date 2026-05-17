/**
 * DS-14.7 — `reactiveFactStore` recipe library (follow-up #1).
 *
 * Eight shipped, tested compositions over the four extension faces (① plain fn,
 * ② `Node<Policy>`, ③ topic input, ④ topic-output subscribe). They mitigate the
 * factory's deliberate steeper learning curve (DS-14.7 PART 4.2) by packaging
 * the canonical patterns as first-class factories instead of register-as-hook
 * machinery — each is small, single-purpose, and copy-paste-modify friendly.
 *
 * | Recipe | Face | Closes |
 * |---|---|---|
 * | {@link scoringByOutcome}    | ② `scoring`        | Hassabis continual learning |
 * | {@link decayExponential}    | ③ `ingest` (timer) | Forgetting curve (the `decay` face is unwired in v1 — see its docs) |
 * | {@link consolidationRem}    | ① `consolidate`+③  | REM replay consolidation |
 * | {@link admissionLlmJudge}   | ② `admissionFilter`| LLM gatekeeper (sync-face adapter) |
 * | {@link shardByTenant}       | ① `shardBy`        | Multi-tenant isolation |
 * | {@link invalidationTracer}  | ④ `cascade`        | Cascade debugging (invisible-edge tracer) |
 * | {@link bitemporalQuery}     | ④ `factStore`      | MEME L3 "as of t" historical view |
 * | {@link influenceAnalysis}   | ④ `dependentsIndex`| MEME write-time blast-radius |
 *
 * **Lifecycle model — two shapes (intentional, not an inconsistency):**
 * - *Config-input / returned-projection* (`scoringByOutcome`, `admissionLlmJudge`,
 *   `consolidationRem`, `shardByTenant`, `bitemporalQuery`): produce a value
 *   the **caller or factory** owns — a `Node`/fn spread into config (the
 *   factory keepalives it transitively) or a view Node returned for the caller
 *   to subscribe (the `itemNode` precedent — no `keepalive`, so no forced
 *   retention; lifecycle follows the caller's subscription).
 * - *`mem`-attached observer/driver* (`decayExponential`, `invalidationTracer`,
 *   `influenceAnalysis`): self-`mem.add` + `keepalive` + disposer so they are
 *   `describe()`-visible and torn down on `mem.destroy()`.
 *
 * **Single-apply per store.** Attached recipes add fixed-named nodes;
 * `Graph.add` throws on a duplicate name. Apply an attached recipe more than
 * once on the same `mem` only with a distinct `opts.name`. `influenceOf(id)`
 * is memoized per-`id` (repeat calls return the same node — safe & idempotent).
 *
 * @module
 */

export {
	type AdmissionLlmJudgeOptions,
	admissionLlmJudge,
} from "./admission-llm-judge.js";
export {
	type BitemporalQueryOptions,
	bitemporalQuery,
} from "./bitemporal-query.js";
export {
	type ConsolidationRemConfig,
	type ConsolidationRemOptions,
	consolidationRem,
} from "./consolidation-rem.js";
export {
	type DecayExponentialOptions,
	decayExponential,
} from "./decay-exponential.js";
export {
	type InfluenceAnalysis,
	type InfluenceAnalysisOptions,
	type InfluenceRow,
	influenceAnalysis,
} from "./influence-analysis.js";
export {
	type InvalidationTraceEntry,
	type InvalidationTracerOptions,
	invalidationTracer,
} from "./invalidation-tracer.js";
export {
	type ScoringByOutcomeOptions,
	scoringByOutcome,
} from "./scoring-by-outcome.js";
export {
	type ShardByTenantConfig,
	type ShardByTenantOptions,
	shardByTenant,
} from "./shard-by-tenant.js";
