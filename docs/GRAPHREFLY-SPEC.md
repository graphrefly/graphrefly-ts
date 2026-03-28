# GraphReFly Spec v0.1

> Reactive graph protocol for human + LLM co-operation.
>
> **graph** — the universal container. **re** — reactive, review, reusable. **fly** — lightweight, fast.

This spec defines the protocol, primitives, and container that both `graphrefly-ts` and
`graphrefly-py` implement. Language-specific ergonomics (syntax, concurrency model, type
encoding) are implementation choices — the spec defines **behavior**.

---

## 1. Message Protocol

### 1.1 Format

All communication between nodes uses a single format: **an array of messages**, where each
message is a tuple `[Type, Data?]`. Always an array of tuples — no single-message shorthand.

```
Messages = [[Type, Data?], ...]
```

Examples:

```
[[DATA, 42]]                                    — single value
[[DIRTY], [DATA, 42]]                           — two-phase update
[[DIRTY], [RESOLVED]]                           — unchanged after dirty
[[DATA, "a"], [DATA, "b"], [COMPLETE]]          — burst + close
[[PAUSE, lockId]]                               — pause with lock
[[RESUME, lockId], [DATA, "resumed"]]           — resume + value
[[ERROR, err]]                                  — error termination
```

### 1.2 Message Types

| Type | Data | Purpose |
|------|------|---------|
| `DATA` | value | Value delivery |
| `DIRTY` | — | Phase 1: value about to change |
| `RESOLVED` | — | Phase 2 alt: was dirty, value unchanged |
| `INVALIDATE` | — | Clear cached state, don't auto-emit |
| `PAUSE` | lockId? | Suspend activity |
| `RESUME` | lockId? | Resume after pause |
| `TEARDOWN` | — | Permanent cleanup, release resources |
| `COMPLETE` | — | Clean termination |
| `ERROR` | error | Error termination |

The message type set is open. Implementations MAY define additional types. Nodes MUST forward
message types they don't recognize — this ensures forward compatibility.

### 1.3 Protocol Invariants

1. **DIRTY precedes DATA or RESOLVED.** Within the same batch, `[DIRTY]` comes before
   `[DATA, v]` or `[RESOLVED]`. Receiving DATA without prior DIRTY is valid for raw/external
   sources (compatibility path).

2. **Two-phase push.** Phase 1 (DIRTY) propagates through the entire graph before phase 2
   (DATA/RESOLVED) begins. Guarantees glitch-free diamond resolution.

3. **RESOLVED enables transitive skip.** If a node recomputes and finds its value unchanged,
   it sends `[RESOLVED]` instead of `[DATA, v]`. Downstream nodes skip recompute entirely.

4. **COMPLETE and ERROR are terminal.** After either, no further messages from that node.
   A node MAY be resubscribable (opt-in), in which case a new subscription starts fresh.

5. **Effect nodes complete when ALL deps complete.** Not ANY. Matches combineLatest semantics.

6. **Unknown message types forward unchanged.** Forward compatibility.

7. **Batch defers DATA, not DIRTY.** Inside a batch, DIRTY propagates immediately. DATA is
   deferred until batch exits. Dirty state established across the graph before recomputation.

### 1.4 Directions

Messages flow in two directions:

- **down** — downstream from source toward sinks (DATA, DIRTY, RESOLVED, COMPLETE, ERROR)
- **up** — upstream from sink toward source (PAUSE, RESUME, INVALIDATE, TEARDOWN)

Both directions use the same `[[Type, Data?], ...]` format.

---

## 2. Node

One primitive. A node is a node.

### 2.1 Construction

```
node(deps?, fn?, opts?)
```

What a node does depends on what you give it:

