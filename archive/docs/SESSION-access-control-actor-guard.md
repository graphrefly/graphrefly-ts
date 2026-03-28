# SESSION: Access Control — Actor, Guard, Policy

**Session ID:** access-control-actor-guard
**Date:** March 28, 2026
**Topic:** Designing built-in ABAC access control for GraphReFly. Actor context, capability guards, declarative policy builder, and scoped introspection — replacing external authz libraries (CASL) with graph-native enforcement.

---

## CONTEXT: The Authorization Gap

The Web3 integration research (SESSION-web3-integration-research) concluded "no new primitives needed" for data flow. But every convergence scenario — AI agent commerce, security monitoring, LLM tool surfaces, human-in-the-loop approval — requires answering **"who is acting?"** and **"may they?"**

### What existed before this session

| Layer | State | Problem |
|-------|-------|---------|
| `meta.access` | String hint: `"human"`, `"llm"`, `"both"`, `"system"` | Decorative only. Not enforced. |
| V3 `caps` (Phase 6) | Undefined semantics, late roadmap | No schema, no enforcement model |
| Identity | None | No actor model — who is calling `graph.set()`? |
| Wallet/x402 | Adapter-level only | No cryptographic identity at node level |

### Why this matters now, not later

If operators (Phase 2), resilience (Phase 3), and domain layers (Phase 4) ship without actor/guard, every layer invents its own authorization:
- `withBreaker` needs "who can trip it?"
- `gate()` needs "who can approve?"
- `agentLoop()` needs "which tools can this agent use?"
- `knobsAsTools()` needs "which knobs does this LLM see?"

Retrofitting authorization into 50+ modules is worse than building it once at Phase 1.

---

## KEY DECISIONS

### 1. Three Primitives — Actor, Guard, Scoped Introspection

**Actor Context** — every mutation optionally carries an actor:

```ts
// TS
graph.set("approve", true, { actor: { type: "wallet", id: "0x..." } })
node.down([[RESUME, lockId]], { actor: { type: "human", id: "david" } })

# Python
graph.set("approve", True, actor=Actor(type="wallet", id="0x..."))
node.down([[RESUME, lock_id]], actor=Actor(type="human", id="david"))
```

Actor type: `{ type: "human" | "llm" | "wallet" | "system" | string, id: string, ...claims }`

Optional, defaults to `{ type: "system" }`. This is attribution first — the prerequisite for enforcement.

**Capability Guard** — per-node enforcement:

```ts
// TS
state(initialValue, {
  guard: (actor, action) => {
    if (action === "write") return actor.type === "wallet" && isAuthorized(actor.id)
    return true
  }
})

# Python
state(initial_value, guard=lambda actor, action: (
    actor.type == "wallet" and is_authorized(actor.id)
    if action == "write" else True
))
```

Actions: `"write"` (down/set), `"signal"` (signal), `"observe"` (describe/observe). Guard returns boolean. Throws `GuardDenied` on rejection.

**Scoped Introspection** — describe/observe filtered by actor:

```ts
graph.describe({ actor: { type: "llm", id: "agent-22" } })
// Only returns nodes where guard(actor, "observe") passes
```

### 2. Declarative Policy Builder (the CASL-style DX)

Raw guard functions are powerful but verbose. The `policy()` builder provides ergonomic rule composition:

```ts
import { policy } from "@graphrefly/graphrefly-ts"

const adminOnly = policy((allow, deny) => {
  allow("write",   { where: actor => actor.role === "admin" })
  allow("signal",  { where: actor => actor.type === "wallet" })
  allow("observe") // everyone can observe
  deny("write",    { where: actor => actor.type === "llm" })
})

state(initialValue, { guard: adminOnly })
```

RBAC is a pattern on top:

```ts
const rbac = (roles) => policy((allow) => {
  for (const [role, actions] of Object.entries(roles)) {
    for (const action of actions) {
      allow(action, { where: actor => actor.role === role })
    }
  }
})

state(value, { guard: rbac({ admin: ["write", "signal"], viewer: ["observe"] }) })
```

### 3. Attribution Built Into Mutations

Each mutation records `{ actor, timestamp }`:

```ts
node.lastMutation  // { actor: { type: "wallet", id: "0x..." }, timestamp: 1711612800000 }
```

Pulled forward from Phase 6 (was "Attribution: mutation records with actor"). Now lives in Phase 1.5.

### 4. meta.access Backward Compatibility

