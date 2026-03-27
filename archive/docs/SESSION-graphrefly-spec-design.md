---
SESSION: graphrefly-spec-design
DATE: March 27, 2026
TOPIC: GraphReFly unified spec — protocol, single primitive (node), Graph container, cross-repo (TS + Python)
REPO: Cross-repo session (originated in callbag-recharge TS, applies to graphrefly-ts + graphrefly-py)
PREDECESSOR: callbag-recharge (TS) + callbag-recharge-py — 170+ modules, 13 categories
---

## CONTEXT

GraphReFly is the successor to callbag-recharge. The spec was designed through a structured
7-step process auditing lessons from 170+ TS modules and the Python port, then radically
simplifying the architecture.

## KEY DISCUSSION

### Strategic 7-step spec design process

0. **Lessons learned** — audited callbag-recharge TS (170+ modules, 20+ design sessions) and Python (Phase 0-1, 100+ tests) for what worked/failed/diverged
1. **Demands & gaps** — 7 demands (human+LLM co-operation, persistent graphs, inspectability, graphs-as-solutions, modularity, real-time, language-agnostic), 12 gaps identified
2. **Functionalities** — 10 concrete capabilities mapped to demands
3. **Common patterns** — 8 cross-cutting patterns (source→transform→sink, companion metadata, builder→graph, two-phase transition, boundary bridge, introspection, lifecycle propagation, scope isolation)
4. **Basic primitives** — progressively simplified from 6 → 5 → 1 primitive
5. **Nice-to-haves** — versioning (V0-V3), subgraph ops, LLM surface, observability, distribution
6. **Scenario validation** — 7 real-world scenarios stress-tested (LLM cost control, security policy, human-in-the-loop, Excel calculations, multi-agent routing, LLM graph building, git versioning)

### Simplification journey (from callbag-recharge)

| What | callbag-recharge | GraphReFly | Why |
|------|-----------------|------------|-----|
| Protocol | 4 callbag types (START=0, DATA=1, END=2, STATE=3) | Unified `[[Type, Data?], ...]` always-array | No channel separation needed with typed interfaces |
| Primitives | 6 (state, derived, dynamicDerived, producer, operator, effect) | 1 (`node`) + sugar constructors | All are variations of "node with optional deps and fn" |
| Introspection | Inspector + observe() + inspect() + knobs() + gauges() + namespace() | `Graph.describe()` + `Graph.observe()` | 2 methods replace 6+ concepts |
| Metadata | `with*()` wrappers (withStatus, withBreaker, etc.) | `meta` companion stores on every node | Each meta key is subscribable |
| Control points | Separate Knob/Gauge types | Metadata on existing nodes | No new types needed |
| Edge transforms | Considered `connect(a, b, { transform })` | Pure wire edges only | Everything is a node |
| Namespacing | namespace() utility, GraphRegistry | Colon-delimited paths (`system:payment:validate`) | String parsing, no extra primitives |
| Termination | END (overloaded: clean + error) | COMPLETE + ERROR (explicit) | No ambiguity |

### Core architectural decisions

#### 1. One primitive: `node(deps?, fn?, opts?)`
Behavior determined by configuration:
- No deps, no fn → manual source (sugar: `state()`)
- No deps, with fn → auto source (sugar: `producer()`)
- Deps, fn returns value → reactive compute (sugar: `derived()`)
- Deps, fn uses `down()` → full protocol (sugar: `operator()`)
- Deps, fn returns nothing → side effect (sugar: `effect()`)

#### 2. Unified node interface
```
node.get()          — cached value (never errors, even disconnected)
node.status         — "disconnected" | "dirty" | "settled" | "resolved" | "completed" | "errored"
node.down(msgs)     — send downstream: [[DATA, value]]
node.up(msgs)       — send upstream: [[PAUSE, lockId]]
node.unsubscribe()  — disconnect from deps
node.meta           — companion stores (each key subscribable)
```

#### 3. Always-array message format
No single-message shorthand. Always `[[Type, Data?], ...]`:
```
[[DATA, 42]]
[[DIRTY], [DATA, 42]]
[[PAUSE, lockId]]
[[RESUME, lockId], [DATA, "resumed"]]
```

#### 4. Meta as companion stores
```js
node(deps, fn, { meta: { status: "idle", error: null } })
// node.meta.status.get() → "idle"
// subscribe(node.meta.status, cb) → reactive
```

#### 5. Graph container
Named, inspectable, composable. Colon-delimited namespace. Pure wire edges. `describe()` for structure, `observe()` for live stream. Lifecycle signals propagate through mount hierarchy.

### Vision

GraphReFly = reactive graph protocol where human + LLM are peers operating on the same graph.
- Both read any node (get, describe)
- Both write to writable nodes (down, set)
- Both observe changes (subscribe, observe)
- Both build/extend graphs (add, mount, connect)
- Graphs are persistent, versionable, git-diffable artifacts
- Every node inspectable, traceable, accountable
- ~8 concepts for an LLM to learn, enough to build anything

### Lessons carried from callbag-recharge

**Validated patterns (keep):**
- Two-phase push (DIRTY→DATA) for glitch-free diamonds
- RESOLVED transitive cascade
- Explicit deps (not implicit tracking)
- Output slot (null→fn→Set) optimization
- Batch defers DATA not DIRTY
- Control flows through graph, not around it
- Composition over configuration

**Anti-patterns (never again):**
- Split channels for data vs control
- Silent operator dedup
- Monolithic config objects
- Internal Promise APIs
- Signal names that don't match behavior
- Lifecycle as imperative bypass
- Transforms on edges

## REJECTED ALTERNATIVES

- **Keep callbag 4-type system** — unnecessary with typed interfaces
- **Separate DATA/CONTROL channels** — unified tuples simpler
- **5+ separate primitives** — all variations of one concept
- **Separate Knob/Gauge types** — just metadata on nodes
- **dynamicDerived as primitive** — Python lesson: declare superset, track at runtime
- **get() pull-recomputes** — return cached, status tells truth
- **Transforms on edges** — everything is a node
- **Separate Inspector** — Graph.describe/observe covers it
- **Single-message format option** — always array eliminates branching
- **Evolve callbag-recharge** — too different, clean break needed

## KEY INSIGHTS

1. The 5-6 callbag-recharge primitives were implementation categories, not conceptual. A node is a node.
2. Meta-as-companion-stores unifies all `with*()` patterns into one concept.
3. Always-array `[[Type, Data?], ...]` eliminates all single-vs-batch branching.
4. Dropping callbag's integer types is strictly better with modern type systems.
5. `get()` should never error — it's a cache read. `status` is the truth.
6. The spec fits ~350 lines. ~8 concepts to build anything.
7. Name: GraphReFly — graph + re (reactive, review, reusable) + fly (lightweight, fast).

## FILES CREATED / CHANGED

**graphrefly-ts:**
- `docs/GRAPHREFLY-SPEC.md` — the unified spec (v0.1.0 draft)
- `docs/roadmap.md` — implementation roadmap
- `archive/docs/SESSION-graphrefly-spec-design.md` — this session
- `archive/docs/DESIGN-ARCHIVE-INDEX.md` — design archive index

**graphrefly-py:**
- (to be created with mirrored spec)

**callbag-recharge (TS):**
- `REFLOW-SPEC.md` — original draft (superseded by graphrefly spec)
- `src/archive/docs/SESSION-reflow-spec-design.md` — original design session
- `src/archive/docs/DESIGN-ARCHIVE-INDEX.md` — updated with reflow session

---END SESSION---
