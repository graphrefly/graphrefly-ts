---
SESSION: rigor-infrastructure-plan
DATE: 2026-04-14
TOPIC: Rigor infrastructure for LLM-usable lower layers — property-based testing, TLA+ core spec, executable TS↔PY contract; parity mitigation without Rust/WASM
REPO: graphrefly-ts (primary), graphrefly-py (parity scope)
---

## CONTEXT

Following Wave 1, Wave 2, and the in-progress Wave 3 audits of the extras layer, a strategic question surfaced: is the foundation over-engineered, and will it pay off relative to the harness-engineering goals in `SESSION-harness-engineering-strategy.md` and the universal-reduction thesis in `SESSION-universal-reduction-layer.md`?

### The real worry

Not raw complexity — but **semantic cracks between layers**. The V4 redesign introduced contradictions between comments, composition guide, and code that forced each new contributor (human or LLM) to dig into internals to find the source of truth. Higher-level blocks built on top accumulated defensive workarounds. Debug time on subtle bugs (e.g. the fast-check-caught infinite loop, Wave 1 `mergeMap` ERROR leak, Wave 3 `withStatus` P3 recovery race) routinely ran 10× what they should have. Each semantic crack compounds when composing higher-level blocks.

### The actual goal

Make GraphReFly's lower two layers (core + extras) **semantically airtight enough that an LLM composing higher-level blocks on top never needs to dig into source to resolve contradictions.** Docs, comments, tests, TLA+ spec, and code must all agree. This is the LLM-usability thesis restated operationally: the substrate is trustworthy, so the composition task is about intent and topology, not about low-level protocol archaeology.

### Correctness benchmark

GraphReFly is not competing with PostgreSQL on rigor — that's the wrong benchmark and unreachable via hand audits. The bar that matters is:

- No silent data corruption
- Visible errors with usable causal context
- Deterministic replay from checkpoint
- No glitches in diamond topologies
- No leaked subscriptions / infinite loops

