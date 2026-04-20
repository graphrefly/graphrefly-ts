---
SESSION: competitive-landscape-self-evolution
DATE: April 20, 2026
TOPIC: Competitive research (Evolver, Hermes Agent, OpenAI Agents SDK, QMD, xiaohongshu structured-output post), multi-agent handoff patterns, self-evolution landscape, 6-block README simplification
REPO: graphrefly-ts (primary), graphrefly (spec — COMPOSITION-GUIDE updated)
---

## CONTEXT

Research sprint triggered by discovering five external sources. Goal: understand what the self-evolution/harness-engineering ecosystem looks like in April 2026, identify what GraphReFly already covers vs what's novel, and formalize new patterns as composition recipes.

**Sources researched:**
- Evolver/EvoMap (github.com/EvoMap/evolver) — GEP-powered self-evolution engine, 22.5k stars
- Hermes Agent (github.com/nousresearch/hermes-agent) — self-improving CLI agent by Nous Research
- OpenAI Agents SDK (github.com/openai/openai-agents-python) — official agent framework, 23.8k stars
- QMD (github.com/tobi/qmd) — local hybrid search engine by Tobi Lütke, 22.5k stars
- Xiaohongshu post — 6-layer structured output defense for agent development

---

## KEY FINDINGS

### 1. Market convergence on self-improving agents

Three independent projects (Evolver, Hermes, GraphReFly) landed on nearly identical architecture in early 2026: closed learning loop + reusable artifacts + safety boundaries + multi-agent sharing. The vocabulary differs but the structure is isomorphic.

### 2. GraphReFly's position

- **vs Evolver:** Evolver is a prompt generator only (half of REFLECT without EXECUTE/VERIFY). No reactive coordination, no composability.
- **vs Hermes:** Monolithic end-user product. Memory is 2 flat files. Skills are markdown. Non-composable. Can't be embedded.
- **vs OpenAI SDK:** No learning loop. Static guardrails. Imperative handoffs. OpenAI-centric.
- **vs QMD:** Complementary retrieval infrastructure, not a competitor.

### 3. GraphReFly already covers the substrate

| Requirement | Already shipped |
|---|---|
| Learning loop | INTAKE→TRIAGE→QUEUE→GATE→EXECUTE→VERIFY→REFLECT + strategy model |
| Reusable artifacts | Catalog entries (typed GraphSpec) + domain templates |
| Safety | policyEnforcer + ABAC + valve + gate + budgetGate |
| Multi-agent | TopicGraph + SubscriptionGraph + promptNode routing |
| Memory | agentMemory (vector + KG + decay + distill + tiers) |
| Observability | describe() + observe() + graphProfile() + explainPath + auditTrail |

---

## DECISIONS

### New COMPOSITION-GUIDE sections added (§29–§31)

1. **§29: Multi-agent handoff pattern** — full handoff vs agent-as-tool, wiring examples, context transfer, mapping to harness stages
2. **§30: Parallel guardrail pattern** — optimistic execution + cancel via gatedStream/switchMap/AbortSignal, three execution modes
3. **§31: Dynamic tool selection** — reactive toolSelector node, composable constraints, relation to tool interception

### New optimizations.md items (6 total)

1. Multi-agent handoff primitive (composition recipe)
2. Dynamic tool selector node (reactive tool availability)
3. Parallel guardrail pattern (documentation)
4. Hierarchical context tree for agentMemory retrieval
5. Auto-solidify pattern (VERIFY success → catalog entry promotion)
6. Frozen context optimization (prefix-cache-friendly prompt composition)

### README restructured: 8 rows → 6 building blocks

| Block | Covers |
|---|---|
| `agentMemory()` | distill + vectors + KG + tiers + decay + contextTree + frozenContext |
| `harnessLoop()` | intake→triage→gate→execute→verify→reflect + handoff + autoSolidify + strategy model |
| `guardedExecution()` | ABAC + policy + budgetGate + valve + gate + toolSelector + parallel guardrail |
| `resilientPipeline()` | rateLimiter → breaker → retry → timeout → fallback |
| `graphLens()` | topology + health + flow + why(node) + auditTrail |
| `persistentState()` | autoCheckpoint + snapshot + restore + diff |

### Marketing strategy §20 added

Competitive positioning against Evolver, Hermes, OpenAI SDK, QMD. New pain-point reply templates. Vocabulary to claim.

---

## SELF-EVOLUTION VISION

The ultimate goal: GraphReFly uses its own harnessLoop to evolve itself.

```
eval results → INTAKE (as IntakeItems)
    → TRIAGE (promptNode classifies: composition gap / missing-fn / schema-gap / regression)
    → GATE (human reviews classification)
    → EXECUTE (promptNode generates fix OR human implements)
    → VERIFY (pnpm test + eval re-run on affected tasks)
    → REFLECT
        → strategy model updates (which interventions work)
        → auto-solidify (successful fix → new catalog entry)
        → memory distillation (lessons for next session)
        → hypothesis generation (predict future failures)
```

This is what §9.0 "Dogfood on 9.1b" already designed. The gap is: EXECUTE and VERIFY stages are still shells needing actuator wiring (tracked in optimizations.md as "harness closed-loop gap").

---

## DELIVERY ASSESSMENT

See "Assess delivery distance" section added inline below for how far each block is from shippable.

---

## FILES CHANGED

- `~/src/graphrefly/COMPOSITION-GUIDE.md` — added §29, §30, §31
- `docs/optimizations.md` — 6 new active work items
- `archive/docs/SESSION-marketing-promotion-strategy.md` — §20 competitive intel
- `~/src/graphrefly_github/profile/README.md` — 6-block restructure
- `archive/docs/SESSION-competitive-landscape-self-evolution.md` — this file
- `archive/docs/design-archive-index.jsonl` — new entry
