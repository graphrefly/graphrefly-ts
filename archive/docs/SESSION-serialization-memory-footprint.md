---
SESSION: serialization-memory-footprint
DATE: March 31, 2026
TOPIC: Adoption blockers for the universal reduction layer — memory footprint, serialization overhead, tiered representation, and why NodeV0 should move earlier in the roadmap
REPO: graphrefly-ts (primary), graphrefly-py (parity scope)
---

## CONTEXT

Follow-on from `SESSION-universal-reduction-layer.md`. The universal reduction layer thesis (massive info → reactive graph → actionable items) is compelling, but the biggest practical blockers for adoption at scale are:

1. **Runtime memory footprint** — 10K+ nodes with meta, history, closures
2. **Serialization bloat** — JSON snapshots are too large for frequent checkpoints, wire transfer, and LLM context windows
3. **Hydration latency** — restoring a persisted graph is too slow if it requires full deserialization
4. **NodeV0/V1 versioning exists in code but is unused** — `src/core/versioning.ts` defines V0 (id + version) and V1 (+ cid + prev) but nothing imports it; `snapshot()` and `describe()` produce output without versioning info

These problems form a cycle: better serialization → cheaper hydration → more aggressive eviction → lower memory → more nodes feasible → more serialization needed. They must be designed as an integrated system.

---

## SERIALIZATION: DAG-CBOR AS DEFAULT CODEC

### Decision: DAG-CBOR replaces JSON as the standard wire/checkpoint format

Predecessor research (`~/src/callbag-recharge/src/archive/docs/SESSION-universal-data-structure-research.md`) already validated DAG-CBOR as the default encoding. Reasons:

- **~40-50% smaller than JSON** — keys as short bytes, numbers as varints, no quotes
- **Deterministic encoding** — same data = same bytes. Critical for: CID computation, snapshot diffing (hash-compare without content diff), cache invalidation
- **CID links are native** — node references are first-class (CBOR tag 42), not string IDs. Matters for `peerGraph` federation where subgraphs transfer between processes
- **COSE signing/encryption at format level** — unique among formats. Relevant for Phase 1.5 Actor/Guard and compliance (`complianceSnapshot`)
- **IETF standard (RFC 8949)** — not a proprietary format

DAG-CBOR + zstd compression (another 2-5x on top) yields **~80-90% smaller than JSON** for graph snapshots.

### Size comparison for a typical node

| Format | Size | Notes |
|---|---|---|
| JSON | ~55 bytes | Keys as strings, numbers as text, quotes everywhere |
| DAG-CBOR | ~30 bytes | Keys as short bytes, varints, no quotes |
| MessagePack | ~32 bytes | Similar to DAG-CBOR but no CID support, no deterministic mode |
| Protobuf | ~20 bytes | Smallest, but needs schema at both ends, not self-describing |

For arrays of nodes (graph snapshots), savings compound because DAG-CBOR doesn't repeat key names if you use arrays-of-arrays instead of arrays-of-objects.

### Practical codec progression

1. **V0 (current):** `JSON.stringify` — works everywhere, debuggable, good enough for < 10K nodes
2. **V1 (size matters):** DAG-CBOR via `@ipld/dag-cbor` — ~40-50% smaller, deterministic (needed for CID anyway), self-describing
3. **V1.5 (speed matters):** DAG-CBOR + zstd compression — another 2-5x. Available in Node (`node:zlib`) and browsers (via wasm)

---

## TIERED REPRESENTATION

The real answer isn't "pick one format" but tiered representation based on access pattern:

```
HOT (active, human/LLM inspecting)
  → Full JS objects in memory
  → describe()/snapshot() as JSON for human/LLM readability
  → Acceptable: higher memory, lower latency

WARM (running but not inspected)
  → Compact binary in memory (DAG-CBOR or FlatBuffer)
  → Lazy hydration: decode node only when read
  → Delta checkpoints: only serialize changed nodes

COLD (persisted, dormant)
  → Columnar format (Arrow/Parquet) for batch storage
  → Full structural dedup
  → Compressed (zstd/lz4)
  → Schema-versioned for forward compat
```

Transitions between tiers can be reactive — a node that hasn't been read in N seconds demotes from hot to warm. A graph that hasn't propagated in M minutes checkpoints to cold.

