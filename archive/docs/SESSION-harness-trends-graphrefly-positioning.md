# Harness Engineering Trends & GraphReFly Positioning

**Date:** 2026-04-27
**Trigger:** Xiaohongshu video deconstructing Claude Code's harness (5 Moves: memory, context, verification, error handling, long-task relay). Broader web research into the harness engineering wave.

---

## Research Sources

Searched ~30+ articles across Chinese and English ecosystems. Key sources:

| Source | Key Contribution |
|--------|-----------------|
| Martin Fowler — "Harness engineering for coding agent users" | Ashby's Law of Requisite Variety applied to agent harnesses; topology as variety-reduction; steering loop concept |
| arXiv — "The Last Harness You'll Ever Build" | Worker → Evaluator → Evolution Agent three-agent self-improving harness; meta-evolution as harness-of-harnesses |
| Addy Osmani — "Agent Harness Engineering" | Ralph Loop (filesystem relay), planner/generator/evaluator splits, sprint contracts |
| Augment — "Harness Engineering for AI Coding Agents" | Three harness layers: feedforward constraints, corrective feedback loops, enforcement quality gates. PEV (Plan-Execute-Verify) loop |
| Boris Cherny (Claude Code creator) | "Quality can improve 2-3x" with verification. Three verification types: rule-based, visual (Playwright), AI judge. Self-eval unreliable — separate generation from evaluation |
| Claude Code source leak analyses (juejin, zhihu, CSDN, 01.me, GitHub) | Three-layer memory (L1 index always loaded, L2 on-demand detail, L3 search-only history). Context tactics: compression, masking, sub-agent summarization. Co-evolution: model trained with its harness |
| Xiaohongshu video (trigger) | 5 Moves synthesis. Counter-intuitive conclusion: simpler harness beats complex. Vercel cut 80% tools, Manus rewrote 5 times (each time deleting). Co-evolution means external harness changes can degrade model |
| lintsinghua/claude-code-book (GitHub) | 42-chapter deep analysis; Chapter 15 "Build Your Own Agent Harness" |
| VILA-Lab/Dive-into-Claude-Code (arXiv 2604.14228) | Academic analysis of design space for today's and future AI agent systems |
| OpenClaw Harness Engineering Guide (yeasy.gitbook.io) | Three-layer memory model: working memory, short-term, long-term with overflow semantics |

## Six Industry Consensus Points

1. **Prompt ⊂ Context ⊂ Harness** — three nested layers, not three independent concerns.
2. **Three-layer memory** — L1 index always in view (~150 chars), L2 topic files loaded on demand, L3 full history searched only when needed. Memory is treated as "hints" — always verify against current state before acting.
3. **Simpler is better** — Vercel cut 80% of tools and accuracy improved. Manus rewrote 5 times, each time deleting. Co-evolution: model + harness trained together means external additions can degrade performance.
4. **Verification is the most critical move** — three types: deterministic rules (tests, types), visual (Playwright screenshots), AI judge (separate agent scoring). Combine all three.
5. **Model gets stronger → harness gets thinner** — Anthropic actively deleting what the model can handle itself. Direction: "If you're not building the model, you're building the harness."
6. **Harness self-evolution** — Worker/Evaluator/Evolution Agent triangle. Meta-evolution: the evolution loop itself is a harness that can be optimized by a meta-agent.

## Three-Trend Framework

David's interpretation: Trend 1 is foundation, Trend 2 is the pursuit, Trend 3 is the result.

### Trend 1: Harness Self-Evolution (Foundation)

The arXiv paper proposes a closed-loop harness optimization cycle. GraphReFly's advantage: this cycle can be expressed as a live reactive graph (not a batch script). `describe()` makes the evolution auditable, `gate.modify()` enables human steering mid-evolution.

**Foundation prerequisites for GraphReFly:**
1. Graph is serializable — `snapshot()` ✅ already works
2. Graph modification is incremental — `add()` ✅, `remove()`/`removeAll()` ✅, `rewire()` ❌ **gap**
3. Graph changes are diffable — `Graph.diff(a, b)` ✅ already works

**Decision:** `rewire(node, newDeps)` is needed but too early — disconnect/resubscribe behavior not yet fully tested. Parked. Current `remove + re-add` workaround is sufficient for now. See `project_rewire_gap.md`.

### Trend 2: Ashby's Law — Topology as Variety Reduction (The Pursuit)

Ashby's Law of Requisite Variety (W. Ross Ashby, 1956): **"Only variety can absorb variety."** A regulator must have at least as much variety as the system it governs. Fowler's corollary: committing to a topology is a variety-reduction move — you narrow the agent's output space instead of trying to build controls for infinite possible outputs.

**David's core thesis (more precise than any prior GraphReFly description):**

> Graph is a variety-reduction machine. It compresses structural information; consumers can quickly locate and focus only on what they're responsible for; context is defined per-node and pushed by the framework — no redundant information wastes limited attention. Explainability is critical: probes alone don't prove correct execution. Explainable end-to-end chaining maximally guarantees that stacked operations are controllable, verified, and reproducible. The foundation is built so you can reliably stack layer upon layer.

**The 0.99 → 1.0 argument:** Each LLM step is ~99% reliable. 10 steps chained: 0.99^10 ≈ 90%. Traditional approach: add more guards outside → thicker harness, worse DX, gets in the way as models improve. GraphReFly approach: isolate each uncertain step in a node, apply resilience at node boundaries (not inside business logic). 0.99 inside the node, 1.0 at the boundary. The graph's topology IS the constraint — no separate "constraint layer" needed.

