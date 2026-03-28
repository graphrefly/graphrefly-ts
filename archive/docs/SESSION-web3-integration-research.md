# GraphReFly + Web3: Integration Sketch

> Research document — March 2026
>
> **Status:** exploratory draft, not spec
>
> **Context:** How GraphReFly's reactive graph protocol maps onto Web3 security
> monitoring, AI agent commerce (x402/ERC-8004/ERC-8183), and the missing "order
> management" layer for decentralized systems.

---

## 1. The Three Web3 Problems GraphReFly Solves

### 1.1 Security Monitoring (reactive defense)

**Problem:** $3.4B+ lost to crypto exploits in 2025. The industry is shifting from
"audit before deploy" to "monitor in real-time." Current monitoring tools (Hypernative,
Forta, etc.) use ad-hoc event listeners and bot scripts — no unified reactive state
propagation model.

**What breaks without a protocol:** When an oracle price feed deviates, a bot detects
it and fires an alert. Meanwhile, a separate bot watches the same feed for liquidation
risk. A third watches for flash loan patterns. They don't share state. They duplicate
RPC calls. They can contradict each other. When multiple signals arrive simultaneously
(e.g., oracle deviation + unusual approval + large transfer), there's no mechanism to
ensure all monitors see the full picture before any of them act.

**GraphReFly fit:** Two-phase DIRTY/DATA ensures all monitoring nodes see that
"something changed" (DIRTY) before any of them act on the change (DATA). Batch
semantics prevent partial-picture responses. RESOLVED skips unnecessary re-evaluation
when a price moves but stays within safe bounds.

### 1.2 AI Agent Commerce (coordination)

**Problem:** AI agents can now pay each other autonomously (x402), verify identity
(ERC-8004), and hire each other (ERC-8183). But there's no coordination protocol for
multi-step agent workflows. When Agent A hires Agent B and Agent C for a task, who
ensures both are ready before the job starts? Who handles partial failure? Who prevents
double-payment?

**GraphReFly fit:** This is exactly the graph coordination problem. Agent states are
nodes. Job lifecycle is message propagation. PAUSE/RESUME handles payment confirmation
latency. Two-phase prevents race conditions in multi-agent quorums.

### 1.3 Order Management (lifecycle tracking)

**Problem:** Web3 replaced order books with AMMs for simple swaps, so "order
management" seemed unnecessary. But as DeFi matures — limit orders (dYdX, Jupiter,
Uniswap v4 hooks), cross-chain operations, RWA settlement, agent-to-agent hiring — the
need for stateful lifecycle tracking is back. Nobody has built a reactive OMS for
decentralized systems.

**GraphReFly fit:** An order's lifecycle is a graph of state transitions with
dependencies, exactly what GraphReFly models. Each order stage is a node. Validation,
inventory, payment, and fulfillment are computed nodes. The graph handles partial fills
(multiple DATA), no-ops (RESOLVED), failures (ERROR), and cancellations (TEARDOWN).

---

## 2. Where This Fits in the Roadmap

### Phase 5.2 — Adapters (new entries)

```
fromChainEvents(provider, filters)   — EVM event log subscription → source node
fromChainState(provider, calls)      — periodic/reactive contract reads → source node
fromX402(endpoint, opts)             — x402 payment channel → source node
toTransaction(signer, opts)          — effect node that submits on-chain transactions
```

These are pure adapters — they don't know about DeFi, security, or OMS. They just
bridge on-chain data into the reactive graph and bridge graph decisions back on-chain.

### Phase 4.5 — Web3 Domain Layer (new section)

Graph factories that return `Graph` objects with Web3-specific topology:

```
securityMonitor(name, opts)      → Graph   // on-chain state → risk graph → alerts
orderGraph(name, opts)           → Graph   // order lifecycle management
agentWorkflow(name, opts)        → Graph   // multi-agent coordination (x402/ERC-8183)
```

