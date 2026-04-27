# Session — Public-Face Phase-4 Blocks Review (memory / guarded-execution / resilient-pipeline / lens)

**Date started:** 2026-04-24
**Precedents:**
- `SESSION-orchestration-messaging-cqrs-review.md` (2026-04-24, 22 units)
- `SESSION-ai-harness-module-review.md` (2026-04-23 → 04-24, 24 units)
- `SESSION-extras-wave1-audit.md` (2026-04-13, higher-order operators)

**Scope:**
- `src/patterns/memory/index.ts` (526 LOC) — 1 utility + 4 factories
- `src/patterns/guarded-execution/index.ts` (174 LOC) — 1 graph class + 1 factory
- `src/patterns/resilient-pipeline/index.ts` (176 LOC) — 1 factory
- `src/patterns/lens/index.ts` (477 LOC) — 1 graph class + 1 factory + 4 surfaces
- **Total:** 1,353 LOC, ~8 units.

**Format:** Same 9-question per-unit format as the orchestration / AI-harness reviews (Q1 semantics → Q9 recommendation, topology check + perf/memory folded into Q7). Decisions locked per-unit so we can move on.

---

## Why this review

Mirrors the prior reviews' drivers, re-framed for this slice:

1. **Six "vision blocks" called out in `~/src/graphrefly_github/profile/README.md`:** `agentMemory`, `harnessLoop`, `guardedExecution`, `resilientPipeline`, `graphLens`, `Graph.attachStorage`. Three of those (`agentMemory` ≈ memory primitives, `guardedExecution`, `resilientPipeline`, `graphLens`) live in this slice. They are the **public face** of GraphReFly's Phase-4 surface — if any of them have islanded `describe()`, closure-held mutable state, or imperative cross-graph writes, the demos / blog posts that point readers at them embarrass the protocol story.
2. **Composition overlap.** `lightCollection` ↔ `extra/reactive-map.ts`, `collection` ↔ a `reactiveMap` + ranking, `vectorIndex` ↔ a vector flavor of `reactiveMap`, `knowledgeGraph` ↔ two `reactiveMap`s with adjacency. `resilientPipeline` is a curried `withStatus(retry(timeout(withBreaker(budgetGate(rateLimiter(source))))))` — is the curried factory the right shape, or should callers compose primitives directly?
3. **Imperative-publish smells (pagerduty-demo class).** Memory `upsert`/`remove` and Lens `flow.set` are imperative mutators called from outside the reactive layer. They are command-side mutations of state(), which is the documented pattern — but the `LensGraph` constructor wires three closures (`watchTopologyTree` callback, `target.observe` callback, `flow.set`) which warrant explicit topology-check and §28 review.
4. **Alignment with the §9.0 harness loop.** `guardedExecution` mounts `policyEnforcer` (lives in `patterns/audit/`, NOT YET AUDITED). `resilientPipeline` calls `budgetGate` from `patterns/reduction/` (NOT YET AUDITED). Each cross-pattern dependency surfaces a follow-up review target.
5. **Pre-1.0, no backward-compat budget.** Rename, delete, restructure as needed.

---

## Explainability criterion (applies to every unit)

Reuse the rule from the AI/harness + orchestration reviews:

