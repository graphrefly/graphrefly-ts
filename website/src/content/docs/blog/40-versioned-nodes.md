---
title: "Versioned Nodes, Portable State: Evolving Agent Workflows Without Rewrites"
description: "GraphReFly v0.4 ships progressive node versioning — V0 identity, V1 history — with retroactive upgrades and version-counter shortcuts for diff, checkpoint, and restore. Here's why schema evolution is the hardest part of durable agent state, and how we handle it."
date: 2026-04-21T09:00:00
authors:
  - david
tags:
  - architecture
  - persistence
  - spec-v0.4
  - schema-evolution
---

# Versioned Nodes, Portable State: Evolving Agent Workflows Without Rewrites

*Arc 7, Post 40 — NodeV0/V1 and Safe Schema Evolution*

---

Here's the scenario every team building long-running agent workflows eventually faces: you have a graph running in production, checkpointing state every few minutes. You need to change the schema — add a field, rename a key, split a node into two. And you can't afford to lose the accumulated state.

Most frameworks answer this with "write a migration script." That's fine for a database. For a reactive graph where nodes are computing functions, not tables, it's significantly more complicated.

GraphReFly v0.4 answers it differently: **node versioning is part of the protocol.**

## Two versioning levels: identity and history

The spec defines two versioning levels, each opt-in:

**V0 — identity only.** Each node gets an `id` (stable across node identity) and a `version` counter that increments on every DATA emission. V0 adds approximately 16 bytes per node. It's enough to answer "did this node's value change since I last checked?" — which powers fast-path shortcuts in diff, checkpoint, and fromSnapshot.

**V1 — full history.** Each emission gets a `cid` (content-addressed hash of the value), a `prev` pointer (the `cid` of the previous emission), and `meta` (timestamp, producer attribution). V1 enables a causally-linked history chain: you can walk backward through a node's emissions, verify content integrity, and reconstruct what happened and when.

## Progressive and opt-in

Neither V0 nor V1 is forced on you. Unversioned nodes (the default) skip the version counter entirely — zero overhead, zero ceremony.

You can opt in per-node at construction:

```typescript
const memory = node([sources], fn, { versioning: 1 }); // V1 from birth
```

Or set a **default for newly constructed nodes** (without repeating `{ versioning: … }` on every primitive). **`defaultVersioning` is not a field on `Graph` or `GraphOptions`** — it lives on **`GraphReFlyConfig`** (the object behind **`graph.config`**, usually the shared **`defaultConfig`**). **`GraphOptions` only has `versioning`**, which runs **`setVersioning(level)`** at graph construction on **nodes already registered** on that graph (often none); for the default that applies when **new** nodes are built, use **`config.defaultVersioning`**.

**`defaultVersioning` must be set before any node is created** — the config freezes on first use, and mutating it after nodes exist is not supported.

Use **`configure`** from the core module (it mutates **`defaultConfig`** safely at startup):

```typescript
import { configure, Graph } from "@graphrefly/graphrefly";

configure((cfg) => {
  cfg.defaultVersioning = 0;
});

const graph = new Graph("agent");
```

If you need an **isolated** `GraphReFlyConfig` (for example parallel tests), instantiate **`new GraphReFlyConfig({ onMessage, onSubscribe, defaultVersioning: 0 })`** — the constructor requires the same protocol hook pair as **`defaultConfig`** — and pass **`new Graph("agent", { config })`**. That graph does not share the singleton.

To raise the floor for **every node already registered** on a graph, use bulk `setVersioning` — it takes a **level only** (not a path) and applies monotonically to each current node:

```typescript
graph.setVersioning(1); // minimum V1 for all nodes registered so far
```

There is no per-path `setVersioning("memory", …)` on the container: a single node is versioned by passing `{ versioning: … }` when you construct it, by **`defaultVersioning`** on the config (via **`configure`** or a dedicated **`GraphReFlyConfig`**), or by **`graph.setVersioning(level)`** for a bulk bump.