All share: `.describe()`, `.observe()`, `.signal()`, `.snapshot()` — the uniform Graph
interface means any Web3 graph is introspectable by LLMs, serializable for audits, and
composable with non-Web3 graphs.

### Phase 6 — Node Versioning (V3 is critical for Web3)

V3 adds `caps` (access control) and `refs` (cross-graph references). For Web3:
- `caps` maps to on-chain permissions (who can trigger this node?)
- `refs` maps to cross-chain references (this node depends on state on another chain)

---

## 3. Concrete Graph Sketches

### 3.1 Security Monitor Graph

```
securityMonitor("uniswap-v4-pool", {
  chains: ["ethereum", "arbitrum"],
  contracts: {
    pool:   { address: "0x...", events: ["Swap", "Mint", "Burn"] },
    oracle: { address: "0x...", events: ["AnswerUpdated"] },
  },
  thresholds: {
    priceDeviation: 0.05,    // 5% deviation triggers alert
    volumeSpike: 3.0,        // 3x normal volume
    flashLoanSize: 1000000,  // $1M+ flash loan
  },
})
```

**Internal graph topology:**

```
┌─────────────────────────────────────────────────────────┐
│ securityMonitor("uniswap-v4-pool")                      │
│                                                         │
│  Sources (fromChainEvents):                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ swap_log │  │ oracle   │  │ approval │              │
│  │ (state)  │  │ (state)  │  │ (state)  │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  Derived (risk calculators):                            │
│       ▼              ▼              ▼                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ price    │  │ oracle   │  │ access   │              │
│  │ impact   │  │ deviation│  │ anomaly  │              │
│  │(derived) │  │(derived) │  │(derived) │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  Aggregator (diamond — waits for all):                  │
│       └──────────────┼──────────────┘                    │
│                      ▼                                   │
│               ┌────────────┐                             │
│               │ threat     │                             │
│               │ score      │ ← RESOLVED if score unchanged│
│               │ (derived)  │                             │
│               └──────┬─────┘                             │
│                      │                                   │
│  Actions:            ▼                                   │
│               ┌────────────┐                             │
│               │ response   │ ← PAUSE if score < critical │
│               │ (effect)   │ ← triggers circuit breaker  │
│               └────────────┘   if score >= critical      │
│                                                         │
│  Meta gauges on each node:                              │
│    threat_score.meta.format = "percentage"              │
│    threat_score.meta.range = [0, 100]                   │
│    response.meta.description = "Circuit breaker action" │
│    response.meta.access = "system"                      │
└─────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- When a Swap event arrives, `swap_log` emits `[[DIRTY], [DATA, event]]`
- DIRTY propagates through `price_impact` → `threat_score` → `response`
- `threat_score` is a diamond node (depends on all three risk calculators)
- It waits for ALL three to settle before recomputing (glitch-free)
- If threat_score doesn't change, RESOLVED propagates — `response` does nothing
- If threat_score crosses critical threshold, `response` submits a pause transaction
- `graph.observe("threat_score")` gives a live feed for dashboards
- `graph.describe()` gives LLMs full visibility into the monitoring topology

### 3.2 Order Lifecycle Graph

```
orderGraph("cross-chain-swap", {
  legs: [
    { chain: "ethereum", action: "sell", token: "USDC", amount: 10000 },
    { chain: "arbitrum", action: "buy",  token: "ARB",  amount: null }, // market
  ],
  limits: { slippage: 0.01, deadline: 300 }, // 1% slippage, 5min deadline
})
```

**Internal graph topology:**

```
┌─────────────────────────────────────────────────────────┐
│ orderGraph("cross-chain-swap")                          │
│                                                         │
│  ┌──────────┐                                           │
│  │ order    │ ← state node, receives the order intent   │
│  │ (state)  │                                           │
│  └────┬─────┘                                           │
│       │                                                 │
│       ▼                                                 │
│  ┌──────────┐   ┌──────────┐                            │
│  │ validate │   │ price    │ ← fromChainState (live)    │
│  │(derived) │   │ feed     │                            │
│  └────┬─────┘   │ (state)  │                            │
│       │         └────┬─────┘                            │
│       │              │                                  │
│       └──────┬───────┘                                  │
│              ▼                                          │
│        ┌──────────┐                                     │
│        │ quote    │ ← computes expected output          │
│        │(derived) │   RESOLVED if price hasn't moved    │
│        └────┬─────┘   enough to change the quote        │
│             │                                           │
│             ▼                                           │
│        ┌──────────┐                                     │
│        │ approve  │ ← PAUSE: awaits human/agent RESUME  │
│        │ (gate)   │   for orders above threshold        │
│        └────┬─────┘                                     │
│             │                                           │
│     ┌───────┴───────┐                                   │
│     ▼               ▼                                   │
│ ┌────────┐    ┌────────┐                                │
│ │ leg_1  │    │ leg_2  │ ← each leg is a subgraph       │
│ │ (eth)  │    │ (arb)  │   mounted via graph.mount()    │
│ └───┬────┘    └───┬────┘                                │
│     │             │                                     │
│     └──────┬──────┘                                     │
│            ▼                                            │
│      ┌──────────┐                                       │
│      │ settle   │ ← diamond: waits for BOTH legs        │
│      │(derived) │   ERROR if either leg fails           │
│      └────┬─────┘   COMPLETE when both confirm          │
│           │                                             │
│           ▼                                             │
│      ┌──────────┐                                       │
│      │ receipt  │ ← effect: emits final confirmation    │
│      │ (effect) │   updates meta with tx hashes         │
│      └──────────┘                                       │
│                                                         │
│  Order status via meta:                                 │
│    order.meta.status:    "pending" | "quoted" |          │
│                          "approved" | "executing" |      │
│                          "settling" | "completed" |      │
│                          "failed" | "cancelled"          │
│    order.meta.fill_pct:  0.0 → 1.0                      │
│    order.meta.tx_hashes: { leg1: "0x...", leg2: "0x..." }│
└─────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- PAUSE at the `approve` gate for human-in-the-loop on large orders
- `quote` uses RESOLVED when price moves but quote stays within slippage — avoids
  unnecessary re-approval
