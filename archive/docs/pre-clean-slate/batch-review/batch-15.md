# Batch 15: AI Debugging Tooling Gap Analysis (TS + Py)

**Date:** 2026-03-29
**Scope:** Assess whether GraphReFly's `describe()` / `observe()` are sufficient for AI-assisted debugging, comparing against callbag-recharge's Inspector (28 methods, 991 LOC).

---

## Current Capabilities Assessment

### 1. `describe()` — Static Snapshot

**What it gives:**
- Full Appendix B JSON: `{ name, nodes, edges, subgraphs }`
- Per-node: `type` (state/derived/producer/operator/effect), `status`, `value`, `deps[]`, `meta{}`
- Qualified paths including meta companions (`node::__meta__::key`)
- Actor-scoped filtering (guard-aware visibility)
- Deterministic ordering (sorted keys) for diff-ability

**What's missing for AI debugging:**
- **No causality.** An AI cannot answer "why did node X get value Y?" from `describe()` alone — it shows the current DAG shape and values but not *which dep triggered the last recomputation* or *what the dep values were at that moment*.
- **No history.** `describe()` is a point-in-time snapshot. An AI cannot reconstruct the sequence of events that led to the current state.
- **No filtering/query.** To find all errored nodes, an AI must parse the full JSON and filter client-side. For large graphs this is wasteful context.
- **No annotations.** There is no field for "why an AI agent set this node to this value" — `meta` can hold arbitrary data, but there's no convention or method for reasoning traces.

**Can an AI answer "why did node X get value Y?":** No. It can see X's deps and their current values, and infer "X = f(dep1, dep2)" but cannot determine which dep change triggered the most recent recomputation, nor what intermediate states existed.

### 2. `observe()` — Live Message Stream

**What it gives (TS):**
- Single-node mode: `GraphObserveOne` with `subscribe(sink: NodeSink) → unsubscribe`
- Graph-wide mode: `GraphObserveAll` with `subscribe(sink: (path, messages) → void) → unsubscribe`
- Raw message batches: `[[DIRTY], [DATA, 42]]`, `[[DIRTY], [RESOLVED]]`, etc.
- Actor-scoped guard filtering

**What it gives (Py):**
- `GraphObserveSource` with `subscribe(sink) → unsubscribe` — same semantics

**What's missing:**
- **No structured result object.** The sink receives raw message tuples. There is no accumulated `ObserveResult` with `{ values, dirtyCount, resolvedCount, completedCleanly, errored }`. An AI consuming `observe()` must build its own accumulators.
- **No timestamps.** Messages arrive without timestamps — post-mortem analysis of ordering or latency is impossible.
- **No batch context.** No `inBatch` flag — the AI cannot distinguish "this DATA arrived during a batch drain" from "this was a standalone emission."
- **No causal info.** Observe delivers what happened but not *why* (which dep triggered).
- **No dispose/reconnect convenience.** The TS implementation returns a raw unsubscribe function; there's no `.reconnect()` to start fresh on the same node.

**Can an AI correlate events across nodes?** Partially — graph-wide mode delivers `(path, messages)` tuples, so an AI can see interleaved events. But without timestamps or batch markers, cross-node causal reasoning is guesswork.

### 3. Meta Companion Stores

**What they provide:**
- Arbitrary key-value metadata per node (`meta: { description, type, range, access }`)
- `metaSnapshot()` reads all companions into a plain object
- Meta appears in `describe()` output under `meta` field
- Meta nodes are individually observable via `observe("node::__meta__::key")`

**Sufficient for AI understanding?** For *what* a node does: yes, if the builder populates `meta.description`. For *why* a node is in its current state: no — meta is static metadata about purpose, not dynamic reasoning traces.

---

## Gap Analysis

### Gap 4: Structured Observe Result

