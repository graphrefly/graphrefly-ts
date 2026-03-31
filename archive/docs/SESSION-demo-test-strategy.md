---
SESSION: demo-test-strategy
DATE: March 30, 2026
TOPIC: Demo & test strategy for domain layers — 4 demos, GraphReFly-powered three-pane shell, inspection-as-test-harness, foreseen building blocks
REPO: graphrefly-ts (primary), graphrefly-py (parity)
---

## CONTEXT

Phase 4 domain layers (4.1 orchestration complete, 4.2–4.5 in progress in both TS and PY repos). Needed a strategy for:
1. Examining and testing domain layer functions beyond unit tests
2. Designing demos that stress-test correctness, showcase potential, and render as interactive apps
3. Exposing missing building blocks that benefit the library broadly

**Predecessor lessons:** callbag-recharge had 4 hero demos (H1–H4) and 6 code examples (D1–D6). H1 (Markdown Editor) and H3 (Workflow Builder) shipped; H2 (AI Docs Assistant) and H4 (Multi-Agent Backend) stayed backlog. The Airflow demo "fell back to imperative because higher-level pipe wiring doesn't exist." AI implementors descoped demos to toys. This session counters that with explicit numbered acceptance criteria.

---

## KEY DECISIONS

### 1. The three-pane shell IS a GraphReFly graph

The synchronized demo shell (visual pane, code pane, graph pane) is itself built as `Graph("demo-shell")`. The cross-highlighting is a reactive coordination problem:

```
hover/target (state) → code/scroll-target (derived) → code/scroll (effect)
                     → graph/highlight-set (derived) → graph/highlight (effect)
                     → visual/highlight-selector (derived) → visual/highlight (effect)
```

This dogfoods `state`, `derived`, `effect`, `observe()` (cross-graph), `describe()`, `toMermaid()`, and `equals` optimization in every demo interaction. Shell bugs are library bugs.

**Meta debug toggle:** the shell can render its own `toMermaid()` — a GraphReFly graph visualizing another GraphReFly graph.

### 2. Four demos, each 3+ domain layers

| Demo | Layers | Framework | LLM | ACs |
|------|--------|-----------|-----|-----|
| Order Processing Pipeline | 4.1+4.2+4.5+1.5+3.3 | Vanilla JS | No | 10 |
| Multi-Agent Task Board | 4.1+4.3+4.4+3.2b+1.5 | React | WebLLM | 11 |
| Real-Time Monitoring Dashboard | 4.1+4.2+4.3+3.1+3.2 | Vue | No | 12 |
| AI Documentation Assistant | 4.3+4.4+3.2b+3.2+3.1 | Preact | WebLLM | 12 |

Non-LLM demos (1, 3) ship first. LLM demos use WebLLM (Qwen3, browser-local, no API keys) with graceful degradation to pre-recorded traces.

### 3. Acceptance criteria prevent descoping

Each demo has 10–12 numbered ACs. Each AC is specific and testable:
- "Submit 10 orders in rapid succession; all 10 process without loss. Verify via `observe("orders", { structured: true })` showing exactly 10 DATA messages."
- Not: "Orders should process correctly."

AI implementors must satisfy every AC or explicitly flag which ones they cannot meet and why.

### 4. Inspection layer IS the test harness

Every demo embeds `describe()`, `observe()`, `toMermaid()`, `traceLog()` as visible interactive panels. This serves three simultaneous purposes:
- Showcase for developers
- Stress test for the inspection tools themselves
- Feedback loop: gaps discovered in demos become library issues

### 5. Four-layer test strategy

| Layer | Scope | Location |
|-------|-------|----------|
| Unit | Per-factory topology and behavior | `src/__tests__/patterns/<factory>.test.ts` |
| Scenario | Multi-step sequences mirroring demo ACs, headless | `src/__tests__/scenarios/<demo>.test.ts` |
| Inspection stress | Inspection tools under realistic load | `src/__tests__/inspection/` |
| Adversarial | Edge cases demos won't hit | `src/__tests__/adversarial/` |

Scenario tests stub LLM responses with `mockLLM(responses[])`.

### 6. Seven foreseen building blocks

Items expected to emerge during demo implementation:

1. **Reactive cursor** — shared by `subscription()` + `jobQueue()`, advancing through `reactiveLog`
2. **Streaming node convention** — partial value emission for token-by-token LLM output
3. **Factory composition helper** — shared boilerplate for 4.x graph factories
4. **Cross-island state bridge** — shared graph state across Astro islands
5. **Guard-aware describe for UI** — `describe({ showDenied: true })` showing hidden nodes with reasons
6. **Mock LLM fixture system** — deterministic `fromLLM()` adapter for tests
7. **Time simulation** — `monotonicNs()` test-mode override for fake timers