| Config | Behavior | Sugar name |
|--------|----------|------------|
| No deps, no fn | Manual source. User calls `.down()` to emit | `state()` |
| No deps, with fn | Auto source. fn runs, emits via actions | `producer()` |
| Deps, fn returns value | Reactive compute. Recomputes on dep change | `derived()` |
| Deps, fn uses `.down()` | Full protocol access, custom transform | `operator()` |
| Deps, fn returns nothing | Side effect, graph leaf | `effect()` |
| Deps, no fn | Passthrough wire | `subscribe()` |

These sugar names are convenience constructors. They all create nodes. Implementations SHOULD
provide them for ergonomics and readability. They are not separate types.

### 2.2 Interface

Every node exposes:

```
node.get()              → cached value (never errors, even when disconnected)
node.status             → "disconnected" | "dirty" | "settled" | "resolved" |
                          "completed" | "errored"
node.down(messages)     → send messages downstream: [[DATA, value]]
node.up(messages)       → send messages upstream: [[PAUSE, lockId]]
node.unsubscribe()      → disconnect from upstream deps
node.meta               → companion stores (each key is a subscribable node)
```

Source nodes (no deps) do not have `.up()` or `.unsubscribe()` — there is nothing upstream.

#### get()

Returns the cached value. Does NOT guarantee freshness. Check `status` to determine trust:

| Status | Meaning | Trust level |
|--------|---------|-------------|
| `disconnected` | Not connected to deps | Stale — last known value |
| `dirty` | DIRTY received, waiting for DATA | Stale — update incoming |
| `settled` | DATA received, value current | Fresh |
| `resolved` | Was dirty, value confirmed unchanged | Fresh |
| `completed` | Terminal: clean completion | Final value |
| `errored` | Terminal: error occurred | Last good value |

Implementations MAY pull-recompute on `get()` when disconnected, but the spec does not
require it. `get()` never throws.

#### down(messages)

Send messages downstream to all subscribers. For source nodes, this is the primary emit
mechanism:

```
node.down([[DATA, 42]])                         — emit value
node.down([[DIRTY], [DATA, 42]])                — two-phase emit
node.down([[COMPLETE]])                         — terminate
```

For compute nodes (with deps and fn), `down()` is available for explicit protocol control
(operator pattern). For pure compute (derived pattern), the node auto-emits based on fn
return value — `down()` is not typically called directly.

#### up(messages)

Send messages upstream toward dependencies:

```
node.up([[PAUSE, lockId]])                      — pause upstream
node.up([[RESUME, lockId]])                     — resume upstream
node.up([[TEARDOWN]])                           — request teardown
```

Only available on nodes that have deps.

#### unsubscribe()

Disconnect this node from its upstream dependencies. The node retains its cached value
(accessible via `get()`) but status becomes `"disconnected"`. May reconnect on next
downstream subscription (lazy reconnect).

### 2.3 Meta (Companion Stores)

`meta` is an object where each key is itself a subscribable node. This replaces all
`with*()` wrapper patterns.

```
const n = node(deps, fn, {
  meta: { status: "idle", error: null, latency: 0 }
})

n.meta.status.get()              // "idle"
n.meta.error.get()               // null

// Subscribe to a single meta field reactively
subscribe(n.meta.error, (err) => alert(err))

// Update meta (from inside fn, or externally)
n.meta.status.down([[DATA, "loading"]])
```

Common meta fields:

| Field | Type | Purpose |
|-------|------|---------|
| `description` | string | Human/LLM-readable purpose |
| `type` | string | Value type hint: "string", "number", "boolean", "enum" |
| `range` | [min, max] | Valid range for numeric values |
| `values` | string[] | Valid values for enums |
| `format` | string | Display format: "currency", "percentage", "status" |
| `access` | string | Who can write: "human", "llm", "both", "system" |
| `tags` | string[] | Categorization |
| `unit` | string | Measurement unit |

Because meta fields are nodes, they appear in `describe()` output and are individually
observable via `observe()`.

### 2.4 Node fn Contract

When a node has deps and fn:

```
node(deps, fn, opts?)
```

