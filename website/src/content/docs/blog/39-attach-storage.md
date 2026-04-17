---
title: "Durable, Attachable, Vendor-Neutral: How attachStorage Ends Checkpoint Sprawl"
description: "GraphReFly v0.4 collapses autoCheckpoint, AutoCheckpointAdapter, checkpoint.ts, and tieredStorage into one primitive: graph.attachStorage(tiers). Here's the design, the implementation choices, and why vendor-neutrality was non-negotiable."
date: 2026-04-20T09:00:00
authors:
  - david
tags:
  - architecture
  - persistence
  - spec-v0.4
  - durability
---

# Durable, Attachable, Vendor-Neutral: How attachStorage Ends Checkpoint Sprawl

*Arc 7, Post 39 — Persistence Unification*

---

If you've built a production system that needs to survive restarts — a long-running agent loop, a multi-day automation, a reactive workflow that accumulates state over time — you've faced the same question: where do I persist the state, and how do I make it fast?

The standard answer is a tiered approach: a fast in-memory tier for immediate recovery, a durable on-disk tier for cross-restart persistence, maybe a remote tier for cross-machine availability. Simple in principle, messy in practice — especially when the persistence layer is scattered across multiple abstractions that don't quite fit together.

In GraphReFly v0.4, we collapsed everything into one primitive.

## The sprawl problem

Before v0.4, GraphReFly had five persistence-related APIs:

- `graph.autoCheckpoint(opts)` — triggered saves on DATA/RESOLVED waves
- `AutoCheckpointAdapter` — a class you'd implement to provide the storage backend
- `checkpoint.ts` — operator-level checkpoint utilities
- `tieredStorage` — a helper for cascading saves across tiers
- `saveGraphCheckpointIndexedDb` / `restoreGraphCheckpointIndexedDb` — IndexedDB-specific helpers

Each had a different interface. Each had different semantics for what triggered a save, how tiers interacted, and how restore worked. Using all of them together required reading five different APIs and understanding how they composed.

The root cause was accretion: each API had been added when a specific use case was needed, without stepping back to ask what the minimal orthogonal primitives were.

## The single primitive: `StorageTier`

A `StorageTier` is one thing: a named object with a `save` method and a `load` method.

```typescript
interface StorageTier {
  save(key: string, record: GraphCheckpointRecord): void | Promise<void>;
  load(key: string): GraphCheckpointRecord | undefined | Promise<GraphCheckpointRecord | undefined>;
}
```

That's it. The `save` return type is `void | Promise<void>` — synchronous tiers stay zero-microtask (no `await` on every write); callers that `await` a sync tier's save get a no-op resolve immediately.

The built-in factories cover the common backends:

```typescript
// In-memory (fastest, not durable across restarts)
memoryStorage()

// Dictionary object (useful for tests and SSR hydration)
dictStorage(obj)

// Local filesystem (Node.js)
fileStorage(dir)

// SQLite (Node.js, via better-sqlite3)
sqliteStorage(path)

// IndexedDB (browser)
indexedDbStorage(spec)
```

Every factory returns a `StorageTier`. They're composable because they share the same interface.

## `attachStorage`: the graph-level API

`graph.attachStorage(tiers, opts?)` is the entry point for everything:

```typescript
// Cold boot: restore from storage, then attach
const graph = await Graph.fromStorage("my-graph", [
  memoryStorage(),
  fileStorage("./checkpoints"),
]);

// Hot attach to a running graph
graph.attachStorage([
  memoryStorage(),
  fileStorage("./checkpoints"),
], { autoRestore: true });
```

`attachStorage` does several things that previously required manual coordination:

1. **Cascading restore** — tries each tier in order until it finds a snapshot. Fast tiers (memory) get warmed on first restore. Slow tiers (file, SQLite) are only hit if faster tiers miss.

2. **Tier-aware saves** — each tier can be configured with a debounce delay. The memory tier saves synchronously on every checkpoint trigger. The file tier debounces to batch small graphs of writes. The remote tier debounces more aggressively. Tiers don't need to know about each other.