### Format per tier

| Tier | Format | Role |
|------|--------|------|
| Hot | JS objects | Live reactive propagation |
| Wire/checkpoint | **DAG-CBOR** | Default codec, deterministic, CID-native |
| Analytical/cold | Arrow/Parquet | Bulk storage, ML pipelines, archival |
| Peek-without-hydrate | FlatBuffers | Read one node from a dormant graph without deserializing everything |

### FlatBuffers for zero-copy access

FlatBuffers is particularly interesting for the "peek" case: memory-map a buffer, read fields directly without deserializing. When a human isn't inspecting and a graph is dormant, you don't need to hydrate — you can read individual nodes on demand. This aligns with the "lighter when not actively inspecting" goal.

### Arrow/Parquet for analytical/cold storage

A graph snapshot as Arrow: one column for node IDs, one for values, one for types, one for deps. Each column compresses beautifully because values within a column are similar. Great for `checkpointToS3`, training-data export, and regulatory archival.

---

## MEMORY FOOTPRINT: THE BIGGEST BLOCKER

### Where memory goes (naive implementation)

```
PER NODE (estimated):
  JS object shell + hidden class        ~64 bytes
  value (varies, say avg object)        ~200 bytes
  meta companion (object + fields)      ~300 bytes
  dependency set (Set of refs)          ~100 bytes (avg 3 deps)
  listener/subscriber set               ~80 bytes
  closure for transform function        ~64 bytes
  ─────────────────────────────────────
  Total per node                        ~800 bytes

GRAPH-LEVEL:
  adjacency/topology structures         ~200 KB for 10K nodes
  reactiveLog history (if enabled)      UNBOUNDED — the real bomb
  snapshot cache (if any)               duplicates entire graph
```

10K nodes ≈ ~8 MB baseline. Manageable. But history, meta, and closures compound fast.

### Five tuning strategies

#### A. Lazy meta materialization

Don't allocate meta until someone calls `describe()` or reads `.meta`. Most nodes in a reduction pipeline are intermediate — nobody inspects them. Cuts per-node memory by ~35%.

```ts
// Lazy: allocate on first access
get meta() {
  if (!this._meta) this._meta = createMeta(this);
  return this._meta;
}
```

#### B. Structural sharing for values

When a node's new value is structurally identical to its old value, don't allocate a new object. The RESOLVED skip already avoids downstream propagation; also avoid allocating the duplicate value.

#### C. Bounded history with eviction policy

History/log should be a ring buffer, not an unbounded array:
- `reactiveLog({ maxEntries: 1000 })` — circular buffer, constant memory
- `reactiveLog({ maxAge: '30s' })` — time-based eviction
- `reactiveLog({ tier: 'warm' })` — after eviction, spill to DAG-CBOR on disk

#### D. Node pooling / struct-of-arrays for homogeneous pipelines

In reduction pipelines, thousands of nodes share the same shape. Instead of N objects with `{id, value, deps, meta}`, use one typed array per field:

```ts
ids:    Uint32Array(5000)
values: Array(5000)
deps:   Uint32Array(15000)  // packed adjacency list
// meta: only allocate for nodes that are inspected
```

Cuts per-node overhead from ~800 bytes to ~50 bytes for structural parts. V8 loves typed arrays — no per-element headers, no hidden class transitions, GC barely touches them.

#### E. Dormant subgraph eviction

If a subgraph hasn't propagated in N seconds and nobody holds a reference to its output, serialize to DAG-CBOR buffer and release JS objects. Re-hydrate on next read.

**This is the link between serialization and memory.** Faster/cheaper serialization → more aggressive eviction → lower memory.

- JSON parse of 5 MB → keep things in memory longer → more memory
- DAG-CBOR decode of 1.5 MB → evict aggressively → less memory
- FlatBuffers zero-copy → evict immediately → minimal memory

---

## IMPACT ON MESSAGE TRANSFER AND HYDRATION

### Message transfer (cross-process via peerGraph)