The bug rate from Wave 1 → Wave 2 → Wave 3 is not trending to zero (Wave 2's bugs were *introduced by* the V4 → V5 foundation redesign itself). That signals the audit-only approach has diminishing returns. Formal methods + property-based testing scale where hand audits don't.

---

## DECISIONS

### 1. Split audit bar into two tiers

- **Tier A — user-observable bug.** Fix immediately. Example from today: `withStatus` P3 recovery race (ERROR then DATA in same batch misses recovery branch), `fallback` double DATA on stateful fb node. Both fixed in this session.
- **Tier B — invariant violation that works today under the sync runner.** Log in `docs/optimizations.md`, defer until it breaks something observable OR until the invariant is encoded in the fast-check harness (Project 1) and fails automatically.

Rationale: Tier B has accumulated faster than user-observable bugs. Deferring them trades "audit every edge case" for "ship the differentiator blocks during the harness-engineering window (April–June 2026 per `SESSION-harness-engineering-strategy.md`)."

### 2. Three rigor infrastructure projects

**Project 1 — Property-based protocol harness (`fast-check`)**

Generator-based test suite producing random small topologies (3–10 nodes, mixed operators) and random event sequences, asserting protocol invariants at each step.

Invariants to encode (each becomes one property):

- No DATA without a preceding DIRTY in the same wave
- RESOLVED settles exactly the wave that dirtied it — no leaks across waves
- Terminal monotonicity: after COMPLETE/ERROR, no further DATA/DIRTY
- Diamond resolution: fan-in converges to exactly one settlement per wave
- Equals-substitution: suppressed DATA becomes RESOLVED, never silence
- Version counter monotonicity: `advanceVersion` fires once per observable cache change
- START handshake: first batch to a new subscriber is exactly `[[START]]` or `[[START],[DATA,v]]`
- Batch drain atomicity: partial drain under nested throw preserves queue order
- Subscribe/unsubscribe reentry: unsub inside a subscribe callback is safe and leaves no dangling refs

**Why it catches what hand audits miss.** The Wave 1–3 bugs (mergeMap ERROR leak, firstValueFrom queueMicrotask, withStatus recovery race, fallback double DATA, the fast-check infinite loop) all violate one of the invariants above. Hand audits find them one at a time by reading code; fast-check finds the class.

**Cost.** ~1–2 weeks for the harness and first 5 invariants. Each subsequent invariant ~1 day.

**LLM-usability payoff.** The invariant list is the substrate contract LLMs need. An LLM composing a higher-level block can reason "does my composition break any of these 9 invariants?" from a finite list rather than from operator-by-operator narrative docs.

**Project 2 — TS↔PY executable contract (kills parity audits)**

Shared `.jsonl` trace format encoding: topology spec (language-neutral vocabulary), event sequence, expected output trace. Both repos ship a trace replayer. CI in both repos runs the same fixture set. Any divergence is automatic parity failure.

Workflow shift: bugs found in either language add a fixture to the shared repo; the other language's CI immediately catches whether it has the same bug. Parity becomes green CI, not quarterly audit session.

**Scope constraint.** The vocabulary only covers operators/sources with defined cross-language behavior. Language-specific features (Python `RLock`, TS `setTimeout`) stay out. Divergence becomes visible and intentional.

**Cost.** ~1 week for replayer in each language + initial vocabulary. Fixtures grow organically thereafter.

**LLM-usability payoff.** The shared fixture set doubles as a behavior spec: "with this input, you get this output." LLMs generating GraphSpecs can be validated against the trace replayer.

**Timing.** **Wait until the graph-level audit is done.** The trace format encodes subscriber output, which the graph audit may still reshape. Locking in too early means re-encoding fixtures.

**Project 3 — Tiny TLA+ spec of the wave protocol**

~100-line TLA+ module modeling ONLY the core protocol:

- State = set of nodes with cache+status, in-flight message queues per edge
- Actions = `Emit`, `DirtyPropagate`, `SettleWave`, `DiamondResolve`, `Terminate`
- Invariants = same list as Project 1

TLC model checker exhaustively explores state sequences for small graphs (3–5 nodes, 2–3 steps deep). Runs in seconds. Either finds a counter-example or confirms the protocol is sound at that scale.

**Why it matters beyond fast-check.** fast-check samples randomly; TLC explores exhaustively. For the core protocol (small state space), exhaustive is achievable. fast-check + TLC together: fast-check catches bugs in realistic operator compositions, TLC catches bugs in the underlying protocol at all possible interleavings.

**Scope.** ONLY the wave protocol. Not operators, not patterns, not adapters. Keeps the model small, the checker fast, and maintenance tractable.

**Cost.** ~3–5 days for the initial model. Revisiting when protocol changes ~1 day.

**LLM-usability payoff.** TLA+ spec becomes the *single source of truth* for the protocol. Docs, comments, test names, and code can reference TLA+ invariants by name. If a comment disagrees with TLA+, the comment is wrong. Kills the "self-contradicting docs" problem that made V4 painful to audit.

### 3. Parity mitigation options (ranked, besides Rust/WASM)

**1 — Executable contract traces (Project 2 above).** Primary answer. Killed parity audits for Babel, PostCSS, CommonMark, GraphQL, Prettier. ~80% of what Rust/WASM buys for parity, ~5% of the effort.

**2 — Relax the parity contract from "same API, same behavior" to "same wire protocol, idiomatic APIs."** TS keeps `pipe()`, PY keeps `|`. GraphSpec (JSON) is the interop surface. Trace format (Project 2) is the behavioral surface. Language-idiomatic differences (Python context managers, TS async conventions) become first-class, not divergences to track. Immediate, no new infra, pure editing decision.

**3 — Single source of truth for docs.** Eliminate duplicate explanations of the protocol across spec/composition-guide/CLAUDE.md/JSDoc/pydoc. Use references (`see GRAPHREFLY-SPEC.md §5.8`) not restatements. LLM sees one canonical doc. Free to do, high value.

**4 — Spec-driven development via TLA+ (Project 3).** The TLA+ spec is the contract; each implementation refines it. Academic-grade heavy for a whole library, but for the *core protocol only* it's tractable and mechanically powerful.

**5 — Code generation from a meta-language.** Too heavy. Skip.

**6 — Rust/WASM unified core.** Real payoff for performance + parity, but 6+ month project with ecosystem friction. Post-1.0 move once Projects 1–3 have stabilized the semantics. Doing it now locks in the current design before it's been stress-tested by fast-check/TLC.

**Practical parity mitigation stack:**

- **Immediate (no infra):** #2 + #3 — pure editing decisions
- **Next 1–2 months:** #1 (Project 2)
- **Post-1.0:** #6 (Rust/WASM core) if performance or maintenance pain justifies it

---

## PHASING PLAN

```
PHASE A — FINISH HAND AUDIT (user-owned, now)
  1. Wave 3 extras audit (resilience.ts — 2 user-observable bugs already fixed this session)
  2. Wave 3 extras audit (backpressure.ts, backoff.ts, timer.ts — smaller surface)
  3. Graph-level audit (Graph, describe, observe, profile)
  Fix Tier A bugs; defer Tier B to optimizations.md

PHASE B — RIGOR INFRASTRUCTURE (jointly, after Phase A)
  4. Project 1 — fast-check protocol harness (first 5 invariants)
     Re-run against Wave 3 code. Any new bugs found validate the approach.
  5. Project 3 — TLA+ core protocol spec (in parallel, independent)
     Model check. Counter-examples become fast-check properties.
  6. Editing passes — parity mitigation #2 and #3 (relax contract, unify docs)

PHASE C — PATTERNS/HARNESS AUDIT (claude-owned, after Phase B)
  7. Audit patterns/harness layer (harnessLoop, composite, orchestration gate, distill/tracker)
     Each bug found → new fast-check invariant → regression covered
  8. Audit §9.0b mid-level blocks when they ship (resilientPipeline, graphLens, etc.)

PHASE D — PARITY AUTOMATION (after Phase B settles, probably after Phase C)
  9. Project 2 — TS↔PY executable contract (trace format + replayers)
     Seed fixture set from Project 1's saved counter-examples
     CI parity becomes green CI, not quarterly audit

PHASE E — POST-1.0 CONSIDERATION
  10. Rust/WASM unified core — only if perf or maintenance pain justifies
```

### Key sequencing point

**Project 1 (fast-check) must ship before Phase C (patterns/harness audit).** Claude will be a much more effective bug finder with a property-based harness in hand than with code reading alone. The invariant list also gives Claude the same contract surface an LLM user would rely on — the audit of the patterns layer becomes "does this composition break any invariant?" rather than "does this operator's edge case match the spec narrative?"

### Main tradeoff

~3–4 weeks on rigor infrastructure delays the eight differentiator blocks (`resilientPipeline`, `graphLens.why`, `persistentState`, `agentMemory`, etc.) by the same amount. This is the bet: LLM-composable differentiators (with semantically airtight substrate) are worth more than the same blocks shipped earlier but prone to compositional surprises. Given that the public README's promise is "LLM-composable reactive harness," the rigor spend is load-bearing for the thesis, not optional polish.

---

## LLM EVAL COST SAFETY

### Problem

Real LLM evals have a failure mode the test suite doesn't: bugs that generate runaway API calls blow through token budgets before the pipeline even realizes something is wrong. The author's prior experience — the contrastive eval exhausting the Gemini 3 Flash preview free tier in 1/30 tasks — is the canonical example. Cause could be an actual GraphReFly reactive loop, a retry storm, or just free-tier rate limiting, and current tooling can't distinguish the three.

This fear is a direct blocker on running the §9.1 eval harness automatically, which in turn blocks Wave 1 of the announcement plan.

### Cost vectors in a reactive harness

Six ways a reactive graph can burn unexpected tokens:

1. **Runaway inner subscriptions** — `switchMap` / `mergeMap` spawning inners that don't clean up. Each rapid upstream DATA → new LLM call. Wave 1 `mergeMap` ERROR leak was exactly this class.
2. **Unbounded retry** — `retry({ backoff: exp() })` without `count` sets `maxRetries = 0x7fffffff`. A flaky provider + exponential backoff = effectively infinite retry budget.
3. **Feedback storms** — `feedback()` with a broken termination condition cycles forever; each cycle is another LLM call.
4. **DIRTY amplification** — a protocol bug where a recompute re-dirties its own upstream creates a compute storm.
5. **Rate limiter's unbounded `pending[]`** — Wave 3 finding. Under sustained load with no max buffer, items queue forever; each queued item is an LLM call when it drains.
6. **Per-task blow-up** — one prompt accidentally generates a 100K-token response because of a bad stop condition or no `maxTokens`.

### Five-layer defense in depth

**Layer 1 — Substrate invariants (catches 1–5 before real run).** Fast-check properties from Project 1 encode:
- *Bounded-fn-invocation-per-event* — total fn invocations ≤ f(N, M) for topology of N nodes and M events.
- *Bounded-subscription-count* — live subscriptions ≤ topology_size × constant.
- *Bounded-retry-timers* — scheduled `ResettableTimer` instances ≤ sum(retry.count).
- *Bounded-pending-queue* — `rateLimiter.pending.length` ≤ required `maxBuffer` option.

Runs against mock integer sources. Zero API cost. Catches entire classes of loops before a dollar is spent.

**Layer 2 — Replay cache.** File-based cache keyed on `sha(provider + model + prompt + params) → LLMResponse`. First run of a task costs real tokens; every rerun is free. Eliminates the "rerun cost" fear entirely in one ~50-LOC file.

**Layer 3 — Hard per-run budget gate.** `circuitBreaker`/`budgetGate`-style wrapper at the LLM provider layer: `maxCalls`, `maxInputTokens`, `maxOutputTokens`, `maxPrice` (currency-agnostic). On breach, throw `BudgetExceededError` and terminate. Live spend visible via `onUpdate` callback to stderr.

**Price tracking scope — deliberately minimal.** Pricing across providers is complex: litellm tracks 15+ dimensions per model (input/output/cache/reasoning/audio/image/video tokens, tool costs, storage-over-time, tiered thresholds, region pricing). Gemini 3 Pro alone has threshold-based input pricing ($2/M ≤200K, $4/M >200K), cache storage at $4.50/M/hour, and batch-tier 50% discount. The litellm pricing JSON is 30K+ lines and changes weekly.

**Decision: don't try to cover all of it.** Price tracking in eval cost safety is best-effort, not billing reconciliation. Order-of-magnitude is fine; under-by-20% is fine; over-by-5× would be bad; exact-to-the-cent is irrelevant. The authoritative caps are `maxCalls` / `maxInputTokens` / `maxOutputTokens` — those are always computable. Price is a secondary check that trips the circuit early when it's trackable.

**v1 pricing scope:**

| Cover | Defer |
|---|---|
| Currency-agnostic `price` field (not `dollars`) | Multi-currency mixing in one run (throw `CurrencyMismatchError`) |
| Flat `inputPricePerMillion` / `outputPricePerMillion` per model | Audio/image/video token classes |
| Optional `inputThresholdTokens` + above-threshold rates (Gemini-style) | Cache read/write pricing (assume worst case = no cache) |
| Optional `batchMultiplier` applied at call site via `tier: "batch"` | Tool costs (search grounding, code interp, file search) |
| `registerModelPricing(model, pricing)` runtime API | Storage-over-time (hourly cache storage) |
| ~15 curated models (Anthropic/OpenAI/Google/Ollama) in default registry | Vendoring litellm's full JSON |
| Unknown models return `{ price: 0, currency: "USD" }` and rely on token/call caps | Per-region pricing |

**Escape hatches:** Users who need comprehensive pricing can (a) call `registerModelPricing()` at startup with their own data, or (b) write a thin `loadLiteLLMPricing(jsonPath)` helper that ingests litellm's backup JSON into the registry. The core library ships neither — litellm's JSON is a maintenance firehose and we'd be forever stale.

**Layer 4 — Dry-run gate as CI requirement.** Every eval PR must pass a dry-run pass (LLMProvider replaced by mock returning canned strings) before any real-run is scheduled. Dry-run runs the entire pipeline with fast-check invariants alongside. If the pipeline makes unexpected call counts or spawns runaway subscriptions, dry-run catches it at zero cost.

**Layer 5 — Per-task budget declaration.** Each `EvalTask` declares `{ maxCallsPerTask, maxTokensPerTask }`. Harness enforces per-task. One misbehaving task can't eat the whole run's budget.

### Action order — unblock real evals this week

1. **Replay cache** — ~50 LOC, zero dependencies. Eliminates rerun cost immediately. Build first.
2. **Budget gate wrapper** — ~100 LOC, uses existing `estimateTokenCost`. 1–2 hours.
3. **Dry-run provider** — ~30 LOC, swappable via `EVAL_MODE=dry-run` env var. 1 hour.
4. **Diagnose the Gemini 1/30 exhaustion** — run contrastive eval in dry-run. If ~30 calls total, it was free-tier rate limiting, not a loop. If 300+ calls, real bug — start investigation there.
5. **Fast-check protocol harness** (Project 1, rigor plan) — long-term invariant guarantee. Not gating for running evals safely, but essential for catching bugs before they reach the eval stage.

**Key insight:** Layers 2–4 are ~1 day of work and unblock real-eval fear with zero dependency on the rigor plan landing. Layer 1 (fast-check) is the long-term complement — Layers 2–4 stop bleeding; Layer 1 finds the cause.

### Roadmap placement

Add `costSafeEval()` or similar to `SESSION-mid-level-harness-blocks.md` as a fifth composed block alongside `resilientPipeline` / `graphLens` / `guardedExecution` / `persistentState`. The block bundles budget gate + replay cache + dry-run toggle + per-task caps as a wrapper for any pipeline that calls external APIs. Natural fit in §9.0b.

### Future direction — v2: reactive LLM statistics + pluggable pricing (roadmap item)

**The v1 sketches above are imperative wrappers around `LLMProvider`.** That's correct for unblocking real evals this week, but it bakes pricing knowledge into the library and couples measurement to interpretation. The cleaner long-term design — and one that matches GraphReFly's "library computes structured facts, users render them" thesis — is to **invert the API so the provider exports raw statistics as reactive nodes, and pricing becomes a user-supplied derived layer.**

**Design insight.** The library should know exactly two things about an LLM call: *what went in* and *what came out*, both measured precisely. It should NOT know *how much that costs* — pricing is a moving target that lives outside the library's correctness boundary. Inverting the API lets the same accurate statistics stream feed multiple interpretations simultaneously: a budget circuit breaker, a cost dashboard UI, CI telemetry, per-task accounting, per-user billing.

**v2 API sketch:**

```typescript
// patterns/ai/observable-provider.ts

export interface CallStats {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    timestamp: number;              // monotonicNs()
    // Extension point for future token classes:
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
}

export interface ObservableLLMProvider extends LLMProvider {
    /** Reactive outputs. Each is a Node downstream consumers subscribe to. */
    readonly stats: {
        /** Most recent call (DATA on every call). */
        lastCall: Node<CallStats>;
        /** Running totals, reactive. */
        totalCalls: Node<number>;
        totalInputTokens: Node<number>;
        totalOutputTokens: Node<number>;
        /** Full stream — for audit / replay / dashboards. */
        allCalls: Node<CallStats[]>;    // reactive-log or similar
    };
    reset(): void;
}

export function observableProvider(inner: LLMProvider): ObservableLLMProvider {
    // Internally: state/reactive-log nodes updated in generate() side effect,
    // exposed via the stats bundle. Same wrapper pattern as withBudgetGate v1,
    // but emits to reactive nodes instead of closure state.
}
```

**Pluggable pricing becomes a user-owned derived graph:**

```typescript
// User decides the shape of pricing — coarse, fine-tuned, or litellm-backed.
// The library ships ZERO pricing data.
type PricingFn = (call: CallStats) => PriceEstimate;

// Coarse: flat rate everywhere
const coarsePricing: PricingFn = (call) => ({
    price: (call.inputTokens + call.outputTokens) * 1e-6 * 5,  // $5/M tokens
    currency: "USD",
});

// Fine: table-based (what v1 sketch 2a does)
const tablePricing: PricingFn = (call) =>
    estimateTokenPrice(call.inputTokens, call.outputTokens, call.model);

// Comprehensive: litellm-backed
const litellmPricing: PricingFn = (call) => {
    const entry = litellmJson[call.model];
    return {
        price: call.inputTokens * entry.input_cost_per_token +
               call.outputTokens * entry.output_cost_per_token,
        currency: "USD",
    };
};

// Wire the pricing as a derived on top of stats
const perCallPrice = map(provider.stats.lastCall, userPricingFn);
const totalPrice = scan(
    perCallPrice,
    (acc, p) => ({ price: acc.price + p.price, currency: p.currency }),
    { price: 0, currency: "USD" },
);

// Budget gate becomes a reactive circuit breaker — not a provider wrapper
const budgetBreaker = circuitBreaker({ failureThreshold: 1 });
effect([totalPrice], ([p]) => {
    if (p.price >= maxPrice) budgetBreaker.recordFailure();
});
const { node: gatedProvider } = withBreaker(budgetBreaker)(sourceRequests);
```

**What this buys over v1:**

| Dimension | v1 (imperative wrapper) | v2 (reactive inversion) |
|---|---|---|
| Pricing coupling | Pricing function lives in `evals/lib/pricing.ts` inside the library | Pricing is user-owned; library ships zero pricing data |
| Multi-consumer | One wrapper, one observer | Same stats feed N consumers (budget, UI, telemetry, billing) simultaneously |
| Pluggability | Users fork or extend the pricing module | Users write a `PricingFn` — pure function, zero library knowledge |
| Testability | Mock the wrapper | Mock the stats nodes directly |
| Composition | Wrapper stacks are ordered (cache outside budget) | Standard graph composition via subscribe |
| Matches library thesis | Partial — still has pricing logic in library | Full — library computes facts, user interprets |
| Roadmap fit | `evals/lib/` utility | First-class pattern in `patterns.ai` |

**Migration path.**

1. **v1 ships now (`evals/lib/pricing.ts` + `budget-gate.ts` + `replay-cache.ts` + `dry-run-provider.ts`).** Unblocks real evals in ~1 day. Stays in `evals/` scope — not part of the public library surface.
2. **v2 roadmap entry (new `§9.0c` or under `§4.4 patterns.ai`).** `observableProvider()` wraps any `LLMProvider` and exposes `stats: { lastCall, totalCalls, ... }`. Ships with `patterns.ai` as a new primitive. Pricing helpers (`estimateTokenPrice`, registry) move to optional helpers under `evals/lib/pricing-helpers.ts` — still exported for users who want the curated table, but no longer load-bearing.
3. **v2 eval harness rewrite.** `createSafeProvider` becomes `observableProvider()` + user-wired derived pricing + `circuitBreaker` gate. The `withBudgetGate` wrapper is deprecated. `withReplayCache` and dry-run stay as-is (they're orthogonal to the pricing inversion).
4. **Deprecate `evals/lib/cost.ts`.** Its curated table moves to the pricing-helpers module. The imperative `estimateTokenCost` stays available for users who don't want the reactive machinery.

**Why this is a future item, not v1:**

- Requires `LLMProvider` interface change (adds `stats` bundle) — breaking across all providers
- Requires new `patterns.ai` primitive to exist and be tested
- Requires rewiring `evals/scripts/*.ts` to use reactive pricing composition
- The value-add over v1 is compositional elegance, not eval safety — v1 already handles the cost-safety blocker
- Touches the public library surface; v1 stays scoped to `evals/`

**Roadmap placement:** New item under `§4.4 patterns.ai — LLM surface` as `observableLLMProvider()` primitive, referencing this section. Should land alongside or after `§9.0b` mid-level blocks so it can compose with `resilientPipeline` / `graphLens` naturally. Not blocking any Wave 1/2/3 announcement work.

**Key insight for the library thesis:** this is a test case for the "library ships structured facts, users render interpretation" principle. Pricing is the cleanest domain to prove it — the measurement is precise and objective, the interpretation is subjective and fluid. If we get this pattern right, it's the template for how every other `patterns.ai` primitive should expose statistics (token usage, retrieval hits, tool-call success rate, judgment confidence, etc.).

### Code sketches

**Sketch 1 — Replay cache (`evals/lib/replay-cache.ts`)**

```typescript
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";

export type ReplayMode = "read-write" | "read-only" | "write-only" | "off";

export interface ReplayCacheOptions {
    cacheDir: string;
    mode?: ReplayMode;
    includeTemperature?: boolean;
}

function cacheKey(provider: string, req: LLMRequest, includeTemp: boolean): string {
    const payload = JSON.stringify({
        provider,
        model: req.model ?? "",
        system: req.system,
        user: req.user,
        maxTokens: req.maxTokens ?? null,
        ...(includeTemp ? { temperature: req.temperature ?? null } : {}),
    });
    return createHash("sha256").update(payload).digest("hex");
}

export function withReplayCache(inner: LLMProvider, opts: ReplayCacheOptions): LLMProvider {
    const mode = opts.mode ?? "read-write";
    if (mode !== "off") mkdirSync(opts.cacheDir, { recursive: true });

    return {
        name: `${inner.name}+replay`,
        limits: inner.limits,
        async generate(req: LLMRequest): Promise<LLMResponse> {
            if (mode === "off") return inner.generate(req);
            const key = cacheKey(inner.name, req, opts.includeTemperature ?? false);
            const path = join(opts.cacheDir, `${key}.json`);
            if (mode !== "write-only" && existsSync(path)) {
                const cached = JSON.parse(readFileSync(path, "utf-8")) as LLMResponse;
                return { ...cached, latencyMs: 0 }; // 0 marks replayed
            }
            if (mode === "read-only") throw new Error(`Replay cache miss: ${key}`);
            const response = await inner.generate(req);
            writeFileSync(path, JSON.stringify(response, null, 2));
            return response;
        },
    };
}
```

Env control: `EVAL_REPLAY=read-write` (default), `read-only` (CI fails on miss), `write-only` (refresh cache), `off` (bypass).

**Sketch 2a — Pricing registry (`evals/lib/pricing.ts`, replaces `cost.ts`)**

```typescript
export interface ModelPricing {
    currency: string;                              // "USD", "CNY", etc.
    inputPricePerMillion: number;
    outputPricePerMillion: number;
    // Optional — Gemini-style threshold pricing
    inputThresholdTokens?: number;                 // e.g. 200_000
    inputPricePerMillionAboveThreshold?: number;
    outputPricePerMillionAboveThreshold?: number;
    // Optional — batch/flex tier multipliers
    batchMultiplier?: number;                      // e.g. 0.5
}

export interface EstimateOptions {
    tier?: "standard" | "batch";                   // default "standard"
}

export interface PriceEstimate {
    price: number;
    currency: string;
}

const DEFAULT_PRICING: Record<string, ModelPricing> = {
    // Anthropic (USD)
    "claude-opus-4-6":         { currency: "USD", inputPricePerMillion: 15,   outputPricePerMillion: 75 },
    "claude-sonnet-4-6":       { currency: "USD", inputPricePerMillion: 3,    outputPricePerMillion: 15 },
    "claude-haiku-4-5-20251001": { currency: "USD", inputPricePerMillion: 0.8, outputPricePerMillion: 4 },
    // OpenAI (USD)
    "gpt-4o":      { currency: "USD", inputPricePerMillion: 2.5,  outputPricePerMillion: 10 },
    "gpt-4o-mini": { currency: "USD", inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
    "gpt-4.1":     { currency: "USD", inputPricePerMillion: 2,    outputPricePerMillion: 8 },
    "gpt-4.1-mini":{ currency: "USD", inputPricePerMillion: 0.4,  outputPricePerMillion: 1.6 },
    "gpt-4.1-nano":{ currency: "USD", inputPricePerMillion: 0.1,  outputPricePerMillion: 0.4 },
    // Google — Gemini has threshold-based pricing
    "gemini-2.5-pro": {
        currency: "USD",
        inputPricePerMillion: 1.25, outputPricePerMillion: 10,
        inputThresholdTokens: 128_000,
        inputPricePerMillionAboveThreshold: 2.5,
        outputPricePerMillionAboveThreshold: 15,
        batchMultiplier: 0.5,
    },
    "gemini-3.1-pro-preview": {
        currency: "USD",
        inputPricePerMillion: 2, outputPricePerMillion: 12,
        inputThresholdTokens: 200_000,
        inputPricePerMillionAboveThreshold: 4,
        outputPricePerMillionAboveThreshold: 18,
        batchMultiplier: 0.5,
    },
    "gemini-2.5-flash": { currency: "USD", inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, batchMultiplier: 0.5 },
    "gemini-2.0-flash": { currency: "USD", inputPricePerMillion: 0.1,  outputPricePerMillion: 0.4, batchMultiplier: 0.5 },
    // Ollama (local) — free
    "gemma3:12b":  { currency: "USD", inputPricePerMillion: 0, outputPricePerMillion: 0 },
    "gemma3:27b":  { currency: "USD", inputPricePerMillion: 0, outputPricePerMillion: 0 },
    "qwen3:32b":   { currency: "USD", inputPricePerMillion: 0, outputPricePerMillion: 0 },
};

const registry = new Map<string, ModelPricing>(Object.entries(DEFAULT_PRICING));

export function registerModelPricing(model: string, pricing: ModelPricing): void {
    registry.set(model, pricing);
}

export function getModelPricing(model: string): ModelPricing | undefined {
    return registry.get(model) ??
        [...registry.entries()].find(([k]) => model.startsWith(k))?.[1];
}

export function estimateTokenPrice(
    inputTokens: number,
    outputTokens: number,
    model?: string,
    opts?: EstimateOptions,
): PriceEstimate {
    if (!model) return { price: 0, currency: "USD" };
    const pricing = getModelPricing(model);
    if (!pricing) return { price: 0, currency: "USD" };

    const overThreshold =
        pricing.inputThresholdTokens !== undefined &&
        inputTokens > pricing.inputThresholdTokens;

    const inRate = overThreshold && pricing.inputPricePerMillionAboveThreshold !== undefined
        ? pricing.inputPricePerMillionAboveThreshold
        : pricing.inputPricePerMillion;
    const outRate = overThreshold && pricing.outputPricePerMillionAboveThreshold !== undefined
        ? pricing.outputPricePerMillionAboveThreshold
        : pricing.outputPricePerMillion;

    const base = (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
    const tierMult = opts?.tier === "batch" && pricing.batchMultiplier !== undefined
        ? pricing.batchMultiplier
        : 1;

    return { price: base * tierMult, currency: pricing.currency };
}

export function totalPrice(prices: (PriceEstimate | undefined)[]): PriceEstimate {
    let sum = 0;
    let currency = "USD";
    for (const p of prices) {
        if (!p || p.price === 0) continue;
        if (sum === 0) currency = p.currency;
        else if (p.currency !== currency) {
            throw new Error(`Cannot total prices across currencies: ${currency} vs ${p.currency}`);
        }
        sum += p.price;
    }
    return { price: sum, currency };
}
```

**Sketch 2b — Budget gate (`evals/lib/budget-gate.ts`)**

```typescript
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";
import { estimateTokenPrice } from "./pricing.js";

export interface BudgetCaps {
    maxCalls?: number;
    maxInputTokens?: number;
    maxOutputTokens?: number;
    maxPrice?: number;                   // currency-agnostic
    currency?: string;                   // default "USD"; throws if a model prices in a different currency
}

export interface BudgetState {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    price: number;
    currency: string;
}

export class BudgetExceededError extends Error {
    constructor(readonly cap: keyof BudgetCaps, readonly current: number, readonly limit: number) {
        super(`Budget exceeded: ${cap} = ${current.toFixed(4)} >= ${limit}`);
        this.name = "BudgetExceededError";
    }
}

export class CurrencyMismatchError extends Error {
    constructor(expected: string, got: string, model: string) {
        super(`Budget currency is ${expected} but model ${model} prices in ${got}. Run one currency at a time.`);
        this.name = "CurrencyMismatchError";
    }
}

export interface BudgetGateOptions {
    caps: BudgetCaps;
    tier?: "standard" | "batch";
    onUpdate?: (state: Readonly<BudgetState>) => void;
    onExceed?: (err: BudgetExceededError) => void;
}

export type GatedProvider = LLMProvider & { state: Readonly<BudgetState>; reset(): void };

export function withBudgetGate(inner: LLMProvider, opts: BudgetGateOptions): GatedProvider {
    const capCurrency = opts.caps.currency ?? "USD";
    const state: BudgetState = {
        calls: 0, inputTokens: 0, outputTokens: 0, price: 0, currency: capCurrency,
    };

    function check(): void {
        const { caps } = opts;
        if (caps.maxCalls !== undefined && state.calls >= caps.maxCalls)
            throw new BudgetExceededError("maxCalls", state.calls, caps.maxCalls);
        if (caps.maxInputTokens !== undefined && state.inputTokens >= caps.maxInputTokens)
            throw new BudgetExceededError("maxInputTokens", state.inputTokens, caps.maxInputTokens);
        if (caps.maxOutputTokens !== undefined && state.outputTokens >= caps.maxOutputTokens)
            throw new BudgetExceededError("maxOutputTokens", state.outputTokens, caps.maxOutputTokens);
        if (caps.maxPrice !== undefined && state.price >= caps.maxPrice)
            throw new BudgetExceededError("maxPrice", state.price, caps.maxPrice);
    }

    function tryCheck(): void {
        try { check(); }
        catch (err) {
            if (err instanceof BudgetExceededError) opts.onExceed?.(err);
            throw err;
        }
    }

    return {
        name: `${inner.name}+budget`,
        limits: inner.limits,
        get state() { return state; },
        reset() {
            state.calls = 0; state.inputTokens = 0;
            state.outputTokens = 0; state.price = 0;
        },
        async generate(req: LLMRequest): Promise<LLMResponse> {
            tryCheck(); // pre-call: bail before spending if already exceeded
            const response = await inner.generate(req);

            // Best-effort price tracking. Unknown models return { price: 0 } and
            // fall through to token/call caps as the authoritative safety net.
            const estimate = estimateTokenPrice(
                response.inputTokens, response.outputTokens, req.model,
                { tier: opts.tier },
            );
            if (estimate.price > 0 && estimate.currency !== state.currency) {
                throw new CurrencyMismatchError(state.currency, estimate.currency, req.model ?? "?");
            }

            state.calls += 1;
            state.inputTokens += response.inputTokens;
            state.outputTokens += response.outputTokens;
            state.price += estimate.price;
            opts.onUpdate?.(state);

            tryCheck(); // post-call: surface breach on the crossing call
            return response;
        },
    };
}
```

**Sketch 3 — Dry-run provider (`evals/lib/dry-run-provider.ts`)**

```typescript
import type { LLMProvider, LLMRequest, LLMResponse } from "./llm-client.js";

export interface DryRunOptions {
    cannedContent?: string;
    onCall?: (req: LLMRequest, callNumber: number) => void;
}

export function createDryRunProvider(opts: DryRunOptions = {}): LLMProvider {
    const content = opts.cannedContent ?? "[DRY RUN] No LLM call was made.";
    let calls = 0;
    return {
        name: "dry-run",
        limits: {
            contextWindow: 1_000_000,
            maxOutputTokens: 1_000_000,
            rpm: Infinity,
            rpd: Infinity,
            tpm: Infinity,
        },
        async generate(req: LLMRequest): Promise<LLMResponse> {
            calls += 1;
            opts.onCall?.(req, calls);
            return { content, inputTokens: 0, outputTokens: 0, latencyMs: 0 };
        },
    };
}
```

**Wiring (in `evals/lib/llm-client.ts`, add alongside `createProvider`)**

```typescript
export function createSafeProvider(config: EvalConfig): LLMProvider {
    const mode = process.env.EVAL_MODE ?? "real"; // "dry-run" | "real"
    const base = mode === "dry-run"
        ? createDryRunProvider({
            onCall: (req, n) =>
                console.log(`[dry-run #${n}] ${req.user.slice(0, 80)}...`),
          })
        : createProvider(config);

    // CRITICAL: cache OUTSIDE budget, budget INSIDE.
    // Cache hits short-circuit before budget is charged → reruns are free.
    // Cache misses fall through to budget gate → real calls are counted.
    const gated = withBudgetGate(base, {
        caps: {
            maxCalls: Number(process.env.EVAL_MAX_CALLS ?? 100),
            maxPrice: Number(process.env.EVAL_MAX_PRICE ?? 2),
            currency: process.env.EVAL_CURRENCY ?? "USD",
        },
        tier: (process.env.EVAL_TIER as "standard" | "batch") ?? "standard",
        onUpdate: (s) => process.stderr.write(
            `\r[budget] ${s.calls} calls | ${s.price.toFixed(4)} ${s.currency}    `
        ),
        onExceed: (err) => console.error(`\n❌ ${err.message}`),
    });

    const cached = withReplayCache(gated, {
        cacheDir: "evals/results/replay-cache",
        mode: (process.env.EVAL_REPLAY as ReplayMode) ?? "read-write",
    });

    return cached;
}
```

**Wrapping order is load-bearing.** `withReplayCache(withBudgetGate(base))`:
- Cache HIT → outer layer returns immediately → budget never charged → reruns are free ✓
- Cache MISS → falls through to budget gate → budget checked → real provider called → response cached on return ✓

Flip the order and cache hits would still count toward budget. Get this backwards and you lose half the value.

---

## OPEN QUESTIONS

1. **fast-check invariant encoding format.** Should invariants be: (a) plain vitest tests with property-based generators inline, or (b) a separate invariant registry module that CI can enumerate? Option (b) makes the invariant list LLM-readable but adds indirection.

2. **TLA+ distribution.** Ship the `.tla` file in `docs/` or in a separate `formal/` directory? LLMs reading the repo should find it; humans running TLC should find it; CI should not need TLA+ installed.

3. **Trace format vocabulary scope.** Should the Project 2 vocabulary cover only state/derived/producer/effect, or extend to Tier 1 operators? Minimal = fast to ship; broad = catches more parity bugs. Recommendation: minimal first, extend as bugs drive demand.

4. **When to relax the parity contract (#2).** Is "same wire protocol, idiomatic APIs" an acceptable regression from users' perspective? For pre-1.0 and the current user base (effectively: the author), yes. Revisit before public launch.

5. **Replay cache staleness.** The cache is keyed on provider + model + prompt + params. If the prompt template changes (same `{{NL_DESCRIPTION}}` but different scaffolding text), all cache entries miss. Is that OK (probably yes — template change means different eval) or should we key on a template version? Defer.

6. **Budget gate reset boundary.** Per-eval-run? Per-task? Per-process? Current sketch is per-`GatedProvider` instance, caller chooses. Document the recommended pattern (one gate per `pnpm eval:l0` invocation).

7. **Per-task caps vs. global caps.** Sketches above implement global-only. Per-task caps need `EvalTask.budget` field and per-task reset. Add when a task is known to diverge from the global estimate.

---

## FILES

- This file: `archive/docs/SESSION-rigor-infrastructure-plan.md`
- Related: `archive/docs/SESSION-extras-wave1-audit.md` (Wave 1 hand-audit methodology)
- Related: `archive/docs/SESSION-foundation-redesign.md` (V5 redesign, source of Tier B items)
- Related: `archive/docs/SESSION-harness-engineering-strategy.md` (category-window urgency)
- Index entry: `archive/docs/design-archive-index.jsonl`