- `settle` is a diamond node across both legs — prevents partial settlement
- If leg_1 succeeds but leg_2 fails, ERROR propagates and leg_1 can attempt rollback
- `graph.snapshot()` captures the full order state — resumable after crash
- `graph.describe()` lets an LLM explain "why is this order stuck?" by reading the
  topology and status of each node

### 3.3 AI Agent Workflow Graph (x402 + ERC-8004 + ERC-8183)

```
agentWorkflow("data-analysis-job", {
  requester: { agentId: 22, registry: "0x..." },  // ERC-8004
  tasks: [
    { role: "data_provider", budget: 0.50 },       // x402 micropayment
    { role: "analyst",       budget: 2.00 },
    { role: "reviewer",      budget: 0.50 },
  ],
  escrow: { contract: "0x...", standard: "ERC-8183" },
})
```

**Internal graph topology:**

```
┌──────────────────────────────────────────────────────────┐
│ agentWorkflow("data-analysis-job")                       │
│                                                          │
│  ┌───────────┐                                           │
│  │ job_spec  │ ← state: the job definition               │
│  │ (state)   │                                           │
│  └─────┬─────┘                                           │
│        │                                                 │
│        ▼                                                 │
│  ┌───────────┐   ┌────────────┐                          │
│  │ identity  │   │ reputation │ ← fromChainState:        │
│  │ verify    │   │ check      │   reads ERC-8004 registry│
│  │ (derived) │   │ (derived)  │                          │
│  └─────┬─────┘   └──────┬─────┘                          │
│        │                │                                │
│        └────────┬───────┘                                │
│                 ▼                                        │
│           ┌──────────┐                                   │
│           │ escrow   │ ← effect: locks funds via         │
│           │ lock     │   ERC-8183 Job contract           │
│           │ (effect) │   PAUSE until tx confirms         │
│           └────┬─────┘                                   │
│                │ RESUME (escrow confirmed)                │
│                ▼                                         │
│  ┌─────────────────────────────────────┐                 │
│  │  task execution (mounted subgraphs) │                 │
│  │                                     │                 │
│  │  ┌──────────┐  x402   ┌──────────┐ │                 │
│  │  │ data     │ ──pay──▶│ data     │ │                 │
│  │  │ request  │         │ delivery │ │                 │
│  │  │ (effect) │         │ (state)  │ │                 │
│  │  └──────────┘         └────┬─────┘ │                 │
│  │                            │       │                 │
│  │                            ▼       │                 │
│  │  ┌──────────┐  x402   ┌──────────┐ │                 │
│  │  │ analysis │ ──pay──▶│ analysis │ │                 │
│  │  │ request  │         │ result   │ │                 │
│  │  │ (effect) │         │ (state)  │ │                 │
│  │  └──────────┘         └────┬─────┘ │                 │
│  │                            │       │                 │
│  │                            ▼       │                 │
│  │  ┌──────────┐  x402   ┌──────────┐ │                 │
│  │  │ review   │ ──pay──▶│ review   │ │                 │
│  │  │ request  │         │ verdict  │ │                 │
│  │  │ (effect) │         │ (state)  │ │                 │
│  │  └──────────┘         └──────────┘ │                 │
│  └─────────────────────────────────────┘                 │
│                 │                                        │
│                 ▼                                        │
│           ┌──────────┐                                   │
│           │ escrow   │ ← effect: releases funds or       │
│           │ release  │   triggers dispute based on        │
│           │ (effect) │   review verdict                   │
│           └────┬─────┘                                   │
│                │                                         │
│                ▼                                         │
│           ┌──────────┐                                   │
│           │ complete │ ← COMPLETE propagates to all      │
│           │ (effect) │                                   │
│           └──────────┘                                   │
│                                                          │
│  Meta:                                                   │
│    job_spec.meta.budget_remaining = 2.40                  │
│    job_spec.meta.tasks_completed = 1                      │
│    job_spec.meta.escrow_status = "locked"                 │
└──────────────────────────────────────────────────────────┘
```