`fn` receives the current values of deps. Its return value determines behavior:

- **Returns a value:** node caches it, emits `[[DIRTY], [DATA, value]]` if changed, or
  `[[DIRTY], [RESOLVED]]` if unchanged per `equals`.
- **Returns nothing (undefined/None):** treated as side effect. No auto-emit.
- **Uses `down()` explicitly:** full protocol control. No auto-emit from return value.
- **Returns a cleanup function:** called before next invocation or on teardown.
- **Throws:** emits `[[ERROR, err]]` to downstream subscribers.

### 2.5 Options

All nodes accept these options:

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `name` | string | — | Identifier for graph registration |
| `equals` | (a, b) → bool | `Object.is` / `is` | Custom equality for RESOLVED check |
| `initial` | any | undefined | Initial cached value |
| `meta` | object | — | Companion store fields |
| `resubscribable` | bool | false | Allow reconnection after COMPLETE |
| `resetOnTeardown` | bool | false | Clear cached value on TEARDOWN |
| `onMessage` | fn | — | Custom message type handler (see §2.6) |

### 2.6 Custom Message Handling (`onMessage`)

The message type set is open (§1.2). Nodes forward unrecognized types by default. The
`onMessage` option lets a node **intercept** specific message types before the default
dispatch:

```
node(deps, fn, {
  onMessage(msg, depIndex, actions) {
    // msg:      the message tuple [Type, Data?]
    // depIndex: which dep sent it
    // actions:  { down(), emit(), up() } — same as fn receives
    //
    // Return true  → message consumed, skip default handling
    // Return false → message not handled, proceed with default dispatch
  }
})
```

`onMessage` is called **for every message** from every dep — including DIRTY, DATA,
RESOLVED, COMPLETE, etc. This gives full control. However, intercepting protocol messages
(DIRTY, DATA, RESOLVED) can break two-phase invariants; users SHOULD only intercept
custom types unless they fully understand the protocol.

When `onMessage` returns `true`:
- The message is consumed. It is NOT forwarded downstream.
- The default dispatch (dirty tracking, settlement, forwarding) is skipped for that message.
- The handler MAY call `actions.down()` or `actions.emit()` to produce downstream output.

When `onMessage` returns `false` (or is not set):
- The default dispatch runs: DIRTY/DATA/RESOLVED drive the settlement cycle, unknown
  types forward unchanged (§1.3.6).

When `onMessage` throws:
- The exception is caught by the node. The node emits `[[ERROR, err]]` downstream
  (same behavior as fn throwing — §2.4). No further messages from that dep batch are
  processed.

Example — intercepting a custom `ESCROW_LOCKED` type:

```
// TS
const ESCROW_LOCKED = Symbol.for("web3/ESCROW_LOCKED");

const handler = node([escrowSource], computeFn, {
  onMessage(msg, depIndex, actions) {
    if (msg[0] === ESCROW_LOCKED) {
      actions.emit({ status: "locked", tx: msg[1] });
      return true;
    }
    return false;
  }
});

// Python
ESCROW_LOCKED = "ESCROW_LOCKED"

def handle_escrow(msg, dep_index, actions):
    if msg[0] == ESCROW_LOCKED:
        actions.emit({"status": "locked", "tx": msg[1]})
        return True
    return False

handler = node([escrow_source], compute_fn, on_message=handle_escrow)
```

Nodes without `onMessage` forward all unrecognized types unchanged — the spec default
(§1.3.6) is preserved.

### 2.7 Diamond Resolution

When a node depends on multiple deps that share an upstream ancestor:

```
    A
   / \
  B   C
   \ /
    D       ← D depends on [B, C], both depend on A
```

1. A changes → `[DIRTY]` propagates to B and C → both propagate `[DIRTY]` to D
2. D's bitmask records: dep 0 dirty, dep 1 dirty (needs both to settle)
3. B settles (DATA or RESOLVED) → D records dep 0 settled
4. C settles (DATA or RESOLVED) → D records dep 1 settled → D now recomputes

