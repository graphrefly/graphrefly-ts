# SESSION: Web3 Integration Research + Message Type Extensibility

**Session ID:** web3-research-type-extensibility
**Date:** March 27-28, 2026
**Topic:** Exploring Web3 integration opportunities for GraphReFly and evaluating whether the TS/Py type systems support user-defined custom message types.

---

## RESEARCH: Web3 Integration Opportunities

### Context

Investigated how GraphReFly's reactive graph protocol maps onto three Web3 problem spaces:

1. **Security monitoring** — $3.4B lost to crypto exploits in 2025. Industry shifting from pre-deploy audits to runtime monitoring. GraphReFly's two-phase DIRTY/DATA propagation prevents partial-picture responses when multiple security signals arrive simultaneously.

2. **AI agent commerce** — x402 (Coinbase/Cloudflare, HTTP 402 payment protocol), ERC-8004 (agent identity/reputation), ERC-8183 (programmable escrow/jobs). 50M+ x402 transactions since May 2025. Gartner projects $15T in AI agent B2B purchases by 2028. No coordination protocol exists for multi-step agent workflows.

3. **Order management** — Web3 replaced order books with AMMs, eliminating the OMS concept. But as DeFi matures (limit orders, cross-chain ops, RWA settlement, agent hiring), stateful lifecycle tracking is needed again. Nobody has built a reactive OMS for decentralized systems.

### Key Finding

GraphReFly doesn't need new primitives for Web3. It needs:
- **Adapters** (Phase 5.2): `fromChainEvents`, `fromChainState`, `fromX402`, `toTransaction`
- **Domain graph factories** (new Phase 4.5): `securityMonitor()`, `orderGraph()`, `agentWorkflow()`
- **Custom message types**: `ESCROW_LOCKED`, `PAYMENT_REQUIRED`, `THREAT_DETECTED`, etc.

### Why Off-Chain, Not On-Chain

GraphReFly runs off-chain because on-chain environments can't support:
- DIRTY propagation (costs gas per hop)
- PAUSE/RESUME (requires expensive state serialization)
- Long-lived subscriptions (contracts are dormant between transactions)
- LLM introspection (needs off-chain `describe()` anyway)

The hybrid architecture: contracts on-chain (Solidity/Move/Rust), GraphReFly off-chain as the coordination brain.

### Smart Contract Language Landscape (2026)

| Language | Chain(s) | Safety Model | Best For |
|----------|----------|-------------|----------|
| Solidity | EVM (Ethereum + dozens) | Manual (audit-dependent) | Broadest reach, DeFi |
| Rust | Solana, Polkadot, NEAR | Compile-time ownership | High-perf, infra |
| Move | Aptos, Sui | Resource types (structural) | Asset-safety-critical |
| Vyper | EVM | Simplicity-first | Security-critical EVM modules |
| Cairo | StarkNet | ZK-native | ZK-rollup computation |

### Detailed Sketch

Full integration sketch with graph topologies: `archive/docs/SESSION-web3-integration-research.md`

---

## ANALYSIS: Message Type Extensibility

### The Spec Says "Open"

GRAPHREFLY-SPEC §1.2:
> The message type set is open. Implementations MAY define additional types. Nodes MUST
> forward message types they don't recognize — this ensures forward compatibility.

### TypeScript: Open (works today)

```typescript
// messages.ts
export type Message = readonly [symbol, unknown?];
```

Using `symbol` as the type discriminator means **any symbol works**:

```typescript
// User-defined custom message types — works today, no changes needed
const ESCROW_LOCKED = Symbol.for("web3/ESCROW_LOCKED");
const PAYMENT_REQUIRED = Symbol.for("web3/PAYMENT_REQUIRED");
const THREAT_DETECTED = Symbol.for("web3/THREAT_DETECTED");

// Valid — type system accepts any symbol
node.down([[ESCROW_LOCKED, { txHash: "0x..." }]]);
node.down([[PAYMENT_REQUIRED, { amount: 0.10, token: "USDC" }]]);
```

The `isKnownMessageType()` helper returns `false` for custom types, but node forwarding
works because the node dispatch logic forwards anything it doesn't handle. TS is spec-compliant.

### Python: Closed (type system blocks it)

```python
# protocol.py
class MessageType(StrEnum):
    DATA = "DATA"
    DIRTY = "DIRTY"
    # ... only 9 members

type Message = tuple[MessageType, Any] | tuple[MessageType]
```

Problem: `Message` requires the first element to be a `MessageType` enum member. Users
**cannot** create custom message types without modifying the enum:

```python
# This is a type error in Python
ESCROW_LOCKED = "ESCROW_LOCKED"  # str, not MessageType
node.down([(ESCROW_LOCKED, {"txHash": "0x..."})])  # type checker rejects
```

Runtime behavior may work (forwarding logic checks `MessageType` membership, not
`isinstance`), but the type system prevents users from expressing custom types correctly.

### Recommendation

Python needs to widen the `Message` type to allow `str` (or any hashable) as the first
element, matching the spec's open-set requirement:

```python
# Option A: Union type (minimal change)
type Message = tuple[MessageType | str, Any] | tuple[MessageType | str]

# Option B: Dedicated protocol (most Pythonic, most flexible)
type MessageTag = MessageType | str
type Message = tuple[MessageTag, Any] | tuple[MessageTag]
```

The `is_phase2_message()` and `partition_for_batch()` functions already check for specific
`MessageType` values, so custom types would naturally fall through to the "immediate"
(non-deferred) path — correct behavior for domain-specific signals.

TS needs no changes — `symbol` is already open.

---

## KEY INSIGHTS

1. GraphReFly's value in Web3 is as the **off-chain coordination protocol** — not competing with on-chain contracts but orchestrating them.
2. The same reactive graph model that solves security monitoring also solves order management — both are "tracking state transitions across a graph of dependent entities."
3. The TS implementation already supports the open message type set. The Python implementation has a type-system-level constraint that needs fixing.
4. The Web3 integration doesn't require any spec changes — just adapters (Phase 5.2) and domain graph factories (Phase 4.5).

---

## FILES

- `archive/docs/SESSION-web3-integration-research.md` — detailed integration sketch with graph topologies
- `archive/docs/SESSION-web3-research-and-type-extensibility.md` — this file (session log)
- `archive/docs/DESIGN-ARCHIVE-INDEX.md` — updated with both entries