3. **Fingerprint deduplication** — before writing, `attachStorage` checks whether the graph state has actually changed since the last write to that tier. V0 version counters (the same mechanism powering [fast diff and fromSnapshot shortcuts](/blog/40-versioned-nodes)) make this check O(1): compare counter, skip write if unchanged.

4. **Tier-local snapshots** — each tier memoizes the snapshot it last wrote. When a write triggers, the tier's memoized snapshot is the baseline; the live graph produces a new snapshot only if the version counter has advanced.

## The autoRestore path

A common pattern in long-running agent systems: start the application, immediately try to restore from the last checkpoint, then continue if successful or start fresh if not.

```typescript
const graph = new Graph("agent-state");

// Register your nodes
const memory = graph.add(agentMemoryNode, "memory");
const plan = graph.add(planningNode, "plan");

// Attach storage with auto-restore
await graph.attachStorage([
  memoryStorage(),
  fileStorage("./agent-checkpoints"),
], { autoRestore: true });

// graph.node("memory") and graph.node("plan") now hold 
// the values from the last checkpoint, if one existed
```

The `autoRestore` path uses `fromSnapshot` internally, with the same factory registry mechanism: custom node types can register factories that know how to reconstruct themselves from a serialized snapshot.

## Why vendor-neutrality was non-negotiable

The original `IndexedDB`-specific helpers bothered me. Not because IndexedDB is bad, but because the specific backend shouldn't be in the framework's API surface. If you decide to move from IndexedDB to SQLite, from SQLite to a remote API, or from file storage to a distributed cache, that should be a change in your `StorageTier` configuration, not a change in how you use GraphReFly.

The `StorageTier` interface is deliberately minimal. It doesn't know about GraphReFly's internal structure. It doesn't know about node identifiers or reactive waves. It knows how to save a record under a key and retrieve it. Everything else is the framework's responsibility.

This means you can implement a `StorageTier` backed by anything: Redis, S3, a REST API, a custom binary format. The framework will call `save` and `load`; what happens inside is your business.

```typescript
// Custom storage tier — any backend
const myRedisStorage: StorageTier = {
  async save(key, record) {
    await redis.set(key, JSON.stringify(record));
  },
  async load(key) {
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : undefined;
  },
};

graph.attachStorage([memoryStorage(), myRedisStorage]);
```

## The codec layer: wire format for tier payloads

`StorageTier.save` receives a `GraphCheckpointRecord` — a JavaScript object. But for external tiers (file, remote), you often want a binary format: smaller on disk, faster to serialize/deserialize, self-describing enough to decode without knowing the schema ahead of time.

v0.4 ships a codec registry on `GraphReFlyConfig`, a binary envelope format, and a built-in JSON codec. The envelope is self-describing: a fixed-size header carries the codec name and codec version, so the read side can select the right decoder without out-of-band negotiation.

```typescript
// snapshot({format: "bytes", codec: "json"}) → Uint8Array
// Graph.decode(bytes) → GraphCheckpointRecord
```

Custom codecs (CBOR, MessagePack, protobuf) can register on the config and participate in the same envelope scheme. The codec is a configuration choice, not an implementation dependency.

## What agent systems get from this

Long-running agent workflows have specific durability requirements:

- **Fast recovery on restart** — in-memory tier covers in-process failures; file tier covers process restarts.
- **No checkpoint sprawl** — one API, one restore path, one configuration surface.
- **Reproducible snapshots** — the same graph state always produces the same snapshot bytes (given the same codec), which means you can diff checkpoints, detect corruption, and verify restore fidelity.
- **Independent of deployment backend** — dev runs with `fileStorage`, staging with `sqliteStorage`, production with a custom remote tier. Zero code changes.

Next: [Versioned Nodes, Portable State](/blog/40-versioned-nodes) — how NodeV0/V1 make schema evolution safe.
