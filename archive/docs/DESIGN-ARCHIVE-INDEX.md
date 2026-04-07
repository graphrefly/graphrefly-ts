# Design Decision Archive

This directory preserves detailed design discussions from key sessions. These are not casual notes — they capture the reasoning chains, rejected alternatives, and insights that shaped the architecture.

## Predecessor: callbag-recharge

GraphReFly is the successor to [callbag-recharge](https://github.com/nicepkg/callbag-recharge) (TS, 170+ modules) and [callbag-recharge-py](https://github.com/nicepkg/callbag-recharge-py) (Python, Phase 0-1). The full design history of callbag-recharge is preserved in those repos under `src/archive/docs/DESIGN-ARCHIVE-INDEX.md`.

Key sessions from the predecessor that directly informed GraphReFly:

| Session | Date | What it established |
|---------|------|-------------------|
| Type 3 Control Channel (8452282f) | Mar 14 | Separating control from data — evolved into unified message protocol |
| Push-Phase Memoization (ce974b95) | Mar 14 | RESOLVED signal for transitive skip — carried forward |
| Explicit Deps (05b247c1) | Mar 14 | No implicit tracking — carried forward |
| No-Default-Dedup (4f72f2b0) | Mar 15 | Operators transparent by default — carried forward |
| Output Slot (8693d636) | Mar 16 | null→fn→Set optimization — carried forward |
| Lazy Tier 2 (lazy-tier2-option-d3) | Mar 18 | get() doesn't guarantee freshness — evolved into status-based trust |
| Promise Elimination (callbag-native) | Mar 24 | Internal APIs return sources not Promises — carried forward |
| Vision: LLM Actuator (vision-llm-actuator-jarvis) | Mar 26-27 | Three-layer vision, Graph as universal output — directly triggered GraphReFly |

---

## GraphReFly Sessions

### Session graphrefly-spec-design (March 27) — Unified Spec: Protocol, Single Primitive, Graph Container
**Topic:** Designing the GraphReFly unified cross-repo spec through a 7-step process. Radical simplification from callbag-recharge's 6 primitives + 4 callbag types to 1 primitive (`node`) + unified message format.

**Process:** Lessons learned → demands/gaps → functionalities → common patterns → primitives → nice-to-haves → scenario validation.

**Key decisions:**
- **One primitive: `node(deps?, fn?, opts?)`** — behavior from configuration, sugar constructors for readability
- **Unified message format:** always `[[Type, Data?], ...]`, 9 types, no channel separation
- **Unified node interface:** `.get()` (cached, never errors), `.status`, `.down()`, `.up()`, `.unsubscribe()`, `.meta`
- **Meta as companion stores** — each key subscribable, replaces all `with*()` wrappers
- **No separate Knob/Gauge/Inspector** — `describe()` + `observe()` on Graph
- **Pure wire edges** — no transforms, everything is a node
- **Colon namespace** — `"system:payment:validate"`

**Validated scenarios:** LLM cost control, security policy, human-in-the-loop, Excel calculations, multi-agent routing, LLM graph building, git versioning.

**Outcome:** `~/src/graphrefly/GRAPHREFLY-SPEC.md` (v0.1.0), `docs/roadmap.md`, new repo decision.

### Session web3-integration-research (March 27-28) — Web3 Integration Sketch: Security, OMS, Agent Commerce
**Topic:** Research into how GraphReFly maps onto Web3 security monitoring ($3.4B lost in 2025), AI agent commerce (x402/ERC-8004/ERC-8183), and the missing reactive order management layer for decentralized systems.

**Key findings:**
- GraphReFly needs no new primitives for Web3 — just adapters (`fromChainEvents`, `fromX402`, `toTransaction`) and domain graph factories (`securityMonitor()`, `orderGraph()`, `agentWorkflow()`)
- GraphReFly runs off-chain as the coordination brain; contracts stay on-chain (Solidity/Move/Rust)
- Three detailed graph topology sketches: security monitor, cross-chain order lifecycle, multi-agent job workflow
- Custom message types (`ESCROW_LOCKED`, `PAYMENT_REQUIRED`, `THREAT_DETECTED`) leverage the open message type set (spec §1.2)

**Files:** `archive/docs/SESSION-web3-integration-research.md`

### Session web3-research-type-extensibility (March 27-28) — Message Type Extensibility Analysis
**Topic:** Evaluating whether TS and Python type definitions allow users to define and emit custom message types, as required by the spec's open message type set.

**Key findings:**
- **TypeScript: open** — `Message = readonly [symbol, unknown?]` accepts any symbol. Users can `Symbol.for("web3/ESCROW_LOCKED")` today with no changes
- **Python: closed** — `Message = tuple[MessageType, Any]` restricts to the `StrEnum`. Users cannot express custom types without modifying the enum. Type alias needs widening to `MessageType | str`
- Smart contract language comparison (Solidity, Rust, Move, Vyper, Cairo) and why GraphReFly is off-chain

**Files:** `archive/docs/SESSION-web3-research-and-type-extensibility.md`

### Session access-control-actor-guard (March 28) — Built-in ABAC: Actor, Guard, Policy Builder
**Topic:** Designing built-in access control for GraphReFly that replaces external authz libraries (e.g. CASL). The graph is the single enforcement point — every mutation flows through `down()`/`set()`/`signal()`, so one guard per node is complete coverage.

**Key decisions:**
- **Three primitives:** Actor context (who), capability guard (may they), scoped introspection (what can they see)
- **`policy()` declarative builder** — CASL-style `allow()`/`deny()` DX, zero dependencies, ~50 LOC
- **Attribution pulled to Phase 1.5** — `node.lastMutation` records `{ actor, timestamp }` on every mutation
- **CASL rejected** as dependency — its subject model, sift.js query engine, and pack/unpack serialization are unnecessary when the graph is the only enforcement point
- **Web3 identity maps cleanly** — wallet signatures, x402 proofs, ERC-8004 agent IDs all produce actors; the guard is identity-mechanism-agnostic

**Roadmap impact:** New Phase 1.5 (Actor & Guard), expanded Phase 1.6 (tests), Phase 5.4 accepts `actor?`, Phase 6 simplified (attribution moved, V3 caps = serialized guard policy).

**Files:** `archive/docs/SESSION-access-control-actor-guard.md`

### Session cross-repo-implementation-audit (March 29) — Spec Compliance, Patterns, callbag-recharge Parity, Tooling Gaps
**Topic:** Structured 16-batch audit (`docs/audit-plan.md`) of graphrefly-ts and graphrefly-py against `GRAPHREFLY-SPEC.md`, internal API consistency, callbag-recharge lessons, operator/data-structure edge cases, and AI-facing introspection. Findings are stored per batch under `docs/batch-review/`.

**Completed reports (as of session date):** batches 1–8, roll-up `batch-4-8-processed-result.md`, batches 13–15. Batches 9–12 and 16 not yet run.

**Key outcomes:**
- Phase A (batches 1–3): strong PASS on core protocol, node, and Graph; **open** TS vs Py batch-drain deferral inconsistency; **spec ambiguity** on §1.4 direction enforcement vs lifecycle forwarding.
- Phases B–C (4–8): pattern and pitfall audits; **documented fixes** (PubSub `removeTopic`, reactive log bounds, direct `retry`/`rateLimiter`, NodeImpl export hygiene, replay nodes, Py drain guard, edge-case tests); **Py xfail** marks remaining operator gaps.
- Batch 13: superset-deps pattern **correct** but may recompute on irrelevant dep changes vs predecessor `dynamicDerived`.
- Batch 14: RxJS alignment **mostly good**; document TS `merge([...])` shape, missing `mergeMap` concurrency, naming divergences for LLM ergonomics.
- Batch 15: `describe()`/`observe()` **insufficient** for causal debugging; proposes structured inspect / timestamps / batch context for Phase 4.

**Files:** `archive/docs/SESSION-cross-repo-implementation-audit.md` — canonical log; `docs/batch-review/*.md` — evidence; `docs/audit-plan.md` — batch definitions.

### Session reactive-issue-tracker-design (March 30) — Reactive Issue Tracker: Dogfooding GraphReFly for Project Management
**Topic:** Designing a reactive issue tracker / agentic knowledge graph that uses graphrefly-ts to solve its own project management pain — tracking roadmap items, audit findings, design invariants, RxJS/callbag parity, cross-repo consistency, and pitfall relationships as **live verifiable assertions** rather than status cards.

**Key decisions:**
- **Issues are live assertions, not status cards** — every issue carries a `verify()` function that programmatically checks whether the issue still holds (via test runs, grep, LLM analysis)
- **"Fixed" ≠ "verified"** — the graph re-runs verifiers and only transitions to "verified" on evidence; failed verification reopens the issue
- **Regression detection via reactive propagation** — file/git changes trigger re-verification of affected issues; regressions reopen automatically with evidence
- **Typed relationships** (`affects`, `blockedBy`, `relatedTo`) enable graph queries: "what invariants break if I change operators.ts?"
- **AI-native via `observe()` + `annotate()`** — agents subscribe, get pushed updates, annotate reasoning; `traceLog()` persists across sessions

**Comparison vs. existing tools:** Identified 7 differentiators over Linear/Notion/GitHub Issues — reactive propagation, live verification, regression detection, typed semantic relationships, AI-native observability, computation as first-class, cross-system coherence.

**Missing pieces:** `collection()` factory (Phase 4.3), `verifiable()` pattern, `fromFSWatch()`/`fromGitHook()` sources, `fromLLM()` adapter (Phase 4.4), transitive dependency query, CLI/MCP tool for agent interaction.

**Files:** `archive/docs/SESSION-reactive-issue-tracker-design.md`

### Session tier2-parity-nonlocal-forward-inner (March 30) — Tier 2 Operator Parity: forwardInner, nonlocal, sample Architecture
**Topic:** Cross-repo parity analysis and fixes for three divergences in Python's Tier 2 operators discovered during `/parity` run after the COMPLETE-before-DATA batch ordering fix. Establishes Tier 2 operator regression testing as the highest-priority testing gap.

**Key decisions:**
- **`_forward_inner` emitted flag** — prevents double-DATA when inner emits during subscribe (Python subscribe doesn't auto-emit initial DATA like TS)
- **`nonlocal` replaces `[value]` list-boxing** — idiomatic Python 3 across all 18 operators; eliminates misleading ruff lints and aligns closure patterns with TS
- **`sample` rewritten to dep+onMessage** — eliminates mirror node; uses `node([src, notifier], compute, on_message=...)` matching TS exactly
- **Tier 2 regression testing is the top testing priority** — composite message ordering, void sources, PAUSE/RESUME/INVALIDATE through dynamic inners, timer callbacks during batch drain — all untested combinatorial surfaces that RxJS/callbag never had to handle

**Files:** `archive/docs/SESSION-tier2-parity-nonlocal-forward-inner.md`

### Session snapshot-hydration-design (March 30) — Seamless Snapshot/Hydration: Auto-Checkpoint & Node Factory Registry
**Topic:** Designing zero-friction resume for dynamic graphs — auto-checkpoint (reactive persistence wired to `observe()`) and node factory registry (`Graph.registerFactory()` for `fromSnapshot` reconstruction of runtime-added nodes). Motivated by reactive issue tracker, agent memory (`distill()`), and security policy hot-reload use cases.

**Key decisions:**
- **Auto-checkpoint fires after settlement** — filter to DATA/RESOLVED (phase-2 messages), debounce ~500ms; snapshotting mid-DIRTY produces inconsistent state
- **Incremental snapshots** via `Graph.diff()` — reduces I/O from O(graph_size) to O(changed_nodes) per mutation; periodic full snapshot compaction
- **Factory registry by name glob pattern** — not by node type (too coarse) or custom meta field (pollutes snapshot); global registry solves chicken-and-egg with `fromSnapshot`
- **Guards reconstruct from data** — `policyFromRules(snap.value.rules)` rebuilds guard fns from persisted policy rules; security policies are fully dynamic (add/remove at runtime, persist, restore with enforcement)
- **Topological reconstruction order** — mounts → state/producer → derived/operator/effect → edges → restore values

**Roadmap impact:** New Phase 1.4b (Seamless Persistence) with 8 items.

**Files:** `archive/docs/SESSION-snapshot-hydration-design.md`

### Session demo-test-strategy (March 30) — Demo & Test Strategy: 4 Demos, GraphReFly-Powered Shell, Reactive Layout, Inspection-as-Test-Harness
**Topic:** Designing the demo and test strategy for Phase 4 domain layers. Four demos (Order Pipeline, Agent Task Board, Monitoring Dashboard, AI Docs Assistant) each exercising 3+ domain layers with 10–12 numbered acceptance criteria to prevent AI descoping. The three-pane demo shell (visual main, graph+code side) is itself a `Graph("demo-shell")` — dogfooding reactive coordination for cross-highlighting. Layout powered by a Pretext-inspired reactive text measurement engine rebuilt as a GraphReFly graph.

**Key decisions:**
- **Three-pane shell IS a GraphReFly graph** (main/side split) — hover/target state → derived scroll/highlight/selector → effects. Shell bugs are library bugs. Each pane has full-screen toggle.
- **Reactive layout engine (Pretext-on-GraphReFly)** — DOM-free text measurement rebuilt as `state → derived` pipeline instead of wrapping Pretext library. Layout is inspectable (`describe()`), snapshotable, extractable as standalone pattern. Used for graph node sizing, code virtual scroll, adaptive pane widths.
- **Acceptance criteria prevent descoping** — 10–12 specific, testable ACs per demo (lesson from callbag-recharge H2/H4 staying backlog)
- **Inspection layer IS the test harness** — every `observe()`, `describe()`, `toMermaid()` in demos simultaneously showcases, stress-tests, and validates the inspection tools
- **Four-layer test strategy** — unit (per-factory), scenario (headless demo ACs), inspection stress, adversarial
- **Eight foreseen building blocks** — reactive layout, reactive cursor, streaming convention, factory helper, cross-island bridge, guard-aware describe, mock LLM, time simulation
- **Non-LLM demos first** — Demo 1 and 3 ship before Demo 2 and 4 (no WebLLM dependency)
- **WebLLM for browser demos** — Qwen3 via WebGPU, zero API keys, graceful degradation to pre-recorded traces

**Predecessor lessons incorporated:** callbag-recharge demo architecture (store.ts + component), H2 AI Docs Assistant design, agentic memory research, switchMap footgun / streamFrom pattern, 5-tier documentation model, descoping problem. [Pretext](https://github.com/chenglou/pretext) (Cheng Lou) inspired the reactive layout engine.

**Roadmap impact:** New Phase 7.1–7.6 in TS repo, 7.1–7.4 in PY repo.

**Files:** `archive/docs/SESSION-demo-test-strategy.md`, `docs/demo-and-test-strategy.md`

### Session agentic-memory-research (March 31) — Agentic Memory SOTA Synthesis + Default agentMemory() Strategy

**Topic:** Synthesizing SOTA agentic memory research (Letta/MemGPT, Mem0, Zep/Graphiti, Cognee, MemOS, MAGMA, A-Mem, OpenViking), AI tool full-chain analysis, and advanced memory write strategies into a concrete default strategy for `agentMemory()` (Phase 4.4). Adapted from predecessor research (`~/src/callbag-recharge/src/archive/docs/SESSION-agentic-memory-research.md`, March 17–26 2026).

**Key decisions:**
- **Four strategies map to existing primitives** — 3D filtering funnel (`extractFn` scoring), GraphRAG (`knowledgeGraph` + `vectorIndex`), dynamic reflection (`distill` consolidation), hot/cold tiers (`decay` + `autoCheckpoint`) — no new core concepts
- **`agentMemory()` is composition, not a new primitive** — wires `distill()` + `knowledgeGraph()` + `vectorIndex()` + `collection()` + `decay()` + `autoCheckpoint()`
- **Default strategy is opinionated but overridable** — OpenViking decay formula (`sigmoid(log1p(count)) * exp_decay(age, 7d)`), 3-tier storage (permanent/active/archived), periodic LLM reflection, 3D admission filter
- **LLM extraction/consolidation stays in userland adapters** (`llmExtractor`, `llmConsolidator`), never inside core primitives
- **Five unique advantages over all existing systems** — reactive/push-based memory, in-process zero-serialization, diamond-safe coordination, transport agnosticism, first-class observability

**Predecessor research:** 8 leading architectures surveyed, CoALA taxonomy, 5 biggest pain points, performance benchmarks (10ns vs 50-500μs), OpenClaw/Mem0 integration analysis, OpenViking L0/L1/L2 progressive loading.

**Files:** `archive/docs/SESSION-agentic-memory-research.md`

### Session universal-reduction-layer (March 31) — Universal Reduction Layer: Massive Info → Actionable Items via LLM-Composable Reactive Graphs
**Topic:** Generalizing GraphReFly from domain-specific tools (issue tracker, observability) to a universal reactive reduction layer for any "massive info → actionable items" pattern. Research into the observability/telemetry landscape (OpenTelemetry, Datadog, Grafana stack pain points and 2026 trends) revealed that the library's reactive graph primitives solve structural problems across many domains — and LLMs are the missing piece that makes composing these graphs practical at scale.

**Key decisions:**
- **GraphReFly is not an observability tool or an issue tracker — it's the reactive computation layer** between any massive information source and human-actionable output
- **Three things LLMs unlock:** (1) composing the graph itself from natural language, (2) operating inside nodes for semantic reduction, (3) auditing and explaining the graph's decisions
- **Stratified reduction is the killer differentiator** — apply 4 layers on noisy signals, 1 on critical errors, cycles for feedback loops, zero filtering on audit-required data, all in the same graph
- **"CICD moment for information processing"** — continuous (reactive push), integrated (one graph), composable (swap strategies live), deliverable (prioritized output)
- **10 concrete advantages** documented: lightweight/reactive, stratified reduction, extensible/no vendor lock-in, rich metadata, reactive prioritization, LLM training at scale, composable plugins, LLM co-operation, constraint wiring for experimentation, auto-regression detection

**Comparison vs alternatives:**
- vs neural networks: dynamic topology, heterogeneous strategies per branch, inspectable/auditable, composable, runtime cycles
- vs workflow engines (n8n, Airflow): truly dynamic, reactive not scheduled, composable subgraphs, lightweight
- vs agentic frameworks (LangChain, CrewAI): domain-focused, less prescriptive, built-in reactivity, security by design

**Roadmap impact:** New Phase 5.2c (ingest adapters), 5.2d (storage/sink adapters), Phase 8 (Universal Reduction Layer: 8.1 reduction primitives, 8.2 domain templates, 8.3 LLM graph composition, 8.4 audit & accountability, 8.5 performance & scale), Phase 7.3b (3 universal reduction demos).

**Files:** `archive/docs/SESSION-universal-reduction-layer.md`

### Session serialization-memory-footprint (March 31) — Adoption Blockers: Memory Footprint, DAG-CBOR Codec, Tiered Representation, NodeV0 Promotion
**Topic:** Follow-on from the universal reduction layer session, investigating the biggest practical blockers for adoption at scale: runtime memory footprint, serialization overhead (JSON bloat), hydration latency, and the observation that `src/core/versioning.ts` (NodeV0/V1) exists but is unused. Establishes that serialization, memory, and hydration form an integrated cycle that must be designed together.

**Key decisions:**
- **DAG-CBOR as default codec** — replaces JSON for wire/checkpoint. Already validated in callbag-recharge (`SESSION-universal-data-structure-research.md`). ~40-50% smaller, deterministic encoding for CID/hash-compare, COSE signing support. With zstd: 80-90% smaller than JSON
- **Tiered representation** — hot (JS objects), warm (DAG-CBOR + lazy hydration), cold (Arrow/Parquet + compression), peek (FlatBuffers zero-copy). Tier transitions can be reactive
- **Five memory tuning strategies** — lazy meta materialization (~35% per-node savings), structural sharing for values, bounded history (ring buffers), struct-of-arrays for homogeneous pipelines (~50 bytes vs ~800 bytes per node), dormant subgraph eviction
- **Delta checkpoints are more impactful than any format choice** — at steady state ~0.5% of nodes change per cycle; ~400x smaller than full snapshots
- **NodeV0 should move from Phase 6 to Phase 3.x** — it's the minimum enabler for delta checkpoints, wire-efficient sync, LLM-friendly diffing, and dormant eviction. Effectively free (<5% overhead). V1 (CID + prev) can stay in Phase 6

**The integrated cycle:** Better serialization → cheaper hydration → more aggressive eviction → lower memory → more nodes feasible. Cheap hydration (DAG-CBOR/FlatBuffers) unlocks low memory.

**Roadmap impact:** `GraphCodec` interface (pluggable serialization), delta checkpoint primitive, lazy hydration API, dormant subgraph eviction policy, NodeV0 promotion to earlier phase.

**Files:** `archive/docs/SESSION-serialization-memory-footprint.md`

### Session marketing-promotion-strategy (April 3) — Marketing, Promotion & Domain Strategy
**Topic:** Comprehensive marketing strategy for GraphReFly — package descriptions/keywords, domain setup (graphrefly.dev + py.graphrefly.dev), Cloudflare configuration, site architecture decisions, AI discoverability (robots.txt + llms.txt), callbag-recharge deprecation plan, and phased promotion roadmap.

**Key decisions:**
- **Single Starlight site per language** — `graphrefly.dev` (TS) and `py.graphrefly.dev` (PY) with cross-linking header nav; rejected separate apex site and subpath approaches
- **Three positioning pillars** — "The Missing Middle" (signals + streams), "Durable by Default" (resumable LLM streaming), "Inspectable AI Orchestration" (observable agent state)
- **AI-permissive crawling** — explicit `robots.txt` allowing GPTBot/ClaudeBot/PerplexityBot + `llms.txt` for LLM ingestion; Block AI Bots OFF on Cloudflare
- **Phased promotion** — Foundation (domain/org/README) → Soft Launch (npm publish, HN, Reddit) → Growth (AI communities, Discord, comparison pages) → Sustained (blog cadence, conferences, PH at v1.0)
- **callbag-recharge deprecation** — npm deprecate, README banner, blog migration (reframe 30 chronicle posts), archive repo
- **Public asset pipeline** — `robots.txt` and `llms.txt` at repo root as single source of truth, synced to `website/public/` by `sync-docs.mjs`

**Predecessor research incorporated:** callbag-recharge Gemini marketing research (March 21), blog strategy doc (30-post plan, growth flywheel).

**Files:** `archive/docs/SESSION-marketing-promotion-strategy.md`

### Session first-principles-audit (April 4) — First-Principles Audit: Is GraphReFly Necessary?
**Topic:** Deep self-examination of whether GraphReFly is over-engineered. Starting from "data flows from function output to function input — why add a reactive graph layer?", the session synthesizes web research (callbag history, reactive programming criticisms, signals vs observables landscape, HN feedback), internal design documents, and first-principles reasoning.

**Key decisions:**
- **GraphReFly is not over-engineered — it's optimized for a specific bet:** long-running human+LLM reactive co-operation will become the dominant software pattern
- **Irreducible core is five things:** node, edge, propagation, describe/snapshot, GraphSpec. Remove any one and at least one of the four requirements (LLM-safe creation, human audit, security, human/LLM symmetry) fails
- **Graph > functions for LLM composition** because it constrains error space — like SQL vs hand-written DB ops. LLMs make fewer mistakes in constrained systems
- **Causal chain persistence is the killer argument** — not reactivity, not performance. Structural causality that persists and auto-invalidates enables progressive trust accumulation (anti-vibe-coding)
- **No LoRA/SFT needed** if GraphSpec stays simple enough for zero-shot. Litmus test: if a junior dev can write it from a 1-page guide, an LLM can generate it zero-shot
- **Demo 0 ("The Existential Demo")** designed: NL -> GraphSpec -> simplified flow view -> run -> persist -> causal explain. Proves the library's reason to exist
- **Three-layer DX/UX strategy:** LLM-DX (schema + errors), Dev-DX (5-min onboard, progressive complexity), End-user UX (NL input, simplified flow view) — Layer 3 is the real moat
- **Reposition public presence:** lead with user pain points (information overload, FOMO, attention protection), not architecture (two-phase push, diamond resolution)
- **Value for ordinary people:** universal reduction engine protecting human attention/energy. Scenarios: personal knowledge management, finance/health monitoring, small business automation, adaptive learning

**Research findings:**
- Callbag (2018) had near-identical thesis, died from zero ecosystem and "no maintainers" philosophy
- Industry converged on Signals for sync reactivity, Observables for async, plain functions for stateless transforms
- All major frameworks (Angular, SolidJS, Preact) now treat glitch-free as table stakes
- Virtual threads (Project Loom) killed server-side reactive in Java; GraphReFly's coordination-protocol positioning remains viable
- HN feedback: "sounds good but don't understand the solution" — confirms architecture-first messaging fails

**Files:** `archive/docs/SESSION-first-principles-audit.md`

### Session deerflow-deepagents-comparison (April 5) — Competitive Analysis: DeerFlow 2.0 & Deep Agents vs GraphReFly
**Topic:** Research-backed comparison of DeerFlow 2.0 (ByteDance, 32k stars) and LangChain Deep Agents (19.3k stars) against GraphReFly. Prompted by a popular 小红书 post analyzing DeerFlow's architectural evolution and "5 core design principles" of 2026 agent design.

**Key findings:**
- **DeerFlow's 1.0→2.0 evolution trajectory points at GraphReFly** — static→dynamic, shared→isolated, engineer→LLM are steps 1-3; the next steps (pull→push, no causality→causal chain, tool-level→topology-level) are steps 4-7 that GraphReFly already provides
- **DeerFlow is a harness, GraphReFly is a protocol** — different abstraction layers, composable not competitive
- **File system as state is 2026 consensus but has fundamental limits** — no consistency, no reactive propagation, no causal chain, no structural diffability
- **"Tool-as-Agent" vs "Topology-as-Program"** is the core philosophical divide — DeerFlow gives LLMs better tools, GraphReFly lets LLMs define the computation structure
- **Deep Agents validates the pattern** (planning + sub-agents + filesystem) without depth — Harrison Chase's weekend hack proving demand
- **"Complementary" is market entry tactic, not architectural truth** — GraphReFly replaces coordination cores; host frameworks keep sandbox + IM + UI (commodity)
- **Ecosystem infiltration via 3 entry points** — MCP Server (universal, highest priority), workspace bridge (zero-change for file agents), LangGraph adapter (largest ecosystem)

**Files:** `archive/docs/SESSION-deerflow-deepagents-comparison.md`

### Session harness-engineering-strategy (April 6) — Harness Engineering Gap Analysis, Three-Wave Announcement Plan, Eval System Design, Ecosystem Infiltration
**Topic:** Research-backed gap analysis between "harness engineering" (2026's defining trend, named by Mitchell Hashimoto, adopted by OpenAI/Anthropic/Fowler) and GraphReFly's existing architecture. Produced a three-wave announcement plan, two-tier eval system design, ecosystem infiltration strategy, and anti-stealth decision.

**Key decisions:**
- **Anti-stealth:** decided NOT to go stealth. The moat is category ownership (vocabulary + mindshare), not code secrecy. 20+ adapters already built; 30+ harness engineering articles published in 8 weeks — window to claim category is April-June 2026
- **Three announcement waves:** Wave 1 (eval story — low risk, high credibility), Wave 2 (harness layer + MCP server + scorecard — claims category), Wave 3 (Demo 0 + Show HN + framework packages — full launch)
- **Two-tier eval:** portable/manual (free, copy-paste into any chat) + automated/API (cheap models for dev, expensive for publish). `LLMProvider` interface makes model switching a config change
- **MCP Server as primary infiltration vector** — one npm package reaches all MCP clients (Claude, Cursor, VS Code Copilot, ChatGPT, Cline, LangGraph, CrewAI, Vercel AI SDK)
- **`explainPath` is THE differentiator** — causal walkback that no competitor has. Prioritized as P0 alongside `auditTrail`
- **Reposition from "reactive graph engine" to "reactive harness layer for agent workflows"** — "Nobody buys an engine" (Aaron Levie)
- **Consumer track deferred** — pillar #1 ("Stop Drowning in Information") revisited post-Wave 3

**Roadmap impact:** New §9.1–9.7 in TS roadmap (eval harness, audit/accountability, MCP server, scorecard, Demo 0, framework packages, Demo 6). Matching §9.0/9.2/9.2b in PY roadmap. §15 added to marketing strategy. Deferred section for §8.5-8.8, §6.2-6.3, demos 1-4.

**External research:** 30+ harness engineering articles (SearXNG, April 2026), Cursor export analysis, MCP ecosystem landscape (official registry, Cline Marketplace, PulseMCP), LangGraph/CrewAI/Vercel AI SDK integration mechanisms, A2A/ACP/ANP protocols.

**Files:** `archive/docs/SESSION-harness-engineering-strategy.md`

### Session reactive-collaboration-harness (April 6) — Reactive Collaboration Harness: Static-Topology Loop for Human+LLM Co-operation
**Topic:** Designing a reactive collaboration harness — a 7-stage static-topology loop (intake → triage → queue → gate → execute → verify → reflect) for human+LLM co-operation. Synthesizes the reactive issue tracker, harness engineering strategy, and catalog automation sessions into a unified architecture with typed gates, promptNode transforms, cursor-driven readers, and strategy tracking.

**Key decisions:**
- **Static topology + flowing data** — the graph models the workflow (pipes), not the work items (water). No runtime topology changes needed. The Kafka/Pulsar insight: producers and consumers at different speeds, connected by a log
- **`gate.modify()` IS structured human judgment** — ported from callbag-recharge with Array.map-style signature `(value, index, pending) => T`. No separate `steer()` API; the gate is the steering point
- **Cursor reading as dimensionality reduction (降维)** — converts exponential graph branching into linear sequence consumption. Support both graph-subgraph (tight coupling) and cursor-reading (independent streams) modes
- **`promptNode` factory** — universal LLM transform: any prompt + deps → processing node. Handles triage, QA, hypothesis generation, parity checking — one factory for all LLM-mediated steps
- **Strategy model (intervention effectiveness)** — derived node tracking `rootCause×intervention → successRate`. Feeds back into triage for better routing. The genuine differentiator: human steering compounds over time
- **distill() kept for memory, not replaced by promptNode** — promptNode plugs INTO distill as extractFn/consolidateFn. Don't rebuild the reactive plumbing
- **Existing infrastructure covers ~70%** — TopicGraph, SubscriptionGraph, JobQueueGraph, distill, agentMemory, decay, bridge all already built. New work: gate port (~200 LOC), promptNode (~100 LOC), valve rename, wiring (~430 LOC)
- **Boolean gate → `valve` rename** — frees `gate` for the real human-approval primitive
- **Build as §9.0 before 9.1b** — dogfood the loop while running the 4-treatment eval experiment. Circular proof: the loop manages 9.1b, 9.1b validates the loop

**Five structural gaps identified in original tracker design:** (1) no typed human judgment input, (2) no eval↔tracker reactive bridge, (3) no intervention effectiveness tracking, (4) no predictive assertions/hypotheses, (5) no attention decay tracking. All addressed by the 7-stage loop.

**Generalizability:** The loop maps to any developer+LLM collaboration (solo dev, team, OSS project). What differs: which channels are gated, what priority signals, what prompts. What's the same: loop structure, primitives, strategy model, distillation.

**Files:** `archive/docs/SESSION-reactive-collaboration-harness.md`

---

## Reading Guide

**For architecture newcomers:** Start with the spec (`~/src/graphrefly/GRAPHREFLY-SPEC.md`), then this session.

**For callbag-recharge context:** Read the predecessor archive index in the callbag-recharge repo, focusing on the sessions listed above.

---

## Archive Format

Each session file contains:
- SESSION ID and DATE
- TOPIC
- KEY DISCUSSION (reasoning, code examples, decisions)
- REJECTED ALTERNATIVES (what was considered, why not)
- KEY INSIGHTS (main takeaways)
- FILES CHANGED (implementation side effects)

---

**Created:** March 27, 2026
**Updated:** April 6, 2026
**Archive Status:** Active — spec design + Web3 integration + access control + cross-repo implementation audit + reactive issue tracker design + Tier 2 parity + snapshot/hydration design + demo & test strategy + agentic memory research + universal reduction layer + serialization/memory footprint + marketing/promotion strategy + first-principles audit + DeerFlow/Deep Agents comparison + harness engineering strategy + reactive collaboration harness