D recomputes exactly once, with both deps settled. This is the glitch-free guarantee.

### 2.8 Sugar Constructors

Implementations SHOULD provide these for readability:

```
state(initial, opts?)           = node([], null, { initial, ...opts })
producer(fn, opts?)             = node([], fn, opts)
derived(deps, fn, opts?)        = node(deps, fn, opts)         // fn returns value
operator(deps, fn, opts?)       = node(deps, fn, opts)         // fn uses down()
effect(deps, fn)                = node(deps, fn)               // fn returns nothing
subscribe(dep, callback)        = node([dep], callback)        // single dep shorthand
```

These are not distinct types. `describe()` MAY report them by sugar name for readability
based on the node's configuration (has deps? fn returns value? etc.).

---

## 3. Graph

The container that organizes nodes into a named, inspectable, composable artifact.

### 3.1 Construction

```
Graph(name, opts?)
```

A graph is a named collection of nodes with explicit edges.

### 3.2 Node Management

```
graph.add(name, node)           — register a node with a local name
graph.remove(name)              — unregister and teardown
graph.get(name)                 — get a node's current value (shorthand for graph.node(name).get())
graph.set(name, value)          — set a writable node's value (shorthand for down([[DATA, v]]))
graph.node(name)                — get the node object itself
```

### 3.3 Edges

```
graph.connect(fromName, toName) — wire output of one node as input to another
graph.disconnect(fromName, toName)
```

Edges are pure wires. No transforms on edges. If you need a transform, add a node in between.
This keeps edges trivially serializable and the graph topology fully visible.

### 3.4 Composition

```
graph.mount(name, childGraph)   — embed a child graph as a subgraph
```

Mounting makes child nodes addressable under the parent's namespace. Lifecycle signals
propagate from parent to mounted children.

### 3.5 Namespace

Colon-delimited paths. No separate namespace primitive.

```
"system"                        — root graph
"system:payment"                — mounted subgraph
"system:payment:validate"       — node within subgraph
```

Rules:
- Mount automatically prepends parent scope
- Within a graph, use local names (`"validate"`)
- Cross-subgraph references use relative paths from the shared parent
- `graph.resolve(path)` → the actual node

### 3.6 Introspection

Two methods replace all introspection needs. No separate Inspector.

#### describe()

Static structure snapshot. Returns JSON.

```json
{
  "name": "payment_flow",
  "nodes": {
    "retry_limit": {
      "type": "state",
      "status": "settled",
      "value": 3,
      "deps": [],
      "meta": {
        "description": "Max retry attempts",
        "type": "integer",
        "range": [1, 10],
        "access": "both"
      }
    },
    "validate": {
      "type": "derived",
      "status": "settled",
      "value": true,
      "deps": ["input"],
      "meta": { "description": "Validates payment data" }
    }
  },
  "edges": [
    { "from": "input", "to": "validate" },
    { "from": "validate", "to": "charge" }
  ],
  "subgraphs": ["email"]
}
```

Knobs = writable nodes with meta (filter by `type: "state"` or writable nodes with meta).
Gauges = readable nodes with meta (filter by nodes that have `meta.description` or `meta.format`).
No separate knob/gauge API — `describe()` is the single source.

The `type` field in describe output is inferred from node configuration:
- No deps, no fn → `"state"`
- No deps, with fn → `"producer"`
- Deps, fn returns value → `"derived"`
- Deps, fn uses down() → `"operator"`
- Deps, fn returns nothing → `"effect"`

#### observe(name?)

Live message stream. Returns a subscribable source.

```
graph.observe("validate")       — messages from one node
graph.observe()                 — messages from all nodes, prefixed with node name
```

For testing:
```
const obs = graph.observe("myNode")
// Receives: [[DIRTY], [DATA, 42]], [[DIRTY], [RESOLVED]], etc.
```