When a guard is present, `meta.access` is derived from it (inferred from which actor types the guard allows for "write"). When no guard is present, `meta.access` behaves as before — decorative hint.

---

## REJECTED ALTERNATIVES

### CASL as a dependency

**Considered:** Using [CASL](https://github.com/stalniy/casl) (~4.5-6KB, ABAC library) for authorization.

**Rejected because:**
- CASL solves scattered enforcement (API + UI + DB queries). GraphReFly has **one** enforcement point: `down()`/`set()`/`signal()`. The complexity of CASL's subject model, sift.js condition engine, and pack/unpack serialization is unnecessary.
- CASL's subject model requires defining domain entities (`"Post"`, `"User"`). GraphReFly nodes are already named, typed, and introspectable — the node IS the subject.
- CASL's MongoDB-style condition DSL is designed for database query translation. Node guards need plain functions.
- CASL's serialization (`packRules`/`unpackRules`) is redundant — `describe()` already serializes the graph view, `snapshot()` captures state.

**What was borrowed:** The declarative `can()`/`cannot()` builder DX → `policy((allow, deny) => ...)`.

### Middleware / interceptor pattern

**Considered:** Authorization as middleware wrapping graph methods (like Express middleware).

**Rejected because:** Middleware is compositional noise. The guard is a node option — it lives where the protection is needed. No registration order, no middleware chains, no "did I forget to add the auth middleware?"

### Separate ACL graph

**Considered:** A dedicated authorization graph that the main graph consults.

**Rejected because:** Over-engineered for most cases. A guard function can consult external state if needed (it's just a function), but the common case — role checks, type checks — should be inline.

---

## KEY INSIGHTS

1. **The graph is the enforcement point.** Unlike web apps with scattered auth checks (routes, queries, UI), every GraphReFly mutation flows through `down()`/`set()`/`signal()`. One guard per node is complete coverage.

2. **Actor context is attribution first, enforcement second.** Even without guards, knowing who changed a node is valuable for audit trails, LLM debugging ("which agent set this?"), and Web3 provenance.

3. **ABAC > RBAC at the primitive level.** The guard function IS attribute-based access control. RBAC is just a pattern: `actor.role === "admin"`. Making the primitive ABAC means no refactoring when requirements grow.

4. **Scoped introspection is the bridge to AI safety.** `knobsAsTools(graph, actor)` means an LLM agent only sees tools it's authorized to use. This is the missing piece between `describe()` (full visibility) and production agent deployments (least privilege).

5. **Web3 identity maps cleanly.** Wallet signatures, x402 payment proofs, ERC-8004 agent IDs all produce actors. The guard doesn't know or care about the identity mechanism — crypto-specific adapters are just actor providers:
   ```ts
   const actor = await walletActor(signer)      // { type: "wallet", id: "0x...", claims: {...} }
   const actor = await x402Actor(paymentProof)   // { type: "x402", id: "...", budget: 2.00 }
   graph.set("approve", true, { actor })
   ```

6. **Zero dependencies.** The policy builder is ~50 lines of code. No sift.js, no query DSL, no pack/unpack. The graph's own serialization (`describe()`, `snapshot()`) handles transport.

---

## ROADMAP CHANGES

### Added: Phase 1.5 — Actor & Guard (access control)

- `Actor` type with extensible claims
- Actor context parameter on `down()`, `set()`, `signal()`
- `guard` node option with `GuardDenied` error
- `policy()` declarative builder
- Scoped `describe(actor?)` / `observe(name?, actor?)`
- Attribution via `node.lastMutation`
- `meta.access` derived from guard (backward compat)

### Added: Phase 1.6 — Tests (expanded)

- Guard enforcement tests (allowed/denied for write, signal, observe)
- Policy builder tests (allow/deny precedence, wildcards, composition)
- Actor attribution tests (mutation records, subgraph propagation)
- Scoped describe tests (filtered output matches permissions)
- GuardDenied diagnostics tests

### Modified: Phase 5.4 — LLM tool integration

- `knobsAsTools(graph, actor?)` and `gaugesAsContext(graph, actor?)` now accept optional actor

### Modified: Phase 6 — Node Versioning

- V3 `caps` = serialized guard policy (runtime enforcement already in 1.5)
- Attribution struck — moved to Phase 1.5

---

## FILES CHANGED

- `docs/roadmap.md` — Phase 1.5 (Actor & Guard), Phase 1.6 (expanded tests), Phase 5.4 (actor param), Phase 6 (simplified)