**PRIORITY:** must-have-before-Phase-4
**EFFORT:** M (1–2 days)
**JUSTIFICATION:** Phase 4 orchestration (`pipeline`, `agentLoop`) will generate complex multi-node event sequences. Without structured observation, every AI debugging session and every test must hand-roll accumulators for `values`, `dirtyCount`, `errored`, etc. The predecessor's `ObserveResult` was the single most-used Inspector feature in tests.

**RECOMMENDATION:**
```ts
// observe() stays as-is (raw stream). New method:
graph.inspect("validate")  →  ObserveResult {
  values: T[],
  events: Array<{ type, data, inBatch }>,
  dirtyCount: number,
  resolvedCount: number,
  completedCleanly: boolean,  // getter
  errored: boolean,            // getter
  dispose(): void,
  reconnect(): ObserveResult,
}
```
Alternatively, `observe(name, { structured: true })` returns `ObserveResult` instead of raw stream — this keeps a single entry point. The roadmap already specs this as `observe()` returning `ObserveResult`; follow that design.

### Gap 5: Causal Trace

**PRIORITY:** must-have-before-Phase-4
**EFFORT:** M (1–2 days)
**JUSTIFICATION:** Phase 4 `agentLoop` and `pipeline` are chains of derived nodes. When a pipeline step produces an unexpected result, the first question is "which input changed and what was the chain?" Without causality, an AI can only see the final value and must re-derive the cause from the full graph snapshot — often infeasible with 20+ nodes.