This replaces Inspector.observe(). The Graph IS the introspection layer.

### 3.7 Lifecycle

```
graph.signal(messages)          — send to all nodes: e.g. [[PAUSE, lockId]]
graph.destroy()                 — send [[TEARDOWN]] to all nodes, cleanup
```

### 3.8 Persistence

```
graph.snapshot()                — serialize: structure + current values → JSON
graph.restore(data)             — rebuild state from snapshot
Graph.fromSnapshot(data)        — construct new graph from snapshot
graph.toJSON()                  — deterministic JSON-serializable snapshot (sorted keys)
graph.toJSONString()            — optional: UTF-8 text + stable newlines (git-versionable)
```

Snapshots capture **wiring and state values**, not computation functions. The fn lives in
code. The snapshot captures which nodes exist, how they're connected, their current values,
and their meta.

Same state → same JSON bytes → git can diff.

**ECMAScript:** `JSON.stringify(graph)` calls `toJSON()`; that hook **must** return a plain
object (not an already-stringified JSON string) or the output is double-encoded. Use
`toJSONString()` (or `JSON.stringify(graph)` after a sorted `toJSON()` return) for
deterministic text.

---

## 4. Utilities

### 4.1 pipe

Linear composition shorthand.

```
pipe(source, op1, op2, ...)     — returns the final node in the chain
```

Pipe creates a chain of nodes. It does not create a Graph — use `graph.add()` to register
piped chains if you want them named and inspectable.

### 4.2 batch

Defers DATA phase across multiple writes.

```
// TS
batch(() => {
  a.down([[DATA, 1]])
  b.down([[DATA, 2]])
})

// Python
with batch():
    a.down([[DATA, 1]])
    b.down([[DATA, 2]])
```

DIRTY propagates immediately for both. DATA deferred until batch exits. Downstream nodes
recompute once, not twice.

---

## 5. Design Principles

### 5.1 Control flows through the graph, not around it

Lifecycle events propagate as messages through graph topology. Never as imperative calls
that bypass the graph. If a new node needs registering in a flat list for lifecycle
management, the design is wrong.

### 5.2 Signal names must match behavior

When semantics diverge from names, rename the signal. Don't change correct behavior to
match a misleading name. (RESET → INVALIDATE.)

### 5.3 Nodes are transparent by default

Nodes forward messages they don't recognize. Deduplication is opt-in (`equals` option or
distinctUntilChanged), not default. No silent swallowing.

### 5.4 High-level APIs speak domain language

Higher layers (orchestration, messaging, AI) use domain terms. Protocol internals are
accessible via `inner` or `.node()` when needed, but the surface API never mentions
DIRTY, RESOLVED, bitmask, etc.

### 5.5 Composition over configuration

Prefer `pipe(source, withRetry(3), withTimeout(5000))` over
`source({ retries: 3, timeout: 5000 })`. Each concern is a separate node.

### 5.6 Everything is a node

Transforms on edges? Add a node. Conditional routing? Add a node. The graph has one kind
of thing (nodes) connected by one kind of thing (edges).

### 5.7 Graphs are artifacts

A graph can be snapshotted, versioned, restored, shared, and composed. It persists beyond
the process that created it. It represents a solution.

---

## 6. Implementation Guidance

### 6.1 Language-Specific Adaptations

| Aspect | Guidance |
|--------|----------|
| Message types | TS: Symbol or string enum. Python: Enum class. |
| Pipe syntax | TS: `pipe(a, op)`. Python: `a \| op` or `pipe(a, op)`. |
| Batch syntax | TS: callback. Python: context manager. |
| Resource cleanup | TS: `.unsubscribe()`. Python: context manager + `.unsubscribe()`. |
| Concurrency | TS: single-threaded. Python: per-subgraph locks. |

### 6.2 Output Slot Optimization