**Key behaviors:**
- Identity + reputation checks run in parallel (diamond resolves both before escrow)
- Escrow lock uses PAUSE/RESUME: graph halts until on-chain confirmation
- Each task is sequential (data → analysis → review) but tasks internally can be
  parallelized via mounted subgraphs
- x402 payments are effect nodes — they fire and receive confirmation
- If the reviewer rejects, the graph can route to dispute resolution (conditional edge
  via a derived gate node)
- `graph.snapshot()` captures the full job state — if an agent crashes mid-workflow,
  another can resume from snapshot
- `graph.describe()` lets any agent or human inspect "what stage is this job at?"

---

## 4. Custom Message Types for Web3

The spec's open message type set (§1.2: "The message type set is open") enables
domain-specific signals without breaking existing nodes:

| Message Type | Data | Direction | Purpose |
|-------------|------|-----------|---------|
| `ESCROW_LOCKED` | txHash | down | ERC-8183 escrow confirmed on-chain |
| `ESCROW_RELEASED` | txHash | down | Funds released to agent |
| `PAYMENT_REQUIRED` | {amount, token, recipient} | down | x402 payment needed |
| `PAYMENT_CONFIRMED` | txHash | down | x402 payment settled |
| `IDENTITY_VERIFIED` | {agentId, score} | down | ERC-8004 check passed |
| `THREAT_DETECTED` | {level, vector, evidence} | down | Security alert |
| `CIRCUIT_BREAK` | {reason, duration} | down | Emergency pause |
| `REORG_DETECTED` | {depth, chainId} | down | Chain reorganization |

Per spec §1.3.6: nodes that don't recognize these forward them unchanged. A security
monitor graph can emit `[THREAT_DETECTED, ...]` and any downstream graph — even one
built without security awareness — will propagate it faithfully.