### 7. Astro islands architecture

Each demo is a single-page app in the Astro docs site. TS demos render as JS islands with framework bindings. Python demos run in Pyodide/WASM lab (separate repo: `graphrefly-py/website/`).

The docs site AI assistant (Demo 4) is a persistent feature, not just a showcase — it uses `knowledgeGraph("api-graph")` with operator/source/pattern relationships and `agentMemory` to learn what the user is building.

---

## CALLBAG-RECHARGE PRECEDENTS INCORPORATED

| Precedent | Source | How it informed this session |
|-----------|--------|----------------------------|
| Demo architecture (store.ts + component) | `site/.vitepress/theme/components/` | Adopted: graph logic in store, rendering in framework component |
| H2 AI Docs Assistant design | `docs/roadmap.md` (H2) | Expanded into Demo 4 with full ACs and `knowledgeGraph` |
| Agentic memory research | `SESSION-agentic-memory-research.md` | Demo 2 + 4 use `distill()`, `agentMemory()`, reactive scoring |
| switchMap footgun / streamFrom | `SESSION-docs-site-patterns-streamFrom.md` | "Streaming node convention" listed as foreseen building block |
| 5-tier documentation model | `docs/docs-guidance.md` | Demos follow same pattern: JSDoc → examples → recipes → interactive |
| Descoping problem | H2/H4 staying backlog, Airflow fallback | Numbered ACs as the countermeasure |

---

## REJECTED ALTERNATIVES

### "Separate test suite for demos"
Testing demo graphs separately from the demo UI doubles coverage surface. Instead: scenario tests run the same graph logic headlessly, UI tests (if needed) use the three-pane shell.

### "Build shell with React/Vue directly"
The shell's cross-highlighting is synchronization logic. Building it with imperative event listeners means we're not dogfooding. GraphReFly derived+effect chains are cleaner AND prove the library works for this pattern.

### "One mega-demo instead of four"
A single app exercising all layers would be impressive but undebuggable when something fails. Four demos with distinct layer combinations isolate failures and provide focused stress tests.

### "Implement all 4.x factories before any demos"
Top-down stub-first approach surfaces API shape issues early. Building factories interleaved with demo validation catches composition problems that unit tests miss.

---

## KEY INSIGHTS

1. **The shell is the first demo.** Building `Graph("demo-shell")` before any content demos validates that GraphReFly can coordinate reactive UI — the exact claim we're making to developers.

2. **Acceptance criteria are the contract.** Without them, AI implementors rationally minimize scope. With 10–12 specific, testable ACs per demo, "descoped toy" becomes "failed spec."

3. **Inspection tools test themselves.** Every `observe()`, `describe()`, `toMermaid()` call in a demo is simultaneously a feature, a test, and a stress test. Gaps in the tools become visible as mismatches between the visual view and the graph view.

4. **Non-LLM demos are the foundation.** Demo 1 (orders) and Demo 3 (monitoring) exercise messaging, CQRS, orchestration, and resilience without the complexity of WebLLM. They must work perfectly before LLM demos add another layer.

5. **Seven building blocks are predictable.** The reactive cursor, streaming convention, and mock LLM fixture will almost certainly be needed. Documenting them now means we can validate whether the prediction was accurate.

---

## ROADMAP IMPACT

### graphrefly-ts (`docs/roadmap.md`)
- New Phase 7.1: Three-pane demo shell (built with GraphReFly)
- New Phase 7.2: Showcase demos (4 demos with AC references)
- New Phase 7.3: Scenario tests (headless demo logic)
- New Phase 7.4: Inspection stress & adversarial tests
- New Phase 7.5: Foreseen building blocks
- Phase 7 "Showcase demos" line replaced by structured 7.1–7.5

### graphrefly-py (`docs/roadmap.md`)
- New Phase 7.1: Showcase demos (Pyodide/WASM lab, 4 demos)
- New Phase 7.2: Scenario tests (headless, pytest)
- New Phase 7.3: Inspection stress & adversarial tests
- New Phase 7.4: Foreseen building blocks (Python equivalents)

---

## FILES

- `docs/demo-and-test-strategy.md` — full strategy document (TS repo, canonical)
- `docs/roadmap.md` — updated Phase 7 (both repos)
- `archive/docs/SESSION-demo-test-strategy.md` — this session log (both repos)
- `archive/docs/DESIGN-ARCHIVE-INDEX.md` — updated index (both repos)