Recommended subscriber storage: `null → single sink → Set<sink>`. Saves ~90% memory for
typical graphs where 70-80% of nodes have 0-1 subscribers. Implementation optimization,
not a spec requirement.

### 6.3 Single-Dep Optimization

When a node has exactly one dep in an unbatched path, implementations MAY skip the DIRTY
message and send DATA directly. The semantic guarantee (DIRTY precedes DATA) is preserved
within batched contexts. This is a performance optimization — the spec does not require it.

### 6.4 Graph Factory Pattern

Domain builders return Graph objects:

```
pipeline("payment", { ... })     → Graph   // orchestration
jobQueue("emails", { ... })      → Graph   // messaging
agentMemory("ctx", { ... })      → Graph   // AI

// All share: .describe(), .observe(), .signal(), .snapshot()
```

The builder provides ergonomic construction. The Graph provides uniform introspection,
lifecycle, persistence, and composition.

---

## 7. Node Versioning (Progressive, Optional)

| Level | Fields | Cost | Enables |
|-------|--------|------|---------|
| V0 | id, version | ~16 bytes | Identity, change detection |
| V1 | + cid, prev | ~60 bytes | Content addressing, linked history |
| V2 | + schema | ~40 bytes | Type validation, migration |
| V3 | + caps, refs | ~80 bytes | Access control, cross-graph references |

V0 is recommended minimum. Higher levels are opt-in.

---

## 8. Spec Versioning

Follows semver:
- **Patch** (0.1.x): clarifications, examples
- **Minor** (0.x.0): new optional features, new message types
- **Major** (x.0.0): breaking changes to protocol or primitive contracts

Current: **v0.1.0** (draft)

---

## Appendix A: Message Type Reference

```
DATA          [DATA, value]           Value delivery
DIRTY         [DIRTY]                 Phase 1: about to change
RESOLVED      [RESOLVED]              Phase 2: unchanged
INVALIDATE    [INVALIDATE]            Clear cache
PAUSE         [PAUSE, lockId?]        Suspend
RESUME        [RESUME, lockId?]       Resume
TEARDOWN      [TEARDOWN]              Permanent end
COMPLETE      [COMPLETE]              Clean termination
ERROR         [ERROR, err]            Error termination
```

## Appendix B: describe() JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "required": ["name", "nodes", "edges"],
  "properties": {
    "name": { "type": "string" },
    "nodes": {
      "type": "object",
      "additionalProperties": {
        "type": "object",
        "required": ["type", "status"],
        "properties": {
          "type": {
            "type": "string",
            "enum": ["state", "derived", "producer", "operator", "effect"]
          },
          "status": {
            "type": "string",
            "enum": ["disconnected", "dirty", "settled", "resolved", "completed", "errored"]
          },
          "value": {},
          "deps": {
            "type": "array",
            "items": { "type": "string" }
          },
          "meta": { "type": "object" }
        }
      }
    },
    "edges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["from", "to"],
        "properties": {
          "from": { "type": "string" },
          "to": { "type": "string" }
        }
      }
    },
    "subgraphs": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

## Appendix C: Scenario Validation

| Scenario | How it works |
|----------|-------------|
| LLM cost control | `state` (knob via meta) → `derived` chain → gauges via meta |
| Security policy | `state` + `derived` + `effect` with PAUSE propagation |
| Human-in-the-loop | Two `state` nodes (human + LLM) → `derived` gate → `effect` |
| Excel calculations | `state` inputs → `derived` formulas → gauges via meta |
| Multi-agent routing | `Graph.mount` + `connect` across subgraphs |
| LLM builds graph | `Graph.fromSnapshot` + `describe()` for introspection |
| Git-versioned graphs | `JSON.stringify(graph)` or `graph.toJSONString()` → deterministic, diffable |
| Custom domain signals | User-defined message types + `onMessage` to intercept; unhandled types forward through graph |