1. Wire a minimal composition exercising the primitive with ≥2 upstream sources and ≥1 downstream sink (or, for self-contained Graphs, a parent that mounts it + a sink subscriber).
2. Run `graph.describe({ format: "ascii" })` + `graph.describe({ format: "mermaid" })`.
3. Check for islands / self-only nodes — a node with zero in-edges AND zero out-edges (that isn't the designated entry/exit) is a smell.
4. Run `graph.explain(source, sink)`. Causal chain should name every node the data flowed through.
5. Record the topology-check result per unit.

When the topology check fails, the fix is ALWAYS one of (§24 / §28 / §32):
- Convert imperative `.emit()` / `.publish()` calls inside fn bodies into proper `derived([…], fn)` edges.
- Replace closure-captured mutable state with a registered `state()` node.
- Remove `.cache` reads from reactive fn bodies (§28 factory-time seed sanctioned at wiring).
- Move source-boundary work into proper sources at the edge.
- For pump-style relays, the pump's fn should return the new value via `actions.emit(...)` on an output node the target depends on — not imperatively call `.publish()` on another graph.

**Note on command-side mutators:** Memory primitives expose `upsert` / `remove` / `clear` as bundle methods, which call `state.emit(nextMap)`. This is the documented "command-side mutator" pattern (§24 Q2): the imperative method is OUTSIDE the reactive `fn` body, so it does not violate the no-`cache`-in-fn rule. We still check that no reactive `fn` reads from a `Map` it mutates externally.

---

## Per-unit review format

Each unit answers nine questions (topology / perf folded into Q7):

1. **Semantics, purpose, implementation** — with file+line refs.
2. **Semantically correct?** — edge cases, subtle bugs.
3. **Design-invariant violations?** — COMPOSITION-GUIDE + spec §5.8–5.12. 🔴 violation / 🟡 gray-zone / 🟢 clean.
4. **Open items** — roadmap.md + optimizations.md cross-refs.
5. **Right abstraction? More generic possible?**
6. **Right long-term solution? Caveats / maintenance burden?**
7. **Simplify / reactive / composable + topology check + perf/memory.**
8. **Alternative implementations (A/B/C…)** with pros/cons.
9. **Recommendation** with coverage table against Q2–Q6.

Each unit ends with **"Decisions locked (date)"** capturing the user's call on each open question + the implementation-session scope.

---

## Batch plan (proposed)

> **Open for refinement at any batch boundary.**

### Wave A — Memory (5 units)

| Batch | Units | Theme |
|---|---|---|
| **A.1** | 1–2 | `decay` utility + `lightCollection` (no-Graph baseline) |
| **A.2** | 3 | `collection` (`CollectionGraph` with ranked/size derived) |
| **A.3** | 4–5 | `vectorIndex` + `knowledgeGraph` (specialized stores) |

### Wave B — Resilience composition (3 units)

| Batch | Units | Theme |
|---|---|---|
| **B.1** | 6 | `guardedExecution` / `GuardedExecutionGraph` |
| **B.2** | 7 | `resilientPipeline` (curried composition) |
| **B.3** | 8 | `graphLens` / `LensGraph` (stats + health + flow + why) |

---

## API-style policy (locked 2026-04-25, applies to all units)

User ratified rule, consistent with the "No imperative in public API" feedback in MEMORY:

> **Public-face Phase-4 primitives expose reactive reads only. Imperative reads (`get / has / peek / getItem / peekItem / search / related / scopedDescribe / etc.`) are dropped. One-shot snapshots use `node.cache` or `firstValueFrom(node)`.**

| API kind | Examples | Decision |
|---|---|---|
| **Command-side writes** (sanctioned §24 Q2) | `upsert / remove / clear / link / unlink / rescore / reindex` | **Keep** — they are the canonical mutation surface; reactive `Node<Command>` inputs would be heavy boilerplate. |
| **Imperative reads** | `get / has / peek / getItem / peekItem / search / related / scopedDescribe` | **Drop** — reactive `itemNode / hasNode / searchNode / relatedNode / scopedDescribeNode` siblings are canonical. |
| **Imperative LRU-touch reads** | `lightCollection.get` / `collection.getItem` (touch-as-side-effect) | **Drop the read; do NOT add `touch(id)` until a real caller surfaces.** Re-upsert is the explicit refresh path. |

**Why this policy:**
- Pre-1.0, free to drop without backward-compat cost.
- "Mostly internal use" — call sites we control adapt to the reactive shape.
- One freshness contract per primitive; no "imperative vs reactive" mixed-use confusion.
- Tests written reactively from the start (`firstValueFrom(itemNode("x"))` or `node.cache` after `awaitSettled`).
- Documentation unambiguous; agentMemory / guardedExecution / resilientPipeline / graphLens vision blocks all read as "reactive primitive, period."

**Affected unit revisions** (applied below in each unit's "Decisions locked" block as a 2026-04-25 revision):
- **Unit 2 — `lightCollection`:** drop `get / has / peek`. Add `itemNode(idNode): Node<T | undefined>` and `hasNode(idNode): Node<boolean>`.
- **Unit 3 — `collection`:** drop `getItem / peekItem`. Add `itemNode(idNode): Node<CollectionEntry<T> | undefined>`.
- **Unit 4 — `vectorIndex`:** drop imperative `search()`. `searchNode(query, k)` is the only read.
- **Unit 5 — `knowledgeGraph`:** drop imperative `related()`. `relatedNode(idNode, relationNode?)` is the only read.
- **Unit 6 — `guardedExecution`:** drop imperative `scopedDescribe()`. `scopedDescribeNode(actorNode?)` is the only read. (Revised before lock — see Unit 6 below.)

**Edge case left open:** if a real caller surfaces a need for non-reactive LRU touch, add `touch(id)` (imperative action) at that point. Don't add preemptively.

---

## Unit 1 — `decay` (utility)

**File:** `src/patterns/memory/index.ts:123-134`

### Q1 — Semantics, purpose, implementation

```ts
export function decay(
    baseScore: number,
    ageSeconds: number,
    ratePerSecond: number,
    minScore = 0,
): number {
    if (!Number.isFinite(baseScore)) return minScore;
    if (!Number.isFinite(ageSeconds) || ageSeconds <= 0) return Math.max(minScore, baseScore);
    if (!Number.isFinite(ratePerSecond) || ratePerSecond <= 0) return Math.max(minScore, baseScore);
    const decayed = baseScore * Math.exp(-ratePerSecond * ageSeconds);
    return Math.max(minScore, decayed);
}
```

Pure, allocation-free utility. Exponential decay (`base * exp(-rate * age)`), floored at `minScore`. Used by `collection` (`memory/index.ts:267, 293`) to compute live scores from `baseScore + lastAccessNs`. Public export — also intended as a building block for caller-defined ranking nodes.

### Q2 — Semantically correct?

- **Non-finite `baseScore`** (NaN / ±∞): collapses to `minScore`. Surprising for `+∞` (a deliberately-infinite priority would silently flatten), but safe.
- **Non-positive `ageSeconds`** (clock skew, fresh insert at the same ns): returns `max(min, base)` — no decay applied. Sane.
- **Non-positive `ratePerSecond`**: returns `max(min, base)`. Documented in `CollectionOptions.decayRate` as "0 disables decay" — matches behavior. Negative rates would otherwise grow scores, so silently flooring to "no decay" is defensible.
- **Underflow:** `Math.exp(-rate * age)` underflows to `0` for huge products → returns `minScore`. Fine.
- No clock dependency — caller passes `ageSeconds`. Good for pure-fn testability and for the `collection.ranked` derived (which computes age from `monotonicNs()` internally).

### Q3 — Design-invariant violations?

🟢 clean. Pure function, no protocol, no graph state, no cross-node reads. Spec §5.8–5.12 don't apply (not a node, not a source, not a runner).

### Q4 — Open items

None. No roadmap reference.

### Q5 — Right abstraction? More generic possible?

- **Right level.** Tiny pure utility used by exactly one factory in the same file.
- **Generic over rate kernel?** Could expose `kernel: "exponential" | "linear" | (age) => number`. Not warranted — every real ranking system uses exponential decay; YAGNI until a second caller asks for linear.
- **Live in `extra/` instead of `patterns/memory/`?** It is not memory-specific (could rank anything by age). But the only existing caller is `collection`, and exporting it from `patterns/memory` keeps the public surface narrow. Move only if a second pattern (e.g. `harness.strategy.successRate` decay) imports it.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** 12 LOC, zero dependencies, pure function. Effectively zero ongoing cost — no protocol surface to break, no async lifecycle, no graph topology to keep coherent. The function is small enough that a future reader can verify it correct in 30 seconds.

**Caveats / footguns:**

1. **`+∞ baseScore → minScore` collapse.** A caller passing `Infinity` to express "permanently top-ranked" gets `0` (the default `minScore`). The `Number.isFinite` short-circuit rejects all non-finite values uniformly. Not unsafe, but wrong-shaped if a caller relies on `Infinity` as a sentinel.
2. **Negative `ratePerSecond → no decay.** If `ratePerSecond` is computed from another node (e.g. a derived rate that briefly clamps to `-1`), the user sees "no decay applied" instead of an error. Silent fallback masks input bugs upstream of `decay`. Defensible because the tolerant fallback never amplifies (a negative rate would otherwise grow scores), but the silence is the maintenance hazard.
3. **No formula in JSDoc.** A reader must read the implementation to learn that this is exponential decay (`base * exp(-λt)`). Inverse half-life, time constant, etc. — all derivable but undocumented. Trivial fix.
4. **Underflow at large `rate * age` products.** `Math.exp(-745) === 0`. For a ratePerSecond of `1e-3` (≈19-minute half-life), `ageSeconds > 745_000s ≈ 8.6 days` underflows to `0`, returning `minScore`. For most "agent memory" use cases this is fine — old entries should drop. But for long-running collections with slow decay, the underflow boundary becomes a silent floor.
5. **`minScore` default of `0`.** Sensible for the "memory ranking" use case (non-negative scores). A caller using signed scores (e.g. sentiment ranking) would see negative scores clipped to `0` unless they explicitly pass `minScore: -Infinity` (which the function tolerates because `Math.max(-Infinity, x) === x`).
6. **Cross-language parity:** `graphrefly-py` does NOT yet have an equivalent `decay()` utility (verified against the Phase-4 memory primitives in the parity audit). If we keep the export, parity needs a Python sibling; if we inline (Option F below), no parity work needed. **This is the most consequential long-term call.**
7. **Public-export commitment.** Pre-1.0, removing the export is free. Once 1.0 ships and external callers depend on it, the tolerant fallbacks become permanent (or each tightening becomes a breaking change). Decide the tolerance posture **now**, while the no-backward-compat budget still applies.

**What hurts in 6 months:**
- If a caller files a bug report "my `+∞` baseScore returned 0," the answer is "documented" — only if we add the JSDoc.
- If `graphrefly-py` lands its own `decay` with different edge-case behavior (e.g. throwing on negative rate), we get parity drift.
- If we inline today and a second caller appears in `harness.strategy.successRate` decay later, we re-create the same utility — minor churn, no real harm.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:** N/A. Pure function, not a node, no protocol participation. The two callers (`collection.ranked` derived at line 267, `collection.effective` helper at line 293) embed `decay` inside reactive `derived` fns, where it correctly behaves as a stateless data transform. No describe()/explain() implications.

**Composability:**
- The function takes `ageSeconds` rather than `(now, lastAccessNs)` — pure-fn signature, no clock dependency, fully testable. Caller computes age. This is the right shape; do not change.
- Both current call sites repeat the conversion `(now - entry.lastAccessNs) / 1_000_000_000`. Could be captured in a `secondsSince(lastAccessNs)` helper if more call sites emerge — premature today.
- Plays well inside `derived([items], …)` fns. No `.cache` reads required (the snapshot is the dep arg). 🟢 §28-clean.

**Simplification options:**
- The two early-return guards could collapse:
  ```ts
  const safe = (n: number) => Number.isFinite(n) && n > 0;
  if (!Number.isFinite(baseScore)) return minScore;
  if (!safe(ageSeconds) || !safe(ratePerSecond)) return Math.max(minScore, baseScore);
  return Math.max(minScore, baseScore * Math.exp(-ratePerSecond * ageSeconds));
  ```
  Marginal LOC win, slight readability loss (the helper hides the predicate). Current shape is fine.
- Could fold `Math.max(minScore, …)` into both branches via a single `Math.max` at the bottom — but the early returns short-circuit `Math.exp` for the no-decay case, which is the intent.

**Perf:**
- O(1) per call. One `Math.exp`, two `Math.max`, up to four `Number.isFinite` checks.
- `Math.exp` is among the slower V8 built-ins (~10–50ns on modern hardware vs ~1–2ns for `Math.max`). For `collection.ranked` with `N` entries, one `decay` call per entry per re-derivation = `O(N)` `exp` calls per emit. 10k entries ≈ 100–500μs per pass. Acceptable for memory-ranking use cases (which typically re-rank on user query, not on every DATA emit).
- Hot-path concern: `collection.ranked` re-derives on every `items` emission. If `items` churns (e.g. LRU `get` re-emitting), `ranked` recomputes the full sort + N `decay` calls. The optimization is not in `decay` itself — it's at the `ranked` derivation level (incremental sort, throttle, or custom `equals` to skip redundant emits). File any `ranked` perf work under Unit 3, not here.

**Memory:**
- Stack-only. No retained allocations. No garbage pressure.

### Q8 — Alternatives

**A. Keep as-is, no JSDoc change.** Behavior preserved exactly. Caller bugs surface through downstream symptoms.
- Pros: zero churn.
- Cons: every caveat in Q6 stays implicit; future readers re-derive the formula.

**B. Strict mode — throw on bad inputs.** Replace tolerant guards with `RangeError` for negative `ratePerSecond` / `ageSeconds` and non-finite `baseScore`.
- Pros: surfaces caller bugs at the `decay` boundary.
- Cons: every call site must pre-validate, including `collection.effective` (which computes `ageSeconds` from clock skew — a single `monotonicNs()` regression would now throw). User-supplied `opts.decayRate` to `collection` would also need validation up-front. The current tolerant shape protects `collection` from those edge cases for free.

**C. Keep as-is + JSDoc the formula, fallbacks, and underflow boundary.** Behavior preserved; caveats become documented.
- Pros: zero behavior risk; closes Q6 caveats #1–#4 without code change.
- Cons: still not strict — bugs still silent. Doesn't address parity (Q6 #6) or relocation (Option E).

**D. Half-life parameterization.** Replace `ratePerSecond` with `halfLifeSeconds`. Internally: `Math.exp(-Math.LN2 * ageSeconds / halfLifeSeconds)`.
- Pros: more intuitive ("score halves every 60s") for user-facing config like `CollectionOptions.decayRate`. Half-life is the field most config UIs surface.
- Cons: changes the public API. `decayRate` semantics in `CollectionOptions` would also need to change. Rate constant is the canonical exponential-decay parameter in literature; users reading academic papers will look for `λ`.

**E. Relocate to `src/extra/decay.ts`.** It is not memory-specific.
- Pros: discoverable for callers building rankings outside memory primitives (e.g. `harness.strategy.successRate` if it ever decays). Aligns with the "extras = small reusable utilities" tier.
- Cons: only one caller today. Importing from `../../extra/decay.js` adds one indirection vs the current intra-file call. Premature until a second caller appears.

**F. Inline into `collection`; remove the public export.** Move into the `effective()` helper at line 291, drop the `export function decay`.
- Pros: smallest public surface area; one less symbol to maintain JSDoc and parity for; one less `graphrefly-py` sibling to write.
- Cons: loses an extension point for caller-defined ranking nodes; if `harness.strategy` or any other pattern wants exponential decay, it has to re-implement (or we re-export later).

**G. Strict in dev, tolerant in prod.** Use a build flag to throw in development and fall back in production.
- Pros: best of both worlds for long-term hardening.
- Cons: introduces dev/prod divergence — anti-pattern. Strict assertions belong in tests, not in build flags.

### Q9 — Recommendation

**Recommended call: C — keep behavior as-is, add a JSDoc block.**

**Rationale:**
- The function is correct as currently written for every documented call site (`collection.ranked`, `collection.effective`).
- The tolerant fallbacks (Options A/C behavior) are load-bearing inside `collection.effective`: clock skew or a one-tick `lastAccessNs > now` would otherwise throw and break eviction. Strict mode (B) has a real downside: it shifts the burden of pre-validation to every reactive `derived` fn that calls `decay`, which is the opposite of "Phase 4+ developer-friendly."
- Half-life parameterization (D) is appealing for user-facing config but is a second-order question — it should be decided at the **`CollectionOptions.decayRate`** level (Unit 3), not at the utility level. If we decide there to expose half-life to callers, the utility can stay as-is (`ratePerSecond`) and `collection` can convert.
- Relocation (E) and inlining (F) are both defensible; my call is **stay in `patterns/memory/`** because (a) only one caller, (b) memory is the natural namespace for ranking utilities, (c) re-exporting from `extra/` later is a one-line change.
- Strict-in-dev (G) is a build-flag anti-pattern.

**Concrete change:**
- Add a JSDoc block above `decay`:
  ```ts
  /**
   * Exponential decay with floor: `score = max(minScore, baseScore * exp(-ratePerSecond * ageSeconds))`.
   *
   * Tolerant fallbacks (deliberate for use inside reactive derived fns):
   * - non-finite `baseScore` → `minScore`
   * - non-positive `ageSeconds` (incl. clock skew) → `max(minScore, baseScore)` (no decay)
   * - non-positive `ratePerSecond` → `max(minScore, baseScore)` (no decay; rate=0 disables)
   *
   * Underflow boundary: `Math.exp(-745) === 0`. For very long ages × rates the
   * result clamps to `minScore`; if you need slow decay over years, choose a
   * smaller `ratePerSecond` rather than relying on graceful underflow.
   */
  ```
- **No behavior change**, no test change, no parity work needed (utility stays single-language until a second caller appears).
- **Defer to Unit 3** any decision about whether `CollectionOptions.decayRate` should be exposed as half-life vs rate.

**Coverage table:**

| Concern | Recommendation closes it? |
|---|---|
| Q2 — `+∞ → minScore` surprise | ✅ documented in JSDoc |
| Q2 — negative-rate silent fallback | ✅ documented in JSDoc |
| Q3 — design invariants | ✅ already 🟢, no change |
| Q4 — open items | n/a |
| Q5 — right abstraction / generic | ✅ acknowledged; relocation deferred |
| Q6 — formula undocumented | ✅ JSDoc adds formula |
| Q6 — underflow boundary | ✅ JSDoc adds underflow note |
| Q6 — public-export commitment | ✅ keep export; deferred parity (single-language until 2nd caller) |
| Q6 — `graphrefly-py` parity | ⚠️ **deferred** — flag in `docs/optimizations.md` as "if a 2nd caller emerges, port to PY" |

**Open question for the user before locking:**

> **Should `decay` ship a `graphrefly-py` sibling now (parity-by-default), or wait until a second caller emerges and accept temporary single-language status?**
>
> The TS-only stance is consistent with "minimal API surface" and matches the current Python parity bar (where utility helpers tend to land alongside their first non-trivial Python caller). The "ship parity now" stance avoids a future drift like Q6 #6.

### Decisions locked (2026-04-24)

1. **Option C** — keep behavior as-is, add JSDoc block (formula + tolerant fallbacks + underflow boundary).
2. **`graphrefly-py` parity sibling deferred** — file in `docs/optimizations.md` under "Active work items": port `decay` to PY when a 2nd caller emerges (e.g. `harness.strategy.successRate`).
3. **Half-life vs rate debate** — address at Unit 3 (`CollectionOptions.decayRate` exposure), not at the utility level.

**Implementation scope when Wave A lands:** add the JSDoc block above `decay` in `src/patterns/memory/index.ts:123`. No tests required (behavior unchanged). Add a one-line entry to `docs/optimizations.md` flagging the deferred PY parity.

---

## Unit 2 — `lightCollection`

**File:** `src/patterns/memory/index.ts:170-243`

### Q1 — Semantics, purpose, implementation

```ts
export function lightCollection<T>(opts: LightCollectionOptions = {}): LightCollectionBundle<T>
```

Returns a bundle:
- `entries: Node<ReadonlyMap<string, LightCollectionEntry<T>>>` — backed by a single `state()` (line 175). NOT mounted to any Graph.
- `upsert(id, value)` — copy-on-write `Map`, set entry with `createdAtNs` (preserved across re-upserts) and `lastAccessNs = now`, evict if over `maxSize`, `entries.emit(next)`.
- `remove(id)` — copy + delete; early-return when key absent.
- `clear()` — reset to empty map; early-return when already empty.
- `get(id)` — under `policy: "lru"`, mutates `lastAccessNs` and re-emits the map; returns `entry.value | undefined`.
- `has(id)` — pure read.

Eviction: O(n²) scan-and-delete per write — over `maxSize`, repeatedly find min by (`lastAccessNs` for LRU / `createdAtNs` for FIFO) and `delete`. Default policy is FIFO (line 172).

### Q2 — Semantically correct?

- **`get` under `policy: "lru"` mutates state and emits a DATA.** This is intended LRU behavior, but the API is `get` — most readers expect `get` to be pure. A reader subscribed to `entries` will see a snapshot emit on every read. **Smell** for ranked/derived consumers.
- **No `peek()` for non-mutating reads.** Forces callers to subscribe to `.entries` and look up themselves if they want to avoid touch.
- **`upsert` always emits**, even when the entry is identical (same value, same id) — because `commit()` always runs. For an immutable-value reflow this generates spurious DATA. Minor; documented `state.emit` semantics already.
- **Eviction is O(n²) per write** under `maxSize`. For `maxSize=1000`, each upsert that triggers eviction is ~1000 scans × maybe 1–2 evictions = O(n). Fine for "light" use cases. Surfaces as a problem only at `maxSize > ~10k`.
- **`createdAtNs` preservation across re-upserts** (line 212) — correct; means FIFO ordering is by *first* insert, not most recent. Reasonable but worth a JSDoc line.
- **`commit` calls `entries.emit(next)` from outside any reactive `fn`.** Documented command-side mutator pattern.

### Q3 — Design-invariant violations?

- **Imperative `state.emit`** from bundle methods → 🟢 (command-side mutator, NOT inside a reactive `fn`).
- **`.cache` reads** (`readMap` at line 146 reads `node.cache`) — used inside `upsert` / `remove` / `get` (also command-side, not reactive `fn` bodies) → 🟢.
- **No central timer in fn bodies** — uses `monotonicNs()` from `core/clock.ts` → 🟢.
- **No `setTimeout` / `Promise` / `queueMicrotask`** → 🟢.
- **No Graph wrapper** — `entries` is a detached `state()`. `lightCollection` is intentionally Graph-less ("light"). 🟡 gray-zone: a caller composing this bundle into a parent Graph must `parent.add(bundle.entries)` themselves; no `describe()`/`explain()` coverage by default. Worth documenting in JSDoc.
- **Phase 4+ developer-friendliness** — reads cleanly, sensible defaults, no protocol leaks.

Net: 🟢 with 🟡 gray-zone on the no-Graph composition wart.

### Q4 — Open items

- **Composition overlap with `extra/reactive-map.ts`.** `reactiveMap` already supports `maxSize` LRU eviction (`reactive-map.ts:30`), score-based retention, TTL, and exposes `entries: Node<ReadonlyMap<K,V>>` + `set/get/has/delete/clear` (with documented LRU touch on `has`/`get` — same pattern). `lightCollection` is essentially `reactiveMap` with a custom entry shape (`LightCollectionEntry<T>` vs raw `V`) and FIFO-or-LRU policy (vs LRU-or-score-retention).
  - **Candidate optimization (`docs/optimizations.md`):** rebuild `lightCollection` as a thin facade over `reactiveMap` with `value: T → LightCollectionEntry<T>` projection. Or drop entirely and let callers compose `reactiveMap` + a tiny entry wrapper.

### Q5 — Right abstraction? More generic possible?

- **`lightCollection` vs `reactiveMap`.** Two parallel implementations of "reactive Map with eviction." Differences:
  - `lightCollection` adds `LightCollectionEntry<T>` shape (id, value, createdAtNs, lastAccessNs).
  - `lightCollection` supports FIFO (reactiveMap is LRU-only or score-retention).
  - `reactiveMap` is more featureful (TTL, score retention, custom backend, version stream).
- **Stronger abstraction:** `reactiveMap<id, T>` + a derived `Node<ReadonlyMap<id, LightCollectionEntry<T>>>` that decorates with timestamps. FIFO becomes a custom retention scorer. Net result: fewer parallel implementations, one source of truth for eviction.
- **Or:** keep `lightCollection` as the "Phase-4 friendly" name and have it call `reactiveMap` internally — the public API stays, the implementation collapses.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~73 LOC of imperative copy-on-write `Map` mutation across 5 methods. Each method follows the same pattern (`copyMap(readMap(entries))` → mutate → `commit(next)`). Low cognitive load *individually*, but the pattern repeats with subtle variations (`upsert` preserves `createdAtNs`, `get` only commits under LRU policy, `clear` early-returns on empty). A future maintainer touching one method must re-derive the invariants for all five.

**Drift risk against `extra/reactive-map.ts` (the dominant concern):**

`reactiveMap` is the senior sibling — it received the **Wave-4 refactor (2026-04-15)** introducing the `MapBackend<K, V>` pluggable-backend interface (`reactive-map.ts:7-8, 188`). It owns:
- LRU ordering with the **F4 has/get touch refinement** (live-key `has` and `get` move the entry to the MRU end without triggering `entries` emission — `reactive-map.ts:112, 123, 246`).
- TTL expiry (`defaultTtl` per-bundle, per-set TTL override).
- Score-based retention (mutually exclusive with LRU `maxSize`).
- O(1) amortized `set` with LRU touch + eviction, vs. `lightCollection`'s O(n) copy.
- A version stream for incremental consumers.

`lightCollection` has none of these. It implements LRU touch by emitting a fresh snapshot — the **opposite** of F4's "no emit on touch" optimization. Anyone using `lightCollection.get(id)` under LRU policy sees DATA churn that `reactiveMap.get(id)` would not produce. **This is silent semantic drift**: identical-looking call sites behave differently across the two primitives.

**Cross-language drift compounds the risk:** `graphrefly-py` ships both `light_collection` (`memory.py:540`) AND `reactive_map` (`extra/data_structures.py:245`). The same parallel-implementation problem exists in PY — and any future fix landed in `reactiveMap` (e.g. F5+) has to be re-evaluated against both `lightCollection` (TS) and `light_collection` (PY). Four sites of potential drift instead of one.

**Caveats / footguns:**

1. **LRU `get` emits a DATA snapshot** (line 235). The function is named `get` — readers reasonably assume it's pure. Subscribed consumers see a snapshot per read. Worse: a consumer writing `bundle.entries.subscribe(snap => bundle.get("hot"))` infinite-loops. JSDoc-only fix or add `peek(id)` for non-mutating reads.
2. **No-Graph composition wart.** `bundle.entries` is a detached `state()` — never mounted, never appears in any `describe()` unless the caller manually `parent.add(bundle.entries)`. The `lens.flow` observability surface (Unit 8) cannot track an unmounted node. Callers wanting any reactive observability over `lightCollection` write 1–3 lines of glue. Inconsistent with `collection`, which IS a `Graph` subclass.
3. **Default `policy: "fifo"` is a footgun.** FIFO eviction by `createdAtNs` means a heavily-touched entry is evicted as soon as it's the oldest, regardless of recency. This is the wrong cache behavior for nearly every "agent memory" use case. `collection` defaults to `"lru"` (line 247). The two memory primitives in the same file have inconsistent defaults — a maintenance smell.
4. **`upsert` always emits**, even when value-equality holds. State `emit` semantics: every call propagates a new snapshot regardless of equality. For frequent re-upserts of the same value (e.g. a metric reporter), downstream `derived` fns recompute. Callable `equals` on `state()` would short-circuit, but `lightCollection` doesn't pass one. Minor.
5. **Eviction scan is O(n²).** `evictIfNeeded` runs `while (next.size > maxSize)` and rescans all entries to find the next victim. For a burst-write scenario where we go from `0 → maxSize+k` in one batch, the cost is `Σ_{i=0..k} (maxSize + i)` ≈ O((maxSize·k) + k²). For typical small caches (`maxSize < 1k`), trivially fine; documented limit for the "light" branding to hold.
6. **`createdAtNs` preservation across re-upserts** (line 212) — correct but undocumented. FIFO ordering is by **first** insert, not most-recent re-write. A caller relying on "FIFO = oldest write" is wrong. Worth a JSDoc line, or arguably reset `createdAtNs` on re-upsert (matches `set` semantics on a Map).
7. **Public-export commitment.** Four exported symbols: `LightCollectionEntry<T>`, `LightCollectionOptions`, `LightCollectionBundle<T>`, `lightCollection<T>`. Pre-1.0, removing or renaming any is free; post-1.0, locked.
8. **Test coverage is thin.** `memory.test.ts:10–31` covers FIFO eviction + LRU eviction. No test for `clear`, `remove` early-return, `clear` early-return, `has` semantics, or the LRU-get-emits behavior (precisely because it's surprising). Drift risk against any hardening or rebuild.
9. **Vision-block alignment.** `agentMemory` is the named public block. The mental model is `agentMemory` ≈ `collection` / `vectorIndex` / `knowledgeGraph` (the Graph-shaped, ranked / searchable / linkable primitives). `lightCollection` is a low-tier helper, NOT a public-face block. Its presence in `patterns/memory/` is debatable — could live in `extra/` since it's just a Map+eviction wrapper.

**What hurts in 6 months:**
- F5+ refinements to `reactiveMap` LRU semantics ship; `lightCollection` lags. Internal call sites get inconsistent eviction behavior depending on which primitive they imported.
- A user files a bug "my `lightCollection.get()` is causing a tight subscriber loop" — answer is "documented, use `peek()`" (only if we add it).
- `agentMemory` documentation has to clarify why two collection primitives exist with different APIs and different defaults.
- Cross-language parity reviews keep flagging the same drift as separate items in TS and PY.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check (run mentally):**

```ts
const c = lightCollection<number>({ maxSize: 2 });
const g = new Graph("demo");
g.add(c.entries, { name: "entries" });
const counter = derived([c.entries], ([m]) => m?.size ?? 0, { name: "size" });
g.add(counter, { name: "size" });
c.upsert("a", 1);
c.upsert("b", 2);
g.describe({ format: "ascii" });
// → entries (state, no upstream)
//   ↓
//   size (derived, depends on entries)
// graph.explain("entries", "size") → 1-edge chain
```

- ✅ Once mounted, the topology is clean: `entries → size`. No islands, deps match dataflow.
- ⚠️ **Without** the manual `g.add(c.entries)`, the bundle is invisible to any parent's `describe()`. Default usage is "give me a bundle and forget the Graph" — exactly the footgun this shape encourages.
- ⚠️ The bundle's `upsert` / `remove` / `clear` are **command-side mutators** (§24 Q2 sanctioned pattern): they call `state.emit(next)` from outside any reactive `fn`. `describe()` doesn't show the call sites — the topology shows the data path, not the mutator path. This is correct per the spec but means causal chains terminate at `entries` (the mutator origin is the *user's code*, not a node).

**Composability:**
- **Upstream OK:** Plays well as an input to `derived([entries], …)` — the dep arg gives the snapshot, no `.cache` reads needed.
- **Downstream NOT OK:** No reactive way to feed `upsert` from a source. Caller must `source.subscribe(msgs => { for (const m of msgs) if (m[0]==="data") c.upsert(...); })` — pure imperative bridge. A `wireUpsert(source: Node<{id, value}>): () => void` helper on the bundle would close this.
- **As a Graph mount target:** `bundle.entries` is one node; mountable but contributes no internal topology (no derived nodes for `size`, `byKey`, etc. — caller writes those).

**Simplification (sketch):**
```ts
// As a thin facade over reactiveMap with timestamp decoration:
export function lightCollection<T>(opts: LightCollectionOptions = {}): LightCollectionBundle<T> {
  const inner = reactiveMap<string, LightCollectionEntry<T>>({
    name: opts.name,
    maxSize: opts.maxSize, // FIFO would need extra work; LRU is free
  });
  return {
    entries: inner.entries,
    upsert(id, value) {
      const now = monotonicNs();
      const prev = inner.get(id);
      inner.set(id, { id, value, createdAtNs: prev?.createdAtNs ?? now, lastAccessNs: now });
    },
    remove(id) { inner.delete(id); },
    clear() { inner.clear(); },
    get(id) { const e = inner.get(id); return e?.value; }, // F4 touch w/o emit
    has(id) { return inner.has(id); },
  };
}
```
~20 LOC, inherits F4, MapBackend, version stream, future TTL/score-retention. **FIFO support is the only feature that doesn't trivially port** — see Q9.

**Perf:**
- Current: `upsert` O(n) (copyMap + eviction scan); `evictIfNeeded` O(n²) worst case under burst eviction.
- Rebuild on `reactiveMap` (`NativeMapBackend`): `upsert` O(1) amortized; eviction O(1) per excess entry.
- For `maxSize=100`, current = ~100 ops/upsert; rebuild = ~5 ops/upsert. ~20× speedup at typical sizes.

**Memory:**
- Current: each `commit` creates a new `Map` (copyMap). `Node.cache` retains the most recent; previous Maps GC when subscribers release. Under heavy `get` traffic with LRU policy → continuous Map allocation / GC pressure.
- Rebuild: single backing `Map` mutated in place; `entries: Node<ReadonlyMap>` exposes a frozen view. No copy-on-write churn.

### Q8 — Alternatives

**A. Keep as-is.** No code change.
- Pros: zero churn, tests already cover the two main paths.
- Cons: every Q6 caveat stays; drift accelerates as `reactiveMap` evolves.

**B. Rebuild as a thin facade over `reactiveMap`** (TS + PY mirrored).
- Pros: single source of truth for LRU semantics; inherits F4/MapBackend/future TTL+retention; ~20 LOC implementation; perf improvement; cross-language parity collapses to one source per side.
- Cons: FIFO support requires either a custom backend or losing FIFO; one-time migration in both repos; tests need to expand to cover the rebuilt behavior; downstream tests asserting "snapshot emit on every LRU get" break (good — that's the F4 fix).

**C. Drop `lightCollection`; document `reactiveMap` as canonical.**
- Pros: smallest public surface; `agentMemory` story narrows to "use `collection` if you want scoring + Graph, use `reactiveMap` if you want a raw reactive Map."
- Cons: callers wanting `LightCollectionEntry<T>` (timestamps) write 5 LOC of value-shape boilerplate per call site; loses the "Phase-4 friendly name"; mirror drop in PY.

**D. Harden in place** (no rebuild).
- Default `policy: "lru"` (matches `collection`); add `peek(id): T | undefined`; JSDoc the LRU-get-emits + no-Graph caveats; document `createdAtNs` preservation; test the early-return paths.
- Pros: minimal change; keeps FIFO; stays parallel to `reactiveMap`.
- Cons: doesn't address drift (Q6 main concern); preserves O(n²) eviction; preserves copy-on-write GC pressure.

**E. Combine D (short-term) + B (medium-term).**
- Land D now; file B in `docs/optimizations.md` under "Active work items"; execute B in a follow-up TS+PY parity pass.
- Pros: closes user-visible footguns immediately; queues the architectural fix without blocking.
- Cons: temporary inconsistency between hardened-in-place behavior and the eventual reactiveMap-backed behavior (mainly the F4 emit semantics — D would still emit on LRU `get`; B would not). Migrating call sites later costs a sweep.

**F. Rename to make no-Graph nature explicit** (`volatileCollection`, `detachedCollection`, `lightMap`, `mapWithEviction`).
- Pros: signals "I don't ship a Graph" up front.
- Cons: bikeshed; doesn't fix any structural problem; rename + migrate in both repos.

**G. Always wrap in a Graph.** Make `lightCollection` return a `Graph` subclass (like `collection`).
- Pros: consistent with `collection`; eliminates the no-Graph wart.
- Cons: kills the "light" differentiator (i.e. the only reason to choose `lightCollection` over `collection`); user pays Graph-construction overhead for the simplest use case.

**H. Move `lightCollection` to `src/extra/`** (it's just Map+eviction).
- Pros: aligns with the "extras = reusable utilities" tier; `patterns/memory/` becomes Graph-shaped primitives only.
- Cons: tooling churn (imports update, JSDoc category change, parity move in PY); doesn't fix drift on its own.

### Q9 — Recommendation

**Recommended call: E — D now, B in a follow-up.**

**Step 1 (lands as part of Wave A implementation):**
- Default `policy: "lru"` in `LightCollectionOptions`. **Breaking** — covered by no-backward-compat budget.
- Add `peek(id: string): T | undefined` to `LightCollectionBundle<T>`. Same semantics as `get` minus the LRU touch / emit.
- JSDoc:
  - LRU-get-emits behavior on `get` ("for non-touching reads, use `peek()`").
  - No-Graph composition wart ("`bundle.entries` is detached; mount manually with `parent.add(bundle.entries)` for `describe()` / `lens.flow` coverage").
  - `createdAtNs` preserved across re-upserts (FIFO orders by **first** insert).
  - Reference to `reactiveMap` for callers who want richer features (TTL, score retention, custom backend).
- Tests: add `peek` test; add `clear`/`remove` early-return tests; add an explicit assertion that `get` under LRU triggers an `entries` snapshot (so the future B migration **breaks** this test loudly — F4 fix == intentional behavior change).

**Step 2 (filed in `docs/optimizations.md`, executed in a later parity pass):**
- Rebuild `lightCollection` (TS) and `light_collection` (PY) as thin facades over `reactiveMap` / `reactive_map`. Drop FIFO support OR ship a `FifoMapBackend` if a real caller needs FIFO. Estimated LOC delta: −50 TS, −50 PY. Estimated perf delta: 10–20× on `upsert` at typical sizes; eliminates copy-on-write GC churn under heavy reads.

**On FIFO support:** my call is **drop it in step 2**. No internal call site uses FIFO; `collection` defaults to LRU; FIFO is the wrong semantics for almost every cache. If a real user needs first-in-first-out, they can write 10 lines with `reactiveMap` + a sorted-by-insertion-time helper.

**On the rename (Option F):** **don't** — `lightCollection` is the right user-facing name; the documentation in step 1 closes the no-Graph confusion without renaming.

**On `extra/` relocation (Option H):** **defer.** After step 2 (rebuild on `reactiveMap`), `lightCollection` is a 20-LOC value-shape facade. At that point, relocation is a one-line change and we can decide based on whether `agentMemory` documentation still wants to surface it under "memory primitives."

**Coverage table:**

| Concern | D (step 1) | B (step 2) |
|---|---|---|
| Q2 — LRU `get` emits surprise | ✅ `peek()` + JSDoc | ✅ F4 inheritance — no emit |
| Q2 — `upsert` always emits | ⚠️ unchanged (could add `equals`) | ✅ inherited from `reactiveMap` semantics |
| Q3 — invariants | 🟢 already clean | 🟢 (same pattern) |
| Q4 — `optimizations.md` parallel-implementation drift | ⚠️ filed but not closed | ✅ closed |
| Q5 — abstraction overlap with `reactiveMap` | ⚠️ acknowledged | ✅ resolved (one source) |
| Q6 — drift risk | ⚠️ slowed but not stopped | ✅ eliminated |
| Q6 — FIFO default footgun | ✅ default `lru` | ✅ FIFO dropped or backend-pluggable |
| Q6 — `createdAtNs` preservation undocumented | ✅ JSDoc | ✅ JSDoc carries forward |
| Q6 — test coverage thin | ✅ early-return + peek tests | ✅ migration breaks LRU-emit test loudly |
| Q6 — cross-language drift | ⚠️ TS-only step | ✅ TS+PY mirrored |
| Q7 — perf O(n²) eviction | ⚠️ unchanged | ✅ O(1) via `MapBackend` |
| Q7 — copy-on-write GC churn | ⚠️ unchanged | ✅ single-backing-Map |

**Open questions for the user before locking:**

1. **Confirm E (D + B follow-up) vs alternatives.** Most consequential calls inside E:
   - **Default policy flip to `lru`** — breaking for any caller who relied on FIFO. Pre-1.0 free; do it?
   - **Drop FIFO in step 2** — lose the option entirely, or build `FifoMapBackend`?
   - **Add `peek(id)`** — accept the new public symbol on the bundle?
2. **Cross-language scope of step 1 (D).** Should the JSDoc / `peek` / default flip also land in `graphrefly-py` `light_collection` immediately, or stay TS-only until step 2?
3. **Relocation deferral.** Option H (move to `extra/`) — confirm we defer until after step 2?
4. **Vision-block surfacing.** When `agentMemory` documentation gets written, do we surface `lightCollection` as a public memory primitive, or only `collection` / `vectorIndex` / `knowledgeGraph`?

### Decisions locked (2026-04-24)

1. **Option E** — D (harden) now in Wave A, B (rebuild on `reactiveMap`) as a follow-up filed in `docs/optimizations.md`.
2. **Default policy flips to `lru`** — breaking change, free pre-1.0.
3. **Drop FIFO in step 2** — no internal caller needs it; if a real user does, they compose with `reactiveMap`.
4. **Add `peek(id): T | undefined`** to `LightCollectionBundle<T>`.
5. **PY parity: deferred** (rolled into the broader "defer Python parity" stance from Unit 1). Step 1 lands TS-only; step 2 mirrors when the parity pass runs.
6. **Option H (move to `extra/`) deferred** until after step 2.
7. **`agentMemory` does not expose `lightCollection`** — stays a low-tier helper, not a public-face vision block.

**Implementation scope when Wave A lands (step 1):**
- Edit `src/patterns/memory/index.ts:170` — flip `policy` default to `"lru"`, add `peek(id): T | undefined` to the bundle, add JSDoc covering: LRU-get-emit semantics, no-Graph composition wart, `createdAtNs` preservation across re-upserts, and a pointer to `reactiveMap` for richer features.
- Tests in `src/__tests__/patterns/memory.test.ts`: add `peek` test, `clear` / `remove` early-return tests, and an explicit test that LRU `get` triggers an `entries` snapshot (so step 2's F4 fix breaks it loudly).
- Add a one-line entry to `docs/optimizations.md` under "Active work items": "`lightCollection` parallel-implementation drift — rebuild as facade over `reactiveMap`; mirror PY; drop FIFO."

#### Revision 2026-04-25 (no-imperative-reads policy, see top-level lock)

Decisions revised:
- **Drop `peek(id: string): T | undefined`** from the bundle (was added by lock #4) — superseded by reactive `itemNode` below.
- **Drop `get(id): T | undefined`** and **`has(id): boolean`** entirely — superseded by reactive equivalents.
- **Add `itemNode(idNode: NodeOrValue<string>): Node<T | undefined>`** — derived over `entries` and `idNode`; lazy; `equals` reference-eq.
- **Add `hasNode(idNode: NodeOrValue<string>): Node<boolean>`** — same pattern; cheap because just `entries.has(id)`.
- **No `touch(id)` action.** Re-upsert is the canonical refresh path. Add only if a real caller surfaces.
- **LRU-emit-on-`get` test (was kept to break loudly when step-2 F4 lands) — drop the test entirely** because `get` itself is dropped. Instead, test that `itemNode("x")` does not retrigger when `entries` doesn't change.

Revised implementation scope:
- Bundle methods after Wave A: `upsert / remove / clear / itemNode / hasNode`. No imperative reads.
- Tests: reactive `itemNode` re-emit on upsert; reactive `hasNode` semantics; `clear` / `remove` early-return; `firstValueFrom(itemNode("x"))` for one-shot snapshot.

---

## Unit 3 — `collection` / `CollectionGraph`

**File:** `src/patterns/memory/index.ts:245-363`

### Q1 — Semantics, purpose, implementation

```ts
export function collection<T>(name: string, opts: CollectionOptions<T> = {}): CollectionGraph<T>
```

A `Graph` subclass with three internal nodes plus four imperative methods:

- **Internal topology** (`memory/index.ts:253-289`):
  - `items: state<ReadonlyMap<id, CollectionEntry<T>>>` (line 254) — primary store.
  - `ranked: derived([items], …)` (line 258) — sorted array of entries with live-decayed scores. Sort key: `score DESC, lastAccessNs DESC`.
  - `size: derived([items], …)` (line 275) — `entries.size`.
  - Edges: `items → ranked`, `items → size`. Two leaves under one source.
- **Bundled methods** (`Object.assign(graph, {…})` at line 324):
  - `upsert(id, value, opts?: { score?: number })` — copy-on-write Map; preserves `createdAtNs` across re-upserts; sets `lastAccessNs = monotonicNs()`; baseScore from `opts.score` or `opts.score(value)` or `() => 1`; eviction by lowest decayed score wins.
  - `remove(id)` / `clear()` — early-return on no-op.
  - `getItem(id)`: returns `CollectionEntry<T>` (id, value, baseScore, createdAtNs, lastAccessNs). Under `policy: "lru"` (default), mutates `lastAccessNs` and re-emits `items`.
- **Defaults:** `policy: "lru"`, `decayRate: 0` (decay disabled), `minScore: 0`, `score: () => 1`.
- **Eviction:** `evictIfNeeded` (line 296) — while over `maxSize`, scan all entries computing live `effective(entry, now)` via `decay`, evict the lowest-score entry; ties broken by oldest `lastAccessNs` (LRU) or `createdAtNs` (FIFO).
- **Keepalive:** `void ranked.subscribe(() => undefined)` and `void size.subscribe(() => undefined)` (lines 284–285) — ensures the deriveds activate without external subscribers.
- **Vision-block role:** Plausibly the canonical "scored agent memory" primitive surfaced under `agentMemory`. Tests only assert ranked-by-score and size correctness (`memory.test.ts:33-44`).

### Q2 — Semantically correct?

- **`ranked` reactive fn calls `monotonicNs()`** (line 262). The fn is **not pure with respect to its dep** — same `items` map yields different `ranked` outputs over time. Concrete consequence: between two `items` emissions, `ranked.cache` reflects scores frozen at the *last* emission's wall-clock; any caller reading `ranked.cache` later sees stale decay. For a read-only stretch (no upsert/get), the ranking ages without re-derivation. **This is the most consequential semantic issue in the unit.**
- **Same problem in `evictIfNeeded`** — `effective` calls `decay` with `now = monotonicNs()` per scan, so eviction decisions are time-dependent on call timing. Acceptable at write-time (eviction happens during `upsert` → `commit`), but correctness depends on callers writing frequently enough that staleness doesn't accumulate.
- **LRU `getItem` mutates and emits** (lines 354–358). Same surprise as `lightCollection.get`. Worse here: `getItem` is the only synchronous read API for a single entry's scored payload, so callers performing read-mostly access patterns trigger `items` emit → `ranked` resort → `size` re-emit per read. Pathological at high `getItem` rates.
- **`getItem` returns `CollectionEntry<T>` with `baseScore` only**, not the live decayed `score`. Callers wanting the live score must subscribe to or read `ranked` and search by id (O(N)). A `RankedCollectionEntry<T>` *is* exported (line 43) but no API returns one for a single id.
- **`upsert` always emits** even when `(id, value, score)` is unchanged. `state.emit` doesn't deduplicate without an `equals`; `items` `state` is created without one (line 254). Hot-path metric reporters spam `ranked` recomputation.
- **Eviction is O(N²) with a `Math.exp` per scan iteration.** Worst case: clear-then-burst that overshoots `maxSize` by k → cost ≈ `Σᵢ (N+i)·O(N)` ≈ `O(N²·k)`.
- **Keepalive subscriptions are never disposed.** `void node.subscribe(() => undefined)` returns an unsubscribe callback that's discarded. If the collection is destroyed via `graph.destroy()`, these sub callbacks are released through the graph's teardown chain (because the deriveds are mounted) — but the inline pattern leaks the disposer reference. Cosmetic in this case (the GC chain holds), but inconsistent with the named `keepalive(node)` helper used elsewhere (e.g. `lens/index.ts:397, 413`). **🟡 should use the helper.**
- **No `domainMeta`** on the internal nodes. Compare to `lens/index.ts:122` which tags every internal node with `domainMeta("lens", kind)` for describe()/mermaid grouping. `collection`'s nodes appear ungrouped in `describe()`. Cosmetic but degrades the explainability story.
- **`createdAtNs` preserved across re-upserts** (line 335) — same undocumented behavior as `lightCollection`.
- **`baseScore` computed at insert time** (line 329) — `scoreFn(value)` runs once per upsert, never refreshed unless caller re-upserts. If `scoreFn` depends on graph state outside `value`, the score is "frozen" at upsert time. Documented "insert/update time" (line 51) but the consequence isn't spelled out.

### Q3 — Design-invariant violations?

- **🟡 Time-dependent reactive fn.** `ranked`'s fn reads `monotonicNs()` (line 262). Spec §5.11 says use the central timer for timestamps — the call uses `core/clock.ts`, so the rule is satisfied. But COMPOSITION-GUIDE expects reactive fns to be a pure function of `(deps, prior fn output)`; calling the clock inside the fn breaks that. Violates the *spirit* (reactive purity, dry-run reproducibility) without violating the *letter*.
- **🟡 Inline keepalive.** `void ranked.subscribe(() => undefined)` reinvents the `keepalive(node)` helper from `extra/sources.ts:1171`. Known idiom mismatch.
- **🟡 No `domainMeta` tags** on internal nodes. Doesn't violate any invariant but undermines explainability (a Q7 concern).
- **🟢 Command-side mutators.** `upsert` / `remove` / `clear` / `getItem` call `state.emit` from outside reactive fns — sanctioned §24 Q2 pattern.
- **🟢 No raw async, no setTimeout, no Promise, no polling.**
- **🟢 Central timer used (`monotonicNs`) — spec §5.11 satisfied at the API level.**
- **🟢 Graph subclass** with `items / ranked / size` mounted — full describe() coverage. No islands.

Net: **🟡 gray-zone**, dominated by the time-dependence of `ranked`.

### Q4 — Open items

- **Time-dependence of `ranked`.** Largest open item; not currently in `docs/optimizations.md`. Candidate framings:
  - "`collection.ranked` cached scores stale between `items` emits — define query-time vs. snapshot-time semantics."
  - "Reactive fn purity: `monotonicNs()` inside `derived` fns — codify rule + alternatives (timer source, query-time API)."
- **Eviction perf.** O(N²) with `Math.exp` per scan — file alongside the Unit 2 rebuild ticket if `collection` also rebuilds on `reactiveMap`.
- **Inline keepalive vs. helper.** Tiny consistency item.
- **No `domainMeta` tags.** Tiny describe-quality item.
- **Test coverage.** One ranked test, one size assertion. No coverage of: decay over time, eviction by lowest-score, LRU `getItem` re-emit semantics, keepalive lifecycle, `score` callback. Drift risk.
- **Cross-language parity.** `graphrefly-py` `collection()` at `memory.py:550` — same drift risks; deferred per Unit 1/2 stance.

### Q5 — Right abstraction? More generic possible?

- **Monolithic shape.** `collection` bundles four concerns: (1) Map storage, (2) LRU/FIFO eviction, (3) score-based ranking with decay, (4) Graph wrapping with mounted internal nodes. A user wanting "LRU Map without ranking" gets `lightCollection`; "Map with custom ranking" must reimplement.
- **Decompose into building blocks:**
  - `reactiveMap<id, T>` (already exists) — Map + LRU/eviction.
  - `decoratedView(map, decorate)` — derived projection adding `lastAccessNs`, `baseScore`.
  - `rankedView(decorated, scoreFn)` — derived sort.
  - `mountAs(graph, name, …)` — Graph-wrapping convenience.
  - `collection` becomes a *preset* composing the above.
- **The `score: (value: T) => number` callback is the wrong abstraction.** It's evaluated at upsert time, freezing the score. A reactive scoring story requires upstream nodes (e.g. `score: (value, ctx) => derived([…], …)`) — out of scope for this primitive but the limitation should be documented.
- **`CollectionEntry<T>` storing `baseScore` conflates data and ranking metadata.** A cleaner shape: store raw `T` in the Map, derive `{value, baseScore}` in a downstream node. Would let users supply different ranking strategies without re-storing entries.
- **Naming:** `collection` is generic; `agentMemory.collection` is more specific. Acceptable as the canonical "scored memory store" — but the public surface should make the "ranked + decayed" intent obvious.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~120 LOC; three internal nodes; four bundle methods. Each bundle method follows the same copy-on-write commit pattern with subtle eviction-policy variations. Current burden is moderate — but the **time-dependence of `ranked` is a load-bearing latent issue** that will compound as users add more derived nodes downstream of `ranked`.

**Caveats / footguns:**

1. **Time-dependent `ranked` cache** is the dominant long-term concern. Three concrete failure modes:
   - **Read-only staleness:** A caller queries `g.get("ranked")` after a 5-minute idle period. Returned scores reflect decay frozen 5 minutes ago. If a downstream consumer re-ranks based on this, decisions are stale.
   - **Equals-comparison non-determinism:** A `derived([rankedA], …)` whose fn checks for changes via shallow equality may see "no change" even when the underlying decayed scores have shifted (because `ranked.cache` itself is the same array reference until the next emit). The `equals` comparator on `ranked` doesn't run unless the fn re-fires.
   - **Dry-run reproducibility (per CLAUDE.md "Dry-run equivalence rule"):** A `graph.observe(ranked)` recording two runs that differ only in wall-clock timing produces *different traces* even with identical `items` history. Breaks the "dry-run reproduces real run topology" guarantee for any test that asserts on `ranked` content.

   **Resolutions** (covered in Q8 alternatives):
   - **D1: Snapshot semantics.** `ranked` only carries scores frozen at last `items` emit; document explicitly. Add a `snapshot()` method or `getRanked(now?)` that computes live scores on demand. Cleanest mental model.
   - **D2: Periodic refresh.** Wire a `fromTimer` source so `ranked` re-derives at a tick rate. Adds polling-shape compute (counter to spec §5.8 in spirit, although `fromTimer` is a sanctioned reactive source). User opts in via `refreshIntervalMs`.
   - **D3: Caller-driven refresh.** Expose a `touch()` method that re-emits `items` to trigger `ranked` re-derive. Lightweight but pushes the timing decision to the caller.

2. **Eviction is O(N²) per excess** with a `Math.exp` per scan. For `maxSize=10k`, evicting 1 entry ≈ 10k×30ns ≈ 300μs; bursting to maxSize+100 ≈ 30ms. Outside the "lightweight" use case.

3. **`getItem` re-emits under LRU.** Same gotcha as Unit 2; same `peek` resolution applies.

4. **Keepalive leaks the disposer reference.** Replace with the named `keepalive(node)` helper; collect the returned disposers via `graph.addDisposer(...)` so destroy semantics are clean.

5. **No `domainMeta` tags.** `g.describe({ format: "mermaid" })` over a `collection` shows the three internal nodes but doesn't group them by domain. Side-by-side with a `lens` (which does tag), the `collection` looks unstructured. Two-line fix.

6. **`score: (value) => number` is upsert-time only.** Score-from-graph-state requires reimplementation. Document the limit; signal a future story (`scoreNode: Node<(value: T) => number>`) for reactive scoring.

7. **Decay parameterization (per Unit 1 lock).** Decision: **keep `decayRate`** (matches the `decay()` utility, single mental model). Add a JSDoc cross-reference noting the half-life conversion: `decayRate = LN2 / halfLifeSeconds`. Do not introduce a separate `halfLifeSeconds` option — it would add a parallel parameterization with subtle precedence rules.

8. **Public-export commitment.** Five public symbols: `CollectionPolicy`, `CollectionEntry<T>`, `RankedCollectionEntry<T>`, `CollectionOptions<T>`, `CollectionGraph<T>`, `collection<T>`. Pre-1.0, tightening tactics (rename, restructure, strip baseScore from `CollectionEntry`) are free.

9. **Cross-language drift.** PY `collection()` at `memory.py:550` shares all the above caveats. Per the deferred-PY-parity stance, fixes land in TS first; PY mirrors when the parity pass runs.

10. **Vision-block alignment.** This IS the canonical `agentMemory.collection` primitive. Documentation around `agentMemory` should treat it as the public face; `lightCollection`, `vectorIndex`, `knowledgeGraph` are siblings. Time-dependence resolution determines whether the doc can promise "decay-aware ranking" or has to caveat "scores reflect last write."

**What hurts in 6 months:**
- A user files: "my `collection.ranked` returned the same scores after 10 minutes — is decay broken?" Answer is "load-bearing semantic; documented" — only if D1 or D2 lands.
- A new derived consumer downstream of `ranked` fires non-deterministically because `equals` doesn't see staleness.
- Eviction pathologies surface under burst-write workloads.
- A second `agentMemory` doc pass clarifies the `collection` vs. `lightCollection` story, exposing the FIFO/no-Graph footguns of `lightCollection` (already addressed at Unit 2) and the time-dependence of `collection.ranked` (addressed here).

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check (run mentally):**

```ts
const g = collection<number>("mem", { maxSize: 3, score: v => v, decayRate: 0.01 });
g.upsert("a", 1);
g.upsert("b", 5);
g.upsert("c", 3);
g.describe({ format: "ascii" });
// → items (state)
//   ├─→ ranked (derived)
//   └─→ size  (derived)
```

- ✅ Three nodes, two edges, no islands. `items → ranked` and `items → size`.
- ✅ `graph.explain("items", "ranked")` produces a 1-edge causal chain.
- ✅ `getItem` / `upsert` / `remove` / `clear` are command-side mutators — they appear in describe()'s `events` stream (when `observe` is enabled), not as edges. Correct.
- ⚠️ **No `domainMeta`** — mermaid output lists the three nodes ungrouped. Cosmetic.
- ⚠️ **`monotonicNs()` inside `ranked` fn** doesn't appear in any describe() surface, so a reader debugging stale scores has no signal that the fn is time-dependent. Worth a JSDoc + a `meta.timeDependent: true` tag (or similar) for tooling.

**Composability:**
- **As an upstream:** `derived([collection.ranked], …)` works trivially. Testable.
- **As a sink:** No reactive way to feed `upsert` from a source — same `wireUpsert` gap as Unit 2.
- **Mounted under a parent Graph:** Good. `parent.mount("memories", coll)` exposes `memories::items`, `memories::ranked`, `memories::size` paths in the parent's describe.

**Simplification (sketch):**

If we land D2 (periodic refresh) with `refreshIntervalMs`:
```ts
const refreshTick = opts.refreshIntervalMs
  ? fromTimer(opts.refreshIntervalMs * NS_PER_MS, { name: "ranked_refresh" })
  : undefined;
const ranked = derived(
  refreshTick ? [items, refreshTick] : [items],
  ([snapshot]) => sortByDecayedScore(snapshot ?? new Map()),
  { name: "ranked", describeKind: "derived", equals: rankedEqual },
);
```
~5 LOC delta. `equals: rankedEqual` cancels redundant emits when scores haven't shifted enough to change order. **Cost: a polling-shape source even when no decay is configured** — must gate on `decayRate > 0`.

Alternative D1 (snapshot) is even simpler:
```ts
// JSDoc on `ranked`: "scores reflect decay at last items-emit. For live scores, call `getRanked()`."
getRanked(): RankedCollectionEntry<T>[] {
  const now = monotonicNs();
  return [...readMap(items).values()]
    .map(e => ({ ...e, score: decay(e.baseScore, ageSec(now, e), decayRate, minScore) }))
    .sort((a, b) => b.score - a.score || b.lastAccessNs - a.lastAccessNs);
}
```
Adds one method; `ranked` becomes a frozen-at-last-emit snapshot.

**Perf:**
- `ranked` derive: O(N log N) sort + O(N) `Math.exp` per emit. N=10k ≈ ~5ms.
- `size` derive: O(1) (just `.size`).
- `evictIfNeeded`: O(N²) with `Math.exp` per scan iteration. N=10k, 1 eviction ≈ ~300μs; 100 evictions ≈ ~30ms.
- `upsert` excluding eviction: O(N) (copyMap).
- Rebuilding on `reactiveMap` (analogous to Unit 2 step B): `upsert` becomes O(1) amortized; eviction O(1) per excess; `ranked` perf unchanged (still must sort).

**Memory:**
- Each `items` emit allocates a fresh Map (copy-on-write). 10k entries ≈ ~200KB per emit.
- Each `ranked` emit allocates a sorted array of N decorated entries ≈ ~200KB per emit.
- Hot-path with frequent `getItem` under LRU: 2× allocation per read (items map copy + ranked array). GC pressure noticeable beyond ~1k entries with ~100 reads/sec.

### Q8 — Alternatives

**A. Keep as-is.** No code change.
- Pros: zero churn; tests still pass.
- Cons: time-dependence of `ranked` stays load-bearing; eviction perf stays O(N²); keepalive idiom drifts; no `domainMeta`.

**B. Apply D1 (snapshot semantics) only.** Keep `ranked` as snapshot-at-last-emit; add `getRanked()` for live; JSDoc the trade-off.
- Pros: minimal change; preserves reactive purity; cleanest mental model; no new sources.
- Cons: callers wanting reactive live decay get nothing — must roll their own `fromTimer + derived`.

**C. Apply D2 (periodic refresh) only.** Wire optional `refreshIntervalMs` → `fromTimer` → `ranked` re-derives at the tick.
- Pros: live ranking out of the box; opt-in (default disabled); reactive end-to-end.
- Cons: callers who configure decay get a polling-shape source whether they want it or not (gated by user setting); equals-comparator becomes important to avoid spamming downstream.

**D. Apply D1 + D2.** Snapshot semantics by default; opt-in periodic refresh via `refreshIntervalMs`.
- Pros: best of both; default behavior is purely reactive; users opt in to refresh.
- Cons: two concepts in one API; doc burden.

**E. Decompose into building blocks** (per Q5). Drop the monolithic `collection`; ship `reactiveMap` + `rankedView` + `mountAs`. `collection` becomes a preset.
- Pros: maximum composability; one source of truth for Map semantics; users can swap ranking strategies.
- Cons: large migration; many existing call sites; PY mirror needed. Likely a phase-5 refactor, not a Wave-A item.

**F. Rebuild storage on `reactiveMap`** (mirror Unit 2 step B). `items` becomes a `reactiveMap<id, CollectionEntry<T>>`; `ranked` and `size` continue as derived siblings.
- Pros: O(1) amortized `upsert`; eliminates copy-on-write GC churn; LRU semantics inherited.
- Cons: need to figure out how to express "score-based eviction" through `reactiveMap`'s `retention` interface — the `ReactiveMapRetention` shape is score-based, which actually fits perfectly. Would land alongside Unit 2 step B in the parity pass.

**G. Apply D + F + cosmetic fixes.** Snapshot semantics + opt-in refresh + rebuild on `reactiveMap` + use `keepalive` helper + add `domainMeta` tags.
- Pros: addresses every Q6 concern.
- Cons: large change footprint; cross-cuts Wave A and the post-Wave parity pass.

**H. Apply D (snapshot + opt-in refresh) + cosmetics now; defer F to the parity pass.**
- Pros: closes the time-dependence issue immediately; cosmetics are 5-line wins; defers the storage rebuild to land alongside Unit 2 step B.
- Cons: temporary inconsistency between "ranked semantics decided" and "storage shape pending."

**I. Strip `baseScore` from `CollectionEntry`** (per Q5 critique). Store raw `T`; derive `{value, baseScore}` in `ranked`'s fn from the user-supplied `score` callback.
- Pros: cleaner data/ranking separation; lets users swap ranking strategies without re-upserting entries.
- Cons: breaks `getItem` return shape; `score` callback runs on every `ranked` re-derivation (was: once per upsert) — different semantics, harder for users to reason about caching.

### Q9 — Recommendation (revised after user pushback)

**User pushback (2026-04-24):** "can this not be all reactive? Why do we need refreshIntervalMs? are you saying the changes to the collection are not known or reactive?"

**Reframing.** Mutations to the collection ARE fully reactive — every `upsert` / `remove` / `clear` / `getItem` (under LRU) emits on `items`, which propagates to `ranked` and `size`. The **only** non-reactive surface in the current design is **time itself**: the fn body reads `monotonicNs()` directly, so wall-clock advance silently changes the *theoretically correct* decayed score without any node emitting.

GraphReFly's answer to "I need to react to time" is **`fromTimer`** (spec §5.8 — no polling; sanctioned reactive timer source). Time is an effect; effects belong in sources, not in fn bodies. The original recommendation (snapshot semantics + `getRanked()` + opt-in refresh) is a hybrid that ships an imperative escape hatch instead of modeling time as a first-class reactive input. Revised below.

**Recommended call: H′ — fully reactive ranking via `fromTimer` dep; cosmetic fixes; F (rebuild on `reactiveMap`) follow-up.**

**Step 1 (lands in Wave A implementation):**

1. **Make `ranked` fully reactive end-to-end.** When `decayRate > 0`, wire a `fromTimer` source as a second dep of `ranked`. The fn becomes pure of deps `(itemsSnapshot, tickPayload) → sortedRanked`. Two implementation choices for the tick payload:
   - **Tick emits `nowNs`** — `fromTimer` source maps each tick to `monotonicNs()` and emits as DATA. The fn reads `nowNs` from its second dep, never calls the clock. **Strictly pure-of-deps; dry-run-reproducible with a mocked clock.** Preferred.
   - **Tick emits a counter; fn reads `monotonicNs()`** — practically equivalent, slightly impure-of-deps (fn-eval-time vs tick-emit-time can differ by a few ms). Simpler implementation.

   Default to the first; document the trade-off.

2. **`refreshIntervalMs` is a tuning parameter, not a feature flag.** When `decayRate > 0`, a timer is **always** wired (no opt-in). The default interval is auto-derived from `decayRate` (e.g. tick at `halfLife / 10 = ln2 / (10·decayRate)` seconds → ~10% staleness budget). Caller can override via `refreshIntervalMs` for tighter or looser cadence. When `decayRate === 0`, **no timer** — `ranked` deps stay `[items]` and the fn is trivially pure (no decay → no time term).

3. **Drop the `ranked` keepalive** (`void ranked.subscribe(() => undefined)` at line 284). With the timer always wired (when decay > 0), the keepalive forces the timer to fire forever even when nothing consumes the ranking. Lazy activation is correct: when `ranked` has zero subscribers, the timer should not run. Consequence: `g.get("ranked")` returns `undefined` until at least one subscriber attaches. Document this as the consequence of "fully reactive" — and provide an explicit `keepalive(coll.ranked)` escape hatch in the JSDoc example for callers who want eager activation.

4. **Drop `getRanked()` from the proposal.** No longer needed — `ranked.cache` is always current (modulo tick latency, which is bounded by `refreshIntervalMs`).

5. **Equality comparator on `ranked`.** Pass `equals: rankedEqual` (length + element-by-element `id, score, lastAccessNs` check) so identical sort-order ticks don't re-emit downstream. Critical for the always-on-timer story — without `equals`, every tick fires DATA even when nothing changed.

6. **Replace inline keepalive on `size`** with `keepalive(size)` from `extra/sources.ts`, collected via `graph.addDisposer(...)`. (We're keeping the keepalive on `size` because it's a pure-of-items derived with no timer cost — consistency with current behavior.)

7. **Add `domainMeta("memory", kind)` to internal nodes.** Tag `items` as `"state"`, `ranked` as `"ranked"`, `size` as `"size"`, the timer (when present) as `"clock"`. Improves describe()/mermaid grouping.

8. **JSDoc tightening.** Document:
   - `createdAtNs` preserved across re-upserts.
   - `score` callback runs once per upsert (frozen at write-time; reactive scoring is a future story).
   - `decayRate` is the canonical parameter (per Unit 1 lock); half-life conversion: `λ = ln 2 / halfLifeSeconds`.
   - `ranked` is fully reactive: when `decayRate > 0`, mounted with a `fromTimer` dep at `refreshIntervalMs`-cadence.
   - `ranked` has no internal keepalive; subscribe to it (or call `keepalive(coll.ranked)`) to keep the timer warm.

9. **Tests:**
   - Decay-over-time: with `decayRate > 0` and a subscribed `ranked`, advance the mocked clock past one tick and assert `ranked` re-emits with shifted scores **without** any `upsert` happening. (Validates that time-driven re-ranking is reactive.)
   - Lazy timer: with `decayRate > 0` but no subscriber to `ranked`, advance the clock past 10 ticks and assert the timer source emitted zero ticks (or, equivalently, `ranked.cache === undefined`). (Validates lazy activation.)
   - `equals` short-circuit: with `decayRate` set very low so scores barely shift between ticks, assert downstream consumers don't see redundant DATA. (Validates the `rankedEqual` comparator.)
   - Eviction-by-lowest-score: existing semantics, missing test.
   - LRU `getItem` re-emit: existing semantics, missing test (so step 2 / F's F4-touch-without-emit fix breaks it loudly).

**Step 2 (filed in `docs/optimizations.md`, executed in the parity pass alongside Unit 2 step B):**

- Rebuild `items` as a `reactiveMap<id, CollectionEntry<T>>` with `retention` configured for score-based eviction (`ReactiveMapRetention.score = effective(entry, now)`).
- Drop `evictIfNeeded` (handled by the backend).
- Drop the copy-on-write `commit` pattern (handled by the backend).
- F4 LRU touch on `getItem` no longer emits — the existing LRU-emit test from step 1 breaks intentionally.
- Mirror PY in the same pass.

**On the dropped pieces from H:**
- **`getRanked()` method:** dropped. With time as a reactive dep, `ranked.cache` is current; no need for a query-time API. Callers wanting "scores at exactly this `now`" subscribe to `ranked` and read the latest emit.
- **Snapshot semantics:** dropped. `ranked` is no longer a "snapshot at last items emit" — it's a live reactive view of decayed scores.
- **Opt-in `refreshIntervalMs`:** flipped to default-on-when-decayRate>0; the parameter is tuning, not a feature gate.

**On Q5 / Option I (strip `baseScore`):** **Don't** — the per-upsert score callback is a deliberate choice (caches a potentially-expensive scoring fn). Reactive scoring (`scoreNode: Node<(value: T) => number>`) is a separate roadmap item.

**On Option E (full decompose):** **Don't** — phase-5 refactor, not a Wave-A item.

**On half-life vs. rate (per Unit 1 deferral):** **Keep `decayRate`.** JSDoc the half-life conversion. Do not add `halfLifeSeconds`.

**Coverage table:**

| Concern | Step 1 (H′ — fully reactive + cosmetics) | Step 2 (F, parity pass) |
|---|---|---|
| Q2 — time-dependent `ranked` fn | ✅ time becomes a reactive dep via `fromTimer`; fn pure-of-deps | (no change) |
| Q2 — LRU `getItem` re-emit surprise | ⚠️ JSDoc only (`peekItem` discussed in open questions) | ✅ F4-touch-without-emit |
| Q2 — `upsert` always emits | ⚠️ JSDoc only | ✅ inherited `reactiveMap` semantics |
| Q2 — eviction perf O(N²) | ⚠️ unchanged | ✅ O(1) per excess via `reactiveMap` retention |
| Q3 — time-dependence (gray-zone) | ✅ resolved fully reactively | (no regression) |
| Q3 — inline keepalive on `ranked` / `size` | ✅ keepalive dropped from `ranked`; `keepalive(size)` helper | (no regression) |
| Q3 — no `domainMeta` | ✅ added | (no regression) |
| Q4 — open items | ✅ all filed; step 2 ticket cross-references Unit 2 | (closed at execution) |
| Q5 — monolithic shape | ⚠️ acknowledged; full decompose deferred to phase 5 | ⚠️ unchanged |
| Q5 — `score` callback upsert-time only | ✅ JSDoc | (unchanged) |
| Q6 — read-only staleness | ✅ resolved by reactive timer | (unchanged) |
| Q6 — equals-comparator non-determinism | ✅ explicit `equals: rankedEqual` | (unchanged) |
| Q6 — dry-run reproducibility | ✅ pure-of-deps fn (clock provided via tick payload) | (no regression) |
| Q6 — half-life parameterization | ✅ JSDoc cross-ref `λ = ln 2 / halfLife`; no new param | (unchanged) |
| Q6 — test coverage thin | ✅ five new tests (decay-over-time, lazy timer, equals short-circuit, eviction, LRU re-emit) | (one more for `reactiveMap` retention) |
| Q6 — cross-language drift | ⚠️ TS-only step 1 (deferred PY parity) | ✅ TS+PY mirrored |
| Q7 — copy-on-write GC churn | ⚠️ unchanged | ✅ single-backing-Map |
| Q7 — always-on timer perf | ✅ lazy via dropped `ranked` keepalive (timer fires only with subscriber) | (no regression) |

**Open questions for the user before locking:**

1. **Confirm H′ (fully reactive timer dep) vs. alternatives.**
2. **Tick payload shape:** `nowNs` value (pure-of-deps; preferred) vs counter + `monotonicNs()` inside fn (simpler; minor impurity)? Default proposed: **`nowNs` value**.
3. **Default `refreshIntervalMs` derivation:** auto from `decayRate` (e.g. `halfLife/10`) vs. require user to specify? Default proposed: **auto-derive**, allow override.
4. **Drop `ranked` keepalive (lazy activation)?** Consequence: `g.get("ranked")` returns `undefined` until subscribed. Default proposed: **drop**.
5. **`peekItem(id)` symmetry with Unit 2's `peek(id)`?** Default proposed: **yes**.
6. **Drop FIFO support in step 2 (mirrors Unit 2)?** Default proposed: **yes**.
7. **Defer reactive `scoreNode`?** Default proposed: **yes**.
8. **`domainMeta("memory", …)` tagging?** Default proposed: **yes**.
9. **Confirm: keep `decayRate`, JSDoc half-life conversion, no new param** (per Unit 1 lock)? Default proposed: **confirm**.
10. **PY parity for step 1: defer to Python parity pass?** Default proposed: **defer**.

### Decisions locked (2026-04-25)

1. **Recommendation H′ — fully reactive, BOTH steps land together in Wave A.** User locked "no defer reactiveMap" → step 1 (fully reactive timer dep + cosmetics) and step 2 (rebuild `items` on `reactiveMap` with score-based retention) are landed as one cohesive change, not staged.
2. **Tick payload: `nowNs` value** — `fromTimer` source maps each tick to `monotonicNs()` and emits as DATA payload; `ranked` fn reads `now` from its second dep, never calls the clock. Strictly pure-of-deps; dry-run-reproducible with mocked clock.
3. **`refreshIntervalMs` auto-derived** from `decayRate` (default ≈ `halfLife / 10` = `ln 2 / (10·decayRate)` seconds → ~10% staleness budget). User can override.
4. **Drop `ranked` keepalive** — lazy activation. `g.get("ranked")` returns `undefined` until subscribed. Document the `keepalive(coll.ranked)` escape hatch for callers who want eager activation.
5. **Add `peekItem(id): CollectionEntry<T> | undefined`** to `CollectionGraph<T>` — non-touching read; symmetry with Unit 2's `peek(id)`.
6. **Drop FIFO support** in step 2 (mirrors Unit 2 lock).
7. **Reactive `scoreNode` lands in this unit (NOT deferred).** Locked interpretation: user's "no" on the deferral question = ship now. Implementation:
   - `CollectionOptions<T>.score` accepts `(value: T) => number` **or** `Node<(value: T) => number>`.
   - When supplied as a Node, `score.cache` (or `score.subscribe()` first DATA) is read at `upsert` time AND added as a `ranked` dep so the ranking re-derives if the scoring fn itself changes.
   - `baseScore` stays cached on each entry (not recomputed reactively) — re-scoring all entries on a fn change requires a re-upsert sweep, which is opt-in via a `coll.rescore()` method (added).
   - `rescore()` walks `items`, recomputes `baseScore` for each via the latest score fn, emits `items`. O(N).
8. **`domainMeta("memory", kind)` tagging** on `items`, `ranked`, `size`, the timer source.
9. **Confirmed: keep `decayRate`** (one parameter, matches `decay()` utility); JSDoc the half-life conversion `λ = ln 2 / halfLife`. No `halfLifeSeconds` option.
10. **PY parity for step 1: deferred** to the Python parity pass. TS-only implementation in Wave A.

**Implementation scope when Wave A lands (Unit 3):**

A. **`src/patterns/memory/index.ts:245-363` rewrite:**
   - `items` becomes `reactiveMap<id, CollectionEntry<T>>` with `retention` configured for score-based eviction (`ReactiveMapRetention.score = effective(entry, now)`). Drop `evictIfNeeded` + copy-on-write `commit`.
   - `ranked` becomes `derived([items.entries, refreshTick?, scoreNode?], …)` with `equals: rankedEqual`; fn pure-of-deps.
   - `refreshTick` mounted only when `decayRate > 0`; tick fires `monotonicNs()` as DATA payload at `refreshIntervalMs` cadence (auto-derived from `decayRate` unless user overrides).
   - `scoreNode` dep added when `score` is passed as a `Node`; `baseScore` recomputed on `coll.rescore()` only.
   - Drop `ranked` keepalive; replace `size` keepalive with `keepalive(size)` helper + `addDisposer`.
   - Add `domainMeta("memory", kind)` to all internal nodes.
   - Add `peekItem(id)` and `rescore()` methods.
   - JSDoc tightening: `createdAtNs` preservation, `score` callback timing, half-life conversion, lazy `ranked` activation, dry-run reproducibility.
B. **`src/__tests__/patterns/memory.test.ts` additions:**
   - Decay-over-time with mocked clock + subscribed `ranked` (validates time-driven re-rank without `upsert`).
   - Lazy timer activation (no subscriber → no tick → `ranked.cache === undefined`).
   - `equals` short-circuit (low decayRate → identical sort orders don't re-emit).
   - Eviction-by-lowest-score via `reactiveMap` retention.
   - LRU `getItem` no-emit (F4 behavior — replaces the "would-have-broken-loudly" test from the deferred plan).
   - `peekItem(id)` non-touching semantics.
   - Reactive `scoreNode`: `score` Node emits new fn → `ranked` deps fire → after `rescore()`, `baseScore` reflects new fn.
C. **`docs/optimizations.md`:** No deferred-rebuild ticket needed (rebuild lands in Wave A). File only the cross-language parity item ("PY mirror of TS Unit 3 changes pending parity pass").

#### Revision 2026-04-25 (no-imperative-reads policy, see top-level lock)

Decisions revised:
- **Drop `peekItem(id): CollectionEntry<T> | undefined`** from `CollectionGraph<T>` (was added by lock #5) — superseded by reactive `itemNode` below.
- **Drop `getItem(id): CollectionEntry<T> | undefined`** entirely (the LRU-touch read) — superseded by reactive equivalent. LRU touch as a side-effect of read disappears.
- **Add `itemNode(idNode: NodeOrValue<string>): Node<CollectionEntry<T> | undefined>`** — derived over `items.entries` (post-`reactiveMap` rebuild) and `idNode`; lazy; `equals` reference-eq.
- **No `touch(id)` action** — re-upsert is the canonical refresh path. Add only if a real caller surfaces.
- LRU-`getItem`-emit test (lock #B item 5) — drop entirely; replaced with `itemNode` reactivity tests.

Revised methods after Wave A: `upsert / remove / clear / rescore / itemNode`. No imperative reads.

Revised tests:
- Reactive `itemNode("x")` emits the latest entry; re-emits on upsert / re-upsert / removal of "x"; doesn't emit on unrelated upserts (via `equals`).
- `firstValueFrom(itemNode("x"))` for one-shot reads in tests.
- Existing decay-over-time, lazy-timer, equals-short-circuit, eviction, reactive `scoreNode`/`rescore` tests carry forward unchanged.

---

## Unit 4 — `vectorIndex`

**File:** `src/patterns/memory/index.ts:365-431`

### Q1 — Semantics, purpose, implementation

```ts
export function vectorIndex<TMeta>(opts: VectorIndexOptions<TMeta> = {}): VectorIndexBundle<TMeta>
```

Reactive vector store with optional HNSW backend. Returns a bundle (no Graph subclass — same shape as `lightCollection`):

- **`backend: VectorBackend`** — `"flat"` (default) | `"hnsw"`.
- **`entries: Node<ReadonlyMap<id, VectorRecord<TMeta>>>`** — single `state()` (line 378), NOT mounted to any Graph.
- **`upsert(id, vector, meta?)`** — `assertDimension`; `copyMap`; `set` with deep-copied vector (line 401: `[...vector]`); if `backend === "hnsw"`, also `hnsw!.upsert(id, vector, meta)`; `commit(next)`.
- **`remove(id)`** — early-return on missing key; if hnsw, also `hnsw!.remove(id)`; commit.
- **`clear()`** — early-return on empty; if hnsw, also `hnsw!.clear()`; emit empty Map.
- **`search(query, k=5): readonly VectorSearchResult<TMeta>[]`** — **imperative**, returns a snapshot. `assertDimension(query)`; `k <= 0` returns `[]`; if hnsw, delegate to `hnsw!.search(query, k)`; else flat scan via `cosineSimilarity` + sort + slice.

**`HnswAdapter<TMeta>` interface** (line 83): `upsert / remove / clear / search`. Factory called **once** at construction (line 370); adapter held in closure (`hnsw`) for the bundle's lifetime. Throws if `backend === "hnsw"` and no `hnswFactory` supplied.

**`cosineSimilarity` helper** (line 154): zero-pads to `max(a.length, b.length)`. Documented in `memory.test.ts:60-65`. Returns 0 for either-side zero-norm.

**`VectorRecord<TMeta>`** (line 71): `{ id, vector: readonly number[], meta?: TMeta }` — frozen-shape entry.

**Cross-language:** `graphrefly-py` ships an equivalent `vector_index` at `memory.py:346` (class shape, same flat/hnsw split, same `hnsw_factory` injection).

### Q2 — Semantically correct?

1. **`search()` is imperative**, not reactive. Returns a snapshot at call time. Subscribers to `entries` see updates; callers using `search()` must re-call to see new results. This is the dominant semantic issue — the bundle exposes a reactive `entries` AND an imperative `search`, two surfaces with different freshness contracts.
2. **HNSW adapter state is mirrored from `entries`**, not derived from it. Two sources of truth → drift surface:
   - If adapter `upsert` succeeds but the subsequent `commit(next)` throws (e.g. a subscriber's onMessage handler errors), adapter has the new record while `entries` does not.
   - If adapter `remove` throws but the imperative `next.delete(id)` already ran, `entries` claims absence while adapter retains the record.
   - If adapter is implemented atop a remote service (Pinecone, Weaviate, Qdrant) that briefly goes down, the in-memory `entries` map and the remote service silently diverge with no recovery API.
3. **No `reindex()` / `rebuild()` API.** If adapter and entries drift, there's no path to reconcile.
4. **HNSW factory called once at construction** (line 370). If the adapter dies (e.g. internal error), the bundle has no recovery path; users must throw away the entire `vectorIndex` and rebuild.
5. **`upsert` always emits**, even when the same `(id, vector, meta)` is re-upserted. Same churn as `lightCollection` / pre-revision `collection`.
6. **No size limit / no eviction.** `vectorIndex` grows unboundedly. For agent-memory use cases (where docs/embeddings accumulate), this is exactly the failure mode. `collection` has `maxSize`; `vectorIndex` has none.
7. **Cosine zero-pad is silent.** When `dimension` is unset and vectors have different lengths, similarities degrade. Documented in tests (line 60-65) but not in JSDoc. A user who unintentionally mixes 768-dim and 1024-dim vectors gets unhelpful results, no error.
8. **`dimension` mismatch throws** RangeError when `dimension` IS set. Strict path is fine; the issue is the lenient path's silent degradation.
9. **`search(query, k=5)` with `k > entries.size`** returns all entries. Fine.
10. **Vector defensive copy** at upsert (line 401: `[...vector]`). Prevents caller mutation. Good.
11. **`entries` is detached** (no Graph mount) — same wart as Unit 2.
12. **No `equals` on `state(entries)`** — every emit propagates regardless of content equality.

### Q3 — Design-invariant violations?

- 🟢 No async / Promise / setTimeout / polling.
- 🟢 No clock reads inside any reactive fn (no deriveds at all — only `state()`).
- 🟢 Command-side mutators use `state.emit` from outside fn bodies.
- 🟡 **Imperative `search()` is the dominant gray-zone.** Phase 4+ guideline says reactive output where it's natural; topK over a reactive Map IS the natural reactive shape. Users currently must wrap in their own `derived([entries], …)` to get reactive search results.
- 🟡 **No-Graph wart** — `entries` detached; describe()/lens.flow inoperative without manual mounting; inconsistent with `collection`.
- 🟡 **HNSW adapter state externalized** — held in closure, mirrored from `entries`. Adapter lifecycle untracked by graph teardown (no `addDisposer`). Drift surface (Q2 #2).
- 🟡 **No `domainMeta` tags** — `entries` appears ungrouped in mermaid output.
- 🟢 No raw async, no fn impurity, no spec §5.8–5.12 letter-of-rule violations.

Net: **🟡 gray-zone**, dominated by imperative-search and adapter-state externalization.

### Q4 — Open items

- **Reactive search.** Largest open item; not in `docs/optimizations.md`.
- **Adapter state consistency / recovery.** No `reindex()`; no adapter `dispose()` plumbing.
- **No-Graph wart** (mirrors Unit 2).
- **No eviction / unbounded growth.** Memory leak surface for long-running graphs.
- **Cosine zero-pad lenient default.** Strict-mode toggle?
- **Cross-language parity.** PY ships `vector_index` at `memory.py:346` — same drift risks; deferred per the established Python-parity stance.
- **Test coverage thin.** `memory.test.ts:46-66` covers flat-search, hnsw-throws-without-factory, and zero-pad. Missing: reindex, eviction, adapter-state divergence, dimension mismatch, defensive vector copy.

### Q5 — Right abstraction? More generic possible?

- **Wrong-shaped bundle.** For "just a Map" → `reactiveMap` / `lightCollection`. For "search-capable index" → search must be reactive AND storage must be Graph-mounted. `vectorIndex` is half of each.
- **HNSW adapter abstraction is right** (pluggable, inject via factory). The lifecycle is wrong — adapter should be tied to graph teardown via `addDisposer`. Also missing `dispose()` on the `HnswAdapter` interface.
- **Storage is independent of search.** A `vectorIndex` could be split into:
  - `reactiveMap<id, VectorRecord<TMeta>>` (storage)
  - `searchNode(map, query, k, similarity?)` (reactive query)
  - Pluggable similarity / backend per call
- **`VectorRecord<TMeta>`** is the right entry shape. `meta?: TMeta` is correct.
- **Naming:** `vectorIndex` is descriptive. Consider `vectorStore` or `vectorMemory` — but `vectorIndex` is the established term in the embedding-search ecosystem (Pinecone/Weaviate use "index"). Keep.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~67 LOC, four bundle methods, one helper (cosineSimilarity at line 154). Lower than `collection` because there's no decay, no eviction, no ranking. But the **lack of reactive search** is the load-bearing latent issue: every consumer that wants live results writes the same wrap-in-derived boilerplate.

**Caveats / footguns:**

1. **Imperative-search anti-pattern.** Same shape problem as Unit 3's pre-revision `getRanked()` — a reactive primitive with an imperative read API. The fully-reactive shape (per the Unit 3 framing) is `searchNode(query, k): Node<results>` that re-derives on `entries` / `query` / `k` change. Without it, users compose `vectorIndex` with `fromTimer` or `effect` to bridge the gap, fighting the framework instead of leveraging it.
2. **Adapter state divergence is a production hazard.** Concrete failure modes:
   - Network blip during HNSW upsert → adapter has the record, `entries` doesn't.
   - Process restart → adapter (if persistent like Pinecone) retains records that the new in-memory `entries` doesn't know about.
   - Adapter rebuild (e.g. HNSW lib version upgrade) requires reconstruction from `entries` — no `reindex()` API exists.
3. **Adapter lifecycle untracked.** Bundle goes out of scope → adapter held by closure if anyone retains a reference; no `dispose()` path. For HNSW backed by native code (e.g. `hnswlib-wasm`), this is a real memory leak.
4. **Unbounded memory growth.** No `maxSize`. For a long-running agent that ingests new docs daily, the index grows monotonically until the process OOMs. Compare to `collection` (`maxSize`, score-based eviction).
5. **Cosine zero-pad silent default.** Mixed-dimension vectors silently produce degraded scores. A strict mode (`dimension` required, OR enforced same-length) would surface the bug. Pre-1.0 free.
6. **`upsert` always emits.** Hot-path metric-style upserts (re-emit same vector) trigger `entries` snapshot churn. Solvable with an `equals` comparator on `state` or `reactiveMap` semantics.
7. **No-Graph composition wart.** Same as Unit 2 — `bundle.entries` detached; describe()/lens.flow inoperative without manual mount.
8. **Cosine assumes Euclidean / dot-product space.** Embedding models that require L2 normalization first (most do) leave that to the caller. Documented in JSDoc? No. Should be.
9. **No `searchN(query, kPerVariant)`** for multi-query topK — common in RAG pipelines. Out of scope but worth noting as a future consideration.
10. **Public-export commitment.** Seven exported symbols (`VectorBackend`, `VectorRecord`, `VectorSearchResult`, `HnswAdapter`, `VectorIndexOptions`, `VectorIndexBundle`, `vectorIndex`). Pre-1.0 free to restructure.
11. **Vision-block alignment.** This IS part of the canonical `agentMemory` surface (alongside `collection` and `knowledgeGraph`). Documentation will cover all three. The reactive-search story determines whether `vectorIndex` reads as a first-class reactive primitive or a hybrid shim.
12. **Cross-language drift.** PY `vector_index` (`memory.py:346`) shares the same imperative-search, no-Graph, adapter-externalization caveats. Per the deferred-PY-parity stance, fixes land in TS first; PY mirrors when the parity pass runs.

**What hurts in 6 months:**
- A user files: "my vectorIndex.search results are stale after upsert" — answer is "imperative; re-call" (until reactive search lands).
- A production HNSW adapter falls out of sync after a reconnect; no recovery API exists.
- Long-running agent OOMs because `vectorIndex` has no eviction.
- A bug report on cosine similarity returning unexpectedly low scores — root cause is silent zero-padding from mismatched dimensions.
- A fix to `reactiveMap` semantics (e.g. F4 LRU touch refinement) doesn't propagate because `vectorIndex` uses raw `state` instead of `reactiveMap`.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check (run mentally):**

Current shape:
```ts
const idx = vectorIndex<{label: string}>({ backend: "flat", dimension: 2 });
const g = new Graph("demo");
g.add(idx.entries, { name: "entries" });
g.describe({ format: "ascii" });
// → entries (state) — single node, no edges, an island.
```

- ⚠️ Detached without manual mount.
- ⚠️ Search is invisible — `search()` calls don't appear in `describe()` / `observe()`. Causal chains terminate at `entries` (the search runs in user code, not the graph).
- ⚠️ HNSW adapter is also invisible — its state changes are invisible to the graph's introspection surface.

Fully-reactive shape (proposed in Q9):
```ts
const idx = vectorIndex<{label}>({ backend: "flat", dimension: 2, name: "vec" });
const queryNode = state<number[]>([]);
const k = state(5);
const results = idx.searchNode(queryNode, k); // Node<VectorSearchResult[]>
g.add(idx);                                    // mount as subgraph
g.add(queryNode, { name: "query" });
g.add(k, { name: "k" });
g.add(results, { name: "results" });
g.describe({ format: "ascii" });
// → vec::entries (state)
//   ↘ vec::search (derived)
//   query  (state)  ↗
//   k      (state)  ↗
//   ↓
//   results (alias / mount-out of vec::search)
```

- ✅ All edges visible; `explain(query, results)` produces a causal chain.
- ✅ HNSW adapter still in closure (necessary — adapter holds index state) but its lifecycle is bound via `addDisposer`.

**Composability:**
- **Current** — entries plays as upstream; search is a black-box function. Reactive consumers wrap `derived([entries, query], …)` themselves.
- **Proposed** — `searchNode(query, k)` IS the reactive consumer; users compose at the dep level.

**Perf:**
- `flat` search: O(N·D) per call (N = entries, D = dimension). 10k × 768 ≈ 7.6M ops, ~10–20ms in JS.
- `upsert`: O(N) for `copyMap` + O(D) for vector deep-copy + O(adapter) for HNSW.
- `reactiveMap` rebuild: `upsert` O(1) amortized via `MapBackend`; eliminates `copyMap` per write.
- Reactive `searchNode` re-derives on every entries/query/k change — same O(N·D) cost per fire. With `equals` (same top-k results), downstream short-circuits. Acceptable.

**Memory:**
- 10k × 768-dim float64 ≈ 60MB raw vectors.
- Each `entries` snapshot retains all vectors (current implementation): 2× during upsert (copy-on-write).
- HNSW adapter has its own internal storage (~2–3× raw for typical implementations).
- `reactiveMap` rebuild eliminates the 2× snapshot churn.
- `maxSize` eviction caps growth.

### Q8 — Alternatives

**A. Keep as-is.** No code change.
- Pros: zero churn; tests pass.
- Cons: every Q6 caveat stays; drift accelerates as `reactiveMap` evolves.

**B. Add reactive `searchNode(query, k)` factory** but otherwise keep bundle shape.
- Pros: closes the imperative-search gap.
- Cons: doesn't fix no-Graph, adapter lifecycle, eviction, or storage.

**C. Wrap in `Graph` subclass `VectorIndexGraph<TMeta>`** (mirror `collection`'s shape).
- Pros: closes no-Graph wart; adapter lifecycle binds via `addDisposer`; describe() coverage.
- Cons: doesn't fix imperative search or storage churn alone.

**D. Rebuild storage on `reactiveMap`.**
- Pros: eliminates copy-on-write churn; F4 LRU semantics inherited; one source of truth for Map storage.
- Cons: storage-only; doesn't fix search or no-Graph alone.

**E. Add `maxSize` + retention** (mirrors Unit 3 reactiveMap retention).
- Pros: caps unbounded growth.
- Cons: storage-only; needs to integrate with adapter-side state.

**F. Add `reindex()` method** for adapter desync recovery.
- Pros: closes the production-hazard gap.
- Cons: surface-only; doesn't fix the dual-write smell.

**G. Strict cosine mode** — require `dimension` OR enforce same-length vectors.
- Pros: surfaces silent-degradation bugs.
- Cons: minor breaking change; users who relied on zero-pad must migrate.

**H. Combine B + C + D + E + F + G** — full fully-reactive rebuild.
- Pros: closes every Q6 caveat in one pass.
- Cons: large change footprint; many test additions; PY mirror queued.

**I. Drop "flat" backend; require an adapter.**
- Pros: unified codepath; flat-cosine becomes a documented fallback adapter, not a built-in.
- Cons: increases caller burden for the simple case (small in-memory indexes); breaking.

**J. Make HNSW adapter optional dispose-aware.** Extend `HnswAdapter` interface with `dispose?(): void`. Lifecycle binds via `addDisposer`. Subset of H.

### Q9 — Recommendation

**Recommended call: H — full reactive rebuild, single Wave-A pass.**

Aligns with the Unit-3 lock pattern (no defers; full reactivity end-to-end; storage rebuild bundled).

**Step 1 (lands in Wave A implementation):**

1. **Convert to `Graph` subclass `VectorIndexGraph<TMeta>`** with mounted `entries`. Factory `vectorIndex(...)` returns the graph. Methods `upsert / remove / clear / search / searchNode / reindex` attached via `Object.assign(graph, …)` (mirroring `collection`'s pattern).

2. **Storage on `reactiveMap<id, VectorRecord<TMeta>>`** with optional `retention` for `maxSize` eviction. Default retention score: `lastUpsertNs` (most-recently-upserted wins). Users can supply a custom retention `score` fn.
   - `LRU-by-upsert-time` is the safe default for vector indexes (newest docs likely most relevant).
   - Score-based retention exists on `reactiveMap` already; pass through.

3. **`searchNode(query: Node<readonly number[]>, k: Node<number> | number = 5, opts?): Node<readonly VectorSearchResult<TMeta>[]>`.** Reactive search:
   - Internal `derived([items.entries, query, kNode], (entries, q, kVal) => topK(entries, q, kVal, backend, hnsw))`.
   - `equals` comparator: shallow-equal results array (same `id` ordering with similar scores).
   - `kNode` accepts a number-or-node — number gets wrapped via `state(k)`.
   - Flat backend: cosine scan inside the fn.
   - HNSW backend: delegate to `hnsw!.search(q, kVal)` inside the fn.
   - Lazy: searchNode only runs when subscribed.

4. **Imperative `search(query, k)` retained** as an escape hatch. Same logic, no node creation. Documented as "for one-shot queries; prefer `searchNode` for reactive composition."

5. **`reindex()` method.** Walks `items.entries`, calls `adapter.upsert(id, vector, meta)` for each. For recovery from adapter desync (network blip, process restart with persistent backend, adapter version upgrade). No-op for `flat` backend.

6. **Adapter lifecycle.** Extend `HnswAdapter<TMeta>` interface with `dispose?(): void`. Bind via `graph.addDisposer(() => hnsw?.dispose?.())`. Tied to graph teardown.

7. **`maxSize?: number` option** with optional `retentionScore?: (record: VectorRecord<TMeta>) => number` for custom eviction semantics. Eviction must coordinate with adapter — `removeFromAdapter(id)` runs in the retention-eviction callback. Document the dual-write gotcha.

8. **Strict dimension mode.** When `dimension` is unset AND any two vectors have different lengths during upsert, throw `RangeError`. JSDoc: "if you mix dimensions intentionally, set `dimension: undefined` AND `strictDimension: false` (default off)." Keep the zero-pad path as opt-in via `strictDimension: false`. Default flips to strict.

9. **`domainMeta("memory", kind)` tagging** on `entries`, `searchNode` (the derived).

10. **JSDoc tightening.** Cover:
    - `searchNode` reactive contract (re-derives on entries/query/k change).
    - Adapter state externalization caveat (HNSW state lives outside the graph; `reindex()` for recovery).
    - Cosine zero-pad lenient mode (off by default).
    - Vector defensive-copy semantics on upsert.
    - L2 normalization expectation for embedding-model vectors (caller's responsibility).
    - `maxSize` eviction coordinates with adapter (drops from both stores).

11. **Tests:**
    - Reactive `searchNode`: subscribe, upsert new entry, assert results re-derive.
    - HNSW adapter mock + `reindex()`: simulate adapter clear, call `reindex`, assert adapter back in sync via mock spy.
    - Eviction by `maxSize` with default retention (LRU-by-upsert-time): assert oldest dropped.
    - Adapter `dispose()` called on graph teardown.
    - `strictDimension` default throws on mixed-length vectors.
    - `strictDimension: false` zero-pads (preserves existing test).
    - `equals` short-circuit on identical search results.

**On Option I (drop "flat" backend):** **Don't.** Small in-memory indexes are a real use case (~hundreds of entries, no HNSW dependency). Keep flat as the zero-config default.

**On Option G stricter:** Default `strictDimension: true` is the right call. Pre-1.0 free. Users who need zero-pad opt in.

**On `searchN(query, kPerVariant)` multi-query** for RAG: out of scope this unit. File in `docs/optimizations.md` if it surfaces as a real need.

**Coverage table:**

| Concern | Step 1 (H — full reactive rebuild) |
|---|---|
| Q2 — imperative search | ✅ `searchNode` reactive; `search()` retained as escape hatch |
| Q2 — adapter state divergence | ✅ `reindex()` for recovery; documented dual-write gotcha |
| Q2 — `upsert` always emits | ✅ `reactiveMap` retention semantics |
| Q2 — no eviction (unbounded growth) | ✅ `maxSize` + retention |
| Q2 — cosine zero-pad silent | ✅ `strictDimension: true` default |
| Q2 — adapter factory called once, no recovery | ✅ `reindex()` + (future) factory re-invocation if needed |
| Q3 — imperative-search gray-zone | ✅ resolved (search is now reactive) |
| Q3 — no-Graph wart | ✅ `VectorIndexGraph` subclass |
| Q3 — adapter lifecycle untracked | ✅ `dispose()` plumbing + `addDisposer` |
| Q3 — no `domainMeta` | ✅ tagged |
| Q4 — open items | ✅ all closed in step 1 (no deferral) |
| Q5 — wrong-shaped bundle | ✅ Graph subclass; storage on `reactiveMap`; reactive search |
| Q5 — adapter abstraction | ✅ extended with optional `dispose()` |
| Q6 — read-only staleness | ✅ `searchNode` always current |
| Q6 — production drift hazard | ✅ `reindex()` recovery |
| Q6 — unbounded growth | ✅ `maxSize` + retention |
| Q6 — cosine zero-pad gotcha | ✅ strict default |
| Q6 — vector L2 normalization undocumented | ✅ JSDoc |
| Q6 — test coverage thin | ✅ seven new tests |
| Q6 — cross-language drift | ⚠️ TS-only step (deferred PY parity) |
| Q7 — copy-on-write GC churn | ✅ `reactiveMap` single-backing-Map |
| Q7 — describe()/explain() invisibility | ✅ Graph subclass, mounted nodes |

**Open questions for the user before locking:**

1. **Confirm H** (full reactive rebuild, single Wave-A pass) vs. alternatives.
2. **Wrap as `VectorIndexGraph<TMeta>` subclass** (mirroring `collection`)?
3. **Storage on `reactiveMap`** with `retention` for `maxSize`?
4. **Reactive `searchNode(query, k)` factory** + retain imperative `search()` as escape hatch?
5. **`reindex()` method** for adapter desync recovery?
6. **Adapter `dispose?()` plumbing** + `addDisposer` lifecycle binding?
7. **`maxSize?: number` option** with default LRU-by-upsert-time retention?
8. **Strict dimension default** (`strictDimension: true`; opt-in zero-pad via `false`)?
9. **`domainMeta("memory", …)` tagging?**
10. **PY parity for step 1**: defer to Python parity pass (consistent with Units 2–3)?

### Decisions locked (2026-04-25)

1. **Recommendation H** — full reactive rebuild, single Wave-A pass.
2. **Wrap as `VectorIndexGraph<TMeta>`** subclass.
3. **Storage on `reactiveMap`** with `maxSize` retention.
4. **Reactive `searchNode(query, k): Node<results>`** + retained imperative `search()` as escape hatch.
5. **`reindex()` method** for adapter desync recovery.
6. **Adapter `dispose?()`** plumbing + `addDisposer` lifecycle binding.
7. **`maxSize` + LRU-by-upsert-time** default retention; user-overridable via `retentionScore` callback.
8. **Strict dimension default** — `strictDimension: true` by default; opt-in zero-pad via `false`.
9. **`domainMeta("memory", …)` tagging** on `entries` + `searchNode` derived + the timer (if any).
10. **PY parity deferred** to the Python parity pass.

**Implementation scope when Wave A lands (Unit 4):**

A. **`src/patterns/memory/index.ts:365-431` rewrite:**
   - `vectorIndex(...)` returns `VectorIndexGraph<TMeta>` (Graph subclass) instead of bundle.
   - `entries` becomes `reactiveMap<id, VectorRecord<TMeta>>`; `maxSize` + `retention` (default `lastUpsertNs`-LRU; user can supply `retentionScore`).
   - Add `searchNode(query: Node<readonly number[]>, k: Node<number> | number = 5): Node<readonly VectorSearchResult<TMeta>[]>` — reactive derived with shallow-equal `equals`. Lazy.
   - Retain imperative `search(query, k)` for one-shot calls.
   - Add `reindex()` method — walks entries, calls `adapter.upsert` for each.
   - Extend `HnswAdapter<TMeta>` interface with optional `dispose?(): void`; bind via `graph.addDisposer(() => hnsw?.dispose?.())`.
   - Eviction-side adapter sync: when `reactiveMap` retention drops a key, also call `adapter.remove(id)`.
   - Default `strictDimension: true`; throw `RangeError` on mixed-length upserts when `dimension` unset and `strictDimension !== false`.
   - Add `domainMeta("memory", "vector-store" | "vector-search")` tags.
   - JSDoc cover: reactive contract, dual-write gotcha, L2 normalization, `reindex()` recovery, strict-dimension default.
B. **`src/__tests__/patterns/memory.test.ts` additions:** reactive `searchNode` re-emit on upsert; HNSW adapter mock + `reindex()`; eviction by `maxSize` (LRU default); adapter `dispose()` on graph teardown; `strictDimension` throws on mixed lengths; opt-in zero-pad; `equals` short-circuit.
C. **`docs/optimizations.md`:** parity item only ("PY mirror of TS Unit 4 changes pending parity pass").

#### Revision 2026-04-25 (no-imperative-reads policy, see top-level lock)

Decisions revised:
- **Drop imperative `search(query, k)`** — was retained as escape hatch (lock #4). `searchNode(query, k)` is now the only read API.
- One-shot tests / debug use `firstValueFrom(searchNode(state(query), state(k)))` or read `searchNode(...).cache` after `awaitSettled`.

Revised `VectorIndexGraph<TMeta>` methods after Wave A: `upsert / remove / clear / reindex / searchNode`. No imperative `search`.

Revised tests: drop the imperative-`search` test; expand `searchNode` reactivity coverage (entries change → results update; query change → results update; k change → results update).

---

## Unit 5 — `knowledgeGraph` / `KnowledgeGraphGraph`

**File:** `src/patterns/memory/index.ts:433-526`

### Q1 — Semantics, purpose, implementation

```ts
export function knowledgeGraph<TEntity, TRelation extends string = string>(
    name: string,
): KnowledgeGraphGraph<TEntity, TRelation>
```

A `Graph` subclass with three internal nodes plus five imperative methods:

- **Internal topology** (`memory/index.ts:436-462`):
  - `entities: state<ReadonlyMap<id, TEntity>>` (line 437) — primary entity store.
  - `edges: state<ReadonlyArray<KnowledgeEdge<TRelation>>>` (line 441) — typed edges (`{from, to, relation, weight}`).
  - `adjacency: derived([edges], …)` (line 445) — `Map<from, ReadonlyArray<KnowledgeEdge>>`. Outbound-only; no inbound index.
  - **Edges:** `edges → adjacency`. `entities` is a topology island (no derived consumes it).
  - **Keepalive:** `void adjacency.subscribe(() => undefined)` (line 458) — inline pattern, same as `collection`.
- **Bundled methods** (`Object.assign(graph, {…})` at line 472):
  - `upsertEntity(id, value)` — copyMap entities, set, commit.
  - `removeEntity(id)` — copyMap entities, delete; filter edges to drop all `from === id || to === id`. Both states emit if changed.
  - `link(from, to, relation, weight = 1)` — Set-based dedup keyed by `${from}\u0000${to}\u0000${relation}`. If duplicate, in-place weight replacement; else push. Single-edge-only commit.
  - `unlink(from, to, relation?)` — filter; commit if changed.
  - `related(id, relation?): readonly KnowledgeEdge[]` — **imperative**; linear scan over all edges checking `from === id || to === id` plus optional relation filter.

**Cross-language:** `graphrefly-py` ships `knowledge_graph` at `memory.py:586` (same shape, same outbound-only adjacency).

### Q2 — Semantically correct?

1. **`related()` is imperative** — same anti-pattern resolved in Unit 4. Reactive `entities` / `edges` / `adjacency` + imperative read API. Users wanting live results re-call.
2. **`adjacency` is outbound-only.** `related(id)` checks both `from === id` AND `to === id`, so the inbound side requires linear scan over all edges. Asymmetric reactive index.
3. **`adjacency` build is O(E²) worst case** (line 451–452). For each edge, the fn does:
   ```ts
   const prev = out.get(edge.from) ?? [];
   out.set(edge.from, Object.freeze([...prev, edge]));
   ```
   The incremental `[...prev, edge]` rebuilds the whole array each step. For a node with `k` outbound edges: `1 + 2 + … + k = O(k²)` element-copy ops. Total cost `Σ kᵢ² ≈ E²/N` worst case (high-fan-out nodes). 1k edges from a hub node = ~500k array-copy ops per re-derive. **Bug.** Optimal is O(E) using mutable arrays during build, freeze at the end.
4. **`link()` rebuilds the dedup `Set` per call** (line 489–492). O(E) per call. For frequent linking, total O(E²).
5. **Edge replacement vs insertion two-codepath** (lines 494–504). When key exists, mutates `next[i]` in place; else push. Refactorable into one expression (`map then push if not found`).
6. **`removeEntity` doesn't index-update `adjacency`** — relies on `edges` re-emit triggering `adjacency` re-derive. Correct but every entity removal triggers the full O(E²) adjacency rebuild.
7. **No size limit / no eviction** — same as `vectorIndex`. Unbounded growth.
8. **No orphan-entity GC.** When `unlink` removes the last edge involving an entity, the entity stays in `entities`. May or may not be desired — undocumented.
9. **`upsertEntity` always emits** even on no-op (no `equals`).
10. **Edge key uses `\u0000` separator.** Common pattern but not documented; entity IDs containing `\u0000` would collide silently.
11. **Edge weight semantics undocumented.** Default `weight = 1`; users computing scores rely on convention.
12. **`link()` "same triple, new weight" is a silent update.** Distinguishable from "first-time link" only by reading current state. Documented? No.
13. **No `entityCount` / `edgeCount` deriveds.** Common observability surface; users compute themselves.
14. **`entities` topology island.** Mounted but no derived consumer — `describe()` shows it standalone. The link from edges back to entities (e.g. "this edge references entity X") isn't reactively expressed.

### Q3 — Design-invariant violations?

- 🟢 No async / Promise / setTimeout / polling.
- 🟢 No clock reads inside any reactive fn.
- 🟢 Command-side mutators use state.emit from outside fn bodies.
- 🟡 **Imperative `related()`** — same gray-zone resolved at Unit 4.
- 🟡 **Inline `void adjacency.subscribe(() => undefined)` keepalive** — should use `keepalive(node)` helper.
- 🟡 **No `domainMeta` tags.**
- 🟡 **Asymmetric adjacency** (outbound only) — incomplete reactive index; `related` falls back to imperative scan.
- 🟡 **O(E²) adjacency build** — implementation bug; not a spec violation but a real perf hazard.
- 🟢 No raw async, no clock impurity.

Net: 🟡 dominated by imperative-`related`, asymmetric/quadratic adjacency, and inline keepalive.

### Q4 — Open items

- **Reactive `relatedNode(idNode, relationNode?)`** factory (mirrors Unit 4 `searchNode`).
- **Symmetric adjacency** — both `adjacencyOut` and `adjacencyIn` deriveds.
- **O(E²) adjacency build → O(E)** — implementation fix.
- **`link()` O(E) dedup → O(1)** via reactive edge index keyed by triple.
- **Inline keepalive vs. helper.**
- **`domainMeta` tagging.**
- **`maxSize` / eviction.**
- **Orphan-entity GC** — opt-in?
- **Edge key collision with `\u0000`** — document, or use a non-string key.
- **`entityCount` / `edgeCount` deriveds** — common observability.
- **Test coverage thin.** `memory.test.ts:68-77` covers one upsert + one link; missing: removeEntity edge-cleanup, unlink, link-replace-weight, related with relation filter, adjacency correctness over multi-edge sets.
- **Cross-language parity.** PY `knowledge_graph` (`memory.py:586`) — mirrored shape; deferred.

### Q5 — Right abstraction? More generic possible?

- **Shape is canonical** for knowledge graphs: entities + typed edges + adjacency index. Don't restructure.
- **Asymmetric adjacency is the wart.** Reactive indexes should be symmetric (out + in) — common queries require both.
- **String-keyed edge dedup is an implementation leak.** A `reactiveMap<edgeKey, KnowledgeEdge>` (where key = `${from}\u0000${to}\u0000${relation}`) replaces both the linear-scan `link` dedup AND the O(N) `unlink` filter with O(1) lookups. The triple-key encoding becomes an internal detail of the index, not exposed.
- **Edge weight semantics** could be encoded in the type (`type EdgeWeight = number; readonly weight: EdgeWeight`) for self-documentation, but it's overkill.
- **Could decompose** into:
  - `entities = reactiveMap<id, TEntity>` (storage).
  - `edges = reactiveMap<tripleKey, KnowledgeEdge>` (indexed storage).
  - `adjacencyOut = derived([edges.entries], outIndex)`, `adjacencyIn = derived([edges.entries], inIndex)`.
  - `relatedNode(idNode, relationNode?)` factory.
  - `entityCount`, `edgeCount` deriveds.
- **Naming:** `knowledgeGraph` is clear. The wrapper class is `KnowledgeGraphGraph<…>` which has the awkward "Graph" duplicate suffix; rename to `KnowledgeGraph<TEntity, TRelation>` (no suffix, since the wrapper IS a Graph). Pre-1.0 free.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~95 LOC, three internal nodes, five bundle methods. Lower than `collection` because there's no decay/ranking. Higher than `vectorIndex` because of the asymmetric adjacency + dedup pattern + multi-state `removeEntity`.

**Caveats / footguns:**

1. **Imperative `related()` is the dominant UX issue.** Consumers wanting live edges per id wrap in their own `derived([adjacency], (a) => a.get(id) ?? [])` — but that misses inbound edges. The fully-reactive shape is `relatedNode(idNode, relationNode?)` parameterized by id/relation as deps.
2. **Asymmetric adjacency limits reactive use cases.** Common queries:
   - "Who knows Alice?" (inbound on entity Alice) — currently O(E) via `related`.
   - "What does Alice know?" (outbound on Alice) — O(1) via `adjacency.get(Alice)`.
   Reactive consumers wanting inbound get nothing for free.
3. **O(E²) adjacency build** is a real perf hazard for high-fan-out graphs. 1k edges from a hub node ≈ ~500k array-copy ops per re-derive. Trivially fixable to O(E).
4. **O(E) `link` dedup** scales poorly. For agent-memory KGs with 100k edges, every `link` is 100k ops just to detect duplicates. Reactive `reactiveMap` keyed by triple → O(1).
5. **No eviction → unbounded growth.** Same hazard as `vectorIndex`. Long-running agents accumulating relations need a retention story.
6. **Orphan-entity GC undocumented.** When the last edge involving entity X is removed, X persists. Some KGs want this (entities are first-class); others want auto-cleanup. Make it explicit via an `orphanGC: "keep" | "remove"` option (default `"keep"`).
7. **Edge key `\u0000` collision** — silent footgun for users with control characters in IDs. Documenting "IDs must not contain `\u0000`" suffices (rare).
8. **Edge weight semantics undocumented.** `weight = 1` default. Users computing path scores or similarity need to know "higher = stronger" or "higher = farther"? Documenting "convention: higher weight = stronger relation" suffices.
9. **`link` updating existing weight is a silent shape change.** Document that "calling `link(a, b, rel)` twice with different weights replaces the weight; calling `unlink` then `link` re-creates the edge."
10. **No `entityCount` / `edgeCount`** deriveds. Trivial to add; common observability surface.
11. **`KnowledgeGraphGraph<…>` naming** — awkward duplicate suffix. Rename to `KnowledgeGraph<TEntity, TRelation>` (the wrapper IS a Graph, the class name shouldn't repeat).
12. **`entities` topology island** — describe() shows it standalone. Cosmetic; could add a `referencedEntities` derived (entities mentioned in any edge) to break the island, but probably overkill.
13. **No `path(from, to)` reactive query** — common KG operation (find paths via BFS/DFS over adjacency). Out of scope this unit; file in `optimizations.md` if a real caller surfaces.
14. **Cross-language drift.** PY `knowledge_graph` mirrors all the above; deferred per the established pattern.
15. **Public-export commitment.** Three exported types (`KnowledgeEdge`, `KnowledgeGraphGraph`, `knowledgeGraph`). Pre-1.0 free.
16. **Vision-block alignment.** Part of the canonical `agentMemory` surface alongside `collection` and `vectorIndex`. Documentation will treat these three as the public face. The fully-reactive rebuild ensures consistent reactive-contract messaging across all three.

**What hurts in 6 months:**
- A user files: "my `related()` results don't update when I add a new edge" — answer is "imperative; re-call" until reactive `relatedNode` lands.
- An agent-memory graph hits the O(E²) adjacency build perf cliff at ~10k edges with high-fan-out hubs.
- A consumer wanting "who points to me?" (inbound) writes a manual O(E) scan because `adjacencyIn` doesn't exist.
- A long-running agent accumulates edges past memory comfort because there's no eviction.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check (run mentally):**

Current shape:
```ts
const kg = knowledgeGraph<{name: string}>("kg");
kg.upsertEntity("a", {name: "A"});
kg.upsertEntity("b", {name: "B"});
kg.link("a", "b", "knows");
kg.describe({format: "ascii"});
// → entities (state, ISLAND — no consumer)
//   edges (state)
//     ↓
//   adjacency (derived)
```

- ⚠️ `entities` is an island.
- ⚠️ `related()` is imperative — invisible to describe().
- ⚠️ `adjacency` covers outbound only.
- ✅ `edges → adjacency` edge clean.

Proposed shape (Q9):
```
entities (reactiveMap)
  ↓ (referenced via edges)
edges (reactiveMap, triple-keyed)
  ↓                                    ↓
adjacencyOut (derived)        adjacencyIn (derived)
  ↓                                    ↓
relatedNode(idNode, relationNode?) — derived parameterized by id/relation
  ↓
[KnowledgeEdge[]] (reactive)
edgeCount (derived[edges]) — observability
entityCount (derived[entities]) — observability
```

All nodes mounted, all edges visible, `explain` works.

**Composability:**
- **Current:** `entities` and `adjacency` plug into reactive consumers as upstream snapshots. `related()` doesn't.
- **Proposed:** `relatedNode(id, relation?)` is the natural reactive read.

**Perf:**
- Current `adjacency`: O(E²) worst case per emit (build-via-frozen-array bug).
- Optimized: O(E) using mutable arrays during build, freeze at end.
- Current `link` dedup: O(E) per call.
- Optimized: O(1) via `reactiveMap` keyed by triple.
- Current `related`: O(E) per call.
- Optimized: O(1) via `adjacencyOut.get(id) + adjacencyIn.get(id)` concat.
- Current `removeEntity`: O(E) edge filter + O(E²) adjacency rebuild.
- Optimized: O(E) edge filter (keyed) + O(E) adjacency rebuild.

**Memory:**
- `entities` map allocated per emit (copy-on-write).
- `edges` array allocated per emit (frozen).
- `adjacency` map + N frozen sub-arrays per emit.
- Optimized via `reactiveMap` single-backing-Map: drops 2× snapshot churn.

### Q8 — Alternatives

**A. Keep as-is.** No code change.
- Pros: zero churn.
- Cons: every Q6 caveat stays; perf cliff at ~10k edges with high fan-out.

**B. Add reactive `relatedNode(idNode, relationNode?)`** factory only.
- Pros: closes imperative-search gap.
- Cons: doesn't fix asymmetric adjacency, O(E²) build, dedup, eviction, naming.

**C. Add symmetric `adjacencyOut` + `adjacencyIn`.**
- Pros: enables reactive inbound queries.
- Cons: doesn't address build perf or dedup.

**D. Fix O(E²) adjacency build → O(E)** (mutable build, freeze at end).
- Pros: closes perf cliff for high fan-out.
- Cons: implementation-only; no API change.

**E. Storage on `reactiveMap<id, TEntity>` and `reactiveMap<tripleKey, KnowledgeEdge>`.**
- Pros: O(1) `link` dedup, O(1) `unlink`; eliminates copy-on-write churn.
- Cons: API barely changes, but internal restructure is significant.

**F. Add `maxSize` + retention** (mirrors Unit 3/4).
- Pros: caps unbounded growth.
- Cons: eviction story for KGs is more nuanced (entity vs edge eviction; orphan handling).

**G. Use `keepalive` helper** instead of inline.
- Pros: idiom consistency.
- Cons: cosmetic.

**H. domainMeta tagging.** Cosmetic.

**I. Rename `KnowledgeGraphGraph` → `KnowledgeGraph`.** Pre-1.0 free.

**J. Combine B + C + D + E + F + G + H + I — full reactive rebuild.**
- Pros: single Wave-A pass closes every Q6 caveat (mirrors Units 3 / 4).
- Cons: large change footprint; multiple test additions; PY parity queued.

**K. Add `entityCount` / `edgeCount` deriveds.**
- Pros: trivial observability.
- Cons: small API surface addition.

**L. Add `path(from, to)` reactive query** (BFS/DFS).
- Pros: powerful KG operation.
- Cons: out of scope this unit; file as separate roadmap item.

**M. Orphan-entity GC option** — `orphanGC: "keep" | "remove"`.
- Pros: explicit semantics.
- Cons: small API addition; default `"keep"` matches current.

### Q9 — Recommendation

**Recommended call: J + K + M — full reactive rebuild + observability deriveds + orphan-GC option, single Wave-A pass.**

Mirrors Units 3 / 4 "no defer" pattern.

**Step 1 (lands in Wave A implementation):**

1. **Rename** `KnowledgeGraphGraph<TEntity, TRelation>` → `KnowledgeGraph<TEntity, TRelation>`. Pre-1.0 free; the duplicate-suffix is awkward.

2. **Storage on `reactiveMap`:**
   - `entities = reactiveMap<id, TEntity>` (mounted).
   - `edges = reactiveMap<tripleKey, KnowledgeEdge<TRelation>>` where `tripleKey = ${from}\u0000${to}\u0000${relation}` (mounted; the triple-key is internal).
   - Drop the `state<readonly KnowledgeEdge[]>` shape entirely.

3. **Symmetric adjacency:**
   - `adjacencyOut = derived([edges.entries], (es) => buildIndex(es, e => e.from))` — mounted.
   - `adjacencyIn  = derived([edges.entries], (es) => buildIndex(es, e => e.to))` — mounted.
   - Both built in O(E) via mutable arrays + final freeze.
   - Both have `equals` comparators (Map size + per-key array shallow-equal) so identical edge sets don't re-emit.

4. **Reactive `relatedNode(idNode: NodeOrValue<string>, relationNode?: NodeOrValue<TRelation>): Node<readonly KnowledgeEdge<TRelation>[]>`** factory:
   - `derived([adjacencyOut, adjacencyIn, idNode, relationNode?], (out, in_, id, rel) => …)`.
   - Concat `out.get(id) ?? []` + `in_.get(id) ?? []`, optional relation filter.
   - Lazy.
   - `equals: shallowArrayEqual`.

5. **Imperative `related(id, relation?)` retained** as escape hatch (mirrors Unit 4's `search()`).

6. **`maxSize` retention:**
   - `entitiesMaxSize?: number` for entity store (default unbounded; LRU-by-upsert-time when set).
   - `edgesMaxSize?: number` for edge store (default unbounded; LRU-by-upsert-time when set).
   - Eviction-side coordination: when an entity is evicted, related edges are also evicted; when an edge is evicted, no entity GC.

7. **Orphan-entity option:** `orphanGC: "keep" | "remove"` (default `"keep"`). When `"remove"`, the next `unlink` that empties an entity's adjacency triggers an `entities.delete(id)`. Implementation: a watchdog effect on `adjacencyOut` + `adjacencyIn` (or a derived "referenced entities" set + a derived "orphans" set). For now, the simpler shape: post-`unlink` imperative cleanup.

8. **Observability deriveds:**
   - `entityCount = derived([entities.entries], m => m.size)`.
   - `edgeCount = derived([edges.entries], m => m.size)`.

9. **`keepalive` helper** for `adjacencyOut`, `adjacencyIn`, `entityCount`, `edgeCount` — collected via `addDisposer`.

10. **`domainMeta("memory", kind)` tagging** on all internal nodes.

11. **JSDoc tightening:**
    - Triple-key encoding (internal; entity IDs must not contain `\u0000`).
    - Edge weight convention ("higher = stronger relation").
    - `link()` updates weight on duplicate (replace-on-conflict).
    - `relatedNode` reactive contract (re-derives on adjacency / id / relation change).
    - `orphanGC` option.
    - `entityCount` / `edgeCount` for observability.

12. **Tests:**
    - Reactive `relatedNode`: subscribe; `link`/`unlink`; assert results re-derive.
    - Symmetric adjacency: link `a -> b`; assert `adjacencyOut.get(a) = [edge]` AND `adjacencyIn.get(b) = [edge]`.
    - O(E) adjacency build: assert no quadratic behavior at 1k edges from one hub (perf budget assertion).
    - `link` replace-weight: re-link same triple with new weight; assert single edge with new weight.
    - `unlink` by relation only.
    - `removeEntity` cascade: removes all involving edges.
    - `maxSize` retention: oldest entity / edge dropped under pressure.
    - `orphanGC: "remove"`: last `unlink` triggers entity removal.
    - `entityCount` / `edgeCount` deriveds emit on mutations.
    - `KnowledgeGraph` rename — update existing tests.

**On Option L (`path(from, to)` reactive query):** **Defer.** No real caller; file as a roadmap item.

**On Option I rename:** **Yes** (`KnowledgeGraph<TEntity, TRelation>`).

**Coverage table:**

| Concern | Step 1 (J + K + M) |
|---|---|
| Q2 — imperative `related()` | ✅ `relatedNode` reactive; `related()` retained as escape hatch |
| Q2 — asymmetric adjacency | ✅ `adjacencyOut` + `adjacencyIn` |
| Q2 — O(E²) adjacency build | ✅ O(E) mutable-build-then-freeze |
| Q2 — O(E) `link` dedup | ✅ `reactiveMap`-keyed-by-triple → O(1) |
| Q2 — `removeEntity` O(E²) | ✅ O(E) via keyed edge map + O(E) adjacency |
| Q2 — no eviction (unbounded) | ✅ `entitiesMaxSize` + `edgesMaxSize` retention |
| Q2 — orphan-entity GC undocumented | ✅ `orphanGC` option |
| Q2 — edge key `\u0000` collision | ✅ documented |
| Q2 — edge weight convention undocumented | ✅ JSDoc |
| Q2 — `link` replace-weight silent | ✅ JSDoc |
| Q2 — `entities` topology island | ✅ resolved via `entityCount` derived consumer + future `referencedEntities` if needed |
| Q3 — imperative `related()` gray-zone | ✅ resolved |
| Q3 — inline keepalive | ✅ `keepalive(node)` + `addDisposer` |
| Q3 — no `domainMeta` | ✅ tagged |
| Q3 — asymmetric adjacency | ✅ symmetric |
| Q3 — O(E²) build | ✅ O(E) |
| Q4 — open items | ✅ all closed in step 1 |
| Q5 — wrong-shaped storage | ✅ `reactiveMap` for both entities and edges |
| Q5 — naming `KnowledgeGraphGraph` | ✅ renamed `KnowledgeGraph` |
| Q5 — missing observability | ✅ `entityCount` / `edgeCount` deriveds |
| Q6 — perf cliff at high fan-out | ✅ O(E) build |
| Q6 — long-running unbounded growth | ✅ retention |
| Q6 — production ergonomics | ✅ reactive `relatedNode`, observability, eviction |
| Q6 — cross-language drift | ⚠️ TS-only step (deferred PY parity) |
| Q7 — copy-on-write GC churn | ✅ `reactiveMap` single-backing-Map |
| Q7 — describe()/explain() invisibility for `related` | ✅ `relatedNode` reactive |

**Open questions for the user before locking:**

1. **Confirm J + K + M** (full reactive rebuild + observability deriveds + orphan-GC option) vs. alternatives.
2. **Storage on `reactiveMap` for both entities and edges?**
3. **Symmetric `adjacencyOut` + `adjacencyIn`?**
4. **Reactive `relatedNode(id, relation?)` + retained imperative `related()`?**
5. **`entitiesMaxSize` + `edgesMaxSize`** with default LRU-by-upsert-time retention?
6. **`orphanGC: "keep" | "remove"`** option (default `"keep"`)?
7. **`entityCount` + `edgeCount`** deriveds?
8. **`keepalive` helper + `domainMeta("memory", …)` tagging?**
9. **Rename** `KnowledgeGraphGraph` → `KnowledgeGraph`?
10. **PY parity for step 1**: defer to Python parity pass?

### Decisions locked (2026-04-25)

1. **Recommendation J + K + M** — full reactive rebuild + observability deriveds + orphan-GC option, single Wave-A pass.
2. **Storage on `reactiveMap`** for both entities and edges (edges keyed by `${from} ${to} ${relation}` triple).
3. **Symmetric `adjacencyOut` + `adjacencyIn`** deriveds; both built in O(E) via mutable arrays + final freeze.
4. **Reactive `relatedNode(idNode, relationNode?): Node<readonly KnowledgeEdge[]>`** factory + retained imperative `related()` as escape hatch.
5. **`entitiesMaxSize` + `edgesMaxSize`** options with default LRU-by-upsert-time retention.
6. **`orphanGC: "keep" | "remove"`** option (default `"keep"`).
7. **`entityCount` + `edgeCount`** observability deriveds.
8. **`keepalive` helper** for `adjacencyOut` / `adjacencyIn` / counts; **`domainMeta("memory", kind)` tagging** on all internal nodes.
9. **Rename `KnowledgeGraphGraph` → `KnowledgeGraph`**. Pre-1.0 free.
10. **PY parity deferred** to the Python parity pass.

**Implementation scope when Wave A lands (Unit 5):**

A. **`src/patterns/memory/index.ts:433-526` rewrite:**
   - Class rename `KnowledgeGraphGraph` → `KnowledgeGraph` (also update `KnowledgeGraphGraph<TEntity, TRelation>` type alias usages).
   - `entities = reactiveMap<id, TEntity>` (mounted) with `entitiesMaxSize` retention.
   - `edges = reactiveMap<tripleKey, KnowledgeEdge<TRelation>>` (mounted) with `edgesMaxSize` retention.
   - Rewrite `link/unlink` to use `edges.set/delete` keyed by triple — drops O(E) Set-rebuild dedup.
   - Rewrite `removeEntity` to filter `edges` by `from === id || to === id` via reactiveMap iteration.
   - `adjacencyOut = derived([edges.entries], buildOutIndex)` — O(E) via mutable arrays + freeze.
   - `adjacencyIn = derived([edges.entries], buildInIndex)` — O(E) via mutable arrays + freeze.
   - Both with `equals` shallow-array-equal-per-key.
   - `relatedNode(idNode, relationNode?)` factory — `derived([adjacencyOut, adjacencyIn, idNode, relationNode?], …)`.
   - Retain imperative `related(id, relation?)`.
   - `entityCount = derived([entities.entries], m => m.size)`, `edgeCount = derived([edges.entries], m => m.size)`.
   - `orphanGC` option implementation: when `"remove"`, post-`unlink` (and post-`edges` retention) check `adjacencyOut.cache + adjacencyIn.cache` for the affected ids and `entities.delete(id)` if empty.
   - Replace inline keepalive on `adjacencyOut` / `adjacencyIn` / `entityCount` / `edgeCount` with `keepalive(node)` helper + `addDisposer`.
   - `domainMeta("memory", kind)` tagging on all internal nodes.
   - JSDoc: triple-key encoding (entity IDs must not contain ` `); edge weight convention ("higher = stronger relation"); `link` replace-on-conflict; `relatedNode` reactive contract; `orphanGC` option; `entityCount` / `edgeCount` observability.
B. **`src/__tests__/patterns/memory.test.ts` additions:** reactive `relatedNode`; symmetric adjacency; O(E) build perf budget at 1k edges/hub; `link` replace-weight; `unlink` by relation only; `removeEntity` cascade; `entitiesMaxSize` + `edgesMaxSize` retention; `orphanGC: "remove"` cleanup; `entityCount` / `edgeCount` emissions; rename test renames.
C. **`docs/optimizations.md`:** parity item only ("PY mirror of TS Unit 5 changes pending parity pass").

#### Revision 2026-04-25 (no-imperative-reads policy, see top-level lock)

Decisions revised:
- **Drop imperative `related(id, relation?)`** — was retained as escape hatch (lock #4). `relatedNode(idNode, relationNode?)` is now the only read API.
- One-shot tests / debug use `firstValueFrom(relatedNode(state(id)))` or read `relatedNode(...).cache` after `awaitSettled`.

Revised `KnowledgeGraph<TEntity, TRelation>` methods after Wave A: `upsertEntity / removeEntity / link / unlink / relatedNode`. No imperative `related`.

Revised tests: drop the imperative-`related` test; expand `relatedNode` reactivity coverage (link/unlink change → results update; id change → results update; relation filter change → results update).

---

## Unit 6 — `guardedExecution` / `GuardedExecutionGraph`

**File:** `src/patterns/guarded-execution/index.ts:1-174` (174 LOC; 1 graph class + 1 factory + cross-references to `patterns/audit/policyEnforcer`)

### Q1 — Semantics, purpose, implementation

```ts
export class GuardedExecutionGraph extends Graph
export function guardedExecution(target: Graph, opts: GuardedExecutionOptions): GuardedExecutionGraph
```

A composable safety wrapper around any target {@link Graph}:

- **Construction** (`guarded-execution/index.ts:83-104`):
  - Calls `policyEnforcer(target, opts.policies, enforcerOpts)` (from `patterns/audit/`) — stacks per-node guards on `target` in `enforce` mode; records would-be denials in a `violations` topic in `audit` mode.
  - `this.enforcer = policyEnforcer(...)` — held as a public readonly property.
  - `this.violations = this.enforcer.violations` — republished topic reference (same Node).
  - `this.mount("enforcer", this.enforcer)` — mounts the enforcer as a child subgraph so `wrapper.describe()` surfaces `enforcer::policies` / `enforcer::violationCount` paths.
- **`scopedDescribe(opts?)` method** (line 124–133):
  - Imperative; returns a `GraphDescribeOutput` snapshot.
  - Falls back to `this._defaultActor` (constructor-supplied) if no per-call actor.
  - Delegates to `target.describe({...opts, actor})`.
  - Filters by per-node guards on the target; in `enforce` mode, also by the policy-derived stacked guards.
- **Modes:**
  - `"enforce"` (default) — disallowed writes throw `GuardDenied`; describe filters by AND(per-node guards, policy guards).
  - `"audit"` — no guards stacked; would-be denials recorded in `violations`; describe filters purely by per-node guards.
- **V1 scope:** policies + actor + scoped describe. **Budget-as-option NOT included** (deferred per JSDoc lines 19–22). Callers needing budget today append a budget-aware `PolicyRuleData` to the policies list.
- **Cross-pattern dependencies (NOT YET AUDITED):** `patterns/audit/policyEnforcer`, `patterns/audit/PolicyEnforcerGraph`, `patterns/audit/PolicyViolation` types. **This unit's correctness depends on the audit module's correctness — flag for the next-round audit.**
- **Cross-language:** PY does NOT have `guarded_execution` — parity work for this unit means "create from scratch," not "mirror," when the parity pass runs.

### Q2 — Semantically correct?

1. **`scopedDescribe` is imperative** — same anti-pattern resolved at Units 4–5. No reactive `scopedDescribeNode(actorNode?)` for harnesses where the actor changes per request.
2. **Mode interaction with `scopedDescribe` is subtle and silently divergent** (JSDoc lines 116–122):
   - `enforce`: filters by AND(per-node guards, policy-derived stacked guards). Policies always affect describe visibility.
   - `audit`: NO guards stacked → filters only by pre-existing per-node guards. **If target has no per-node guards, policies have ZERO effect on describe visibility** — only on the `violations` topic.
   - A user testing in audit mode and seeing all nodes might assume enforce mode shows the same. It won't. Documented in JSDoc but easy to miss.
3. **Empty-policies deny-by-default in enforce mode is hostile UX** (JSDoc lines 41–47). Empty list blocks every write AND every observe. Documented but the right fix is a friendlier default OR a runtime guard.
4. **`scopedDescribe(opts?)` with no actor returns unscoped describe.** Lines 127–131: if neither `opts.actor` nor `this._defaultActor` is set, the actor field is omitted, and `target.describe({})` runs without actor scoping. **No warning** — if a user forgot to configure actor, they get full unscoped output silently.
5. **`opts.actor`** is `Actor | undefined` (static). Not a `NodeOrValue<Actor>` — can't switch reactively without reconstructing the wrapper. For LLM-driven harnesses this is the wrong shape.
6. **`this.enforcer` and `this.violations` are public** — callers can read them, but the wrapper has no own non-mounted nodes. `describe(wrapper)` shows only `enforcer::*` paths.
7. **Wrapper destruction / lifecycle:** the mount handles enforcer teardown via the standard mount-disposer chain (assumed; not directly verified — depends on `patterns/audit/policyEnforcer` correctness).
8. **No runtime check for "audit + no per-node guards on target"** — the silent-no-effect case in Q2 #2.
9. **`opts.violationsLimit`** is forwarded to enforcer; otherwise enforcer default applies.
10. **`opts.graph`** plumbing — passes options to the wrapper's super(); fine.

### Q3 — Design-invariant violations?

- 🟢 No async / Promise / setTimeout / polling.
- 🟢 No clock reads inside reactive fns (no fns at all in this unit — pure delegator).
- 🟢 Composition via mount — clean.
- 🟢 No cache reads inside reactive fns.
- 🟡 **Imperative `scopedDescribe`** — reactive sibling missing.
- 🟡 **Static `actor`** — not a `NodeOrValue<Actor>`, no reactive actor binding.
- 🟡 **Empty-policies deny-by-default** — UX violates spec §5.12 ("Phase 4+ APIs must be developer-friendly").
- 🟡 **Audit-vs-enforce describe divergence** silently footgun-shaped.
- 🟡 **No `domainMeta`** on the wrapper itself (no own nodes to tag, but the wrapper class could be tagged).
- 🟡 **Cross-pattern dependency on `patterns/audit/`** — not violation-shaped, but full correctness requires that module's audit.

Net: 🟡 dominated by imperative-scopedDescribe + static-actor + empty-policies UX.

### Q4 — Open items

- **Reactive `scopedDescribeNode(actorNode?, opts?)` factory.**
- **Reactive `actor: NodeOrValue<Actor>` binding.**
- **Empty-policies UX fix** — throw at construction OR default `allow *` OR warn-on-first-write.
- **No-actor warning** — when `scopedDescribe()` is called with no actor configured.
- **Audit-vs-enforce describe divergence** — JSDoc-only or runtime-detectable?
- **Wrapper-level "scope" observability derived** — current actor, mode, policies count.
- **`domainMeta("guarded", …)`** — once the wrapper has own nodes.
- **Budget integration (V1 deferred per JSDoc).**
- **Cross-pattern audit dependency.** `patterns/audit/policyEnforcer` not yet reviewed; flag for next-round audit.
- **PY parity** — does NOT exist; create-from-scratch when parity pass runs.
- **Test coverage.** `guarded-execution.test.ts` — need to inspect (haven't yet).

### Q5 — Right abstraction? More generic possible?

- **Wrapper shape is correct.** Coordinator graph mounting an enforcer + republishing the violations topic + offering a scoped describe API. Don't restructure.
- **The cross-pattern split (`guarded-execution` ↔ `audit/policyEnforcer`) is right.** `policyEnforcer` is the reactive primitive (policies → guards + violations topic); `guardedExecution` is the public-face composition. Keep.
- **Imperative `scopedDescribe` should have a reactive sibling** for harness use cases. Keep imperative as escape hatch (mirroring Units 4–5).
- **Actor should be reactive.** `NodeOrValue<Actor>` accepts both static and Node-supplied actors. Reactive consumers compose; static callers pass a plain Actor.
- **Wrapper could expose own observability nodes** — `scope` derived showing `{actor, mode, policiesCount}` for at-a-glance status. Optional; cosmetic.
- **Dropping the wrapper class entirely (Option J in Q8)** is unattractive — `policyEnforcer` is in `patterns/audit/` (an internal-feeling module), and the public-face vision block needs a stable, discoverable `guardedExecution(...)` factory. The wrapper IS the public face.
- **Naming:** `GuardedExecutionGraph` is clear. The `Graph` suffix is consistent with `LensGraph`, `KnowledgeGraph` (post-rename), `CollectionGraph`, etc. Don't rename.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~100 LOC of class + factory + JSDoc. Low intrinsic burden. **The real burden lives in `patterns/audit/policyEnforcer`** — the enforcer is doing the actual work; the wrapper is a pure delegator. If the enforcer changes shape, the wrapper updates trivially.

**Caveats / footguns:**

1. **Imperative `scopedDescribe` will surface as a UX issue** for harness/LLM use cases. A harness loop calling `scopedDescribe({actor})` per turn is fine; a reactive consumer wanting "live scoped describe per actor change" needs a reactive sibling.
2. **Static actor is the wrong shape for LLM harnesses.** Per-request actor switching via per-call `{actor}` is workable but anti-reactive. `NodeOrValue<Actor>` resolves both shapes.
3. **Empty-policies deny-by-default is hostile.** Three real options:
   - **Option D1: Throw at construction** in enforce mode if `policies` is a static empty array. Most defensive; surfaces the bug at boot.
   - **Option D2: Default `[{ effect: "allow", action: "*" }]` if empty.** Permissive default; explicit deny rules are layered on top. Safer UX but allows accidental "I configured policies but they're empty so everything is open."
   - **Option D3: Warn on first use with empty policies.** Logs a warning and stacks no guards. Compromise; doesn't prevent the foot-shoot.
   - My call: **D1** — throw at construction in enforce mode; tolerate empty in audit mode (where policies don't gate writes anyway).
   - For Node-supplied policies: the dynamic case can't validate at construction. Add a guard that throws on the first observed empty emission in enforce mode.
4. **Audit-vs-enforce describe divergence** is documented but easy to miss. Two real options:
   - **Option H1: Add a runtime warning** when `scopedDescribe` is called in audit mode AND target has no per-node guards (no scoping happens). Console warn + `violations` topic emit.
   - **Option H2: Stronger JSDoc only.** Trust the user.
   - My call: **H1** — emit a one-time warning per wrapper instance; quiet thereafter.
5. **No-actor `scopedDescribe`** silently returns unscoped. Add the same warning class.
6. **No reactive actor binding** — locked already in Q5/Q6 #2 above.
7. **Wrapper has no own observability nodes.** Adding a `scope: derived([policiesNode?, …], () => ({actor, mode, policiesCount}))` is cheap; surfaces status in `describe`.
8. **Budget integration (V1 deferred).** Stays deferred — separate cost-tracking design.
9. **Cross-pattern dependency on `patterns/audit/`** means full correctness validation requires that module's audit. **Flag now: file under "Active work items" in `docs/optimizations.md`** that `patterns/audit/policyEnforcer` audit is a prerequisite for the `guardedExecution` audit being fully closed.
10. **PY parity is "create-from-scratch."** PY does not have `guarded_execution`. Parity pass needs to author the module. JSDoc + tests + cross-language semantics-doc all need to be designed for both.
11. **`enforcer` and `violations` properties expose internals.** Public access lets callers wire downstream consumers (alerts, dashboards via `lens`); kept.
12. **Vision-block alignment.** This IS the public-face `guardedExecution` block. Documentation must lock the reactive contract — the rebuild here makes that possible.
13. **Public-export commitment.** `GuardedExecutionOptions`, `GuardedExecutionGraph`, `guardedExecution`, re-exported `DescribeFilter`. Pre-1.0 free.

**What hurts in 6 months:**
- A harness author files: "my scopedDescribe doesn't update when the actor changes" — answer is "imperative; re-call" until reactive sibling lands.
- A user with an empty policies list in enforce mode deploys to production, every write throws GuardDenied, debug session ensues. Throw-at-construction prevents this.
- A user testing in audit mode misinterprets "describe shows all nodes" as "policies are too permissive" — should be "audit mode doesn't filter describe."
- Budget-aware policies require manual rule authoring; future `budget` option remains TBD.
- PY ecosystem users expect `guarded_execution` parity and find it missing.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:**

```ts
const app = new Graph("app");
app.add(state(0, { name: "counter" }));
const guarded = guardedExecution(app, {
  actor: { type: "human", id: "alice" },
  policies: [{ effect: "allow", action: "*" }],
});
guarded.describe({ format: "ascii" });
// → app_guarded
//     enforcer (mounted PolicyEnforcerGraph)
//       policies (state, audit-pattern)
//       violationCount (derived)
//       violations (topic)
```

- ✅ Wrapper mounts the enforcer; describe() surfaces enforcer's nodes.
- ⚠️ Wrapper has no own non-mounted nodes — `app_guarded` describe shows `enforcer::*` paths only. Cosmetic.
- ⚠️ `scopedDescribe` is imperative — invisible to wrapper's own describe/explain.
- ⚠️ Target's nodes are not visible in wrapper.describe() unless the user explicitly mounts the target too. The wrapper holds a reference (`this._target`) but does NOT mount the target. **This is intentional** (the target stays standalone; the wrapper is a sidecar) but worth documenting.

**Composability:**
- **As an upstream:** `guarded.violations.events` (the topic's events stream) plays cleanly into reactive consumers (alerts, `lens.health`).
- **As a sink:** The wrapper coordinates target writes via the stacked guards; reactive composition flows through the target, not the wrapper.
- **With `lens`:** `lens(guarded)` works — the wrapper IS a Graph; topology stats reflect the enforcer mount. Health monitoring of `violations` count is a natural consumer (per JSDoc line 13).

**Perf:**
- Construction: O(target nodes) for enforcer to stack guards (in enforce mode).
- `scopedDescribe`: O(target nodes) per call.
- Reactive `scopedDescribeNode` (proposed): O(target nodes) per re-derive; `equals` should short-circuit identical outputs.
- `violations` topic: bounded ring buffer (default 1000); O(1) per emit.

**Memory:**
- Per-node guard stack from enforcer: scales with target nodes.
- Violations ring: bounded.
- Wrapper itself: ~constant (a few fields).

### Q8 — Alternatives

**A. Keep as-is.** No code change.
- Pros: zero churn; tests pass.
- Cons: every Q6 caveat stays.

**B. Add reactive `scopedDescribeNode(actorNode?, opts?): Node<GraphDescribeOutput>` factory.**
- Pros: closes imperative gap.
- Cons: doesn't fix actor binding, empty-policies UX, audit-vs-enforce divergence.

**C. Make `actor: NodeOrValue<Actor>` (reactive actor binding).**
- Pros: reactive composition for harnesses.
- Cons: pre-1.0 breaking; doesn't fix empty-policies UX.

**D. Empty-policies UX:** D1 throw-at-construction in enforce mode; D2 default `allow *`; D3 warn-only.
- Pros (D1): defensive; surfaces bugs at boot.
- Cons (D2): permissive default could mask "I forgot to configure deny rules."
- My call: **D1** for enforce; tolerate empty in audit.

**E. Budget integration.** Out of scope V1 per JSDoc.

**F. `domainMeta("guarded", …)` tagging** — once the wrapper has own nodes (per G).

**G. Wrapper-level `scope` observability derived** — `Node<{actor, mode, policiesCount}>`.

**H. Audit-vs-enforce describe divergence:** H1 runtime warning when audit + no per-node guards; H2 stronger JSDoc only. My call: **H1**.

**I. Combine B + C + D1 + F + G + H1 — harden + reactify, single Wave-B pass.**

**J. Drop the wrapper class entirely; export only `policyEnforcer`** (currently in `patterns/audit/`). Rejected per Q5 — the public-face block needs a stable factory.

**K. Make actor required (no fallback to default).**
- Pros: prevents silent unscoped describe.
- Cons: breaking; harsher UX than warn.

**L. Warn-on-no-actor in `scopedDescribe`** — same warning class as audit-vs-enforce divergence.

**M. Add target re-mount option.** Optionally mount target as a sibling of enforcer so wrapper.describe() shows target paths too. Cosmetic; behind an `includeTarget?: boolean` flag.

### Q9 — Recommendation (revised 2026-04-25, no-imperative-reads policy)

**Recommended call: I + L — harden + reactify + no-actor warning, single Wave-B pass. Imperative `scopedDescribe` is DROPPED (per top-level API-style policy lock).**

Mirrors Units 4–5's pattern adapted to a delegator-shaped wrapper, with the no-imperative-reads policy applied.

**Step 1 (lands in Wave B implementation):**

1. **Add reactive `scopedDescribeNode(actorNode?: NodeOrValue<Actor>, opts?: NodeOrValue<…>): Node<GraphDescribeOutput>`** factory on `GuardedExecutionGraph`:
   - `derived([targetTopologyStream, actorNode?, optsNode?], (_topology, actor, optsArg) => target.describe({...optsArg, actor}))`.
   - Subscribes to `target.topology` (the topology event stream) so describe re-derives on structural changes.
   - `equals: deepDescribeEqual` — short-circuits identical outputs.
   - Lazy.
   - **This is the only read API on the wrapper.**
2. **Drop imperative `scopedDescribe(opts?)` entirely.** One-shot callers use `firstValueFrom(guarded.scopedDescribeNode(state(actor)))` or read `.cache` after `awaitSettled`. Pre-1.0 free.
3. **Make `actor: NodeOrValue<Actor>` (reactive actor binding).** Internally normalize to `actorNode = isNode(actor) ? actor : state(actor)`. Pre-1.0 breaking change.
4. **Empty-policies UX fix (D1):**
   - At construction: if `mode: "enforce"` AND `policies` is a static empty array, throw `RangeError("guardedExecution: empty policies in enforce mode would deny all operations. Add at least an `allow` rule.")`.
   - At runtime for Node-supplied policies: subscribe to first DATA from the policies node; if empty AND mode=enforce, emit a one-time warning to `violations` topic with type `"empty-policies"` (define a new `PolicyViolation` shape).
   - Tolerate empty in audit mode (no gating effect; only violations topic).
5. **Audit-vs-enforce describe divergence (H1):**
   - Inside `scopedDescribeNode`'s derived fn: detect "audit mode + target has no per-node guards" via a one-time check. Emit a one-time warning per wrapper-instance lifetime to `violations` topic with type `"audit-no-effect"`.
6. **No-actor warning (L):**
   - Inside `scopedDescribeNode`: detect "no actor configured AND no per-call actor on the node" → one-time warning per wrapper instance, type `"no-actor"`.
7. **Wrapper-level `scope` observability derived (G):**
   - `scope: derived([actorNode?, policiesNode?], (actor, policies) => ({actor, mode, policiesCount: policies.length}))`.
   - Mounted on the wrapper as `app_guarded::scope`.
8. **`domainMeta("guarded", kind)` tagging (F)** on `scope` and on `scopedDescribeNode` deriveds when created.
9. **JSDoc tightening:**
   - `scopedDescribeNode` reactive contract.
   - Reactive actor binding (`NodeOrValue<Actor>`).
   - Empty-policies throw-on-construction for enforce mode.
   - Audit-vs-enforce describe divergence with runtime warning + stronger language.
   - No-actor warning class.
   - `scope` observability node.
   - Migration note: "imperative `scopedDescribe` removed; use `firstValueFrom(scopedDescribeNode(...))` for one-shot reads."
10. **Tests** (`src/__tests__/patterns/guarded-execution.test.ts`):
    - Reactive `scopedDescribeNode`: switch actor; assert describe re-derives with new scoping.
    - Reactive actor binding: pass `state(actor)`; emit new actor; assert effect.
    - Topology change in target → `scopedDescribeNode` re-derives.
    - Empty-policies throw at construction in enforce mode.
    - Empty-policies tolerated in audit mode (with violation emit on first DATA).
    - Audit + no-per-node-guards warning surfaces in `violations` topic.
    - No-actor warning surfaces in `violations` topic.
    - `scope` derived emits on actor / policies changes.
    - `firstValueFrom(scopedDescribeNode(state(actor)))` returns a single snapshot (one-shot pattern).

**Cross-pattern dependency (`patterns/audit/policyEnforcer`):**
- **Flag in `docs/optimizations.md`** under "Active work items": "`patterns/audit/policyEnforcer` audit is a prerequisite for `guardedExecution` correctness sign-off."
- The Unit-6 step-1 work proceeds on the assumption that the enforcer is correct as-is; if the audit pass uncovers bugs, this unit may need follow-up.

**On Option K (actor required):** **Don't** — harsher than necessary; warn-on-no-actor is sufficient.

**On Option M (target re-mount):** **Don't** — needless mounting complexity; the wrapper IS a sidecar by design.

**On budget integration (Option E):** **Defer per V1 JSDoc.** Separate roadmap item.

**Coverage table:**

| Concern | Step 1 (I + L) |
|---|---|
| Q2 — imperative `scopedDescribe` | ✅ `scopedDescribeNode` reactive; `scopedDescribe` retained escape hatch |
| Q2 — static actor | ✅ `actor: NodeOrValue<Actor>` reactive binding |
| Q2 — audit-vs-enforce describe divergence | ✅ runtime warning via `violations` topic |
| Q2 — empty-policies deny-by-default | ✅ throw at construction in enforce; warn at runtime for Node-supplied |
| Q2 — no-actor silent unscoped | ✅ runtime warning |
| Q3 — imperative-scopedDescribe gray-zone | ✅ resolved |
| Q3 — static-actor gray-zone | ✅ resolved |
| Q3 — empty-policies UX violation | ✅ resolved |
| Q3 — no `domainMeta` | ✅ tagged |
| Q4 — open items | ✅ closed in step 1 (except budget integration, V1 deferred) |
| Q5 — wrapper observability gap | ✅ `scope` derived |
| Q5 — naming | ✅ no rename (consistent suffix) |
| Q6 — production ergonomics for harnesses | ✅ reactive scopedDescribeNode + actor binding |
| Q6 — empty-policies foot-shoot | ✅ throw-at-construction |
| Q6 — audit-vs-enforce silent divergence | ✅ runtime warning |
| Q6 — cross-pattern audit dep on `patterns/audit/` | ⚠️ flagged for next-round audit |
| Q6 — PY parity (create-from-scratch) | ⚠️ deferred to parity pass; create-from-scratch effort |
| Q7 — wrapper-level describe gap | ✅ `scope` derived adds own paths |
| Q7 — copy-on-write GC churn | n/a (pure delegator) |

**Open questions for the user before locking:**

1. **Confirm I + L** (harden + reactify + no-actor warning, single Wave-B pass) vs. alternatives.
2. **Reactive `scopedDescribeNode(actorNode?, opts?)` as the only read API** (imperative `scopedDescribe` dropped per top-level policy)?
3. **Reactive `actor: NodeOrValue<Actor>` binding** (pre-1.0 breaking)?
4. **Empty-policies UX (D1):** throw at construction in enforce mode? Tolerate empty in audit mode?
5. **Audit-vs-enforce describe divergence (H1):** runtime warning via `violations` topic on first detection?
6. **No-actor warning (L):** runtime warning via `violations` topic on first detection?
7. **Wrapper-level `scope` observability derived (G)?**
8. **`domainMeta("guarded", …)` tagging (F)?**
9. **Cross-pattern `patterns/audit/` audit prerequisite** — file in `docs/optimizations.md`?
10. **PY parity:** defer to Python parity pass (create-from-scratch effort)?

### Decisions locked (2026-04-25)

1. **Recommendation I + L** — harden + reactify + no-actor warning, single Wave-B pass. Imperative `scopedDescribe` dropped per top-level no-imperative-reads policy.
2. **`scopedDescribeNode(actorNode?, opts?): Node<GraphDescribeOutput>` is the only read API.** Subscribes to target topology stream so describe re-derives on structural changes; `equals: deepDescribeEqual`; lazy.
3. **`actor: NodeOrValue<Actor>` reactive binding** — pre-1.0 breaking; normalized internally to a Node.
4. **Empty-policies UX (D1):** throw `RangeError` at construction in `enforce` mode for static empty array; emit `"empty-policies"` violation on first DATA in `enforce` mode for Node-supplied empty; tolerate empty in `audit` mode.
5. **Audit-vs-enforce describe divergence (H1):** one-time-per-instance `"audit-no-effect"` violation when audit + target has no per-node guards.
6. **No-actor warning (L):** one-time-per-instance `"no-actor"` violation when neither configured nor per-call actor present.
7. **Wrapper-level `scope` derived** — `Node<{actor, mode, policiesCount}>`; mounted as `app_guarded::scope`.
8. **`domainMeta("guarded", kind)` tagging** on `scope` and `scopedDescribeNode` deriveds.
9. **Cross-pattern `patterns/audit/policyEnforcer` audit prerequisite** — filed in `docs/optimizations.md` under "Active work items": "`patterns/audit/policyEnforcer` audit is a prerequisite for `guardedExecution` correctness sign-off."
10. **PY parity deferred** — create-from-scratch effort when the Python parity pass runs.

**Implementation scope when Wave B lands (Unit 6):**

A. **`src/patterns/guarded-execution/index.ts:1-174` rewrite:**
   - Remove imperative `scopedDescribe(opts?)`.
   - `actor` option becomes `NodeOrValue<Actor>`; normalize to internal `actorNode = isNode(actor) ? actor : state(actor)`.
   - `scopedDescribeNode(actorNode?: NodeOrValue<Actor>, opts?: NodeOrValue<…>): Node<GraphDescribeOutput>` — derived over `[target.topology, actorNode, optsNode?]`; `equals: deepDescribeEqual`; lazy.
   - Constructor throw on `mode: "enforce"` + static empty `policies` (`RangeError`).
   - Subscribe to first DATA from policies node; if empty AND mode=enforce, emit `"empty-policies"` violation.
   - Audit-mode + no per-node guards detection inside `scopedDescribeNode` derived fn → one-time `"audit-no-effect"` violation.
   - No-actor detection inside `scopedDescribeNode` → one-time `"no-actor"` violation.
   - `scope = derived([actorNode, policiesNode], (actor, policies) => ({actor, mode, policiesCount: policies.length}))`; mounted.
   - `domainMeta("guarded", kind)` tagging.
   - JSDoc tightened per Q9.
B. **`src/__tests__/patterns/guarded-execution.test.ts` additions:** `scopedDescribeNode` reactive on actor + topology change; reactive actor binding; empty-policies throw; empty-policies audit-tolerate + violation; audit-no-effect warning; no-actor warning; `scope` derived emissions; `firstValueFrom(scopedDescribeNode(...))` one-shot.
C. **`docs/optimizations.md`:**
   - File: "`patterns/audit/policyEnforcer` audit prerequisite for `guardedExecution` sign-off."
   - File: "PY `guarded_execution` create-from-scratch (Wave B follow-up parity pass)."

---

## Unit 7 — `resilientPipeline`

**File:** `src/patterns/resilient-pipeline/index.ts:1-176` (176 LOC; 1 factory; cross-references to `extra/resilience.ts` and `patterns/reduction/budgetGate`)

### Q1 — Semantics, purpose, implementation

```ts
export function resilientPipeline<T>(
    source: Node<T>,
    opts: ResilientPipelineOptions<T> = {},
): ResilientPipelineBundle<T>
```

Curried compose-pipeline factory wrapping `source` with the canonical resilience nesting order:

```
rateLimit → budget → breaker → timeout → retry → fallback → status
```

Each layer optional (omit → skip). Returns a `ResilientPipelineBundle<T>`:
- `node: Node<T>` — final resilient node.
- `status: Node<StatusValue>` — `"pending" | "active" | "completed" | "errored"`.
- `error: Node<unknown | null>` — last error or null.
- `breakerState: Node<CircuitState> | undefined` — only set when `opts.breaker != null`.

**Implementation steps** (`resilient-pipeline/index.ts:113-173`):
1. `current = source`.
2. **rateLimit** — `current = rateLimiter(current, opts.rateLimit)` (admission control; cheapest-to-drop first).
3. **budget** — `current = budgetGate(current, opts.budget)` (cost gate; from `patterns/reduction/`).
4. **breaker** — `circuitBreaker(opts.breaker)` + `withBreaker<T>(breaker, {onOpen})(current)`; `breakerState` saved off the bundle.
5. **timeout** — `current = timeout(current, opts.timeoutMs * NS_PER_MS)`. Applied BEFORE retry so each retry resubscribes to a fresh deadline (per-attempt semantics, JSDoc lines 136–139).
6. **retry** — `current = retry(current, opts.retry)`.
7. **fallback** — `current = fallback(current, opts.fallback)`. Guard `opts.fallback !== undefined` so `null` is a valid fallback.
8. **withStatus** — `current = withStatus(current, { initialStatus })`. Always last so it sees the final shape.

**`timeoutMs` upper bound:** 9_000_000 ms (≈2.5h) — guards against `timeoutMs * NS_PER_MS` overflowing `Number.MAX_SAFE_INTEGER`. Throws `RangeError` above the bound.

**`breakerOnOpen` default `"skip"`** — emits RESOLVED when breaker open (lets downstream drop the beat). Alternative `"error"` propagates `CircuitOpenError` so retry/fallback can react.

**Cross-pattern dependencies (NOT YET AUDITED):**
- `extra/resilience.ts` — `rateLimiter`, `circuitBreaker`, `withBreaker`, `timeout`, `retry`, `fallback`, `withStatus`. **Auditing the resilience primitives is a prerequisite for full sign-off on this unit.**
- `patterns/reduction/budgetGate` — flag for next-round audit.

**Cross-language:** PY does NOT have `resilient_pipeline` — parity work is "create from scratch."

**Subsumes:** the pre-1.0 `resilientFetch` template (per JSDoc line 22). `resilientFetch` becomes a preconfigured instance of this factory for the HTTP fetch case.

### Q2 — Semantically correct?

1. **Order is opinionated and well-justified.** Each step's position has explicit rationale in JSDoc (rate→budget→breaker→timeout→retry→fallback→status). Per-attempt timeout-before-retry is correct.
2. **`breakerOnOpen` interaction with retry is subtle:**
   - `"skip"` (default) — breaker open emits RESOLVED, retry sees no error, no resubscribe. Downstream drops the beat.
   - `"error"` — breaker open emits `CircuitOpenError`, retry sees error, resubscribes. Next attempt likely also breaker-open → another error → retry burns its budget against an open circuit.
   - With `breakerOnOpen: "error"` AND `retry`, callers should configure retry's `shouldRetry` (if available) to ignore `CircuitOpenError`, OR set retry's backoff long enough for the breaker reset window. Documented? No.
3. **Static options.** `RateLimiterOptions`, `RetryOptions`, `CircuitBreakerOptions`, `BudgetConstraint[]`, `timeoutMs`, `fallback` — all static. Once constructed, the pipeline is fixed. For LLM-tuned timeouts or dynamic budget adjustment, this is the wrong shape.
4. **Bundle return (no Graph wrapper).** Same no-Graph wart as `lightCollection` / pre-rebuild `vectorIndex`. Each intermediate node (post-rateLimit, post-breaker, etc.) is detached. Caller wanting describe()/lens.flow coverage must mount each.
5. **`status` reflects only the final layer.** No per-layer status surface. If breaker trips, `status` shows the wrapped layer's status (skipped or errored), but there's no `breakerOpen` boolean separate from `breakerState`.
6. **`error` only carries the last error.** Retry's intermediate errors are not exposed.
7. **`breakerState` is `undefined`** when no breaker configured. Caller must null-check. Could be `Node<CircuitState | "no-breaker">` for uniformity, but `undefined` matches the "layer skipped" semantics.
8. **`rateLimiter`, `budgetGate`, etc. correctness depends on `extra/resilience.ts` and `patterns/reduction/`** — neither audited yet.
9. **`timeoutMs > 0` check** at line 141 — good; `<= 0` throws.
10. **`opts.budget != null && opts.budget.length > 0`** — empty budget array = no gate. Reasonable.
11. **`fallback !== undefined`** — guard at line 160 lets `null` be a valid fallback.
12. **`initialStatus` default `"pending"`** — per JSDoc line 73; reasonable.
13. **No reactive switching of layers** — can't "turn off the breaker" without reconstruction.
14. **No way to inspect intermediate stages.** A caller debugging "where did my data drop?" can't see "rate-limited skip" vs "breaker open" vs "budget exhausted" separately. `status: "completed"` collapses all skips.

### Q3 — Design-invariant violations?

- 🟢 Pure composition; no imperative triggers, no Promise/setTimeout, no clock reads inside fn bodies.
- 🟢 Each layer is a reactive primitive from `extra/resilience.ts` or `patterns/reduction/`.
- 🟢 No protocol surfaces leaked.
- 🟡 **Static options** — for harness use cases this is the wrong shape. Reactive tunability missing.
- 🟡 **No-Graph wart** — bundle return; intermediates detached.
- 🟡 **No `domainMeta`** on intermediates → mermaid grouping degrades.
- 🟡 **Status / error surfaces narrow** — no per-layer breakdown.
- 🟡 **Cross-pattern dep unaudited** (`extra/resilience.ts`, `patterns/reduction/budgetGate`).

Net: 🟡 dominated by static-options + no-Graph wart + cross-pattern audit prerequisite.

### Q4 — Open items

- **Reactive options.** `NodeOrValue<RetryOptions>`, `NodeOrValue<RateLimiterOptions>`, etc. — depends on whether the underlying primitives support reactive options.
- **No-Graph wart** — wrap in `ResilientPipelineGraph<T>` subclass.
- **Per-layer status companions** — surface `rateLimitState`, `budgetState`, `retryAttempts`, `lastTimeout`, etc.
- **Cross-pattern audit prerequisites** — `extra/resilience.ts` (the whole file), `patterns/reduction/budgetGate`.
- **`domainMeta` tagging.**
- **`breakerOnOpen + retry` JSDoc** — document the subtle interaction.
- **Order flexibility.** Defer; canonical order is well-justified.
- **`resilientFetch` migration** — verify no call sites depend on the legacy template.
- **PY parity** — create-from-scratch.
- **Test coverage.** `resilient-pipeline.test.ts` exists — need to inspect.

### Q5 — Right abstraction? More generic possible?

- **Curried composition is the right pattern** for resilience pipelines. Don't decompose.
- **Bundle return is the wrong shape** post-no-Graph-wart resolution. Should return a `ResilientPipelineGraph<T>` (Graph subclass) with mounted intermediate nodes.
- **Static options are the wrong shape** for harness use cases. `NodeOrValue<…>` upgrades on a per-option basis (where the underlying primitive supports it).
- **Per-layer status companions** are the right level of observability — surface what each layer did. The aggregate `status: Node<StatusValue>` becomes a reduction over the per-layer surfaces.
- **`breakerState` shape** stays as-is.
- **Naming:** `resilientPipeline` is clear. The factory + bundle pattern matches `lightCollection` / pre-rebuild `vectorIndex`. Pre-1.0 free to switch to Graph subclass.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~70 LOC of pure composition. Low intrinsic burden — the actual logic lives in the underlying primitives (each ~50–200 LOC in `extra/resilience.ts`). The pipeline factory itself is just an order-of-operations.

**Caveats / footguns:**

1. **Static options will surface as a UX issue** for harness / LLM-tuned use cases. Concrete: an agent observing high latency wants to bump `timeoutMs` from 10s → 30s; under static options, the only path is reconstructing the entire pipeline. With `NodeOrValue<number>` for `timeoutMs`, the agent emits a new value on a `state(timeoutMs)` and the layer adapts.
2. **No-Graph wart.** Every intermediate node is detached. `lens.flow` over a `resilientPipeline` shows only the source and the final node — the rate-limit / breaker / retry stages are invisible. For production debugging ("where did my data get dropped?") this is the wrong UX.
3. **Aggregate `status` collapses skip-vs-error.** A user seeing `status: "completed"` doesn't know if the data actually flowed through or was skipped by the breaker. Per-layer status companions resolve this.
4. **`breakerOnOpen + retry` interaction** — the `"error"` mode + retry can burn the retry budget against an open circuit. Document or guard.
5. **Cross-pattern audit prerequisites** — `extra/resilience.ts` is the dominant external dependency. Each primitive's correctness is a prerequisite for this unit's sign-off. **Flag in `docs/optimizations.md`:** "`extra/resilience.ts` audit (Wave 2+ extras pass) is a prerequisite for `resilientPipeline` correctness sign-off."
6. **`patterns/reduction/budgetGate` audit prerequisite** — same flag.
7. **Order rigidity** — accept as canonical; document alternatives if a real use case surfaces.
8. **`resilientFetch` migration** — JSDoc says this subsumes it. Need to verify no call sites depend on the legacy template name.
9. **PY parity is create-from-scratch** — same as `guarded_execution`. Significant effort; defer to parity pass.
10. **`timeoutMs` upper bound at 2.5h** is generous; documented.
11. **Public-export commitment.** `ResilientPipelineOptions<T>`, `ResilientPipelineBundle<T>`, `resilientPipeline<T>`, plus re-exported `NS_PER_MS / NS_PER_SEC` from `extra/backoff.js`. Pre-1.0 free.
12. **Vision-block alignment.** This IS the canonical `resilientPipeline` block. Documentation must align with the reactive contract — the rebuild here makes that possible.
13. **No-imperative-reads policy** doesn't directly apply (the pipeline has no read API beyond Nodes). The relevant policy here is the **reactive options** upgrade.

**What hurts in 6 months:**
- A harness author files: "I want my retry count to adapt to observed failure rate" — answer is "reconstruct the pipeline" until reactive options land.
- A production debug session can't tell which layer dropped a beat.
- A `breakerOnOpen: "error"` + retry config in a flaky network burns retry budget against an open breaker.
- PY users find `resilient_pipeline` missing.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check (run mentally):**

Current shape (no-Graph):
```ts
const safeFetch = resilientPipeline(fetchNode, {...});
// Bundle: { node, status, error, breakerState }
// All detached unless caller mounts.
g.add(fetchNode); g.add(safeFetch.node); g.add(safeFetch.status);
g.describe({ format: "ascii" });
// → fetchNode (state)
//   ... intermediate detached nodes ...
//   safeFetch.node (state — final)
//   safeFetch.status (state — companion)
// Intermediates invisible; describe doesn't show layer chain.
```

Proposed (`ResilientPipelineGraph<T>`):
```
fetchNode → rateLimited → budgetGated → breakerWrapped → timeoutWrapped → retryWrapped → fallbackWrapped → statusWrapped
                                              ↓
                                         breakerState
                                              ↓                                 ↓                ↓
                                         rateLimitState        retryAttempts  lastTimeout
```

All intermediates mounted; `describe()` / `lens.flow` see the chain; per-layer status companions surface at each stage.

**Composability:**
- **Source must be a Node.** Reactive composition end-to-end.
- **Each layer adds a derived/wrapped node.** Each is observable individually.
- **Reactive options** would let layer settings flow from upstream nodes (e.g. an LLM-controlled `timeoutMsNode` → timeout layer adapts).

**Perf:**
- Each layer adds latency overhead (one derived hop).
- Retry resubscribes on error → multiplicative cost.
- Breaker + rate-limit are O(1) per pass.
- Timeout is O(1) per pass + a pending deadline.
- `equals` short-circuits at each layer reduce downstream churn.

**Memory:**
- Each layer holds its own state (breaker counters, retry counter, status, etc.).
- Bounded; no unbounded growth.

### Q8 — Alternatives

**A. Keep as-is.** No code change. Cons: every Q6 caveat stays; static options block harness use cases.

**B. Wrap in `ResilientPipelineGraph<T>` subclass.** Mount intermediate nodes; `domainMeta` tagging. Closes no-Graph wart.

**C. Reactive options** — `NodeOrValue<…>` for tunable layers. Depends on underlying primitive support.

**D. Per-layer status companions** — surface `rateLimitState`, `budgetState`, `retryAttempts`, `lastTimeout`, etc.

**E. `domainMeta("resilient", kind)` tagging.**

**F. `breakerOnOpen + retry` JSDoc** — document subtle interaction.

**G. Migration audit for `resilientFetch` callers.**

**H. Combine B + C + D + E + F + G — full reactive rebuild.**

**I. Allow custom layer order** via `layers: ResilientLayer[]` array. Rejected (canonical order is well-justified; complexity for no real use case).

**J. Surface aggregate metrics** (`totalRetries`, `totalSkips`, `totalTimeouts`) — observability over time. Subset of D.

### Q9 — Recommendation

**Recommended call: H — full reactive rebuild, single Wave-B pass.**

Mirrors Units 4–6 "no defer" pattern adapted to a composition factory.

**Step 1 (lands in Wave B implementation):**

1. **Convert to `ResilientPipelineGraph<T>` subclass** with mounted intermediate nodes.
   - Factory `resilientPipeline(source, opts)` returns the graph.
   - Bundle properties (`node`, `status`, `error`, `breakerState`) become readonly graph properties.
   - Intermediate nodes (`rateLimited`, `budgetGated`, `breakerWrapped`, `timeoutWrapped`, `retryWrapped`, `fallbackWrapped`) mounted with explicit names.
2. **Reactive options.** Each option that supports it accepts `NodeOrValue<…>`:
   - `rateLimit: NodeOrValue<RateLimiterOptions>` (if `rateLimiter` supports reactive options — TBD pending `resilience.ts` audit; if not, file as a dependency).
   - `budget: NodeOrValue<readonly BudgetConstraint[]>` (similar).
   - `breaker: NodeOrValue<CircuitBreakerOptions>` (similar).
   - `timeoutMs: NodeOrValue<number>` (`timeout(source, ns)` — TBD).
   - `retry: NodeOrValue<RetryOptions>` (TBD).
   - `fallback: NodeOrValue<FallbackInput<T>>`.
   - `breakerOnOpen` and `initialStatus` stay static (configuration-only).
   - **For each option where the underlying primitive doesn't yet support reactive config: file in `docs/optimizations.md` as a dependency.** The pipeline factory accepts the `NodeOrValue<…>` shape but currently calls `node.cache ?? defaultValue` once at construction — graceful degradation until the primitive ships reactive support.
3. **Per-layer status companions.** Mount on the graph:
   - `rateLimitState: Node<...>` (when `rateLimit` configured).
   - `budgetState: Node<…>` (when `budget` configured).
   - `breakerState: Node<CircuitState>` (when `breaker` configured) — already present.
   - `retryAttempts: Node<number>` (when `retry` configured).
   - `lastTimeout: Node<number | null>` (when `timeoutMs` configured).
   - **Each companion's existence depends on what the underlying primitive exposes.** File any missing surfaces in `docs/optimizations.md` as `resilience.ts` audit follow-ups.
4. **`domainMeta("resilient", kind)` tagging** on all intermediates and companions. `kind ∈ {"rate-limit", "budget", "breaker", "timeout", "retry", "fallback", "status", "rate-limit-state", …}`.
5. **`breakerOnOpen + retry` JSDoc tightening:**
   - Document the interaction explicitly: with `"error"` + retry, retry will see `CircuitOpenError` and resubscribe; configure retry's backoff longer than breaker reset, or use `shouldRetry` to skip `CircuitOpenError`.
6. **`resilientFetch` migration audit:**
   - Grep call sites. If any exist, migrate to `resilientPipeline(fetchNode, {…})` with the equivalent preset.
   - Drop `resilientFetch` export if it's purely cosmetic; or keep as a JSDoc-noted alias if call sites are widespread.
7. **JSDoc tightening:**
   - Reactive options story (which options accept `NodeOrValue<…>`, which are static).
   - Per-layer companion observability surface.
   - `breakerOnOpen + retry` interaction.
   - `timeoutMs` upper bound rationale.
   - Migration note from `resilientFetch`.
   - `resilientPipeline` is now a `ResilientPipelineGraph<T>` (Graph subclass), not a bare bundle.
8. **Tests** (`src/__tests__/patterns/resilient-pipeline.test.ts`):
   - Each layer present / absent (skip semantics).
   - Per-attempt timeout (retry resubscribes to fresh deadline).
   - `breakerOnOpen: "skip"` vs `"error"` interaction with retry.
   - Reactive options: `state(timeoutMs)` emits new value → next attempt uses new deadline (gated on underlying primitive support).
   - Per-layer companion emissions (when configured).
   - `domainMeta` grouping in `describe({ format: "mermaid" })`.
   - `resilientFetch` preset (if retained) produces equivalent topology.

**Cross-pattern audit prerequisites filed in `docs/optimizations.md`:**
- "`extra/resilience.ts` audit (Wave 2+ extras pass) is a prerequisite for `resilientPipeline` correctness sign-off and reactive-option support."
- "`patterns/reduction/budgetGate` audit (next round) is a prerequisite for `resilientPipeline.budget` reactive support."

**On Option I (custom layer order):** **Don't.** Canonical order is well-justified.

**On reactive options where the underlying primitive doesn't support them yet:**
The `resilientPipeline` factory accepts the `NodeOrValue<…>` shape and reads `.cache` once at construction. Behavior degrades gracefully to "static config" until the underlying primitive ships reactive support. Each missing surface filed as a `resilience.ts`-audit follow-up.

**Coverage table:**

| Concern | Step 1 (H — full reactive rebuild) |
|---|---|
| Q2 — static options | ✅ `NodeOrValue<…>` per option (graceful degrade if primitive lacks support) |
| Q2 — no-Graph wart | ✅ `ResilientPipelineGraph<T>` subclass |
| Q2 — `breakerOnOpen + retry` subtle | ✅ JSDoc; tested |
| Q2 — aggregate-status collapses skip-vs-error | ✅ per-layer companions |
| Q3 — static-options gray-zone | ✅ resolved (with primitive-side dependency) |
| Q3 — no-Graph wart | ✅ resolved |
| Q3 — no `domainMeta` | ✅ tagged |
| Q4 — open items | ✅ closed in step 1; cross-pattern audits flagged in `optimizations.md` |
| Q5 — wrong-shaped bundle | ✅ Graph subclass with mounted intermediates |
| Q5 — observability gap | ✅ per-layer companions |
| Q6 — production debug ("where did data drop?") | ✅ per-layer status visible via describe + companions |
| Q6 — harness-tuned timeout / retry / budget | ✅ reactive options (gated on primitive support) |
| Q6 — cross-pattern unaudited | ⚠️ flagged for `extra/resilience.ts` + `patterns/reduction/` audits |
| Q6 — PY parity | ⚠️ deferred (create-from-scratch) |
| Q7 — describe()/explain() invisibility for intermediates | ✅ Graph subclass |

**Open questions for the user before locking:**

1. **Confirm H** (full reactive rebuild + reactive options + per-layer companions + Graph subclass + JSDoc + migration audit) vs. alternatives.
2. **Wrap as `ResilientPipelineGraph<T>` Graph subclass** with mounted intermediates?
3. **Reactive options** (`NodeOrValue<…>`) for tunable layers, with graceful degrade when underlying primitive lacks reactive support?
4. **Per-layer status companions** (`rateLimitState`, `budgetState`, `retryAttempts`, `lastTimeout`, etc.)?
5. **`domainMeta("resilient", kind)` tagging** on intermediates + companions?
6. **`breakerOnOpen + retry` JSDoc tightening** documenting the subtle interaction?
7. **`resilientFetch` migration audit** + drop the export if no callers depend on it?
8. **Cross-pattern audit prerequisites** filed in `docs/optimizations.md` (`extra/resilience.ts`, `patterns/reduction/budgetGate`)?
9. **Order rigidity** confirmed (no `layers: …` custom-order option)?
10. **PY parity:** defer to Python parity pass (create-from-scratch effort)?

### Decisions locked (2026-04-25)

1. **Recommendation H** — full reactive rebuild, single Wave-B pass.
2. **`ResilientPipelineGraph<T>` Graph subclass** with mounted intermediates (`rateLimited`, `budgetGated`, `breakerWrapped`, `timeoutWrapped`, `retryWrapped`, `fallbackWrapped`). Bundle properties become readonly graph properties.
3. **Reactive options** (`NodeOrValue<…>`) for `rateLimit`, `budget`, `breaker`, `timeoutMs`, `retry`, `fallback`. Static for `breakerOnOpen` and `initialStatus`. **Graceful degrade**: when underlying primitive lacks reactive support, factory reads `node.cache` once at construction; missing surface filed as a `resilience.ts`-audit follow-up.
4. **Per-layer status companions:** `rateLimitState`, `budgetState`, `breakerState` (already present), `retryAttempts`, `lastTimeout`. Each gated on underlying primitive support; missing surfaces filed.
5. **`domainMeta("resilient", kind)` tagging** on intermediates + companions.
6. **`breakerOnOpen + retry` JSDoc tightening** — explicit interaction documentation (retry budget burn against open breaker; recommended `shouldRetry` filter or longer backoff than reset window).
7. **`resilientFetch` migration audit** — grep call sites; if any exist, migrate to `resilientPipeline(fetchNode, {…})`; drop the export if no callers remain.
8. **Cross-pattern audit prerequisites filed in `docs/optimizations.md`:**
   - "`extra/resilience.ts` audit (Wave 2+ extras pass) — prerequisite for `resilientPipeline` correctness sign-off and reactive-option support."
   - "`patterns/reduction/budgetGate` audit (next round) — prerequisite for `resilientPipeline.budget` reactive support."
9. **Order rigidity confirmed** — no `layers: …` custom-order option. Canonical order locked.
10. **PY parity deferred** — create-from-scratch effort when the Python parity pass runs.

**Implementation scope when Wave B lands (Unit 7):**

A. **`src/patterns/resilient-pipeline/index.ts:1-176` rewrite:**
   - `resilientPipeline(...)` returns `ResilientPipelineGraph<T>` (Graph subclass) instead of bundle.
   - Mount intermediates with explicit names; `domainMeta("resilient", kind)` tags.
   - Each option accepted as `NodeOrValue<…>`; normalized to internal Node; passed through to underlying primitive (where supported) or read `.cache` once (graceful degrade).
   - Per-layer status companions mounted as readonly properties of the graph.
   - JSDoc cover: reactive options, per-layer companions, `breakerOnOpen + retry` interaction, `timeoutMs` upper bound, migration from `resilientFetch`, Graph-subclass shape.
   - `resilientFetch` migration audit + conditional drop.
B. **`src/__tests__/patterns/resilient-pipeline.test.ts` additions:** layer present/absent skip semantics; per-attempt timeout; `breakerOnOpen` modes interaction with retry; reactive options (gated on primitive support); per-layer companion emissions; `domainMeta` mermaid grouping; `resilientFetch` preset equivalence.
C. **`docs/optimizations.md`:**
   - File: `extra/resilience.ts` audit prerequisite.
   - File: `patterns/reduction/budgetGate` audit prerequisite.
   - File: PY `resilient_pipeline` create-from-scratch (Wave B follow-up parity pass).

---

## Unit 8 — `graphLens` / `LensGraph`

**File:** `src/patterns/lens/index.ts:1-477` (477 LOC; 1 graph class + 1 factory + 4 observability surfaces; cross-references to `patterns/audit/reactiveExplainPath` and `extra/reactive-map.ts`)

### Q1 — Semantics, purpose, implementation

```ts
export class LensGraph extends Graph
export function graphLens(target: Graph, opts?: GraphLensOptions): LensGraph
```

Reactive observability lens over a target Graph. Four surfaces:

- **`stats: Node<TopologyStats>`** (line 279) — `nodeCount, edgeCount, sources, sinks, depth, hasCycles, subgraphCount`. Recomputes on every structural change (transitive via `watchTopologyTree`). Named `stats` (not `topology`) to avoid collision with inherited `Graph.topology` event stream (Liskov).
- **`health: Node<HealthReport>`** (line 280) — `{ok, problems[]}` flipping `ok=false` when any node enters `"errored"` status. `upstreamCause` walks deps backward.
- **`flow: ReactiveMapBundle<string, FlowEntry>`** (line 293) — per-path DATA counter + `lastUpdate_ns`. O(1) `get/has/size` queries; `.entries` lazy snapshot.
- **`why(from, to, opts?): { node: Node<CausalChain>; dispose: () => void }`** (line 430) — live causal chain via `reactiveExplainPath`.

**Construction** (`lens/index.ts:296-414`):
- **Closure version counters** `statsVersion`, `healthVersion` — sanctioned §28 pattern; closure keeps the `stats_tick` / `health_tick` derived fns pure.
- **`stats_tick` and `health_tick` mounted state nodes** (lines 307-310). Bumping these triggers downstream re-derive.
- **`flow = reactiveMap<string, FlowEntry>(...)`** mounted at `flow` (line 318).
- **Single consolidated topology watcher** via `watchTopologyTree(target, ...)` (line 325). Bumps both ticks; flow cleanup for removed paths via prefix-qualified key matching.
- **Single consolidated `target.observe({timeline:true, structured:true})`** (line 358). On `error/complete/data/teardown`: bumps `healthTick`. On `data`: increments per-path `flow` counter (filtered by `pathFilter`).
- **`stats` derived** (line 386) reads `target.describe({detail:"minimal"})` per tick; `equals: topologyStatsEqual`; `meta: lensMeta("stats")`.
- **`health` derived** (line 402) reads `target.describe({detail:"standard"})` per tick; `equals: healthReportEqual`; `meta: lensMeta("health")`.
- **`keepalive(stats)` and `keepalive(health)`** at lines 397, 413 — uses the canonical helper (clean compared to Unit 3's pre-rebuild inline pattern).
- **All disposers tracked via `addDisposer`** — clean teardown.

**`why(from, to)` lifetime note** (lines 416–423 JSDoc):
> Every call to `why()` registers a lens-owned disposer that runs on `lens.destroy()`. The returned `dispose` releases the internal subscription but DOES NOT remove the lens-owned disposer — heavy calling (per render frame) accumulates no-op disposers until lens teardown. **Cache the returned handle for long-lived queries.**

**Cross-pattern dependencies (NOT YET AUDITED):**
- `patterns/audit/reactiveExplainPath` — the `why` engine.
- `extra/reactive-map.ts` (`reactiveMap`, `ReactiveMapBundle`) — flow backend.
- `graph/topology-tree.ts` (`watchTopologyTree`) — topology subscription helper.

**Cross-language:** PY does NOT have `graph_lens` — parity is create-from-scratch.

### Q2 — Semantically correct?

1. **`flow.get(path)` is an imperative read** on `ReactiveMapBundle<string, FlowEntry>`. Per the top-level no-imperative-reads policy, this should have a reactive sibling `flowEntryNode(pathNode)`. (`flow.entries` is reactive — that's the bundle's canonical reactive surface; `flow.get` is the bundle's imperative escape hatch.)
2. **`pathFilter` and `maxFlowPaths` are static** (closure-held / construction-time). Same harness-tunability gap as Unit 7. Reactive `NodeOrValue<…>` upgrade applies.
3. **`why(from, to)` allocates a fresh derived per call** — no caching. Documented per-render-frame footgun (line 416). Bounded internal LRU cache resolves it.
4. **`stats` derived calls `target.describe({detail:"minimal"})` per tick** (line 388). For 10k-node targets, every tick = 10k traversal. `equals` short-circuits emit but not compute. **Performance concern at scale**; mitigation is incremental stats updates (defer to perf pass).
5. **`health` derived calls `target.describe({detail:"standard"})` per tick** (line 404). Even more expensive; fires on every observe event (data/error/complete/teardown). For high-DATA-emit targets, this is hot. Same incremental-update mitigation.
6. **Tick-then-derive pattern is unusual.** Bump tick even when content didn't change → derive runs → equals suppresses emit. Wasted compute when topology didn't change but tick fired anyway (e.g. observe events that don't affect topology still bump healthTick).
7. **`reachable(described, path, "upstream", {})`** — explicit empty `{}` arg disambiguates the TS overload (per inline comment line 209). Smelly but documented.
8. **Health flags only `"errored"` status** (per JSDoc line 72). Future versions may add `"completed"` / `"disconnected"`. V1 scope.
9. **`upstreamCause` finds first errored ancestor**, not deepest root cause. Documented; semantic choice.
10. **`flow.set(path, …)` allocates a new `FlowEntry` per DATA emission** (line 375). For 10k DATA/sec targets, GC pressure noticeable.
11. **`flow` clears properly** on topology removed events (line 334–351). `deleteMany` collapses N deletions into one snapshot emit. Good.
12. **Lens is detached by default.** Caller mounts via `target.mount("lens", lens)` if desired. Reasonable; documented.
13. **`stats_tick` / `health_tick` mounted but no `domainMeta`** — inconsistent with `stats` / `health` (which use `lensMeta("stats")` / `lensMeta("health")`). Tick nodes appear ungrouped in mermaid output.
14. **Closure version counters** are §28 sanctioned — clean.
15. **`onMessage` is not customized** (lens uses standard Graph behavior). Correct.

### Q3 — Design-invariant violations?

- 🟢 No async / Promise / setTimeout / polling.
- 🟢 §28 closure version counters — sanctioned.
- 🟢 Central timer (`monotonicNs`) used appropriately (inside the observe callback, which is imperative event-driven, not a reactive `fn` body).
- 🟢 `keepalive` helper used (lines 397, 413) — uses the canonical helper.
- 🟢 All disposers tracked via `addDisposer` — clean teardown.
- 🟡 **`flow.get(path)` imperative read** — top-level no-imperative-reads policy violation; needs `flowEntryNode(pathNode)` reactive sibling.
- 🟡 **Static `pathFilter` / `maxFlowPaths`** — harness-tunability gap.
- 🟡 **`why(from, to)` per-call allocation** — documented footgun; LRU cache fix.
- 🟡 **Full `target.describe()` per tick** — perf at scale; defer to perf pass.
- 🟡 **`stats_tick` / `health_tick` no `domainMeta`** — inconsistent.
- 🟡 **Cross-pattern dep on `patterns/audit/reactiveExplainPath`** (NOT YET AUDITED) — same prerequisite as Unit 6.

Net: **🟢 cleanest unit so far** structurally (uses `keepalive` helper, `lensMeta` on stats/health, clean teardown, sanctioned §28 pattern). 🟡 dominated by surface-level policy gaps (imperative `flow.get`, static options) plus the `why` allocation footgun and cross-pattern audit prerequisite.

### Q4 — Open items

- **Reactive `flowEntryNode(pathNode)`** factory.
- **Reactive `pathFilter: NodeOrValue<…>` and `maxFlowPaths: NodeOrValue<number>`.**
- **`why` LRU cache** — keyed by `(from, to, opts)`.
- **Full-describe-per-tick perf** — incremental updates (defer to perf pass).
- **`domainMeta` on tick nodes** (`stats_tick`, `health_tick`).
- **Health expansion** (`"completed"` / `"disconnected"` flags) — V2.
- **Cross-pattern audit prerequisites:** `patterns/audit/reactiveExplainPath`, `extra/reactive-map.ts` (Wave 2+ extras pass).
- **PY parity** — create-from-scratch.
- **Test coverage.** `lens.test.ts` exists — need to inspect.
- **Aggregate metrics** (`totalDataCount`, `totalErrorCount`) — V2.

### Q5 — Right abstraction? More generic possible?

- **Four-surface design (stats, health, flow, why) is well-conceived.** Don't restructure.
- **`flow` as `ReactiveMapBundle`** is right (per-path lookups + reactive snapshot). Adding `flowEntryNode(pathNode)` is the minor reactivity upgrade.
- **`why` as method** is right (parameterized query); the allocation/disposer story needs a small cache.
- **Tick-then-derive** is a sanctioned pattern; the perf cliff is "full describe per tick" not "tick design itself."
- **Lens is a Graph subclass** — correct; `describe()` / `lens.flow` / `keepalive` all work natively.
- **`graphLens(target)` factory + `LensGraph` class** — naming consistent with `collection`/`vectorIndex`/`knowledgeGraph`/`guardedExecution`/`resilientPipeline`.
- **Could decompose** but no real benefit — the four surfaces share the underlying topology / observe subscriptions, splitting them would duplicate subscription overhead.

### Q6 — Right long-term solution? Caveats / maintenance burden?

**Maintenance burden:** ~480 LOC; complex (multiple closures, two subscriptions, four surfaces). The complexity is load-bearing — observability requires touching topology AND observe streams together. Lower-level refactor is risky; targeted hardening is appropriate.

**Caveats / footguns:**

1. **`flow.get(path)` imperative read** — per top-level policy. Add `flowEntryNode(pathNode): Node<FlowEntry | undefined>` factory. `flow.entries` (the canonical reactive read) and `flow` itself stay; only `flow.get` is the imperative escape now formally non-canonical.
2. **Static `pathFilter` / `maxFlowPaths`** — harness use cases (LLM "focus the lens") need reactive tunability. Mirrors Unit 7 reactive-options upgrade.
3. **`why` per-call allocation** — documented footgun; bounded LRU cache (e.g. last 16 queries by `(from, to, maxDepth, findCycle)`) prevents memory growth in render-loop callers. Cache eviction triggers actual disposal.
4. **Full `target.describe()` per tick** — concrete perf concern at scale. For a 10k-node target with 100 status changes/sec, that's 100 × 10k = 1M describe traversals/sec. Mitigations:
   - Incremental stats updates (track topology deltas; recompute only changed parts).
   - Throttle health-tick emissions to e.g. 10 Hz.
   - Cache `target.describe()` output and invalidate per topology event.
   - **None of these are simple**; defer to a perf-optimization pass with a "lens scaling" ticket.
5. **Tick-then-derive wastes compute** when nothing changed. The `equals` short-circuits emit but the derived fn runs. Fix is at the perf-pass level (incremental).
6. **Health limited to `"errored"`** — V1 scope; defer expansion to V2 with explicit ticket.
7. **Cross-pattern audit prerequisites:**
   - `patterns/audit/reactiveExplainPath` — the `why` engine. **Flag in `docs/optimizations.md`.**
   - `extra/reactive-map.ts` — flow backend. Wave 2+ extras pass prerequisite.
8. **`stats_tick` / `health_tick` no `domainMeta`** — inconsistent grouping in mermaid output.
9. **PY parity is create-from-scratch.**
10. **Vision-block alignment** — `graphLens` is the canonical observability lens. The hardening here keeps the public face consistent with Units 4–7.

**What hurts in 6 months:**
- A render-loop caller invokes `lens.why("a", "b")` per frame; lens-owned disposer list grows unbounded until destroy. LRU cache prevents this.
- A 50k-node target lens hits CPU ceilings due to full-describe-per-tick. Perf pass needed.
- A harness wanting to focus the lens on a subset of paths can't reconfigure mid-run. Reactive options resolve.
- PY users find `graph_lens` missing.

### Q7 — Simplify / reactive / composable + topology check + perf/memory

**Topology check:**

```ts
const g = new Graph("app");
g.add(state(0, { name: "counter" }));
const lens = graphLens(g);
lens.describe({ format: "ascii" });
// → app_lens
//     stats_tick (state)
//     health_tick (state)
//     flow (reactiveMap entries)
//     stats (derived [stats_tick], lens-tagged)
//     health (derived [health_tick], lens-tagged)
```

- ✅ Five mounted nodes, two clear edges (`stats_tick → stats`, `health_tick → health`). `flow` is a separate observability surface (the reactiveMap's entries node).
- ⚠️ `stats_tick` / `health_tick` ungrouped in mermaid (no `domainMeta`).
- ⚠️ The lens's relationship to the target is opaque in describe — there's no edge from target to lens (because lens watches via subscription, not dep). Cosmetic; documented.
- ✅ Each `why(from, to)` call adds an off-graph derived under lens disposer control.

**Composability:**
- **Lens consumers** subscribe to `lens.stats` / `lens.health` / `lens.flow.entries` reactively. Clean.
- **`why(from, to)`** returns `{node, dispose}` — the node plays into reactive composition.
- **Mounted as subgraph** of the target via `target.mount("lens", lens)` works cleanly.

**Perf:**
- `stats` derive: O(N) target nodes per tick (full minimal describe).
- `health` derive: O(N + E) per tick (full standard describe).
- `flow.set` per DATA emit: O(1) amortized via reactiveMap.
- `why` allocation per call: O(P) where P = explored path length.

**Memory:**
- `flow` capped by `maxFlowPaths` (LRU). Default unbounded — JSDoc warns.
- `stats` / `health` Nodes hold last cached value; `equals` deduplicates emits.
- `why` derived Nodes accumulate as lens-owned disposers until LRU cache lands.

### Q8 — Alternatives

**A. Keep as-is.** No code change. Cons: every Q6 caveat stays.

**B. Add reactive `flowEntryNode(pathNode): Node<FlowEntry | undefined>`** — closes the imperative `flow.get` gap per top-level policy.

**C. Reactive `pathFilter` / `maxFlowPaths`** via `NodeOrValue<…>`.

**D. `why` LRU cache** — bounded by query-key.

**E. Incremental stats / health updates** — defer to perf pass.

**F. Health expansion** (`"completed"`, `"disconnected"`) — defer to V2.

**G. `domainMeta` on tick nodes.**

**H. Cross-pattern audit prerequisites filed in `optimizations.md`.**

**I. Aggregate metrics** (`totalDataCount`, `totalErrorCount`) — defer to V2.

**J. Combine B + C + D + G + H — harden + reactify + cache, single Wave-B pass.** Defer E (perf), F (health expansion), I (aggregates) to follow-ups.

**K. Drop `flow.get` outright.** Make `flow.entries` and `flowEntryNode(pathNode)` the only reads. Most aggressive interpretation of the no-imperative-reads policy.

### Q9 — Recommendation

**Recommended call: J + K — harden + reactify + cache + drop `flow.get`, single Wave-B pass.**

Mirrors Units 4–7 "no defer" pattern adapted to a smaller, structurally-clean unit. Defer the heavy perf-pass work (E, F, I) explicitly.

**Step 1 (lands in Wave B implementation):**

1. **Add reactive `flowEntryNode(pathNode: NodeOrValue<string>): Node<FlowEntry | undefined>`** factory on `LensGraph`:
   - `derived([flow.entries, pathNode], (entries, path) => entries.get(path))`.
   - `equals` reference-eq (fine — `FlowEntry` mutates on each DATA).
   - Lazy.
2. **Drop imperative `flow.get(path)` from the lens-exposed surface.** The `flow: ReactiveMapBundle` still has `get` on the bundle (it's `reactiveMap`'s API), but the lens documentation directs callers to `flowEntryNode(pathNode)`. The `ReactiveMapBundle.get` stays accessible (we don't break reactiveMap's API) but is no longer documented as a lens entry point.
   - **Option: stricter** — wrap `flow` in a lens-specific projection that only exposes `entries` and a `flowEntryNode` factory, hiding `flow.get/has/size`. Tradeoff: callers wanting one-shot O(1) lookups via `flow.size` or `flow.has` lose access. **My call: don't wrap; document `flowEntryNode` as canonical and leave `flow` as the underlying primitive accessible.**
3. **Reactive `pathFilter: NodeOrValue<((path: string) => boolean) | undefined>` and `maxFlowPaths: NodeOrValue<number | undefined>`.** Internally: subscribe to the option nodes; re-apply filter/cap on change. Pre-1.0 breaking on the option type.
4. **`why` LRU cache:**
   - Internal `Map<string, {node, dispose, refCount}>` keyed by `(from, to, opts.maxDepth ?? null, opts.findCycle ?? false)`.
   - Cache size cap (e.g. 16 entries; configurable via `whyCacheSize?: number`, default 16).
   - On `why(...)` call: if cache hit, return cached `{node, dispose}` and increment refCount. If miss, compute via `reactiveExplainPath`; insert into cache; if cache over limit, evict LRU entry (call its actual `dispose`); return.
   - Returned `dispose` decrements refCount; when refCount hits 0 AND cache evicts the entry, call the underlying `reactiveExplainPath` dispose.
   - Lens-owned disposer chain remains (each cache entry's underlying dispose is collected via `lens.addDisposer`).
   - **JSDoc:** "Identical `why(from, to, opts)` calls return the same handle; the lens caches up to `whyCacheSize` queries (default 16) keyed by arguments."
5. **`domainMeta("lens", "tick")` on `stats_tick` and `health_tick`.** Closes the inconsistent-grouping gap.
6. **Cross-pattern audit prerequisites filed in `docs/optimizations.md`:**
   - "`patterns/audit/reactiveExplainPath` audit (next round) — prerequisite for `graphLens.why` correctness sign-off."
   - "`extra/reactive-map.ts` audit (Wave 2+ extras pass) — prerequisite for `graphLens.flow` correctness sign-off."
7. **JSDoc tightening:**
   - `flowEntryNode` reactive contract.
   - Reactive `pathFilter` / `maxFlowPaths`.
   - `why` LRU cache semantics + bound.
   - `flow.get` no longer canonical (use `flowEntryNode`).
   - Existing `why` "Cache the returned handle" warning becomes "Lens caches automatically up to `whyCacheSize`."
8. **Tests** (`src/__tests__/patterns/lens.test.ts`):
   - `flowEntryNode(state(path))`: emits `FlowEntry` for that path; updates on DATA emit; `undefined` for missing path.
   - Reactive `pathFilter`: change filter via `state(filterFn).emit(newFilterFn)` → flow stops/starts tracking matching paths.
   - Reactive `maxFlowPaths`: change cap → reactiveMap retention re-applies.
   - `why` cache: identical `why(from, to)` calls return same `node` reference; cache eviction at `whyCacheSize` threshold disposes underlying.
   - `domainMeta` mermaid grouping for tick nodes.
   - Existing tests for stats, health, flow continue to pass.

**Deferred (filed in `docs/optimizations.md` or a new follow-up doc):**
- **Option E — incremental stats / health updates.** Perf-pass ticket: "graphLens scaling to 50k-node targets — replace full-describe-per-tick with incremental delta updates."
- **Option F — health status expansion** (`"completed"`, `"disconnected"`). V2 ticket: "graphLens.health V2 — add `"completed"` and `"disconnected"` flag classes."
- **Option I — aggregate metrics.** V2 ticket: "graphLens aggregate observability — `totalDataCount`, `totalErrorCount`, per-status counters."
- **PY parity** — create-from-scratch.

**On Option K (drop `flow.get` outright via lens-side wrapping):** **Don't.** The `ReactiveMapBundle` is the underlying primitive; wrapping it loses access to `size`/`has` etc. Documenting `flowEntryNode` as canonical and leaving `flow` accessible is the right balance.

**Coverage table:**

| Concern | Step 1 (J — harden + reactify + cache) | Deferred (perf + V2 + parity) |
|---|---|---|
| Q2 — imperative `flow.get` (top-level policy) | ✅ `flowEntryNode(pathNode)` factory; documented as canonical | n/a |
| Q2 — static `pathFilter` / `maxFlowPaths` | ✅ `NodeOrValue<…>` reactive | n/a |
| Q2 — `why` per-call allocation | ✅ LRU cache, bounded, ref-counted | n/a |
| Q2 — full `target.describe()` per tick | ⚠️ unchanged | ✅ perf-pass ticket: incremental updates |
| Q2 — health limited to `"errored"` | ⚠️ unchanged (V1 scope) | ✅ V2 ticket: `"completed"` / `"disconnected"` |
| Q3 — closure §28 / `keepalive` / disposers | 🟢 already clean | (no regression) |
| Q3 — `flow.get` imperative-read gray-zone | ✅ resolved at lens documentation level | n/a |
| Q3 — static-options gray-zone | ✅ resolved | n/a |
| Q3 — `domainMeta` on ticks | ✅ tagged | n/a |
| Q3 — cross-pattern audit prereq | ✅ filed | (prerequisite audits run in next round) |
| Q4 — open items | ✅ all closed in step 1; perf / V2 / parity deferred via filed tickets | (ticketed) |
| Q5 — right abstraction | 🟢 confirmed; no restructure | n/a |
| Q6 — `why` per-render-frame footgun | ✅ LRU cache | n/a |
| Q6 — production debug ergonomics | ✅ reactive `flowEntryNode` + reactive options | n/a |
| Q6 — perf cliff at 50k+ nodes | ⚠️ unchanged | ✅ perf-pass ticket |
| Q6 — PY parity | ⚠️ deferred | ✅ create-from-scratch ticket |
| Q7 — copy-on-write GC churn | 🟢 already mitigated via `reactiveMap` flow backend | n/a |

**Open questions for the user before locking:**

1. **Confirm J + K** (harden + reactify + cache + drop `flow.get` from canonical surface) vs. alternatives.
2. **Reactive `flowEntryNode(pathNode)`** factory + document `flow.get` as non-canonical?
3. **Reactive `pathFilter: NodeOrValue<…>` and `maxFlowPaths: NodeOrValue<…>`** (pre-1.0 breaking)?
4. **`why` LRU cache** with `whyCacheSize` option (default 16)?
5. **`domainMeta("lens", "tick")` on `stats_tick` / `health_tick`?**
6. **File `patterns/audit/reactiveExplainPath` audit prerequisite** in `docs/optimizations.md`?
7. **File `extra/reactive-map.ts` audit prerequisite** in `docs/optimizations.md`?
8. **Defer perf-pass work** (incremental stats/health updates, full-describe-per-tick) via filed ticket?
9. **Defer health V2 expansion** (`"completed"` / `"disconnected"`) via filed ticket?
10. **PY parity:** defer to Python parity pass (create-from-scratch)?

### Decisions locked (2026-04-25)

1. **Recommendation J + K** — harden + reactify + cache, single Wave-B pass; `flow.get` documented as non-canonical (no wrapping; underlying `ReactiveMapBundle` remains accessible).
2. **`flowEntryNode(pathNode: NodeOrValue<string>): Node<FlowEntry | undefined>`** factory; lazy; `equals` reference-eq.
3. **Reactive `pathFilter: NodeOrValue<((path: string) => boolean) | undefined>` and `maxFlowPaths: NodeOrValue<number | undefined>`** — pre-1.0 breaking on option types.
4. **`why` LRU cache** keyed by `(from, to, opts.maxDepth, opts.findCycle)`; `whyCacheSize?: number` default 16; ref-counted disposal; cache eviction triggers underlying `reactiveExplainPath` dispose.
5. **`domainMeta("lens", "tick")`** on `stats_tick` and `health_tick`.
6. **File in `docs/optimizations.md`:** "`patterns/audit/reactiveExplainPath` audit (next round) — prerequisite for `graphLens.why` correctness sign-off."
7. **File in `docs/optimizations.md`:** "`extra/reactive-map.ts` audit (Wave 2+ extras pass) — prerequisite for `graphLens.flow` correctness sign-off."
8. **Perf-pass deferred** — file: "`graphLens` scaling to 50k-node targets — replace full-describe-per-tick with incremental delta updates."
9. **Health V2 deferred** — file: "`graphLens.health` V2 — add `\"completed\"` and `\"disconnected\"` flag classes; aggregate metrics (`totalDataCount`, `totalErrorCount`)."
10. **PY parity deferred** — create-from-scratch effort when the Python parity pass runs.

**Implementation scope when Wave B lands (Unit 8):**

A. **`src/patterns/lens/index.ts:1-477` rewrite:**
   - Add `flowEntryNode(pathNode: NodeOrValue<string>): Node<FlowEntry | undefined>` method on `LensGraph`.
   - Convert `pathFilter` and `maxFlowPaths` options to `NodeOrValue<…>`; subscribe internally; re-apply on change (filter via observe-callback gate; cap via `reactiveMap` retention update).
   - Internal `whyCache: Map<string, {node, dispose, refCount}>` keyed by query args; cache size cap from `opts.whyCacheSize ?? 16`; evict-LRU-on-overflow with underlying disposal.
   - `domainMeta("lens", "tick")` on `stats_tick` / `health_tick`.
   - JSDoc: `flowEntryNode` reactive contract; reactive options; `why` cache semantics + `whyCacheSize`; `flow.get` documented as non-canonical (use `flowEntryNode`).
B. **`src/__tests__/patterns/lens.test.ts` additions:** `flowEntryNode` reactive on DATA emit; reactive `pathFilter` mid-run change; reactive `maxFlowPaths` mid-run change; `why` cache (identical args → same Node); cache eviction at `whyCacheSize` triggers underlying dispose; `domainMeta` mermaid grouping for ticks.
C. **`docs/optimizations.md`:** five filed entries (two cross-pattern prereqs, perf-pass ticket, health V2 ticket, PY parity ticket).

---

## Wave A + Wave B — Final summary (locked 2026-04-25)

All 8 units audited and locked. Eight Wave-A/B implementation passes ready to land.

### Cross-cutting decisions (locked top-level)

- **API-style policy: no imperative reads** in public-face Phase-4 primitives. One-shot snapshots use `node.cache` or `firstValueFrom(node)`. Dropped: `get / has / peek / getItem / peekItem / search / related / scopedDescribe`. Kept: command-side writes (`upsert / remove / clear / link / unlink / rescore / reindex`).
- **`reactiveMap` migration** — Units 2, 3, 4, 5 all migrate storage to `reactiveMap` for unified LRU/eviction semantics, F4 touch-without-emit, and elimination of copy-on-write GC churn.
- **`Graph` subclass migration** — Units 4, 7 (and Unit 5 rename) migrate from bundle return to `Graph` subclass. Closes the no-Graph wart: `describe()` / `lens.flow` / `addDisposer` work natively.
- **Reactive options** — Units 6, 7, 8 accept `NodeOrValue<…>` for previously-static options where the underlying primitive supports reactive config. Graceful degrade where it doesn't.
- **Reactive deriveds replace imperative reads** — `itemNode`, `hasNode`, `searchNode`, `relatedNode`, `scopedDescribeNode`, `flowEntryNode` ship as the canonical reactive read APIs.
- **`domainMeta(domain, kind)` tagging** on all internal nodes for mermaid grouping. Domains: `"memory"`, `"guarded"`, `"resilient"`, `"lens"`.
- **`keepalive` helper** (from `extra/sources.ts`) replaces inline `void node.subscribe(() => undefined)` patterns. Disposers collected via `addDisposer`.
- **`decayRate` parameter** (Unit 1 lock) kept; half-life conversion documented as JSDoc note (`λ = ln 2 / halfLifeSeconds`). No `halfLifeSeconds` option.
- **PY parity deferred** for all units. Three units have NO existing PY counterpart (`guarded_execution`, `resilient_pipeline`, `graph_lens`) — those are create-from-scratch when the parity pass runs.

### Per-unit recommendations (locked)

| Unit | File | Decision | Scope |
|---|---|---|---|
| **1 — `decay`** | `memory/index.ts:123` | **C** — keep behavior; add JSDoc (formula, fallbacks, underflow) | TS-only; PY sibling deferred until 2nd caller |
| **2 — `lightCollection`** | `memory/index.ts:170` | **E** — D (harden) + B (rebuild on `reactiveMap`); revised to drop imperative reads (`get` / `has` / `peek`); add `itemNode` / `hasNode` reactive | One-pass TS; PY mirror deferred |
| **3 — `collection`** | `memory/index.ts:245` | **H′** — fully reactive timer dep + `reactiveMap` rebuild + reactive `scoreNode` + `rescore()`; revised to drop imperative reads (`getItem` / `peekItem`); add `itemNode` reactive | One-pass TS; PY mirror deferred |
| **4 — `vectorIndex`** | `memory/index.ts:365` | **H** — full reactive rebuild as `VectorIndexGraph<TMeta>`; revised to drop imperative `search`; `searchNode` only | One-pass TS; PY mirror deferred |
| **5 — `knowledgeGraph`** | `memory/index.ts:433` | **J + K + M** — full rebuild + observability deriveds + orphan-GC option + rename `KnowledgeGraphGraph` → `KnowledgeGraph`; revised to drop imperative `related`; `relatedNode` only | One-pass TS; PY mirror deferred |
| **6 — `guardedExecution`** | `guarded-execution/index.ts:1` | **I + L** — harden + reactify + no-actor warning; imperative `scopedDescribe` dropped; `scopedDescribeNode` only; reactive `actor: NodeOrValue<Actor>` | One-pass TS; PY create-from-scratch deferred |
| **7 — `resilientPipeline`** | `resilient-pipeline/index.ts:1` | **H** — full reactive rebuild as `ResilientPipelineGraph<T>`; reactive options with graceful degrade; per-layer status companions; `resilientFetch` migration audit | One-pass TS; PY create-from-scratch deferred |
| **8 — `graphLens`** | `lens/index.ts:1` | **J + K** — harden + reactify + cache + document `flow.get` non-canonical; reactive `flowEntryNode` / `pathFilter` / `maxFlowPaths`; `why` LRU cache; perf + health-V2 + PY parity deferred via filed tickets | One-pass TS; PY create-from-scratch + perf pass + V2 deferred |

### Filed tickets in `docs/optimizations.md` (cross-pattern audit prerequisites + deferrals)

**Cross-pattern audit prerequisites** (must run before sign-off on dependent units):
1. `patterns/audit/policyEnforcer` audit — prerequisite for Unit 6 (`guardedExecution`).
2. `patterns/audit/reactiveExplainPath` audit — prerequisite for Unit 8 (`graphLens.why`).
3. `extra/resilience.ts` audit (Wave 2+ extras pass) — prerequisite for Unit 7 (`resilientPipeline`) reactive-option support.
4. `patterns/reduction/budgetGate` audit — prerequisite for Unit 7 (`resilientPipeline.budget`).
5. `extra/reactive-map.ts` audit (Wave 2+ extras pass) — prerequisite for Units 2, 3, 4, 5, 8 (rebuilt storage / flow backend).

**Deferred follow-ups** (file-and-track):
1. `graphLens` scaling to 50k-node targets — incremental delta stats/health updates (perf pass).
2. `graphLens.health` V2 — `"completed"` / `"disconnected"` flag classes; aggregate metrics.
3. `decay` PY sibling — port when 2nd caller emerges.
4. PY parity for all 8 units — Wave A/B mirror + create-from-scratch for Units 6/7/8.
5. `lightCollection` rebuild on `reactiveMap` — already locked into Unit 2 step 2; mirrored in PY when parity pass runs.

### Next steps (proposed)

The audit phase is complete. Proposed sequencing for implementation:

1. **Wave A landing** — Units 1–5 (memory primitives) in TS. Single coherent change touching `src/patterns/memory/index.ts`. Tests, JSDoc, build/lint.
2. **Wave B landing** — Units 6–8 (resilience blocks) in TS. Three smaller changes (`guarded-execution/`, `resilient-pipeline/`, `lens/`).
3. **Cross-pattern audit follow-ups** — the five prerequisite audits filed above. Each unblocks final sign-off on its dependent unit(s).
4. **Python parity pass** — mirror Wave A + create-from-scratch Units 6/7/8 in `graphrefly-py`.
5. **Perf pass** — `graphLens` incremental updates ticket.
6. **V2 expansions** — `graphLens.health` / aggregate metrics ticket.

User to dispatch the actual implementation work via `/dev-dispatch` per Wave (suggested) or by individual unit.

---

---

# Post-sync revisions (2026-04-25, after `git pull --ff-only origin main` to v0.36.0)

After all 8 units locked, the worktree was synced with main (5 commits, 80 files). Re-reading [docs/optimizations.md](../docs/optimizations.md) (885 lines) surfaced direction-confirming items, new cross-cutting infrastructure shipped while this audit ran, and a small hygiene violation worth riding along. This appendix consolidates every revision to the locked decisions; per-unit "Decisions locked (2026-04-25)" blocks above remain as the canonical record, with revisions cross-referenced here.

---

## A. Cross-references to optimizations.md

### A.1 — Direction-confirming items (already shipped, support the audit)

| Item | Date | Source | Relevance |
|---|---|---|---|
| `ToolRegistryGraph.execute` removed entirely; `executeReactive` is sole path | 2026-04-24 | [optimizations.md:25](../docs/optimizations.md) | Lockstep with our no-imperative-reads policy; project direction matches Units 2–6 revisions. |
| `agentMemory.retrieveReactive` shipped (factor core pipeline + reactive sibling) | 2026-04-22 | [optimizations.md:643](../docs/optimizations.md) | Validates Unit 4–5 reactive-read direction. **Note:** lives in `patterns/ai/memory/`, NOT `patterns/memory/` (see clarification below). |
| `graph.describe({ reactive: true })` shipped — `ReactiveDescribeHandle<…>` | 2026-04-22 | [optimizations.md:530](../docs/optimizations.md) / [graph.ts:2194](../src/graph/graph.ts) | **Unit 6 must leverage this primitive** rather than re-implementing topology subscription. See revision § B.1 below. |
| Wave 4 `reactiveMap` refactor (MapBackend, setMany/deleteMany, F4 LRU touch fix) | 2026-04-15 | [optimizations.md:856](../docs/optimizations.md) | Units 2–5 storage rebuilds plug straight in. |
| Folder-shaped `patterns/*` packages + per-domain subpath exports | 2026-04-23 | [optimizations.md:452](../docs/optimizations.md) | All audit file paths verified correct after sync. |
| `graph.add(node, { name })` signature flip | 2026-04-22 | [optimizations.md:526](../docs/optimizations.md) | Implementation must use new signature; 608 sites already migrated tree-wide. |

### A.2 — New cross-cutting infrastructure shipped during audit

| Component | Status | File | Relevance to Wave A/B |
|---|---|---|---|
| **Audit 2 framework: `_internal/imperative-audit.ts`** — `createAuditLog`, `wrapMutation`, `registerCursor`, `registerCursorMap`. Locked 2026-04-24. | Shipped | [src/patterns/_internal/imperative-audit.ts](../src/patterns/_internal/imperative-audit.ts) | **Adoption integrated into Wave A.** See § B.2 below. |
| **`patterns/process/` (Audit 3 / Phase 7)** — `processManager`, 819 LOC. Locked 2026-04-24. | Shipped | [src/patterns/process/index.ts](../src/patterns/process/index.ts) | Out of Wave A/B scope. Has a §5.10 hygiene violation we ride along on (see § B.4). |

### A.3 — Related open items cross-linked into our tickets

| Item | Source | Cross-link |
|---|---|---|
| **Path X — per-attempt Node-returning mutations** (deferred 2026-04-25). `cqrs.dispatch / gate.approve / coll.upsert` etc. returning `Node<TResult>` per call. Currently blocked on `defaultOnSubscribe` design. | [optimizations.md:796](../docs/optimizations.md) | Our void-returning `upsert/remove/clear` is **forward-compatible**: `wrapMutation` and `lightMutation` accept any return type. When Path X lands, mutations can evolve without re-architecting the audit framework. |
| **`lens.flow` delta companion** (post-1.0). `flow.mutations: Node<FlowDelta>` O(1) per event. | [optimizations.md:689](../docs/optimizations.md) | Cross-link from our Unit 8 perf-pass deferral ticket. Same "snapshot delivery" theme; land together post-1.0. |
| **`agentMemory` tier closure-state promotion** (open) | [optimizations.md:873](../docs/optimizations.md) | Belongs to the `patterns/ai/memory/` follow-up audit (see § C). |
| **`agentMemory.tierClassifier` feedback cycle** (open) | [optimizations.md:874](../docs/optimizations.md) | Same — `patterns/ai/memory/` follow-up. |
| **`processManager` state-snapshot persistence** (deferred 2026-04-25) | [optimizations.md:810](../docs/optimizations.md) | Future Wave 7 `patterns/process/` audit (out of our scope). |
| **`appendLogStorage.loadEntries` pagination cursor** (deferred 2026-04-25) | [optimizations.md:804](../docs/optimizations.md) | Reference only; relevant if our `reactiveMap` rebuild hits append-log persistence. |

---

## B. Locked-decision revisions (2026-04-25, post-sync)

### B.1 — Unit 6 refinement: minimal core upgrade (Option B)

**Discovered:** the shipped `graph.describe({ reactive: true })` primitive at [graph.ts:2194](../src/graph/graph.ts) already does topology-tree subscribe + recompute on every settle. Our locked Unit 6 spec re-implemented this from scratch in `scopedDescribeNode`. Audit-2 grep also confirmed `NodeOrValue<…>` is **not** an established pattern in the codebase — the precedent is **typed union per field** (`T | Node<T> | …`), exemplified by `FallbackInput<T>` at [resilience.ts:908](../src/extra/resilience.ts).

**Revised approach:** minimally upgrade `GraphDescribeOptions.actor` to `Actor | Node<Actor>` (precedent-aligned; ~3 LOC change to core describe). Other opts (filter / format / detail) stay static until a real use case surfaces. `_describeReactive` subscribes to the actor node when present and bumps the same version-counter as topology/observe events; describe fn reads `actor.cache ?? defaultActor` at recompute.

**Unit 6 `scopedDescribeNode` becomes a 3-line delegation:**
```ts
scopedDescribeNode(actorNode = this._actorNode, opts?) {
  const handle = target.describe({ reactive: true, actor: actorNode, ...opts });
  this.addDisposer(handle.dispose);
  return handle.node;
}
```

**Why Option B over the alternatives:**
- A (consumer-side `switchMap` over reactive-describe handles): awkward `handle.dispose` lifecycle inside `switchMap`; each consumer reimplements.
- C (full sweep — every opt becomes `T | Node<T>`): no precedent for full sweep; speculative.
- B: precedent-aligned (`FallbackInput<T>` shape), tiny surface change, solves the harness use case, defers other reactive-opt upgrades until needed.

**Implementation scope addition (to Unit 6 + core `src/graph/graph.ts`):**
- Widen `GraphDescribeOptions.actor` to `Actor | Node<Actor>`.
- `_describeReactive` subscribes to actor-when-Node; bumps version on emit; `describe()` recompute reads current cache.
- Static-actor path unchanged (back-compat preserved by union widening, not breaking).
- Test additions: actor-Node emission triggers describe re-derive; mixed actor with topology change coalesces correctly.

### B.2 — Mutation-framework factoring + memory-primitive adoption (Units 2–5)

**Two-tier framework added to [`_internal/imperative-audit.ts`](../src/patterns/_internal/imperative-audit.ts):**

| Tier | Use | Examples |
|---|---|---|
| **`lightMutation` — substrate-tier atomic mutations** | One substrate-level write per call (single emit, single `Map.set`, single counter bump). Hot-path-friendly: no batch frame, no deep-freeze. | `TopicGraph.publish`, `JobQueueGraph.enqueue/ack/nack`, memory primitive writes (`upsert/remove/clear/link/unlink/rescore/reindex`). |
| **`wrapMutation` — orchestration-tier multi-step mutations** | Multi-step handler runs (handler + event store + state update); can throw mid-step; need rollback-on-throw + freeze-at-entry. | `gate.approve/reject/modify/open/close`, `CqrsGraph.dispatch`, `CqrsGraph.saga`, `processManager.start/cancel`. |

**Heuristic for developers:** if your imperative method's body is **one or two lines** (mutate state, emit), use `lightMutation`. If it **runs a user-supplied handler** or has **multiple steps that could leave inconsistent state mid-throw**, use `wrapMutation`. Audit log shape is identical; only orchestration overhead differs.

**Factoring (Option A — shared low-level helpers, separate top-level wrappers):**
```ts
// Shared low-level helpers (both wrappers use these)
function appendAudit<R, TArgs>(audit, builder, args, result, meta, handlerVersion): void
function bumpCursor(seq: Node<number>): number

// Substrate-tier — atomic, hot-path-friendly
function lightMutation(action, opts) {
  return function wrapped(...args) {
    const t_ns = wallClockNs();
    const seq = opts.seq ? bumpCursor(opts.seq) : undefined;
    try {
      const result = action(...args);
      appendAudit(opts.audit, opts.onSuccess, args, result, {t_ns, seq}, opts.handlerVersion);
      return result;
    } catch (err) {
      const errorType = err instanceof Error ? err.name : typeof err;
      appendAudit(opts.audit, opts.onFailure, args, err, {t_ns, seq, errorType}, opts.handlerVersion);
      throw err;
    }
  };
}

// Orchestration-tier — batch frame + freeze + failure-audit-outside-batch
function wrapMutation(action, opts) {
  // Refactored to use appendAudit + bumpCursor; behavior unchanged.
  // Failure audit appends OUTSIDE the batch frame so rollback doesn't undo the failure record.
}
```

**Why Option A** (shared helpers, separate wrappers) over alternatives:
- B (`wrapMutation` calls `lightMutation` with skip-failure-audit flag): couples `lightMutation` to `wrapMutation`'s needs.
- C (`lightMutation` is `wrapMutation` with skip-batch flag): inverts the dependency hierarchy.
- A: divergence-risk surface (audit-record stamping) IS shared via `appendAudit` + `bumpCursor`. Top-level structure differences (batch + freeze vs. plain) are deliberate and shouldn't share code.

**Naming-collision JSDoc note:** `src/extra/reactive-map.ts:540` has its own private `wrapMutation` for transactional mutation tracking on the reactiveMap version counter. Different concern, file-private. Add a one-line JSDoc note in both places differentiating; rename if real confusion surfaces.

**Per-unit adoption (Units 2–5):**

| Unit | Methods to wrap | Wrapper | Freeze? |
|---|---|---|---|
| 2 — `lightCollection` | `upsert / remove / clear` | `lightMutation` | yes |
| 3 — `collection` | `upsert / remove / clear / rescore` | `lightMutation` | yes (small inputs) |
| 4 — `vectorIndex` | `remove / clear / reindex` | `lightMutation` | yes |
| 4 — `vectorIndex.upsert` only | `upsert(id, vector[768], meta)` | `lightMutation` with **`freeze: false`** | no (deep-freeze of 768-dim vector is a hot-path tax) |
| 5 — `knowledgeGraph` | `upsertEntity / removeEntity / link / unlink` | `lightMutation` | yes |
| 6 — `guardedExecution` | (none — pure delegator over enforcer) | n/a | n/a |
| 7 — `resilientPipeline` | (none — pure compositor) | n/a | n/a |
| 8 — `graphLens.flow.set` | (internal observe-callback, not a public mutator) | **NOT WRAPPED** — would add per-DATA frame for high-traffic targets | n/a |

**Each wrapping primitive ships a public audit log:**
- `lightCollection.events: ReactiveLogBundle<LightCollectionAuditRecord>`
- `collection.events: ReactiveLogBundle<CollectionAuditRecord>`
- `vectorIndex.events: ReactiveLogBundle<VectorIndexAuditRecord>`
- `knowledgeGraph.events: ReactiveLogBundle<KnowledgeGraphAuditRecord>`

Bounded retention default 1024 (per `createAuditLog` default); deny-write guard; visible in `describe()`. Each `<MemoryAuditRecord>` shape: `{ t_ns, seq, type: "upsert" | "remove" | …, key?, valueShape? }` — minimal record (no full value capture; users wanting payload visibility wire their own derived).

### B.3 — Phase 0: Framework refactor (lands BEFORE Wave A)

**Sequencing:** the framework refactor lands first as a focused ~1-day pass. Wave A's memory-primitive adoption depends on `lightMutation` being available.

**Phase 0 scope:**
1. Extract `appendAudit<R, TArgs>(audit, builder, args, result, meta, handlerVersion)` and `bumpCursor(seq)` as exported low-level helpers in `_internal/imperative-audit.ts`.
2. Add `lightMutation(action, opts)` using shared helpers — ~30 LOC.
3. Refactor existing `wrapMutation` to use `appendAudit` + `bumpCursor` — no behavior change.
4. Add JSDoc differentiating the public `wrapMutation` from `reactive-map.ts:540`'s file-private same-named helper.
5. Tests: `lightMutation` happy path + throw path + `freeze: false` opt-out + `seq` cursor; `wrapMutation` regression tests stay green (no behavior change).

**Phase 0 exit criteria:** existing `orchestration/pipeline-graph.ts` `wrapMutation` consumers behave identically; new `lightMutation` covered by unit tests; lint + typecheck + build pass.

### B.4 — Hygiene fixes (rides along with Wave B)

**`processManager queueMicrotask` dead branch ([process/index.ts:563](../src/patterns/process/index.ts#L563)):**

```ts
const timerCb = (msgs) => {
  for (const m of msgs) {
    if (m[0] === DATA) {
      if (timerUnsub) {
        timerUnsub();
      } else {
        // unreachable — fromTimer is async-by-contract (setTimeout-backed per spec §5.8)
        queueMicrotask(() => timerUnsub?.());
      }
      ...
```

**Why the dead branch existed:** defensive coding for a hypothetical synchronous fire of `subscribe()`'s callback before `subscribe()` returns the unsubscribe handle (TDZ). `fromTimer(afterMs)` uses `setTimeout` internally; `setTimeout` callbacks are async-by-spec. The defensive guard is **unreachable**; documented as such in the inline comment.

**Fix:** delete the `else` branch; replace with inline JSDoc note that `fromTimer` is async-by-contract per spec §5.8. ~3-LOC delete + 2-LOC comment. Rides along with Wave B implementation.

**Test:** existing process-manager tests cover the timer cleanup path; verify no regression.

### B.5 — Unit-revision summary table

| Unit | Original lock | Post-sync revision | Source |
|---|---|---|---|
| 1 — `decay` | C: keep + JSDoc | (no change) | — |
| 2 — `lightCollection` | E: harden + reactiveMap rebuild + reactive `itemNode` / `hasNode` | **+ `lightMutation` adoption + `events` audit log** | § B.2 |
| 3 — `collection` | H′: fully reactive timer dep + reactiveMap + reactive `scoreNode` + `rescore()` + reactive `itemNode` | **+ `lightMutation` adoption + `events` audit log** | § B.2 |
| 4 — `vectorIndex` | H: full reactive rebuild + reactive `searchNode` | **+ `lightMutation` adoption (+ `freeze: false` for `upsert`) + `events` audit log** | § B.2 |
| 5 — `knowledgeGraph` | J+K+M: full rebuild + reactive `relatedNode` | **+ `lightMutation` adoption + `events` audit log** | § B.2 |
| 6 — `guardedExecution` | I+L: harden + reactify + `scopedDescribeNode` only | **+ leverage `graph.describe({ reactive: true })` via `actor: Actor \| Node<Actor>` core widening (Option B); `scopedDescribeNode` becomes 3-line delegation** | § B.1 |
| 7 — `resilientPipeline` | H: full reactive rebuild + reactive options + per-layer companions | (no change) | — |
| 8 — `graphLens` | J+K: harden + reactify + `why` LRU cache | **+ explicit note: `flow.set` from observe-callback stays unwrapped (would add per-DATA frame)** | § B.2 |

---

## C. Cross-pattern migration opportunities (Wave C — separate session)

The Audit 2 framework shipped while our audit ran. Eight existing imperative-mutation sites today inline their audit logic with hand-rolled `events.append({...})` calls instead of using a wrapper. Migrating them to the new two-tier framework gives uniform audit observability and removes drift surface.

**This is NOT in Wave A/B scope** — Wave C is a separate session, sequenced after Wave A/B's framework adoption proves out. Bundling into Wave A/B would balloon scope across 7+ pattern domains.

| Site | Current | Migrate to | Rationale |
|---|---|---|---|
| [`messaging/index.ts:116 publish(value)`](../src/patterns/messaging/index.ts#L116) | direct emit, no audit | `lightMutation` | Atomic emit; spec §5.12 SENTINEL guard already throws |
| [`messaging/index.ts:264 ack(count?)`](../src/patterns/messaging/index.ts#L264) | direct emit, no audit | `lightMutation` | Atomic state update |
| [`messaging/index.ts:308 take(...)`](../src/patterns/messaging/index.ts#L308) | direct emit, no audit | `lightMutation` | Atomic |
| [`messaging/index.ts:499 delete(name)`](../src/patterns/messaging/index.ts#L499) (hub registry) | direct, no audit | `lightMutation` | Atomic |
| [`job-queue/index.ts:122 enqueue`](../src/patterns/job-queue/index.ts#L122) | hand-rolled `events.append` | `lightMutation` | Atomic queue mutation |
| [`job-queue/index.ts:169 ack`](../src/patterns/job-queue/index.ts#L169) | hand-rolled `events.append` | `lightMutation` | Atomic state update |
| [`job-queue/index.ts:183 nack`](../src/patterns/job-queue/index.ts#L183) | hand-rolled `events.append` | `lightMutation` | Atomic state update |
| `cqrs/index.ts` `dispatch` (handler + event store append + state update) | hand-rolled audit code | `wrapMutation` | Multi-step + rollback-on-throw matters; **currently misses rollback safety** |
| `cqrs/index.ts` `saga` (per-event business handler) | hand-rolled audit code | `wrapMutation` | Multi-step per-event handler |
| `process/index.ts` `start / cancel` | hand-rolled audit code | `wrapMutation` | Stateful workflow lifecycle |

**Wave C exit criteria:** all 10 sites migrated; tests updated; existing audit-log subscribers unaffected (record shape compatibility maintained); lint + typecheck + build pass.

---

## D. Follow-up audits

### D.1 — `patterns/ai/memory/` audit (natural Wave A follow-up)

**Clarification:** the audit covered `src/patterns/memory/` (low-level primitives — `decay`, `lightCollection`, `collection`, `vectorIndex`, `knowledgeGraph`). A **separate** directory `src/patterns/ai/memory/` (`agent-memory.ts`, `llm-memory.ts`, `memory-composers.ts`, `retrieval.ts`, `tiers.ts`) holds higher-level compositions (`agentMemory`, `memoryWithTiers`, retrieval pipeline, tier classifier) — built **on top of** the primitives we audited. **NOT in this audit's scope.**

**Wave A follow-up scope** (separate session): audit `patterns/ai/memory/` against the same 9-question format and the same no-imperative-reads policy. Cross-pattern open items from optimizations.md attach to this follow-up:
- `agentMemory.retrieveReactive` hybrid (line 643) — under no-imperative-reads policy, drop imperative `retrieve`; reactive `retrieveReactive` becomes the only read.
- `agentMemory tier closure-state promotion` (line 873) — promote `permanentKeys: Set<string>` and `entryCreatedAtNs: Map<string, number>` to reactive nodes.
- `agentMemory.tierClassifier` feedback cycle (line 874) — wire archival through `retention.onArchive` instead of effect-based classifier.

### D.2 — Cross-pattern audit prerequisites (filed in `docs/optimizations.md`)

These five audit prerequisites must run before final sign-off on dependent units:
1. `patterns/audit/policyEnforcer` — prerequisite for Unit 6.
2. `patterns/audit/reactiveExplainPath` — prerequisite for Unit 8 (`why`).
3. `extra/resilience.ts` (Wave 2+ extras pass) — prerequisite for Unit 7 reactive-option support.
4. `patterns/reduction/budgetGate` — prerequisite for Unit 7 `budget` reactive support.
5. `extra/reactive-map.ts` (Wave 2+ extras pass) — prerequisite for Units 2, 3, 4, 5, 8 (rebuilt storage / flow backend).

### D.3 — Deferred follow-up tickets

- `graphLens` scaling to 50k-node targets — incremental delta stats/health updates (perf pass).
- `graphLens.health` V2 — `"completed"` / `"disconnected"` flag classes; aggregate metrics.
- `lens.flow` delta companion (cross-link to optimizations.md:689; same "snapshot delivery" theme).
- `decay` PY sibling — port when 2nd caller emerges.
- PY parity for all 8 units — Wave A/B mirror + create-from-scratch for Units 6/7/8.
- `patterns/process/` audit (Wave 7) — out of scope; future round.

---

## E. Updated implementation sequencing

The audit phase is complete. Implementation sequencing (revised after post-sync findings):

| Phase | Scope | Source |
|---|---|---|
| **Phase 0** — Framework refactor | Add `lightMutation`; extract shared helpers; refactor `wrapMutation` to use them; naming-collision JSDoc; tests. | § B.3 |
| **Wave A** — Memory primitives (Units 1–5) | All locked decisions + `lightMutation` adoption + `<primitive>.events` audit logs (per § B.2). | All Unit 1–5 lock blocks + § B.2 |
| **Wave B** — Resilience blocks (Units 6–8) | All locked decisions + Unit 6 `actor` core widening (per § B.1) + `processManager queueMicrotask` hygiene fix (per § B.4). | All Unit 6–8 lock blocks + § B.1 + § B.4 |
| **Cross-pattern audit prerequisites** | Five filed audits (per § D.2). Each unblocks final sign-off on its dependent unit(s). | § D.2 |
| **Wave C** — Mutation-framework migration | 10 cross-pattern sites migrate to `lightMutation` / `wrapMutation` (per § C). | § C |
| **`patterns/ai/memory/` audit** | Higher-level memory compositions; same 9-question format. | § D.1 |
| **PY parity pass** | Mirror Wave A; create-from-scratch Units 6/7/8 in `graphrefly-py`. | § D.3 |
| **Perf pass** | `graphLens` incremental updates; `lens.flow` delta companion. | § D.3 |
| **V2 expansions** | `graphLens.health` V2; aggregate metrics. | § D.3 |

**The session log above is now the complete implementation spec for Phase 0 + Wave A + Wave B (including the post-sync revisions in this appendix).** Subsequent sessions execute the listed work; each unit's locked decisions plus the post-sync revisions in §§ A–D constitute the binding direction.

---

## F. Audit round 2 (2026-04-25 → 2026-04-27)

Follow-up audit pass that picks up Wave B remainder (Units 7, 8) plus the four `D.2` cross-pattern prerequisites filed at § D.2. Same 9-question format; HALT-and-lock per unit. **D.2.5 (`extra/reactive-map.ts`) deferred** for coordination with the in-flight Wave A reshape — to be audited against the post-Wave-A shape.

**Chronology of follow-up audit rounds (this section + §§ G, H):** Phase 0 + Unit 6 widening shipped (§ F.0, 2026-04-25) → **Wave AM audit, Units 1–5 (§ G, 2026-04-26)** — `patterns/ai/memory/` per § D.1 of the original review → **Wave C lock (§ H, 2026-04-26)** — mutation-framework migration per § C of the original review → round-2 audit § F.1–F.7 (Wave B remainder + D.2 prereqs, 2026-04-26 → 2026-04-27) → architecture re-lock § F.8 (2026-04-27).

**Order executed (this § F):** Unit 7 → Unit 8 → D.2.1 → D.2.2 → D.2.4 → D.2.3a → D.2.3b (interrupted at Q1, resumed 2026-04-27) → reconsideration of "reactive options everywhere" lock.

### F.0 — Phase 0 + Unit 6 widening shipped (2026-04-25)

Per § B.1 (Option B) and § B.3 (Option A). Both landed clean; full pnpm test/lint/build green.

**Phase 0 — mutation-framework refactor** ([src/patterns/_internal/imperative-audit.ts](../src/patterns/_internal/imperative-audit.ts), [src/extra/reactive-map.ts:540](../src/extra/reactive-map.ts#L540) JSDoc only):
- Extracted `appendAudit<TArgs, TResult, R, M>` (exported helper).
- Promoted `bumpCursor(seq)` to exported.
- Added `lightMutation(action, opts)` — substrate-tier (`freeze: true` default; no `batch()` frame; seq advance persists on throw).
- Refactored `wrapMutation` to use the shared helpers (no behavior change).
- New tests: 14 in [imperative-audit.test.ts](../src/__tests__/patterns/_internal/imperative-audit.test.ts) (lightMutation happy/throw/freeze-default/freeze-false/seq-cursor/handlerVersion/undefined-skip; wrapMutation regression; bumpCursor unit tests including no-subscribers and `NaN` guard).
- QA carries: **A3** (JSDoc `Node<Actor>` cache:undefined = no scoping); **B1** (terminal-type unsub on `COMPLETE | ERROR | TEARDOWN` + final `bump()`); **C** (strengthened `isActorNode` duck-type via `typeof x.down === "function"`); **D** (`bumpCursor` `Number.isFinite` guard); **E** (lightMutation cursor-log alignment caveat in JSDoc); **F** (dispose-cleanup test counts `unsubCalls`); **G** (dropped brittle `Object.isFrozen(input)` test); **H** (added `bumpCursor` no-subscribers test).

**Unit 6 widening — `GraphDescribeOptions.actor`** ([src/graph/graph.ts](../src/graph/graph.ts)):
- Type widened to `Actor | Node<Actor>`.
- File-local `isActorNode` + `resolveActorOption` helpers (mirrors `extra/resilience.ts:886` precedent — file-local, not promoted to a shared `NodeOrValue` utility).
- Static `describe()` resolves at entry; `_describeReactive` subscribes to the actor node and routes `DATA` emits through the existing `bump()` coalescer; disposer cleans up actor sub.
- Tightened "coalesces correctly" claim from § B.1: cross-source events do NOT batch (subscribe callbacks fire during drain when `batchDepth === 0`, so `registerBatchFlushHook` runs immediately rather than batching across event sources). Final state correctness still holds; tests assert observable property rather than recompute count.
- 4 new tests in [graph.test.ts:1006](../src/__tests__/graph/graph.test.ts#L1006).

### F.1 — Unit 7 lock (`resilientPipeline`, 2026-04-26)

**Locked recommendation E** (corrected to **§ F.10** under Architecture-2 demotion below). Original lock per § B.5 was H = full reactive rebuild + reactive options + per-layer companions; § F.10 demotes "reactive options" to compositor-only.

**Stays locked (Architecture-2 compatible):**
- Mount-on-graph option (`graph?: Graph` opt) — mounts `status`, `error`, `breakerState` companions automatically.
- Per-layer `name?` opts (debug breadcrumb; describe shows the layer-purpose name instead of generic primitive name).
- Per-layer companion exposure (already shipped: `status`, `error`, `breakerState`).
- `timeoutMs` overflow guard at `9_000_000` ms (~2.5h) — already shipped; documented inline.

**Sign-off contingent on:** D.2.3 + D.2.4.

### F.2 — Unit 8 lock (`graphLens` / `LensGraph`, 2026-04-26)

**Locked: J + K from § B.5 verbatim + new "health-tick observe-callback gate":**
- J — full reactive rebuild + reactify `flow` from observe-callback closure to a registered reactive node where it doesn't add a per-DATA frame (carry forward the § B.2 note: `flow.set` from observe-callback stays unwrapped).
- K — `whyCacheSize` default **`16`** (NOT 32; per § B.5 lock).
- **NEW (this round)**: in the health-tick observe gate, skip `t === "data"` from triggering `healthVersion` bumps — closes the perf cliff for high-traffic graphs.

**Sign-off contingent on:** D.2.2.

**Filed in optimizations.md (per § B.5 instruction, retroactively):**
- `graphLens` 50k-node scaling: replace full-describe-per-tick with incremental delta updates.
- `graphLens.health` V2: add `"completed"` and `"disconnected"` flag classes; aggregate metrics (`totalDataCount`, `totalErrorCount`).

### F.3 — D.2.1 lock (`policyEnforcer`, 2026-04-26)

**File:** [src/patterns/audit/index.ts:227-504](../src/patterns/audit/index.ts#L227) (~250 LOC slice of 725).

**Locked: I′ — original recommendation I MINUS D (reactive `violationsLimit`):**
- **B**: drop `all()` imperative read (per no-imperative-reads policy at top of doc).
- **C**: reactive `paths: readonly string[] | Node<readonly string[] | undefined>` — STAYS reactive under Architecture-2 (see § F.10 carve-out: `policyEnforcer` consumer is `guardedExecution`, an inline pattern, NOT a rebuilding compositor).
- **F**: remove the B9 `lastMutation` fallback (B9 added stamped-actor on observe events 2026-04-22; the fallback is now dead code).
- **G**: replace per-event linear path filter with a `Set<string>` lookup in audit mode (current code does `paths.includes(...)` per event; perf pinch at scale).
- **H**: JSDoc the coupling to `NodeImpl._pushGuard` (internal API; document why `safeNode` skip semantics cannot be inferred from the public Node surface).
- **NEW E** (formerly the hub-adoption question): no hub — confirmed in Wave C hub audit that `_publishViolation` calls (subscribe-callback in audit mode + guard-fn in enforce mode) are sanctioned categories. No action needed.

**Dropped (was D in original recommendation):** reactive `violationsLimit` — depends on TopicGraph supporting reactive `retainedLimit`, which the messaging audit confirmed is STATIC. Filed as deferred follow-up: "TopicGraph reactive `retainedLimit` support — needed for reactive `violationsLimit` (re-audit messaging in a future round)."

**`violations.publish(...)` → `lightMutation` adoption** is locked under Wave C, not here.

**Carries:** PY parity → umbrella ticket; Wave C messaging coordination with locked TopicGraph audit changes.

### F.4 — D.2.2 lock (`reactiveExplainPath`, 2026-04-26)

**File:** [src/patterns/audit/index.ts](../src/patterns/audit/index.ts) (~50 LOC slice).

**Locked: B + C + F — co-land with Unit 8 implementation; file path-scoped observe follow-up.**

(Detailed Q-list per the round-2 audit; locks expressed as a short matrix to avoid duplicating the full audit text in this archive.)

- **B**: reactive `from`/`to`/`maxDepth`/`findCycle` opts — same harness-tunability gap as Unit 7/8/D.2.1; reactive options live where the pattern shape demands (inline pattern → reactive on the primitive; compositor → reactive only on the compositor).
- **C**: closure-mutables (`v`, `pendingBump`, `disposed`) sanctioned per §28 — JSDoc the wiring-time-seed pattern.
- **F**: file path-scoped observe follow-up (whole-graph observe scope is a perf gap at scale; not a spec violation; defer).

**Carries:** PY parity → umbrella; B21 wrapper consolidation pending pre-1.0 removal (cross-ref [optimizations.md:541](../docs/optimizations.md#L541)).

### F.5 — D.2.4 lock (`budgetGate`, 2026-04-26 → revised § F.10)

**File:** [src/patterns/reduction/index.ts:240-423](../src/patterns/reduction/index.ts#L240) (~180 LOC).

**Original lock:** B + C + D + E + F + G + reference-equality diff. **Revised under § F.10: drop C (reactive `constraints`); keep B+D+E+F+G + ref-equality.**

- **B**: RingBuffer / head-index queue replacement for `buffer.slice(1)` per pop (currently O(N²) on large buffers; line 299).
- **C**: ~~reactive `constraints: NodeOrValue<readonly BudgetConstraint[]>`~~ — **DROPPED per § F.10**. Consumer `resilientPipeline` rebuilds chain on opt change; `budgetGate` stays static-constraints.
- **D**: terminal force-flush + PAUSE-release ordering audit (current behavior at line 372-386 is correct; lock the ordering as documented invariant + testify).
- **E**: explicit JSDoc on the `node([], fn)` producer-pattern + manual subscribe consequence: source AND constraints invisible to `describe()` from the budgetGate node (effect-mirror limitation; same shape as `policyEnforcer`, `lens.health`, `_explainReactive`).
- **F**: empty-deps `RangeError` documented + tested.
- **G**: reference-equality diff for buffer dedup (where applicable).
- **Reference-equality diff** — applies cross-cuttingly to constraint-array and option-array shapes; locked as the canonical "subscribe management" pattern.

**Carries:** end-of-batch `_handleBudgetMessage` boolean return / forward-unknown audit across other producer-pattern factories (filed under "Implementation anti-patterns" in optimizations.md); PY parity → umbrella.

### F.6 — D.2.3a initial lock (Supervisors cluster: retry + breaker + timeout + fallback, 2026-04-26 → revised § F.10)

**Files:** [src/extra/resilience.ts:49-325 (retry), :327-563 (breaker), :879-1071 (timeout, fallback, TimeoutError)](../src/extra/resilience.ts).

**Original lock:** G + (b) require explicit `count` when `backoff` set + per-field reactive opts on retry/breaker/timeout/fallback. **Revised under § F.10: drop per-field reactive opts; keep G + (b).**

**Surviving items (Architecture-2 compatible):**
- **(b) Unbounded-retry footgun fix**: when `backoff` is provided but `count` is omitted, require explicit `count` (or explicit `count: Infinity` for opt-in). Previously defaulted to `0x7fffffff` ≈ 2.1B retries — flaky-provider + exp-backoff = effectively infinite retry budget.
- **G**: retry source-mode / factory-mode body deduplication (the two overload branches share ~110 LOC; extract shared closure-state machinery).
- **JSDoc** on retry/breaker/timeout/fallback: clock injection contract on `circuitBreaker(now)`, `Math.max(1, delayNs / NS_PER_MS)` minimum-1ms scheduling guard, `coerceDelayNs` defensive non-finite handling, breaker state-telemetry shape, `fallback` `fromAny` type-discrimination contract.
- **Breaker state telemetry** — already shipped via `withBreaker` companion; lock the JSDoc.

**Dropped (was in original lock):** per-field `T | Node<T>` reactive opts on retry / breaker / timeout / fallback — see § F.10.

**Carries:** PY parity follow-up; carries to D.2.3b for shared cross-primitive patterns.

### F.7 — D.2.3b lock (Throttles + status cluster: tokenBucket + rateLimiter + withStatus, 2026-04-27)

**Files:** [src/extra/resilience.ts:565-634 (tokenBucket), :636-774 (rateLimiter), :776-868 (withStatus)](../src/extra/resilience.ts).

**Prior context** (validates Architecture-2 carve-out):
- `rateLimiter` rewritten 2026-04-15 from sliding-window to `tokenBucket` (resolved-decisions.jsonl id `ratelimiter-sliding-window-to-tokenbucket`). Current shape locked.
- `withStatus` P3 fix 2026-04-15 — closure `currentStatus` instead of `.cache` read (id `p3-audit-4-withstatus-cache-read`).
- **`adaptiveRateLimiter`** (resolved 2026-04-21, id `adaptive-rate-limiter-primitive`) is the primitive-level reactive-opts variant — accepts `rpm` / `tpm` `NodeInput<number>` knobs + `TokenBucket.putBack` recovery. Validates the § F.10 carve-out: `rateLimiter` stays static; callers needing hot-path reactivity use `adaptiveRateLimiter`.

**Locked: (c) — full hygiene + bounded-pending + `droppedCount` companion. (e) explicitly deferred to post-1.0.**

**(c) Items:**

1. **Bounded-`maxBuffer`** on `rateLimiter`: require explicit `maxBuffer` OR `maxBuffer: Infinity` for opt-in unbounded. Default to a sane cap (e.g. `2 * maxEvents`). Same shape as retry's `count`-required-when-`backoff`-set fix (D.2.3a (b)). Closes the "high-rate source + low limit + omitted maxBuffer = unbounded queue growth" footgun.
2. **RingBuffer / head-index queue** for `rateLimiter.pending`: replace `pending.shift()` (O(N) per pop) with O(1) pops; cross-share the RingBuffer primitive with D.2.4 B's `budgetGate.buffer.slice(1)` fix.
3. **`droppedCount` reactive companion** on `rateLimiter`: `Node<number>` increments on each drop (under any overflow policy: `drop-newest` / `drop-oldest`); resets on terminal. `rateLimiter` return type widens from `Node<T>` to `{ node: Node<T>, droppedCount: Node<number> }` (companion-bundle shape; pre-1.0 free to break).
4. **`tokenBucket(capacity, refill, opts?)` clock injection**: optional `now?: () => number` for testability; parity with `circuitBreaker(now)`. Removes test reliance on `vi.useFakeTimers`.
5. **JSDoc**:
   - `tokenBucket.tokens` is float (fractional refill credit accumulates).
   - `rateLimiter` producer-pattern: source visible, `droppedCount` companion invisible to describe-traversal from `node` (effect-mirror limitation; documented).
   - `rateLimiter.droppedCount` lifecycle (counts drops; resets on terminal).
   - `withStatus.batch()` recovery semantics — already documented; lock the comment.
6. **Drop reactive opts on `rateLimiter`** per § F.10 — `resilientPipeline` rebuilds; `adaptiveRateLimiter` is the reactive-opts variant.

**(e) `withStatus` decomposition — DEFERRED post-1.0.** Initial Q9 alternatives surfaced (e) as a candidate (decompose into `statusOf` + `errorOf` + thin bundle). On reflection: complicates the surface for no current use case. Re-evaluate post-1.0 when concrete demand for independent-companion reuse or describe-traversal visibility on `withStatus` companions emerges. Filed in `docs/optimizations.md` under "Deferred follow-ups" so the rationale + tradeoff analysis is preserved.

**Coverage table:**

| Q | Concern | Coverage |
|---|---|---|
| Q2 | Unbounded `pending` queue | (1) explicit `maxBuffer` |
| Q2 | `pending.shift()` O(N) | (2) RingBuffer |
| Q2 | No throttle-pressure signal | (3) `droppedCount` companion |
| Q5 | `tokenBucket` testability | (4) clock injection |
| Q6 | Float `tokens` undocumented | (5) JSDoc |
| Q3 gray #2 | `withStatus` empty-deps + invisible companions | DEFERRED post-1.0 (see optimizations.md) |
| Architecture | Reactive opts on primitive | (6) DROPPED — § F.10 |

**Carries:**
- PY parity → umbrella: mirror items 1–5 in `~/src/graphrefly-py/src/graphrefly/extra/resilience.py`.
- Cross-pattern: `rateLimiter`'s new `droppedCount` companion is sanctioned subscribe-callback mutation per Wave C hub audit — no `lightMutation` adoption needed.

### F.8 — Architecture re-lock (2026-04-26): "reactive options everywhere" → compositor-only

**Trigger.** During D.2.3b Q1, the user pushed back on "NodeOrValue everywhere" — the implicit assumption behind Unit 7 E + D.2.3a (per-field reactive) + D.2.4 C (reactive constraints). The user's reasoning:

> *"I accepted the unit 6 widening (`actor: Actor | Node<Actor>`) but I think architecture 2 is enough because, like you said, we haven't got a use case for LLM to actually tune the graph on the fly yet. That step requires we do a lot of evals on LLM's ability to understand how the spec and the composition guide work. I don't think LLM is capable of doing that on the fly. At least, at this stage, it requires a version upgrade on the code to tune the graph for now."*

**Reasoning chain reviewed.**
1. The "reactive options everywhere" lock came from the original § B.5 Unit 7 H, dated 2026-04-25.
2. Two architectures answer "who reacts when an option-Node emits":
   - **Architecture 1**: push reactivity into each primitive — every primitive (retry, rateLimiter, etc.) accepts `T | Node<T>` for its options and owns its option subscription. ~250 LOC of new code across 7 primitives + per-primitive state-migration logic (e.g. bucket-state on `rateLimiter` capacity change).
   - **Architecture 2**: keep primitives static; the compositor (`resilientPipeline`) accepts option-Nodes per-layer and rebuilds the chain on emit (switchMap-style). Primitives unchanged. ~30 LOC of rebuild logic in the compositor.
3. Architecture 1's runtime win (incremental update vs full rebuild) only pays off for HOT opt changes. **No current consumer asks for HOT option tuning.** The harness use cases are: UI knob, periodic harness tuning — option Nodes change rarely, not per-DATA. Per-rebuild cost is small (~7 nodes; constant time relative to source throughput).
4. The original lock was inherited from a SESSION-doc decision, not from a use case that demanded it.

**Locked: Architecture 2.** Primitives stay static; reactivity lives at the compositor layer.

**Why this matches the user's framing.**
- Tuning the resilience pipeline on-the-fly is an *LLM-as-graph-tuner* capability. That capability requires evals on LLM understanding of GRAPHREFLY-SPEC + COMPOSITION-GUIDE before we trust it.
- At this stage, the version-upgrade-to-tune model is the right operating mode. We don't pay the ~250 LOC primitive-churn tax for a use case we can't yet exercise safely.
- The compositor-level rebuild keeps the user-visible reactivity (callers still pass `T | Node<T>`) — the cost shifts to the framework's compositor, not to every primitive.

### F.9 — Carve-outs from Architecture 2

Two patterns explicitly **stay reactive at the primitive layer** because their consumers are NOT rebuilding compositors:

| Primitive | Reactive opt | Reason |
|---|---|---|
| `policyEnforcer` (D.2.1 C) | `paths: readonly string[] \| Node<readonly string[] \| undefined>` | Consumer is `guardedExecution`, an inline pattern; "harness updates allowed paths mid-run" is a real flow that doesn't go through a rebuilding compositor. |
| `Graph.describe({ actor })` (Unit 6) | `actor: Actor \| Node<Actor>` | `Graph.describe` is itself the compositor for the snapshot; the actor-Node subscription routes through the existing `bump()` coalescer. Already shipped. |

Carve-outs are decided by the *consumer's pattern shape* (compositor vs inline), not by the primitive's intrinsic reactivity. This is the heuristic going forward.

### F.10 — Round-2 unit-revision summary (Architecture-2 final lock)

| Audit | § F section | Original lock | Final lock (Architecture 2) |
|---|---|---|---|
| **Unit 6 widening** | F.0 | `actor: Actor \| Node<Actor>` (§ B.1 Option B) | **Stays accepted** — § F.9 carve-out (`Graph.describe` IS the compositor). |
| **Unit 7** | F.1 | H = full reactive rebuild + reactive options + per-layer companions (§ B.5) | **Compositor-level reactive only**: `resilientPipeline` accepts `T \| Node<T>` per-layer and rebuilds chain on emit (switchMap-pattern). Per-layer companions + mount-on-graph + naming stay. |
| **Unit 8** | F.2 | J + K (§ B.5) + new health-tick gate | **Stays** (no Architecture-1 dependency). |
| **D.2.1** | F.3 | I′ — drop reactive `violationsLimit`; keep B+C+F+G+H | **Stays — reactive `paths` survives** under § F.9 carve-out (consumer is inline `guardedExecution`, not a rebuilding compositor). |
| **D.2.2** | F.4 | B + C + F | **Stays** (no Architecture-1 dependency). |
| **D.2.3a** | F.6 | G + (b) require explicit count + per-field reactive opts | **Drop reactive opts**; keep G + (b) + JSDoc. |
| **D.2.3b** | F.7 | (interrupted at Q1; re-locked 2026-04-27) | **(c)**: bounded-`maxBuffer`, RingBuffer, `droppedCount` companion, `tokenBucket` clock injection, JSDoc, **drop reactive opts**. **(e) `withStatus` decomposition deferred post-1.0** (see optimizations.md). |
| **D.2.4** | F.5 | B + C + D + E + F + G + ref-equality diff | **Drop C** (reactive `constraints`); keep B + D + E + F + G + ref-equality diff. |

### F.11 — Round-2 carry-forward to optimizations.md

To file (alongside the AM follow-ups, batched at end of audit batch):

- **TopicGraph reactive `retainedLimit`** — needed for reactive `violationsLimit` on `policyEnforcer` and similar consumers. Re-audit messaging in a future round (D.2.1 carry).
- **`graphLens` 50k-node scaling** — incremental delta updates instead of full describe-per-tick (Unit 8 carry, § B.5 instruction).
- **`graphLens.health` V2** — `"completed"` / `"disconnected"` flag classes; aggregate metrics (Unit 8 carry, § B.5 instruction).
- **End-of-batch `_handleBudgetMessage` boolean return / forward-unknown audit** across other producer-pattern factories (D.2.4 carry; file under "Implementation anti-patterns").
- **Compositor-level reactive options pattern** — `resilientPipeline` switchMap-pattern rebuild on per-layer option-Node emit. New entry capturing the Architecture-2 design: when, why, the diff-vs-rebuild tradeoff, the §28 wiring-time-seed pattern in the compositor.
- **PY parity umbrella** — Round-2 additions: Unit 7/8 ports, D.2.1/D.2.2/D.2.3/D.2.4 ports.

### F.12 — Items still left for audit

| Item | Status | Note |
|---|---|---|
| **D.2.5** — `extra/reactive-map.ts` | DEFERRED | Coordination flag — Wave A is reshaping `reactiveMap` as part of memory-primitive adoption. Audit AFTER Wave A ships against the post-Wave-A shape. |
| Implementation phases | QUEUED | Wave B (Units 7, 8) + D.2.1, D.2.2, D.2.3, D.2.4 implementation can proceed now that the audit-side decisions are locked. Wave A is in-flight by another agent. |

**Round-2 audit status:** **7 of 7 audits locked** (Unit 7, Unit 8, D.2.1, D.2.2, D.2.4, D.2.3a, D.2.3b); 1 deferred (D.2.5). Architecture-2 re-lock applies retroactively to Unit 7 + D.2.3a + D.2.3b + D.2.4; § F.9 carve-outs preserve reactivity for D.2.1 `paths` and Unit 6 `actor`.

**The session log above is now the complete implementation spec for Phase 0 + Wave A + Wave B (including the post-sync revisions in this appendix and the round-2 audit decisions in § F).** Subsequent sessions execute the listed work; each unit's locked decisions plus the post-sync revisions in §§ A–D plus the round-2 locks in § F plus the Wave AM and Wave C locks in §§ G, H constitute the binding direction.

---

## G. Wave AM — agentic memory audit (2026-04-26)

Audit pass on `patterns/ai/memory/` per § D.1 of the original review. Same 9-question format; HALT-and-lock per unit; one file per unit. No backward compat budget (pre-1.0). All PY parity items rolled into a single umbrella ticket at end of wave.

**Files in scope:**
- [src/patterns/ai/memory/tiers.ts](../src/patterns/ai/memory/tiers.ts) — Unit 1
- [src/patterns/ai/memory/admission.ts](../src/patterns/ai/memory/admission.ts) — Unit 2
- [src/patterns/ai/memory/retrieval.ts](../src/patterns/ai/memory/retrieval.ts) — Unit 3
- [src/patterns/ai/memory/llm-memory.ts](../src/patterns/ai/memory/llm-memory.ts) — Unit 4
- [src/patterns/ai/memory/memory-composers.ts](../src/patterns/ai/memory/memory-composers.ts) — Unit 5

### G.1 — Wave AM Unit 1 (`tiers.ts`, decay constant, 2026-04-26)

**Locked: E — full pass.**

- ✅ **Decay constant moves to `src/patterns/_internal/decay.ts`** — new internal file (NOT a public surface). `tiers.ts` and `harness/defaults.ts` re-export.
- ✅ **Drop `tierOf` entirely** — `tierOfNode(keyInput): Node<MemoryTier>` becomes the only read. No imperative escape hatch (per top-level no-imperative-reads policy at line 97).
- ✅ **Narrow `activeEntries: Node<unknown>` → `Node<ReadonlyMap<string, TMem>>`** — the upstream `store.store.entries` is already typed as `Node<ReadonlyMap<string, TMem>>` (`ReactiveMapBundle.entries`). Today's `Node<unknown>` is a gratuitous type erasure; just stop erasing. No new type promotion needed.
- ✅ **Keep `markPermanent` as command-side write** (sanctioned per API-style policy); `lightMutation` adoption deferred to Unit 5 (`memory-composers.ts`) where the body lives.
- 🟡 **Open follow-up:** [`extractStoreMap<TMem>`](../src/patterns/ai/memory/memory-composers.ts#L42) becomes redundant once the upstream type narrows — delete it as part of Unit 5.

**Carries:** PY parity → umbrella.

### G.2 — Wave AM Unit 2 (`admission.ts` — `admissionFilter`, 2026-04-26)

**Locked: C + D + E + F — clean full pass.**

**Final shape:**

```ts
// Generic predicate (renamed from admissionScored — "Scored" was misleading;
// it returns a predicate, not scores).
admissionFilter<Dims, TRaw>(opts): (raw: TRaw) => boolean

// Reactive sibling — direct graph composition without the agentMemory-style
// `derived(...)` wrapper. Sets the precedent for Unit 6 to accept a reactive
// filter without us having to come back here.
admissionFilterNode<Dims, TRaw>(rawInput, optsInput): Node<boolean>

// 3D sugar — name unchanged.
admissionFilter3D(opts): (raw) => boolean
```

- ✅ **C** — fix `scoreFn` double-call in `admissionFilter3D`; extract private `gateThresholds(scores, thresholds)` helper; both `admissionFilter` and `admissionFilter3D` use it.
- ✅ **D** — `requireStructured: boolean` → `structureThreshold?: number`. Uses `>=` like persistence/personalValue. Old `requireStructured: true` migrates to `structureThreshold: Number.MIN_VALUE` for the literal `> 0` semantic; callers should set a meaningful threshold.
- ✅ **E** — rename `admissionScored` → `admissionFilter` (the "Scored" suffix mis-described the returned shape); add `admissionFilterNode` reactive sibling.
- ✅ **F** — type-cleanup on the dim-keyed options object.

**Carries:** PY parity → umbrella.

### G.3 — Wave AM Unit 3 (`retrieval.ts` — defaults + rename, 2026-04-26)

**Locked: G — defaults centralization + `context` → `path` rename for hierarchical-breadcrumb fields only.**

- ✅ **G** — surface `DEFAULT_RETRIEVAL_TOPK / GRAPH_DEPTH / BUDGET / CONTEXT_WEIGHT` as named constants (currently inline literals scattered across the file).
- ✅ **Q2 rename mapping** (hierarchical-breadcrumb field rename only):
  - `RetrievalQuery.context` → `.path`
  - `RetrievalEntry.context` → `.path`
  - `RetrievalPipelineOptions.contextOf` → `.pathOf`
  - `RetrievalPipelineOptions.contextWeight` → `.pathWeight`
  - `MemoryWithTiersOptions.context` (the agent-wide score-fn live state) **stays** — that's the disambiguation.
- ✅ **Q3** — empty-query enforcement deferred to a runtime guard in Unit 5 (cleanest; type-level discrimination would force awkward "build an X-style query" choices on callers).

**Carries:**
- 🟡 To Unit 5: rename ripple in `memory-composers.ts` (`pathOf`, `pathWeight`, `query.path`, `entry.path`); add at-least-one-channel runtime guard for `RetrievalQuery`.
- 🟡 To Unit 6 (post-Wave-AM follow-up): rename ripple in `agent-memory.ts` (retrieval field references).
- PY parity → umbrella.

### G.4 — Wave AM Unit 4 (`llm-memory.ts` — `llmJsonCall` → public `promptCall`, 2026-04-26)

**Locked: D′ — promote `llmJsonCall` → public `promptCall` in new file `src/patterns/ai/prompts/prompt-call.ts`. Folds in C (type cleanup + tests + recency-bias doc) for the memory-domain wrappers.**

**Final shape:**
- **NEW** [`src/patterns/ai/prompts/prompt-call.ts`](../src/patterns/ai/prompts/prompt-call.ts):
  - `PromptCallOptions = PromptNodeOptions ∪ { name? }`.
  - `promptCall<TIn, TOut = string>(adapter, contentBuilder, opts): (input: TIn) => Node<TOut>` — body is the current `llmJsonCall` minus the memory-specific bits, with cleaned-up type casts.
  - JSDoc cross-references `promptNode` (deps shape) and the `extractFn` / `consolidateFn` / distill-callback usage pattern.
- **REFACTOR** `src/patterns/ai/memory/llm-memory.ts`:
  - Drop the file-private `llmJsonCall`; import `promptCall`.
  - `llmExtractor` and `llmConsolidator` become thin specializations: build closure args (`{raw, existingKeys}` / `{memories}`) and delegate.
  - Keep memory-domain JSDoc (`Extraction<TMem>` shape, distill integration).
  - Drop `as NodeInput<TOut>` cast (no longer needed once the body lives in `prompt-call.ts` with cleaner types).

- ✅ **Q2** — fix `as never` locally for now (cast to `[Node<TIn>]`); revisit `promptNode` deps signature only if multiple call sites force the same workaround.
- 🟡 **Q3** — flag the `mapFromSnapshot` ([composite.ts:141](../src/patterns/ai/memory/composite.ts#L141)) ↔ `extractStoreMap` ([memory-composers.ts:42](../src/patterns/ai/memory/memory-composers.ts#L42)) parallel pair as a separate Wave-A follow-up to file in `optimizations.md` once the wave finishes. (`extractStoreMap` is also slated for deletion via Unit 1 / Unit 5 type-narrowing chain.)

**Future overgeneralization deferred:** `extra/callFactory<TArgs, TResult>` generalizing the per-call-fresh-Node pattern is conceivable but premature at two callers (`promptCall` + future). Defer.

**Carries:** PY parity → umbrella.

### G.5 — Wave AM Unit 5 (`memory-composers.ts` — composite memory factories, 2026-04-26)

**Locked: E with refined D — clean full pass across `memoryWithVectors` / `memoryWithKG` / `memoryWithTiers` / `memoryRetrieval`.**

- ✅ **A. `memoryWithVectors`** — diff-based indexer (insert / update / remove tracking); inline now, file `diffMap` extraction as a Wave-A-extras follow-up.
- ✅ **B. `memoryWithKG`** — same diff-based pattern; verify `kg.removeEntity` exists in Wave A's KG rebuild surface — file as blocker if not.
- ✅ **C. `memoryWithTiers`**:
  - Closure-state promotion: `permanentKeys: Set<string>` → `state<ReadonlySet<string>>`; `entryCreatedAtNs: Map<string, number>` → `reactiveMap`.
  - `tierClassifier` effect → pure `derived<{toArchive, toPermanent}>` + `retention.onArchive` wire (retires §7 feedback cycle per [optimizations.md:892](../docs/optimizations.md#L892)).
  - `tierOf` → `tierOfNode` (per Unit 1 lock).
  - `markPermanent` adopts `lightMutation` with public `events` audit log (per § B.2).
  - Score-fn double-call fix.
- ✅ **D. `memoryRetrieval`**:
  - Drop imperative `retrieve` (per top-level no-imperative-reads policy).
  - Explicit-deps fully-reactive `runRetrieval` (snapshots in, no `.cache` reads in body).
  - Two memoized sibling `derived`s.
  - Candidate-map fix (only fall back to full-store when no vectors AND no KG AND no entityIds — current code falls back too eagerly).
  - Empty-query runtime guard (per Unit 3 carry).
  - Unit 3 renames applied (`pathOf` / `pathWeight` / `query.path` / `entry.path`).
  - Unit 3 default constants applied.
- ✅ **E** — delete `extractStoreMap` (per Unit 1 follow-up); tighten `store.store.entries` typing inline.

- ✅ **Q2 archive semantic — (b) real archival** — add `archiveStore?: LightCollectionBundle<TMem>` opt; classifier writes archived entries there before deleting from active. Keeps the `archiveTier` snapshot-storage opt for persistence. Names stay descriptive.
- ✅ **Q3 diffing** — inline diff in indexers (Wave-A-extras follow-up files `diffMap` extraction once a 3rd caller emerges).

**Resulting topology** (per Q9 walkthrough, locked): `memoryRetrieval` ends at 2 nodes (down from 3). No state-node mirror, no effect, no race between imperative and reactive write paths. `runRetrieval` runs **once** per input change (memoized). `describe()` shows both.

**Carries:** PY parity → umbrella; `diffMap` extraction once 3rd-caller emerges.

### G.6 — Wave AM follow-ups + cross-references

**Filed in optimizations.md (post-Wave-AM batch):**
- `mapFromSnapshot` ↔ `extractStoreMap` parallel-pair audit follow-up (Unit 4 Q3).
- `diffMap` extraction once a 3rd caller emerges (Unit 5 Q3).
- PY parity umbrella ticket — single ticket capturing PY mirror for Wave AM Units 1–5 (locked at user request: "roll all PY parity into one umbrella ticket at the end of the wave").

**Out of scope but discussed**: `agent-memory.ts` (Unit 6 of Wave AM) NOT audited in this round — flagged as natural follow-up after the Unit 3 rename ripple lands. Filed as a post-Wave-AM follow-up.

---

## H. Wave C lock — mutation-framework migration (2026-04-26)

Wave C per § C of the original review. Migrates 10 cross-pattern sites to the Phase-0 mutation framework (`lightMutation` for atomic single-step mutations; `wrapMutation` for multi-step with rollback). **Decisions only — implementation deferred to a separate session per user request ("Don't do the actual code, just locking down decisions").**

**Phases (sequencing per user lock "am followups then wave c"):**
1. **C.1 — job-queue** — smallest blast radius; validates Phase 0 framework end-to-end.
2. **C.2 — cqrs** — highest-VALUE migration (closes documented rollback gap on `dispatch` + `saga`).
3. **C.3 — process** — same `wrapMutation` pattern as C.2.
4. **C.4 — messaging** — heaviest (NEW public audit surfaces × 3).

### H.1 — Cross-cutting decisions (apply to all 4 phases)

- ✅ **Q1 — Class-field assignment in constructor.** `readonly enqueue: (...) => T` declared as field; bound via `lightMutation` / `wrapMutation` in the constructor after dependent state is initialized. No method-delegate indirection. Subclass-override loss is acceptable (none of the four pattern domains have subclassing today).
- ✅ **Q2 — `onFailure` selectivity.** Always-on for **queue / state mutations** (where the failure represents an internal-state issue worth auditing). Off for **caller-input validation throws** (e.g. duplicate-id, malformed args — those are the caller's bug, not a system event).
- ✅ **Q3 — Same-file ride-along.** Migrate any sibling site in a touched file that uses the hand-rolled `events.append + wallClockNs + seq` pattern, even if not in SESSION § C's explicit 10. Better consistency than strict-list adherence.

### H.2 — C.1: job-queue (4 sites; SESSION § C listed 3 + 1 ride-along)

| Site | Wrapper | freeze | onFailure? | Notes |
|---|---|---|---|---|
| `enqueue(payload, opts?)` (line 122) | `lightMutation` | `false` (large payloads) | OFF (duplicate-id is input validation) | seq advances inside wrapper; remove private `_bumpSeq` helper |
| `ack(id)` (line 169) | `lightMutation` | `true` | OFF (returns `false` for invalid state — no throw to audit) | |
| `nack(id, opts?)` (line 183) | `lightMutation` | `true` | OFF (same as ack) | Two paths (requeue + drop) — single wrapper, builder discriminates via captured opts |
| `claim(limit?)` | NOT WRAPPABLE 1:1 | n/a | n/a | **Lock: keep `claim` hand-rolled** with JSDoc note. Per-job loop semantically wants N records; forcing N wrapper calls would N-fold framework overhead. |
| `removeById` (~line 232; ride-along) | `lightMutation` | `true` | OFF (returns false for unknown id) | Same shape as ack |

**Net for C.1:** enqueue + ack + nack + removeById migrated; `claim` documented as intentional hand-roll; `_bumpSeq` private helper deleted.

### H.3 — C.2: cqrs (2 sites — closes rollback-safety gap)

| Site | Wrapper | freeze | onFailure? | Notes |
|---|---|---|---|---|
| `CqrsGraph.dispatch(command)` | **`wrapMutation`** | `true` (default) | **ON** (closes the rollback-safety gap — current `dispatch` can leave inconsistent state mid-throw) | Multi-step: handler runs → event-store appends → state updates. Batch frame ensures rollback if any step throws; failure record commits OUTSIDE the rolled-back frame. **Highest-value Wave C migration.** |
| `CqrsGraph.saga(...)` (per-event handler) | **`wrapMutation`** | `true` | **ON** (handler-supplied code can throw) | Same multi-step rollback story per-event-type. |

**Net for C.2:** `dispatches` audit log already exists; refactor wires the existing log. Adopting `wrapMutation` is FUNCTIONAL (not just stylistic) — closes the documented rollback gap.

### H.4 — C.3: process (2 sites)

| Site | Wrapper | freeze | onFailure? | Notes |
|---|---|---|---|---|
| `processManager.start(correlationId, ...)` | **`wrapMutation`** | `true` | **ON** | Multi-step: instance creation + initial state + audit append. `instances` audit log already exists. |
| `processManager.cancel(correlationId, reason?)` | **`wrapMutation`** | `true` | **ON** | Multi-step: state transition to "cancelled" + compensation logic + audit. |
| `appendRecord` / `appendRecordWithReason` (private helpers) | NOT WRAPPED | n/a | n/a | These ARE the audit-emit mechanism; wrapping would be circular. Stay private; the `wrapMutation` on `start` / `cancel` calls them as internal helpers. |

**Net for C.3:** refactor adopts `wrapMutation` at the public-method boundary; private `appendRecord*` helpers become an implementation detail of the wrapped methods.

### H.5 — C.4: messaging (4 sites + NEW public audit surface)

**Lock:** messaging gets a NEW public audit log per pattern type. Not "no audit log" anymore — Audit-2-convention `events: ReactiveLogBundle<...>` surfaces are added.

| Site | Wrapper | freeze | onFailure? | Notes |
|---|---|---|---|---|
| `Topic.publish(value)` (line 116) | `lightMutation` | `false` (large message values) | OFF (only throw is §5.12 SENTINEL guard — user error) | New `Topic.events: ReactiveLogBundle<TopicAuditRecord>` surface |
| `Subscription.ack(count?)` (line 264) | `lightMutation` | `true` | OFF | New `Subscription.events: ReactiveLogBundle<SubscriptionAuditRecord>` |
| `Subscription.take(...)` (line 308) | `lightMutation` | `true` | OFF | Same audit log as ack — siblings |
| `Hub.delete(name)` (line 499) | `lightMutation` | `true` | OFF (returns false for unknown name) | New `Hub.events: ReactiveLogBundle<HubAuditRecord>` |
| `Hub.publish(name, value)` (line 600; ride-along) | `lightMutation` | `false` | OFF | Delegates to `Topic.publish` internally; **double-audit not desired**. Lock: `hub.publish` does NOT add its own record — the topic's record is sufficient. `Hub.events` only records hub-level events (delete, register). |
| `Hub.publishMany(entries)` (line 613; ride-along) | NOT WRAPPED | n/a | n/a | Loops over `Hub.publish` — wrapping the loop would N-record. Same logic as job-queue's `claim`. JSDoc note. |

**New public types:**

```ts
type TopicAuditRecord = BaseAuditRecord & {
  action: "publish";
  // payload omitted to avoid retaining large values; consumers tail Topic.node for values.
};

type SubscriptionAuditRecord = BaseAuditRecord & {
  action: "ack" | "take" | "complete";
  count?: number;        // for ack/take
  remaining?: number;    // pending after the op
};

type HubAuditRecord = BaseAuditRecord & {
  action: "register" | "delete";
  name: string;
};
```

**Audit-surface decisions:**
- ✅ Retained limit: default **1024** (cross-cutting bounded-default).
- ✅ Deny-write guard: yes, `DEFAULT_AUDIT_GUARD` from imperative-audit.
- ✅ Surfaced as `events: ReactiveLogBundle<...>` on each of `TopicGraph`, `SubscriptionGraph`, `HubGraph`; aliased as `audit` per Audit-2 convention.
- ✅ `describe()` visibility: each `events.entries` registered on the parent graph via `createAuditLog({ graph: this })`.

### H.6 — Implementation order + tests

**Per-phase commits**: one per phase (4 total) so each pattern domain is reviewable in isolation. QA pass = 5th commit. **Total estimate: ~1.5 days focused.** C.4 is half the work because of the new surfaces.

**Test / regression coverage to add:**
- **C.1**: `_bumpSeq` removal — assert `events.entries[i].seq === i + 1` for a sequence of enqueue/ack/nack with no gaps.
- **C.2**: `dispatch` rollback-safety regression — handler throws partway through state update; assert event-store NOT appended; assert failure record IS appended (currently the system fails inconsistently here).
- **C.2**: `saga` per-event handler rollback — same story for saga-driven event handlers.
- **C.3**: `start` / `cancel` adoption is mostly behaviorally identical; existing tests should pass unchanged. Add: `start` with throwing initial-state computation rolls back the instance creation.
- **C.4**: `TopicGraph.events` records every publish; `Subscription.events` records ack/take/complete; `Hub.events` records register/delete. Assert `describe()` shows the audit nodes.
- **C.4**: `hub.publish(name, val)` produces ONE record (the topic's), NOT two.

### H.7 — Wave C carry-forward

Once Wave C ships, the migration table at § C of this SESSION doc becomes a "completed migration" reference, not a backlog item. No new follow-ups expected unless the QA pass surfaces something. Archive the resolved items to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log".

**Wave C status:** decisions locked 2026-04-26; **implementation pending** in a separate session.