**RECOMMENDATION:**
```ts
const obs = graph.observe("validate", { causal: true });
// Each evaluation records:
obs.causality: Array<{
  result: T,
  triggerDepIndex: number,
  triggerDepName: string | undefined,
  depValues: unknown[],
  timestamp_ns: number,
}>
```
Implementation: wrap `NodeImpl._fn` to snapshot dep values before/after (same approach as predecessor's `causalityTrace`). Only active when `{ causal: true }` — zero overhead otherwise.

### Gap 6: Timeline

**PRIORITY:** should-have
**EFFORT:** S (half day)
**JUSTIFICATION:** Useful for debugging batch-drain ordering and latency, but Phase 4 can ship without it. Becomes critical when users report "events arrive in wrong order" bugs.

**RECOMMENDATION:**
```ts
const tl = graph.observe("node", { timeline: true });
tl.entries: Array<{
  timestamp_ns: number,
  type: "data" | "dirty" | "resolved" | "complete" | "error",
  data: unknown,
  inBatch: boolean,
}>
tl.dispose(): void
```
Minimal wrapper: adds a monotonic `timestamp_ns` and batch-detection flag to each message before passing to the events array. Roadmap already includes this.

### Gap 7: Diff

**PRIORITY:** should-have
**EFFORT:** M (1–2 days)
**JUSTIFICATION:** Phase 4 `pipeline` with checkpointing will produce many snapshots. An AI agent needs "what changed between checkpoint A and B?" without parsing two full JSONs. Also critical for `collection()` with eviction in Phase 4.3.

**RECOMMENDATION:**
```ts
Graph.diff(a: GraphDescribeOutput, b: GraphDescribeOutput) → {
  nodesAdded: string[],
  nodesRemoved: string[],
  nodesChanged: Array<{ path: string, field: string, from: unknown, to: unknown }>,
  edgesAdded: Array<{ from: string, to: string }>,
  edgesRemoved: Array<{ from: string, to: string }>,
}
```
Static method (no graph instance needed). Pure JSON comparison — straightforward to implement.

### Gap 8: Query (Filtered Describe)

**PRIORITY:** should-have
**EFFORT:** S (half day)
**JUSTIFICATION:** Large Phase 4 graphs (20–50 nodes) make full `describe()` noisy for LLM context windows. Filtering to `{ status: "errored" }` or `{ type: "state", meta: { access: "both" } }` dramatically reduces token count. The LLM can ask targeted questions instead of parsing everything.

**RECOMMENDATION:**
```ts
graph.query({ status: "errored" })                    → GraphDescribeOutput (filtered)
graph.query({ type: "state", meta: { access: "both" } })  → GraphDescribeOutput (filtered)
graph.query((node: DescribeNodeOutput) => boolean)     → GraphDescribeOutput (predicate)
```
Implemented as `describe()` + filter. Tiny wrapper, big UX win for AI consumers.

### Gap 9: Reasoning Trace

**PRIORITY:** must-have-before-Phase-4
**EFFORT:** S (half day)
**JUSTIFICATION:** Phase 4.4 (`agentLoop`, `agentMemory`) is explicitly about AI agents controlling graphs. When an AI sets a node's value, the *reason* is lost unless recorded. `annotate()` captures the "why" that `meta.description` captures for the "what." Without this, debugging an agent loop means reading LLM chat logs side-by-side with graph state — impractical.

**RECOMMENDATION:**
```ts
graph.annotate("retryLimit", "Increased from 3→5 because last 3 attempts timed out");
graph.traceLog() → TraceEntry[]  // ring buffer, chronological

type TraceEntry = {
  path: string,        // qualified path
  reason: string,
  timestamp_ns: number,
}
```
Storage: per-graph `Map<string, string>` for latest annotation + ring buffer array for chronological log. Appears in `describe()` output as `meta.__annotation` or a dedicated `annotation` field. `Graph.inspectorEnabled` gates overhead.

### Gap 10: Diagram Export

**PRIORITY:** nice-to-have
**EFFORT:** M (1–2 days for both Mermaid + D2)
**JUSTIFICATION:** Useful for documentation and visual debugging, but not blocking for Phase 4. AI agents can consume JSON; humans benefit more from diagrams. Can be added anytime.

**RECOMMENDATION:**
```ts
graph.toMermaid({ direction: "TD" }) → string
graph.toD2({ direction: "down" }) → string
```
Port from predecessor nearly line-for-line — the logic maps directly since both use `describe()` shape. Consider extracting as a separate `@graphrefly/diagram` package to avoid core bloat.

### Gap 11: Overhead Gating

**PRIORITY:** must-have-before-Phase-4
**EFFORT:** S (half day)
**JUSTIFICATION:** Phase 4 production deployments cannot afford structured observation, timeline recording, and annotation storage running by default. The predecessor's `Inspector.enabled` flag was essential — when false, `register()`, `annotate()`, timeline, and causal tracing are no-ops. Without this, users must choose between debuggability and performance.

**RECOMMENDATION:**
```ts
Graph.inspectorEnabled: boolean  // default: process.env.NODE_ENV !== "production"

// When false:
// - observe() still works (raw stream is always available — it's core protocol)
// - observe({ structured/causal/timeline: true }) returns no-op result or throws
// - annotate() is a no-op
// - traceLog() returns []
// - describe() and query() are unaffected (read-only, low cost)
```
Single boolean check at entry points. The roadmap already specs this.

### Gap 12: LLM-Specific Surface

**PRIORITY:** nice-to-have
**EFFORT:** S–M depending on scope
**JUSTIFICATION:** `describe()` JSON is already well-structured for LLM parsing — typed fields, deterministic keys, Appendix B schema. A natural-language `explain()` would add convenience but isn't necessary when the JSON schema is documented. More valuable: ensure `describe()` output fits typical LLM context windows (4K–8K tokens) for medium graphs.

**RECOMMENDATION:**
- **Don't add `graph.explain()` yet.** The JSON schema is sufficient; an LLM can be prompted with the Appendix B schema once and then consume `describe()` output reliably.
- **Do add `graph.query()` (Gap 8)** — this is the real LLM-surface win, letting agents request only what they need.
- **Consider `graph.describeCompact()`** — a reduced-token format that omits meta fields and truncates long values. Lower priority than query filtering.

---

## Summary Matrix

| Gap | Capability | Priority | Effort | Roadmap 3.3? |
|-----|-----------|----------|--------|---------------|
| 4 | Structured ObserveResult | **must-have** | M | Yes |
| 5 | Causal trace | **must-have** | M | Yes |
| 6 | Timeline | should-have | S | Yes |
| 7 | Diff | should-have | M | Yes |
| 8 | Query (filtered describe) | should-have | S | Yes |
| 9 | Reasoning trace (annotate) | **must-have** | S | Yes |
| 10 | Diagram export | nice-to-have | M | Yes |
| 11 | Overhead gating | **must-have** | S | Yes |
| 12 | LLM-specific surface | nice-to-have | S–M | No |

**Must-haves before Phase 4:** Gaps 4, 5, 9, 11 (~4–5 days total).
These are already fully spec'd in roadmap §3.3. The roadmap's sequencing is correct.

**Key architectural note:** All predecessor Inspector capabilities map cleanly onto GraphReFly's "graph IS the introspection layer" design. The predecessor used a separate static class with WeakMaps; GraphReFly integrates directly into `Graph` methods. This is the right call — it means `describe()`, `observe()`, `annotate()`, and `query()` all share the same actor/guard model, qualified path resolution, and mount traversal. No separate registration step needed.

---

## Cross-Language Parity Note (TS ↔ Py)

Both implementations currently have the same capabilities (describe + observe + snapshot/restore). The Python `GraphObserveSource` and TypeScript `GraphObserveOne`/`GraphObserveAll` are structurally equivalent. When implementing Phase 3.3 gaps, maintain parity:

- **ObserveResult** needs a Python dataclass equivalent
- **Causal trace** requires wrapping `_fn` in Python (same pattern, `__wrapped__` convention)
- **Overhead gating** in Python: class-level `inspector_enabled` attribute, checked at method entry
- **Timeline** timestamps: `time.monotonic()` in Python vs `Date.now()` in TS (document the difference)

---

## Result: API Design Decision — Extend, Don't Proliferate

**Decision:** Enhance `observe()` and `describe()` directly via options bags. No separate Inspector class, no parallel method set. Pre-1.0 — no backward compat, no legacy shims.

### `observe()` — options bag selects the view

The raw stream is the primitive. Structured/causal/timeline are views built on top of it. One entry point, options select the view.

```ts
// Raw stream (default, as today)
graph.observe("node")                          → GraphObserveOne

// Structured accumulator
graph.observe("node", { structured: true })    → ObserveResult

// Causal trace (superset of ObserveResult)
graph.observe("node", { causal: true })        → CausalResult

// Timeline (timestamped + batch context)
graph.observe("node", { timeline: true })      → TimelineResult

// Graph-wide variants — same options
graph.observe({ structured: true })            → ObserveAllResult
```

`GraphObserveOne` / `GraphObserveAll` become the `{ structured: false }` (default) case. Since we're pre-1.0, change return types freely — no deprecation dance.

### `describe()` — filter parameter, not a separate `query()`

`describe` already means "tell me about the graph" — filtering is just scoping that question.

```ts
// Full snapshot (as today)
graph.describe()

// Object filter
graph.describe({ filter: { status: "errored" } })

// Predicate filter
graph.describe({ filter: (node) => node.type === "state" })
```

No separate `graph.query()` method needed.

### New methods only where the concept is genuinely new

| Method | Rationale |
|--------|-----------|
| `graph.annotate(path, reason)` | Write operation (reasoning trace) — doesn't fit describe or observe |
| `graph.traceLog()` | Returns the annotation ring buffer — distinct from node observation |
| `Graph.diff(a, b)` | Static utility on two snapshots — no graph instance involved |
| `graph.toMermaid()` / `graph.toD2()` | Serialization format — separate concern from introspection |
| `graph.spy(path?)` | Sugar (observe + console.log) — optional convenience |

### The split rule

- **View of node activity** → `observe()` option
- **View of graph structure** → `describe()` option
- **Write or format conversion** → new method