The upgrade is monotonic — you can only bump upward (V0 → V1, never V1 → V0). The existing identity is preserved. The V0 version counter continues incrementing. V1 adds the cid chain on top.

## Retroactive upgrades: `_applyVersioning`

The most interesting case is upgrading a node that's already running — mid-production, without a restart.

Internally, `NodeImpl._applyVersioning` implements the bump; you invoke it through **`graph.setVersioning(level)`** (bulk) or by constructing a node with `{ versioning: … }`. When a V0 node is upgraded to V1, the cid chain starts fresh. The first V1 emission has `prev = null` — an intentional fresh root. There's no synthetic history fabricated for emissions that happened before versioning was attached.

Why intentional, rather than trying to back-fill? Because back-filling would be a lie. The content hashes of pre-upgrade emissions weren't computed, can't be recovered, and inserting synthetic ones would create a chain that looks authoritative but isn't. A fresh root is honest: "versioning started here."

The upgrade can only happen on a quiescent node (not mid-wave). The framework enforces this: mid-wave upgrade attempts are rejected with an error.

## V0 fast paths: skip work you don't need to do

V0's real value isn't the history chain — it's the `version` counter. A monotonic counter that increments on every DATA emission gives you a cheap change-detection signal for three expensive operations:

**Diff.** `graph.diff(snapshotA, snapshotB)` compares two snapshots. Without versioning, it deep-equals every node's value. With V0, it checks the `version` field first: if both snapshots carry the same `id + version` for a node, the value is identical — skip the deep equal. For graphs with hundreds of nodes and large payloads, this is the difference between O(n × payload_size) and O(n).

**Checkpoint.** `attachStorage` uses the graph's version counter — a counter that advances on every `add`, `remove`, and node `DATA` emission — to decide whether to write. If the counter hasn't advanced since the last write to a tier, skip the write. No hashing, no serialization, no I/O.

**fromSnapshot restore.** When `fromSnapshot` is hydrating a graph and encounters a node whose live state has the same `id + version` as the snapshot's entry, it skips the restore for that node. The node is already at the right value. This makes partial restores (after a partial failure) fast and idempotent.

## Schema evolution: what versioning enables

Node versioning is the foundation for safe schema evolution. Here's a concrete example:

You have a V1 node `"context"` that accumulates agent memory as a flat object:

```typescript
{ topics: string[]; lastSeen: Record<string, number> }
```

In the next version of your agent, you want to split this into two nodes: `"context/topics"` and `"context/activity"`.

With versioning, the migration path is:

1. The old `"context"` node's last snapshot has a `cid` and a `version`. Keep these — they're the anchor for the migration.
2. In `fromSnapshot({factories})`, register a factory for `"context"` that reads the old snapshot and emits initial values to both `"context/topics"` and `"context/activity"`.
3. The new nodes start from V1 with `prev = null` (fresh root) — they don't pretend to have history from before the migration.
4. The old `"context"` node is removed from the graph.

The key invariant: the migration is transparent to downstream nodes. They receive DATA from the new nodes exactly as they would from the old one. The version chain records the migration boundary clearly.

## Why this matters for teams evaluating long-lived agent systems

The question of schema evolution usually doesn't come up in initial evaluation. It comes up six months after deployment, when the system has been running long enough to accumulate state that can't be thrown away.

The teams that plan for this ahead of time — who ask "how do I change this graph in production without losing six months of accumulated context?" — are the teams whose agent systems survive their first major feature change.

GraphReFly's answer is in the protocol, not in a separate migration framework. Node versioning is part of how nodes describe themselves. `fromSnapshot` knows how to handle versioned nodes. The diff and checkpoint machinery uses version counters automatically.

You don't need to add schema evolution as an afterthought. It's already there.

Next: [The Diamond Race That Almost Cost 10× Retries](/blog/41-diamond-race) — a production-class harness bug and the structural fix.