---

## 5. Why Not On-Chain?

GraphReFly runs off-chain because:

| Concern | Off-chain | On-chain |
|---------|-----------|----------|
| DIRTY propagation | Free (in-process) | ~2,600 gas per hop minimum |
| PAUSE/RESUME | Native (event loop) | ~20,000 gas per state slot write |
| Graph of 50 nodes | Microseconds | ~500,000+ gas (~$5-50 per update) |
| Snapshot/restore | JSON serialize | Prohibitively expensive storage |
| LLM introspection | `describe()` → prompt | Would need off-chain read anyway |

The contracts stay on-chain (Solidity/Move/Rust). GraphReFly is the **off-chain
coordination brain** that reads on-chain state and submits transactions when the graph
decides to act. This is the same architecture as Hypernative, Reactive Network's
off-chain monitoring, and every DeFi keeper bot — but with a proper reactive protocol
instead of ad-hoc scripts.

---

## 6. Comparison: GraphReFly vs. Existing Web3 Approaches

| Approach | State Model | Coordination | Failure Handling |
|----------|------------|-------------|-----------------|
| **Keeper bots** | Per-bot, no sharing | None (race each other) | Retry loops |
| **The Graph (indexer)** | Read-only subgraphs | Query-based, not reactive | Reindex |
| **Reactive Network** | On-chain Solidity | Cross-chain hooks | Revert |
| **Forta/Hypernative** | Proprietary monitoring | Alert-based, no state graph | Manual escalation |
| **GraphReFly** | Reactive node graph | Two-phase, glitch-free | PAUSE/ERROR/TEARDOWN lifecycle |

GraphReFly's advantage: it's the only approach that gives you **glitch-free multi-source
coordination** (diamond resolution), **lifecycle semantics** (PAUSE/RESUME/TEARDOWN),
**composability** (mount subgraphs), and **LLM introspection** (`describe()`/`observe()`)
in a single protocol.

---

## 7. Relationship to Existing Roadmap

| Roadmap Item | Web3 Relevance |
|-------------|---------------|
| Phase 1: Graph container | Required — all Web3 graphs need `describe()`, `snapshot()`, `mount()` |
| Phase 2: Operators | `switchMap` for chain reorgs, `debounce` for noisy feeds, `throttle` for rate-limited RPCs |
| Phase 3.1: `withBreaker` | Direct fit — circuit breaker for on-chain actions |
| Phase 3.1: `retry`, `backoff` | Direct fit — transaction retry with gas bumping |
| Phase 3.2: `reactiveMap` | Token balance tracking (KV with TTL for stale state) |
| Phase 4.1: Orchestration | `gate()`, `approval()` map to PAUSE/RESUME approval flows |
| Phase 4.4: AI surface | `agentLoop()` + x402 = autonomous agent commerce |
| Phase 5.2: Adapters | `fromChainEvents`, `fromChainState`, `toTransaction` needed |
| Phase 6: V3 versioning | `caps` = on-chain permissions, `refs` = cross-chain state |

The Web3 integration doesn't require new primitives. It requires **adapters** (Phase 5.2)
and **domain graph factories** (new Phase 4.5). Everything else — two-phase propagation,
diamond resolution, PAUSE/RESUME, batch, RESOLVED, meta — already exists in the spec.

---

## 8. Next Steps

1. **Phase 1 first** — Graph container is prerequisite for all Web3 work (mount,
   describe, snapshot are critical)
2. **Prototype `fromChainEvents`** — simplest adapter, proves the concept with a live
   Ethereum node
3. **Build a security monitor demo** — most compelling proof-of-concept, quantifiable
   value ($3.4B lost)
4. **Engage with Reactive Network / Hypernative** — potential integration partners who
   would benefit from a proper reactive protocol
5. **Write an EIP or spec extension** — position GraphReFly as the off-chain
   coordination standard for agent workflows
