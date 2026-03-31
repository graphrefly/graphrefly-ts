---
SESSION: snapshot-hydration-design
DATE: March 30, 2026
TOPIC: Seamless snapshot/hydration — auto-checkpoint, node factory registry, and runtime persistence for reactive graphs
REPO: graphrefly-ts (primary), graphrefly (spec)
---

## CONTEXT

GraphReFly's `graph.snapshot()` / `graph.restore()` / `Graph.fromSnapshot()` (Phase 1.4) already captures structure + current values + meta. But seamless resume — closing a process and picking up exactly where you left off — requires two missing pieces:

1. **Auto-checkpoint:** Mutations persist automatically without manual `checkpoint.save()` calls.
2. **Node factory registry:** `fromSnapshot()` reconstructs dynamic graphs (runtime-added nodes) without a hardcoded `build` callback.

These are critical for:
- **Reactive issue tracker:** 50+ issues added at runtime, verifiers reattach on restore, regressions persist across sessions
- **Agent memory (`distill()`):** memory store entries survive process restarts, eviction/scoring logic reactivates
- **Security policies:** guards added/removed at runtime, policy data persists, guard fns reconstruct from persisted rules

---

## CURRENT STATE: What snapshot/restore already captures

### `graph.snapshot()` → `GraphPersistSnapshot`

Delegates to `describe()`, adds `version: 1`, sorts keys deterministically:

```json
{
  "name": "tracker",
  "version": 1,
  "nodes": {
    "issue/foo": { "type": "state", "status": "settled", "value": { "title": "...", "status": "verified" }, "deps": [], "meta": { "severity": "high" } },
    "invariant/no-promise": { "type": "derived", "status": "settled", "value": { "holds": true }, "deps": ["issue/foo", "issue/bar"], "meta": {} }
  },
  "edges": [{ "from": "issue/foo", "to": "invariant/no-promise" }],
  "subgraphs": ["sub"]
}
```

### `graph.restore(data)`

- Validates envelope (version, required keys)
- Sets values on `state` and `producer` nodes only (derived/operator/effect recompute)
- Uses `graph.set()` → triggers reactive recomputation downstream
- Skips missing paths silently

### `Graph.fromSnapshot(data, build?)`