| Format | Per-message | At 100K/sec | Notes |
|---|---|---|---|
| JSON | ~500 bytes | **50 MB/sec** | |
| DAG-CBOR | ~250 bytes | **25 MB/sec** | |
| DAG-CBOR + delta | ~80 bytes | **8 MB/sec** | Only changed fields |
| DAG-CBOR + delta + zstd batch | ~20 bytes eff. | **2 MB/sec** | Batch 100, compress |

25x reduction. Difference between "needs dedicated link" and "fits in normal traffic."

### Graph hydration (cold start / dormant wake)

| Format | 10K-node size | Parse time | Notes |
|---|---|---|---|
| JSON | 5-50 MB | 50-500 ms | Full parse, all objects allocated |
| DAG-CBOR | 2-25 MB | 20-200 ms | Binary decode, faster |
| DAG-CBOR + lazy | same on disk | **<5 ms to ready** | Decode on first access |
| FlatBuffers | 2-20 MB | **~0 ms** | Zero-copy mmap |

Lazy/zero-copy: don't hydrate the entire graph to start using it. Propagate immediately, decode as touched. Most nodes in a dormant graph may never be decoded.

### Delta checkpoints

Track dirty nodes via bitset (from propagation tracking), serialize only deltas, append to WAL, periodic full snapshot for compaction.

At steady state (50 nodes changing/sec out of 10K), each checkpoint is ~12 KB of DAG-CBOR instead of 5 MB full-graph JSON. **~400x smaller.** Checkpoint every second without meaningful I/O.

---

## NODEV0 PLACEMENT: WHY IT SHOULD MOVE EARLIER

### Current state

`src/core/versioning.ts` defines V0 (id + version) and V1 (+ cid + prev). **Nothing imports it.** Phase 6 in the roadmap is the first time versioning is mentioned.

### The problem

Without V0, the current system:

1. **Cannot do delta checkpoints** — no version counter to know "what changed since last checkpoint." `describe()` produces a full snapshot every time. `Graph.diff()` exists but compares two full snapshots — O(graph_size) not O(changes).
2. **Cannot do deterministic CID for snapshots** — `snapshot()` does key-sorting for determinism but hashes nothing. You can't hash-compare two snapshots without serializing both and doing byte comparison.
3. **Cannot do wire-efficient peerGraph** — without per-node version counters, you can't send "only nodes with version > X" to a peer. Must send everything.
4. **Cannot do efficient hydration skip** — FlatBuffers zero-copy needs a way to know "is this node stale?" Version counter is the cheapest way.

### callbag-recharge precedent

In callbag-recharge, NodeV0 was Level 3 (data structures), not Level 4 (persistence). The strategic plan explicitly states:

> NodeV0 overhead is just two fields (`id: string`, `version: number`) — negligible

And the success metric was:

> NodeV0 adds < 5% overhead to existing callbag-recharge operations

NodeV0 was placed early because it's the **minimum enabler for serialization, diffing, and identity** — all of which are needed before you can do any of the tiered representation, delta checkpoints, or dormant eviction described above.

### Why it's useful for AI functions

NodeV0 makes nodes **diff-friendly**:
- `id` gives stable identity across snapshots (not positional like `describe()` output)
- `version` gives cheap change detection ("has this node changed since I last read it?")
- LLMs reading `describe()` output can track which nodes changed between turns by comparing version numbers instead of diffing values
- `Graph.diff()` can use version counters to skip unchanged nodes — O(changes) not O(graph_size)

### Recommendation

Move NodeV0 from Phase 6 to **Phase 3.x or earlier**, as a prerequisite for:
- Phase 8.5 (delta checkpoints, backpressure, sharding)
- Phase 5.2c/d (ingest/sink adapters — wire efficiency)
- Phase 5.3+ (peerGraph — requires per-node versioning for sync)
- The tiered representation system described in this session

NodeV1 (CID + prev) can stay in Phase 6 — it's opt-in and has real compute cost (hashing). But V0 is effectively free and unblocks everything.

---

## ROADMAP ADDITIONS

### GraphCodec interface (Phase 8.5 or earlier)

Pluggable serialization, not hardcoded JSON:
- `GraphCodec` interface: `encode(snapshot) → Uint8Array`, `decode(buffer) → snapshot`
- Default: JSON (human-readable)
- Shipped codecs: DAG-CBOR, DAG-CBOR+zstd
- Extension points: FlatBuffers, Arrow

