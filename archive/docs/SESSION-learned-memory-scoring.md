---
SESSION: learned-memory-scoring
DATE: April 30, 2026
TOPIC: Reactive Score Input for agentMemory() — Separating Scoring Mechanism from Score Source
STATUS: Initial decisions locked, implementation deferred
ORIGIN: Discussion following "Rethinking Memory Mechanisms of Foundation Agents in the Second Half" survey analysis
---

## CONTEXT

Part 6 of SESSION-agentic-memory-research.md analyzed two papers:

1. **"Rethinking Memory Mechanisms of Foundation Agents in the Second Half: A Survey"** (Huang et al., arXiv:2602.06052, 218 papers surveyed) — identifies three paradigms for memory policy: prompt-based rules → fine-tuning → RL-trained. Argues RL is the frontier because only long-term reward signals can determine which memories should persist.

2. **"InftyThink+: Effective and Efficient Infinite-Horizon Reasoning via Reinforcement Learning"** (Yan et al., arXiv:2602.06960, ZJU-REAL) — agent learns when/what/how to summarize via end-to-end RL, +21% accuracy over fixed-heuristic baselines.

Core thesis from both: **memory should be trained with the agent, not handcrafted.** Handcrafted memory → learned memory mirrors SIFT → CNN in computer vision.

## PROBLEM

Current `agentMemory()` design (SESSION-agentic-memory-research.md Parts 1-5) is open-loop:

- `decay()` computes score from age + access count — purely internal signals
- `admissionFilter` uses static thresholds
- `llmConsolidator` runs on fixed timer triggers
- **No feedback from downstream task outcomes to memory quality**

This puts us squarely in the survey's Paradigm 1 (prompt/rule-based). Functional, interpretable, but not learning from outcomes.

## DECISIONS

### Decision 1: Expose a reactive `score` input on memory entries

Separate the *scoring mechanism* from the *score source*.

The user pushes `(memoryId, scoreAdjustment)` signals into the memory system. These get folded into the memory's ranking alongside internal scoring (decay, access frequency).

**The memory system doesn't care where the score came from.** It sees a reactive signal on the score input and propagates the ranking change downstream.

This is the **general primitive**. Users compose their own scoring systems and supply them reactively:
- User thumbs-up/down
- Downstream citation detection (did the LLM reference this memory?)
- Retrieval-hit counting
- External analytics
- Trained RL model emitting score adjustments

### Decision 2: Ship an outcome-based feedback preset

An opinionated composition on top of the score input:

- Harness VERIFY pass/fail → score adjustments for all memories retrieved in that episode
- Coarse attribution: boost all retrieved memories on success, mild penalty on failure
- Law of large numbers sorts out noise over many episodes

This is a **preset**, not the primitive. Users who want finer attribution (e.g., tracing which memories appeared in the reasoning chain via `observe()`) compose their own.

### Decision 3: Credit attribution is composition, not core

Three levels of attribution sophistication, all built on the same score input:

1. **Episode-level (default preset):** All retrieved memories share the outcome signal equally
2. **Citation-level (user composition):** Detect which memories the LLM referenced in its output, attribute score only to those
3. **Causal-level (advanced):** Use `observe({ causal: true })` to trace which memories causally influenced the output, weight score accordingly

Core ships #1 as a preset. #2 and #3 are documented composition patterns.

### Decision 4: GraphReFly is the reactive substrate, not the RL framework

We don't train models. But we provide:

- **Execution layer:** Reactive graph where learned memory policies execute (push-based propagation, diamond-safe coordination, in-process speed)
- **Training data:** `observe()` + `spy()` capture full causal traces — (memory state, action, outcome) trajectories for external RL training
- **Policy-agnostic score input:** Whether the score comes from rules, prompts, or a trained model, the memory graph doesn't change

## OPEN QUESTIONS (for future discussion)

1. **Score input API shape:** Is it `memoryGraph.score(memoryId, delta)` as a source node, or a dedicated `scoreInput` node that accepts `{id, delta}` pairs? The latter is more compositional (can wire any upstream to it).
2. **Score aggregation:** How do external scores combine with internal `decay()` scores? Additive? Multiplicative? Weighted sum with configurable weights?
3. **Negative feedback protection:** Should there be a floor so a single bad episode can't tank a memory's score? Or is the decay formula's `minScore` sufficient?
4. **Cold-start:** New memories have no outcome signal yet. Use `decay()` score as prior until enough episodes accumulate?
5. **Observability:** Should `describe()` show the score breakdown (internal vs external contributions)?

## KEY INSIGHT

The scoring input is the bridge between handcrafted and learned memory. Same reactive graph, same propagation semantics, same observability — but the *policy* feeding the score can evolve from static rules to RL-trained models without any structural changes to the memory system.

---END SESSION---