- **With `build`:** creates empty graph → calls `build(g)` to add nodes/edges/mounts → calls `restore(data)` to hydrate values
- **Without `build`:** auto-creates state nodes and mounts only; rejects edges and non-state nodes (fns can't deserialize from JSON)

### Key insight: the split is correct

- **Values** (state, meta) → serialized in snapshot, hydrated on restore
- **Computation** (derived fns, guards, verifiers) → live in code, not serializable
- **Structure** (edges, mounts) → serialized, but derived nodes need code to reconstruct

Derived nodes don't need stored values — they recompute from restored state. This is the right design.

---

## DESIGN 1: AUTO-CHECKPOINT (reactive persistence)

### Problem

Today: `checkpoint.save(graph.snapshot())` is manual. There's a gap between "graph changed" and "snapshot on disk." For long-running graphs (tracker, agent memory, policy engine), this gap means lost state on crash.

### Pattern

Wire `observe()` → debounced save:

```typescript
const autoPersist = effect([graph.observe()], (msgs) => {
  checkpoint.save(graph.snapshot())
})
```

### Subtleties

#### 1. Debounce vs. batch boundary

Don't snapshot mid-batch. The save should fire after the batch drains and the graph is settled. Trigger on DATA/RESOLVED (not DIRTY), debounced by ~500ms–1s:

```typescript
// Filter to phase-2 messages only (graph is settled)
const settled = derived([graph.observe()], (msgs) =>
  msgs.filter(([type]) => type === DATA || type === RESOLVED)
)

// Debounce to avoid saving on every keystroke
effect([debounce(settled, 500)], () => {
  adapter.save(graph.snapshot())
})
```

#### 2. Incremental snapshots

Full `snapshot()` on every mutation is wasteful for large graphs. `Graph.diff(prev, current)` already exists (Phase 3.3). Auto-checkpoint can save diffs with periodic full snapshots:

```
mutation → diff against last snapshot → save diff
every N diffs → save full snapshot (compaction)
```

This reduces I/O from O(graph_size) per mutation to O(changed_nodes).

#### 3. Selective scoping

Not all nodes need checkpointing. Derived nodes recompute. Transient producer nodes (timers, intervals) restart. The auto-checkpoint should support a filter:

```typescript
graph.autoCheckpoint(adapter, {
  debounceMs: 500,
  filter: (name, node) => node.type === "state",  // only persist state nodes
  compactEvery: 100,  // full snapshot every 100 diffs
})
```

#### 4. Restore ordering

On resume, state nodes must restore *before* derived nodes connect, or you get a spurious recomputation wave (restored value → derived fires → another restored value → derived fires again). The current `restore()` handles this by setting all state nodes in sorted order, but auto-checkpoint must preserve this invariant — no partial restores.

### API surface

```typescript
// On Graph
graph.autoCheckpoint(adapter, opts?)  → Node<void>  // returns effect node (disposable)

// Options
interface AutoCheckpointOpts {
  debounceMs?: number        // default 500
  filter?: (name: string, described: DescribeNodeOutput) => boolean
  compactEvery?: number      // full snapshot every N diffs (default: 50)
  onError?: (err: Error) => void
}
```

Returns a `Node<void>` (the effect), so it participates in the graph lifecycle — `graph.destroy()` tears down the auto-checkpoint too.

---

## DESIGN 2: NODE FACTORY REGISTRY (auto-reconstruct without build callback)

### Problem

`fromSnapshot(data)` without a `build` callback can only create state nodes. With a `build` callback, you must manually wire everything. For dynamic graphs (tracker with N issues added at runtime, memory store growing), the `build` callback doesn't know what nodes will exist — it only knows the *types* of nodes.

### Pattern

Register factories by name pattern. The snapshot carries type info; the registry maps type+pattern to a factory that reconstructs the node:

```typescript
// Register once at app startup
Graph.registerFactory("tracker/issue/*", (name, snap) => {
  return state(snap.value, {
    name,
    guard: issueGuard,
    meta: {
      description: snap.meta?.description ?? "",
      severity: snap.meta?.severity ?? "medium",
    }
  })
})

Graph.registerFactory("tracker/invariant/*", (name, snap) => {
  // deps resolved from snap.deps by the registry
  return derived([], (deps) => ({
    holds: deps.every(d => d.status === "verified"),
    violations: deps.filter(d => d.status !== "verified"),
  }), { name, initial: snap.value })
})
```

Then `fromSnapshot` becomes:

```typescript
// No build callback needed — factories handle reconstruction
const g = Graph.fromSnapshot(snap)
// For each node in snap, looks up factory by name pattern,
// calls factory with persisted value + meta, adds to graph,
// then reconstructs edges and mounts
```

### Key design decisions

#### 1. Factory key: match by name pattern

Options considered:
- **Node `type` field** (`state`, `derived`, etc.) — too coarse; all issues are `state` but need different factories than memory entries
- **Custom `factoryKey` in meta** — works but pollutes meta with infrastructure concerns
- **Name prefix pattern** (`"tracker/issue/*"`, `"memory/*"`) — most natural for domain graphs where naming conventions are consistent

**Decision:** Name prefix pattern with glob matching. Falls back to type-based matching, then to default (state-only) behavior.

#### 2. Dep resolution order

Derived nodes need their deps. The snapshot has `deps: ["a", "b"]` as strings. The registry reconstructs nodes in **topological order** (state first, then derived), resolving dep strings to already-constructed node references:

```
1. Reconstruct all mount hierarchies (subgraphs)
2. Reconstruct state/producer nodes (no deps needed)
3. Reconstruct derived/operator/effect nodes (deps resolved to step 2 nodes)
4. Reconstruct edges
5. Call restore() to hydrate values (triggers settled recomputation)
```

#### 3. Dynamic collections

This is where the registry shines. The tracker has N issue nodes added at runtime. The snapshot has all N. The registry knows "anything matching `issue/*` uses the issue factory." On restore, all N issues reconstruct without enumerating them in a `build` callback.

```typescript
// At startup
Graph.registerFactory("issue/*", issueFactory)
Graph.registerFactory("memory/*", memoryFactory)
Graph.registerFactory("policy/*", policyFactory)

// After restart — all runtime-added nodes come back
const g = Graph.fromSnapshot(savedSnap)
// 50 issues, 200 memories, 12 policies — all reconstructed
```

#### 4. Guards and policies from data

Guard fns can't serialize, but the *policy data* can. A factory for policy nodes reconstructs the guard from persisted policy rules:

```typescript
Graph.registerFactory("policy/*", (name, snap) => {
  // snap.value = { rules: [{ action: "write", role: "admin" }] }
  return state(snap.value, {
    guard: policyFromRules(snap.value.rules)  // rebuild guard from data
  })
})
```

This means security policies can be dynamically added/removed at runtime, persisted in snapshots, and fully restored with working guard enforcement.

### API surface

```typescript
// Static methods on Graph
Graph.registerFactory(pattern: string, factory: NodeFactory)
Graph.unregisterFactory(pattern: string)
Graph.listFactories() → string[]

// Factory signature
type NodeFactory = (
  name: string,
  snapshot: { value: unknown; meta: Record<string, unknown>; deps: string[]; type: string },
) => Node<unknown>

// fromSnapshot uses registry automatically when no build callback provided
Graph.fromSnapshot(data)  // looks up factories by name pattern
Graph.fromSnapshot(data, build)  // build callback takes precedence (existing behavior)
```

### Scoping: global vs. per-graph

The registry could be:
- **Global** (`Graph.registerFactory`) — simplest, one registry for all graphs
- **Per-graph** (`graph.registerFactory`) — isolated, but can't use before graph exists (chicken-and-egg with `fromSnapshot`)
- **Both** — per-graph overrides global; `fromSnapshot` uses global since graph doesn't exist yet

**Decision:** Global registry (`Graph.registerFactory`). Per-graph override is a future extension if needed.

---

## HOW THEY COMPOSE

The two features are independent but compound powerfully:

```typescript
// 1. Register factories at app startup
Graph.registerFactory("issue/*", issueFactory)
Graph.registerFactory("memory/*", memoryFactory)
Graph.registerFactory("policy/*", policyFactory)

// 2. Restore from last checkpoint (or start fresh)
const snap = await adapter.load("tracker")
const g = snap ? Graph.fromSnapshot(snap) : buildFreshTracker()

// 3. Enable auto-checkpoint — from here on, all mutations persist
g.autoCheckpoint(adapter, { debounceMs: 500 })

// 4. Runtime: add/remove nodes freely
g.add("issue/new-bug", state({ title: "...", status: "open" }, { guard: issueGuard }))
g.remove("policy/deprecated-rule")
// → auto-checkpoint fires → snapshot saved → next restart picks up all changes
```

For the reactive issue tracker specifically:
```
Startup → fromSnapshot (registry reconstructs 50 issues, memories, policies)
        → autoCheckpoint (arm the debounced save)
        → observe() fires effects (verifiers re-arm, regression detection active)
        → runtime add/remove (new issues, policy changes)
        → auto-persist (every mutation debounced to disk)
        → crash/restart → fromSnapshot picks up exactly where we left off
```

---

## USE CASE WALKTHROUGH

### Agent memory resume

```typescript
Graph.registerFactory("memory/*", (name, snap) =>
  state(snap.value, {
    name,
    meta: { type: snap.meta?.type, extractedAt: snap.meta?.extractedAt }
  })
)

// distill() creates memories at runtime:
//   g.add("memory/pitfall-batch-drain", state({ rule: "...", why: "..." }))
//   g.add("memory/invariant-no-promise", state({ rule: "...", confidence: 1.0 }))

// Auto-checkpoint persists. On restart:
const g = Graph.fromSnapshot(saved)  // 200 memories restored
g.autoCheckpoint(adapter)            // continue persisting
// Eviction/scoring/consolidation derived nodes recompute from restored memory values
```

### Security policy hot-reload

```typescript
Graph.registerFactory("policy/*", (name, snap) =>
  state(snap.value, {
    name,
    guard: policyFromRules(snap.value.rules)
  })
)

// Runtime: admin adds a policy
g.add("policy/auditor-readonly", state(
  { rules: [{ action: "observe", role: "auditor" }] },
  { guard: policyFromRules([{ action: "observe", role: "auditor" }]) }
))

// Runtime: admin removes a policy
g.remove("policy/deprecated")

// All changes auto-checkpointed. On restart, all policies restore with guards.
```

---

## REJECTED ALTERNATIVES

### "Just serialize functions"

Functions (guards, verifiers, derived fns) could theoretically be serialized as strings and `eval()`'d. Rejected for obvious security and correctness reasons. The split (data serializes, code lives in code) is right.

### "Store factory key in snapshot metadata"

Could add a `__factory` field to snapshot nodes. Rejected because it couples the snapshot format to the registry mechanism. Name-pattern matching is decoupled — the snapshot doesn't know about factories.

### "Per-graph registry only"

Can't use before graph exists (fromSnapshot creates the graph). Global registry solves the chicken-and-egg. Per-graph override is a future extension.

### "Full snapshot on every mutation"

Wasteful for large graphs. Incremental diff + periodic compaction is better. But the initial implementation can start with full snapshots and optimize later.

---

## KEY INSIGHTS

1. **The snapshot already captures values.** The missing piece isn't what to persist — it's when (auto-checkpoint) and how to reconstruct (registry).

2. **Auto-checkpoint must fire after settlement, not during batch.** Snapshotting mid-DIRTY produces an inconsistent state. The debounce + phase-2 filter ensures consistency.

3. **The registry turns `fromSnapshot` from "restore known topology" to "restore arbitrary topology."** This is the difference between resuming a fixed pipeline and resuming a dynamic collection of runtime-added nodes.

4. **Guards reconstruct from data, not from serialized functions.** The `policyFromRules()` pattern means security policies are fully dynamic: add at runtime, persist in snapshot, restore with working enforcement.

5. **The two features compose.** Registry handles reconstruction, auto-checkpoint handles persistence. Together they give zero-friction resume for any graph that follows naming conventions.

---

## ROADMAP IMPACT

New Phase 1.4b (Seamless Persistence) in both `docs/roadmap.md` and `GRAPHREFLY-SPEC.md` §3.8.

| Item | Phase | Depends on |
|------|-------|-----------|
| `graph.autoCheckpoint(adapter, opts?)` | 1.4b | 1.4 (snapshot/restore), 3.1 (checkpoint adapters) |
| Incremental snapshots (diff-based) | 1.4b | 3.3 (`Graph.diff`) |
| `Graph.registerFactory(pattern, factory)` | 1.4b | 1.4 (fromSnapshot) |
| `Graph.fromSnapshot` registry integration | 1.4b | registry |
| Selective restore (`restore(data, { only })`) | 1.4b | 1.4 |

---

## FILES

- This file: `archive/docs/SESSION-snapshot-hydration-design.md`
- Roadmap update: `docs/roadmap.md` (Phase 1.4b)
- Spec update: `~/src/graphrefly/GRAPHREFLY-SPEC.md` (§3.8 extended)