### Delta checkpoint as core primitive

- `graph.checkpoint()` returns only changes since last checkpoint (requires NodeV0 version counters)
- Append-only WAL + periodic full snapshot compaction
- More impactful than any format choice alone

### Lazy hydration

- `Graph.fromBuffer(buf)` doesn't decode everything upfront
- Nodes decode on first access
- FlatBuffers/DAG-CBOR make this nearly free

### Dormant subgraph eviction

- Configurable per-graph: `graph.setEvictionPolicy({ idleTimeout: '30s', tier: 'warm' })`
- Serialization format determines re-materialization cost
- Meta not materialized unless inspected

---

## REJECTED ALTERNATIVES

### "Just use MessagePack instead of DAG-CBOR"
- No deterministic encoding mode → can't hash-compare snapshots
- No CID links → node references are strings, not first-class
- No COSE signing → no format-level security
- DAG-CBOR was already validated in callbag-recharge research

### "Use Protobuf for everything"
- Smallest wire size, but requires schema at both ends — not self-describing
- Schema evolution (field numbers) is painful for a dynamic graph where topology changes at runtime
- No CID support
- Good for specific high-throughput sinks, not as a general codec

### "Don't bother with tiered representation — just use one format"
- A single format can't optimize for all access patterns
- Hot path needs JS objects (zero-overhead reads)
- Cold path needs columnar compression (10-100x smaller)
- Wire path needs deterministic binary (CID + delta)

### "Memory isn't a real problem — just use more RAM"
- True for servers, fatal for edge devices, browser tabs, and embedded contexts
- The reduction layer thesis includes lightweight deployment ("no agent binary, no collector sidecar") — this requires memory discipline
- GC pressure at 100K msgs/sec is a real perf concern even with plenty of RAM

---

## KEY INSIGHTS

1. **Serialization, memory, and hydration form a cycle.** Better serialization → cheaper hydration → more aggressive eviction → lower memory → more nodes feasible → more serialization needed. Must be designed as an integrated tier system.

2. **DAG-CBOR is the right default codec — already validated.** It replaces JSON as the standard wire/checkpoint format. Combined with zstd, 80-90% smaller than JSON.

3. **NodeV0 is the minimum enabler for everything.** Delta checkpoints, wire-efficient sync, LLM-friendly diffing, dormant eviction — all require per-node id + version. It's effectively free (<5% overhead) and should move much earlier in the roadmap.

4. **Lazy meta materialization is the single biggest memory win.** Most nodes in a reduction pipeline are intermediate — nobody inspects them. Not allocating meta until accessed cuts per-node memory by ~35%.

5. **The link between serialization and memory is hydration cost.** If re-materializing a node is cheap (DAG-CBOR decode or FlatBuffers zero-copy), you can evict aggressively. If it's expensive (JSON parse), you keep things in memory "just in case." Cheap hydration unlocks low memory.

6. **Delta checkpoints are more impactful than any format choice.** At steady state, ~0.5% of nodes change per checkpoint cycle. Sending 0.5% of the data is a 200x win regardless of whether that 0.5% is JSON or CBOR.

7. **FlatBuffers zero-copy is the endgame for dormant graphs.** mmap the buffer, read fields directly, never allocate JS objects. The graph is "running" in the sense that it can be queried, but uses near-zero JS heap.

---

## RELATED SESSIONS

- `SESSION-universal-reduction-layer.md` — the thesis this session supports
- `SESSION-snapshot-hydration-design.md` — auto-checkpoint, incremental snapshots, factory registry
- `SESSION-universal-data-structure-research.md` (callbag-recharge) — DAG-CBOR validation, NodeV0-V2 design
- `SESSION-level3-strategic-plan.md` (callbag-recharge) — NodeV0 as Level 3, performance firewall between V0 and V1
- `SESSION-agentic-memory-research.md` — distillation pipeline, budgeted context, memory lifecycle

## FILES

- This file: `archive/docs/SESSION-serialization-memory-footprint.md`
- Existing versioning code: `src/core/versioning.ts` (V0 + V1 types, unused)
- Python companion: `~/src/graphrefly-py/archive/docs/SESSION-serialization-memory-footprint.md`