**Two evolution paths when AI gets stronger:**
1. **Human pruning** — `describe()` + `harnessProfile()` show which constraints never triggered → remove them
2. **AI self-pruning** — library is small enough for AI to understand the full API surface → AI reads `describe()` output → decides which nodes/edges are redundant → makes incremental modifications → `explain()` verifies causal chains still intact. Crucially: not rebuilding from scratch, but fine-tuning the existing graph — every step traceable and verifiable.

### Trend 3: Thinner is Better (The Result)

Not a goal but a signal. Real goal: harness complexity proportional to task complexity, not to model weakness.

**GraphReFly actions:**
- `harnessProfile()` as harness hygiene tool (like code coverage — shows untriggered paths)
- Library must stay small enough for AI comprehension
- `llms.txt` + `describe()` output as AI entry points
- Documentation > code for enabling AI self-assembly

## High-Frequency Resilience Patterns (Building Block Candidates)

From cross-source analysis, four patterns appeared in consensus (3+ independent sources):

1. **Retry with budget cap** — Stripe "max 2 retries then stop", universally cited
2. **Error taxonomy routing** — 4-way split: transient / AI-recoverable / human-required / fatal (Langchain, Augment, Claude Code, xiaohongshu video all independently converged)
3. **Evaluator as separate agent** — generation and verification must be separated; self-eval skews positive (Boris Cherny, Anthropic, arXiv paper, Addy Osmani)
4. **Deterministic gate before expensive step** — schema/type/lint check as feedforward filter (Augment Layer 1, Fowler "keep quality left", Claude Code permissions)

Two patterns at trend-level (2-3 sources):
5. Sprint contract — pre-agree "done" definition between generator and evaluator
6. Staleness gate — check for outdated dependencies/APIs in AI-generated code

**Decision:** Building block design deferred. David is doing worktree walk-throughs of existing patterns. Will reconsolidate patterns into orthogonal "greatest common divisor" building blocks. Priority: avoid LangChain-style DX failure from too many similar-but-different abstractions.

## Claude Code Harness ↔ GraphReFly Mapping

Introspecting the agent's own harness steps and mapping to GraphReFly primitives:

| Agent Harness Step | Role | GraphReFly Primitive |
|---|---|---|
| Intent classifier | Route message to appropriate handler | `derived` node (graph role; internal impl may be mechanical or LLM) |
| Safety classifier | Hard stop on dangerous requests | `gate` — reject blocks downstream |
| L1/L2/L3 context loading | Tiered information retrieval | Topology design pattern: L1 = in-graph nodes, L2 = `SubscriptionGraph`, L3 = source nodes pulling from external storage |
| Tool routing | Narrow available tools before execution | Feedforward constraint — tool registry + filter (Augment Layer 1) |
| Permission gate | Human approval for risky operations | `gate.modify()` — human decides allow/deny |
| Output calibration | Adjust format/depth/tone to intent | `derived` node consuming intent + context |
| Context compression | Manage conversation length | `distill()` — compress retaining signal |
| Memory write-back | Persist lessons for future sessions | `effect` node — triggered by feedback signal |

**Key insight:** Claude Code's harness IS a reactive graph — just written imperatively. If expressed in GraphReFly, it could `describe()` its own harness topology, `explain()` why it made decisions, and `harnessProfile()` which safety checks never fire.

**Clarifications from discussion:**
- `SubscriptionGraph` is not a "tier manager" — it's an independent-pace consumption mechanism. Three-tier context is a topology design pattern, not a single API.
- Intent classifier as `derived` doesn't mean "no LLM" — `derived` is the graph role (pure input→output, no side effects). The internal implementation (keyword match, regex, LLM) is the node's business. This exemplifies the thesis: all fuzzy steps compressed inside nodes, node boundaries are deterministic.
- Tool routing maps to tool registry + executor patterns already in patterns/ai, not a new primitive.

## Core Narrative (for external use)

> Traditional harnesses add constraints around agents. GraphReFly reduces dimensionality of the problem.
>
> LLM steps at 99% reliability, 10 steps chained = 90%. Traditional: wrap more guards → thicker harness, worse DX, fights model improvement. GraphReFly: graph isolates each uncertain step into a node, resilience at node boundaries, not inside business logic. 0.99 inside, 1.0 at the boundary. The topology IS the constraint.
>
> Model gets stronger? `describe()` shows which resilience layer never triggered — delete it. Or let AI read `describe()` and prune its own topology. Library is small enough for AI to understand completely. Modifications are incremental, traceable, verifiable.

## Open Questions

- What is the right granularity for building blocks after patterns reconsolidation?
- Should `harnessProfile()` report per-node resilience type + historical trigger frequency?
- When to revisit `rewire()` — what's the minimal test coverage for disconnect/resubscribe?

## Related Files

- `archive/docs/SESSION-harness-engineering-strategy.md` — Wave plan, MCP infiltration, eval design
- `archive/docs/SESSION-mid-level-harness-blocks.md` — 4 mid-level blocks
- `archive/docs/SESSION-competitive-landscape-self-evolution.md` — Self-evolution patterns
- `archive/docs/SESSION-strategy-roadmap-demo-reprioritization.md` — explainPath as P0 differentiator
- `archive/docs/SESSION-google-cloud-next-clawsweeper-analysis.md` — "Harness" no longer claimable category
- `docs/optimizations.md` — post-1.0 changesets (not needed for trend 1 foundation)
- Memory: `project_rewire_gap.md` — rewire API gap, parked
- Memory: `project_harness_engineering_strategy.md` — 3-wave plan context
