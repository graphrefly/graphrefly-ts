# Demo & Test Strategy — Domain Layers

> **Context:** Phase 4 domain layers (4.1 orchestration done, 4.2–4.5 in progress). This document defines demos that stress-test, showcase, and visualize GraphReFly's domain layer composition — and the testing philosophy that feeds back into the library itself.
>
> **Predecessor lessons:** callbag-recharge demos (H1–H4, D1–D6) established the pattern: `store.ts` = pure library code, component = framework rendering, no mocks. The caveat: AI implementors descoped demos to toys. This plan counters that with explicit acceptance criteria per demo.
>
> **Spec authority:** `~/src/graphrefly/GRAPHREFLY-SPEC.md`. Roadmap: `docs/roadmap.md`.

---

## Principles

### 1. The inspection layer IS the test harness

Every demo embeds GraphReFly's own introspection (3.3) as a visible panel. This serves three purposes:
- **Showcase:** developers see `describe()`, `observe()`, `toMermaid()`, `traceLog()` working on non-trivial graphs
- **Stress-test:** if the inspection tools misrepresent or miss state, the visual/code/graph mismatch exposes it
- **Feedback:** inspection tool gaps discovered in demos become library issues

### 2. Three synchronized views per demo

Every demo renders three interactive panes in a main/side split. Each pane can be toggled to full-screen.

```
┌───────────────────────────┬──────────────────┐
│                           │   Graph View     │
│    Visual View (main)     │   describe() +   │
│                           │   observe() +    │
│    The "app" UI users     │   toMermaid()    │
│    interact with directly │                  │
│                           ├──────────────────┤
│                           │   Code Pane      │
│                           │   source code    │
│                           │   with line      │
│                           │   highlighting   │
└───────────────────────────┴──────────────────┘
      ~60-70% width              ~30-40% width
      (content-dependent)
```

**Layout behavior:**
- Main pane (visual) dominates — this is the "app" the user interacts with
- Side pane stacks graph view (top) and code pane (bottom); ratio adjustable by dragging
- Each pane has a full-screen toggle (click to expand, click again to restore)
- Side pane width adapts to content: wider when graph is complex, narrower for simple topologies
- Mobile: panes stack vertically with tab switcher (Visual | Graph | Code)

**Cross-highlighting contract:**
- Hover on visual element → code pane scrolls to the `state()`/`derived()`/`effect()` that backs it → graph highlights the corresponding node(s) and edges
- Hover on graph node → visual element highlights → code pane scrolls
- Hover on code line → if it references a node, visual + graph highlight

**Implementation:** Each demo's `store.ts` exports a `nodeRegistry: Map<string, { codeLine: number, visualSelector: string }>` that the three-pane shell uses for cross-referencing. The graph view reads `describe()` output and matches by node path.

### 2b. Reactive layout engine (Pretext-on-GraphReFly)

The demo shell's layout — pane sizing, graph node sizing, text measurement for code pane line heights — is powered by a reactive layout primitive built on the [Pretext](https://github.com/chenglou/pretext) concept: pure-math text measurement without DOM layout thrashing.

**Why build it ourselves instead of wrapping Pretext:**
- Pretext is a black box (`PreparedText` opaque object). Rebuilding it as a GraphReFly graph means the layout itself is inspectable via `describe()`, snapshotable via `snapshot()`, and debuggable via `observe()`.
- Graph node sizing requires knowing text dimensions *before* rendering. Pretext's `prepare()` → `layout()` split maps directly to `state` → `derived`.
- The layout engine becomes a standalone reusable pattern (`graphrefly-layout`) that works in both browser (Canvas measurement) and server (snapshot hydration of measurements).

**Architecture:**

```
Graph("reactive-layout")
├── state("text")                    — input text content
├── state("font")                    — font family, size, weight
├── state("max-width")               — container constraint
├── derived("segments")              — text → segments (words, glyphs, emoji)
│                                      uses Canvas measureText() for widths (cached)
├── derived("line-breaks")           — segments + max-width → pure arithmetic line breaking
├── derived("height")                — line-breaks → total height
├── derived("char-positions")        — per-character x,y for hit testing (click → line number)
└── meta: { cache-hit-rate, segment-count, layout-time-ns }
```

**Usage in the demo shell:**
- **Graph pane node sizing:** each graph node's label runs through the layout engine to compute width/height before Mermaid renders — no "jumps" on re-render
- **Code pane line heights:** variable-height lines (long lines wrapping) computed instantly for virtual scroll
- **Pane size calculation:** side pane width derives from the graph pane's content width (how wide is the widest node label + padding?)

**Standalone value:** This pattern is useful beyond demos — anyone building reactive UIs with dynamic text (chat interfaces, editors, dashboards) needs DOM-free text measurement. It's a showcase of GraphReFly solving a real problem that React/Vue don't.

### 3. Acceptance criteria prevent descoping

Each demo below has numbered acceptance criteria (AC). An AI implementor MUST satisfy every AC or explicitly flag which ones it cannot meet and why. "Working but minimal" is not acceptable — the ACs define the minimum viable demo, not the stretch goal.

### 4. Framework bindings per demo

Each demo can use a different framework binding (5.1) to showcase breadth:
- Demo 1: Vanilla JS (zero framework, proves the core works standalone)
- Demo 2: React island (most popular framework)
- Demo 3: Vue island (good for reactive data visualization)
- AI Assistant: Preact island (lightweight, good for docs site integration)

Python demos use Pyodide/WASM lab in `graphrefly-py/website/`.

### 5. LLM demos use `cascadingLlmAdapter` (§9.3d)

All LLM demos use the library’s N-tier `cascadingLlmAdapter` — the demo itself IS the showcase for the adapter layer. Default stack (no API key required to start):

1. **BYOK tier (opt-in):** user pastes their own API key in a settings panel → `createAdapter({ provider, apiKey, model })`. Best quality. Settings persisted in `localStorage`.
2. **WebLLM tier:** **Gemma 4** (instruction-tuned **E2B** / **E4B** sizes) via WebLLM and WebGPU, in-browser inference — aligns with Google’s April 2026 open release (Apache 2.0, agentic / edge focus; see [Gemma 4 overview](https://ai.google.dev/gemma/docs/core/model_card_4)). Web Worker for inference, SharedWorker for memory state, Service Worker for model cache.
3. **Chrome Nano tier:** `chromeNanoAdapter()` — zero download, instant startup on Chrome 131+. `filter` skips tool-use requests (Nano can’t do structured output).
4. **FTS/pre-recorded fallback:** if all LLM tiers fail, degrade to keyword search or show pre-recorded traces with a "requires WebGPU or API key" banner.

Per-tier `withBreaker` — breaker opens on repeated failures, cascade falls through automatically. A status badge shows which tier is active. `onFallback` events visible in the debug panel.

- **Pinning models:** pass the exact `model_id` string accepted by `CreateMLCEngine()` from the installed `@mlc-ai/web-llm` package’s `prebuiltAppConfig.model_list`. MLC Hugging Face artifacts for Gemma 4 may land shortly after each Google drop; until a Gemma 4 entry appears there, use the newest compatible prebuilt in that list (do not hardcode a stale Qwen-only assumption in new demo code)

---

## Demo 1: Order Processing Pipeline

**Domain layers:** 4.1 (orchestration), 4.2 (messaging), 4.5 (CQRS), 1.5 (guards), 3.3 (inspector)

**Story:** A small e-commerce order flow. Customer submits order → validation → payment → fulfillment → notification. Manager can approve high-value orders. System rejects unauthorized access.

**Framework:** Vanilla JS (no framework dependency)

### Architecture

```
pipeline("order-flow")
├── topic("orders")                    — 4.2: incoming order stream
├── subscription("processor")          — 4.2: cursor-based consumer
├── task("validate")                   — 4.1: schema + inventory check
├── branch("value-check")             — 4.1: route by order value
│   ├── gate("auto-approve")          — 4.1: < $500 auto-approves
│   └── approval("manager-review")    — 4.1: >= $500 needs human
├── task("charge-payment")            — 4.1: payment processing
├── onFailure("payment-failed")       — 4.1: retry with backoff
├── task("fulfill")                   — 4.1: mark as shipped
├── cqrs("ledger")                    — 4.5: event-sourced order log
│   ├── command("place-order")        — 4.5: write-only
│   ├── event("order-placed")         — 4.5: immutable log
│   ├── event("order-shipped")        — 4.5: immutable log
│   ├── projection("order-stats")     — 4.5: read-only aggregate
│   └── saga("notify-customer")       — 4.5: event-driven side effect
├── guard: customer can submit, manager can approve, system processes
└── autoCheckpoint(indexeddb)          — 1.4b: persist across browser refresh
```

### Visual view (the "app")

- Order form (product, quantity, address)
- Order queue showing pending/processing/completed
- Live stats dashboard (total orders, revenue, avg processing time)
- Manager approval panel (only visible to manager actor)
- Activity feed (scrolling event log from topic)

### Acceptance criteria

- **AC-1:** Submit 10 orders in rapid succession; all 10 process through the pipeline without race conditions or lost orders. Verify via `observe("orders", { structured: true })` showing exactly 10 DATA messages.
- **AC-2:** Submit a $600 order; it pauses at `approval("manager-review")`. Switch to manager actor; approve it. Verify the pipeline resumes. The graph view shows the gate node status change in real time.
- **AC-3:** Simulate payment failure (checkbox "simulate failure"); `onFailure` triggers retry with exponential backoff. Visual view shows retry count. Graph view shows the `onFailure` node re-entering the pipeline.
- **AC-4:** CQRS projections: `order-stats` node reactively updates (total count, total revenue) as orders complete. The projection value is read-only — attempting to `set()` it throws `GuardDenied`. Verify in code pane that the guard enforcement is visible.
- **AC-5:** Refresh the browser. Orders in progress restore from IndexedDB checkpoint. The pipeline resumes from where it left off (not from the beginning). Verify via `Graph.diff(pre-refresh, post-refresh)` showing zero value changes for completed orders.
- **AC-6:** CQRS event replay: click "Rebuild projections" button. All events replay through the projection reducer. Final projection state matches pre-rebuild state exactly.
- **AC-7:** Guard enforcement: switch to "anonymous" actor. Order form is visible but submit is rejected with `GuardDenied`. Graph view shows which nodes the anonymous actor can observe (filtered `describe(actor)`).
- **AC-8:** Cross-highlighting: hover over the "Processing" badge on an order → code pane scrolls to the `task("validate")` or current pipeline step → graph highlights the active node with a pulse animation.
- **AC-9:** Graph view shows live Mermaid diagram updating as orders flow through. Nodes change color by status (idle=gray, active=blue, error=red, complete=green). `traceLog()` panel shows chronological pipeline events.
- **AC-10:** Performance: 100 orders submitted via "stress test" button. No dropped messages, no UI freeze (main thread stays responsive — heavy lifting in the graph, not the renderer).

---

## Demo 2: Multi-Agent Task Board

**Domain layers:** 4.1 (orchestration), 4.3 (memory), 4.4 (AI surface), 1.5 (guards), 3.3 (inspector), 3.2b (distill)

**Story:** A Kanban board where a human and an LLM agent collaborate on tasks. The LLM suggests task breakdowns, estimates, and next actions. The human approves, edits, or rejects. Both can create and move tasks. An agent memory persists learnings across sessions.

**Framework:** React island

**LLM:** WebLLM (**Gemma 4 E2B** IT, smallest edge-sized checkpoint) — no API key. Fallback: pre-recorded traces.

### Architecture

```
pipeline("workspace")
├── collection("tasks")               — 4.3: reactive task store with metadata
│   ├── task/1, task/2, ...           — state nodes (title, status, assignee, estimate)
│   └── decay scoring                 — 4.3: stale tasks sink in priority
├── agentLoop("assistant")            — 4.4: observe → plan → act → reflect
│   ├── fromLLM(webllm)              — 4.4: browser-local inference adapter
│   ├── toolRegistry("actions")       — 4.4: create-task, move-task, suggest-breakdown, estimate
│   └── chatStream("conversation")    — 4.4: streaming LLM responses
├── agentMemory("learnings")          — 4.4: composes distill()
│   ├── distill(conversation)         — 3.2b: extract lessons from chat
│   ├── llmExtractor(systemPrompt)    — 4.4: structured extraction
│   └── collection("memories")        — 4.3: scored + evicted memory store
├── pipeline("task-workflow")          — 4.1: kanban state machine
│   ├── task("triage")                — 4.1: new → backlog
│   ├── branch("assign")             — 4.1: human or AI
│   ├── gate("human-review")         — 4.1: AI work needs human approval
│   └── task("complete")             — 4.1: done
├── guards
│   ├── human: full access
│   ├── llm: can suggest, create draft tasks; cannot approve or delete
│   └── system: internal signals only
└── autoCheckpoint(indexeddb)
```

### Visual view

- Kanban board (Backlog | In Progress | Review | Done) with drag-and-drop
- Chat panel (human ↔ LLM conversation, streaming responses)
- Agent memory panel (what the LLM has learned, with scores and decay indicators)
- Task detail drawer (click task → see full history, LLM annotations, verification status)

### Acceptance criteria

- **AC-1:** Human creates a task "Build login page". LLM agent observes (via `observe("tasks")`) and within 5 seconds suggests a breakdown (3-4 subtasks) in the chat. Human accepts; subtasks appear on the board as draft tasks (assignee: "llm", status: "backlog").
- **AC-2:** LLM attempts to move a task to "Done" — `GuardDenied` fires. Chat shows "I can't mark tasks complete — that needs human approval." Graph view highlights the guard node that rejected the action.
- **AC-3:** Move a task through the full kanban pipeline: Backlog → In Progress → Review → Done. Each transition fires the orchestration pipeline. `observe("task-workflow", { causal: true })` shows which dep triggered each transition.
- **AC-4:** Agent memory: after 5+ chat exchanges, the LLM references a previous conversation topic accurately. The memory panel shows extracted memories with scores. Stale memories (from resolved tasks) decay visually.
- **AC-5:** `distill()` budget constraint: memory panel shows total token count. When budget (2000 tokens) is reached, lowest-scored memories evict. The eviction is visible in real time in the graph view (node removal from collection).
- **AC-6:** Streaming: LLM response appears token-by-token in the chat panel. The graph view shows `chatStream` node updating in real time. `observe("conversation", { timeline: true })` shows timestamped partial updates.
- **AC-7:** Session persistence: refresh browser. Tasks, chat history, and agent memories restore. The LLM still remembers context from the previous session (memories hydrate from checkpoint, not from re-reading chat).
- **AC-8:** `toolRegistry` visible in graph: each tool (create-task, move-task, etc.) is a node. When the LLM calls a tool, the corresponding node activates in the graph view. `traceLog()` shows the LLM's reasoning annotation before each tool call.
- **AC-9:** Cross-highlighting: hover over a task card → code shows the `state()` node for that task → graph highlights the task node and all edges (deps to workflow pipeline, connections to agent memory if referenced).
- **AC-10:** WebLLM graceful degradation: if WebGPU unavailable, a banner shows "WebGPU required for live AI — showing pre-recorded session." The demo replays a recorded `traceLog()` with the same visual behavior (tasks appear, move, chat populates).
- **AC-11:** Collection eviction: add 50 tasks, set `collection` max to 20. Oldest completed tasks evict reactively. `describe({ filter: { status: "settled" } })` confirms collection size stays bounded.

---

## Demo 3: Real-Time Monitoring Dashboard

**Domain layers:** 4.1 (orchestration), 4.2 (messaging), 4.3 (memory), 3.1 (resilience), 3.2 (data structures), 3.3 (inspector)

**Story:** A system health dashboard monitoring 5 microservices. Metrics stream in, alerts fire on thresholds, incidents auto-escalate through a pipeline. Historical metrics are retained with decay. Circuit breakers protect against cascading failures.

**Framework:** Vue island (reactive data binding is natural for dashboards)

**No LLM required** — this demo is pure reactive data flow, which makes it the best stress test for correctness.

### Architecture

```
pipeline("monitor")
├── topic("metrics")                   — 4.2: incoming metric stream (simulated)
│   ├── subscription("dashboard")     — 4.2: real-time consumer
│   ├── subscription("alerter")       — 4.2: threshold checker
│   └── subscription("archiver")      — 4.2: writes to collection
├── jobQueue("alerts")                 — 4.2: alert processing queue
│   └── jobFlow("escalation")         — 4.2: alert → notify → escalate → incident
├── collection("metric-history")       — 4.3: 1-hour retention with decay
│   ├── reactiveMap (metric → values) — 3.2: per-service metric store
│   └── decay scoring (age-based)     — 4.3: old metrics evict
├── pipeline("incident-response")      — 4.1: alert → triage → assign → resolve
│   ├── sensor("manual-alert")        — 4.1: human can file manual alert
│   ├── branch("severity")            — 4.1: P1 vs P2 vs P3 routing
│   ├── gate("oncall-ack")            — 4.1: P1 needs acknowledgment within 5min
│   ├── wait("sla-timer")             — 4.1: escalate if SLA breached
│   └── onFailure("escalate")         — 4.1: auto-escalate on timeout
├── resilience
│   ├── withBreaker("service-a")      — 3.1: circuit breaker per service
│   ├── rateLimiter("alert-flood")    — 3.1: prevent alert storms
│   └── retry("metric-fetch")         — 3.1: retry failed metric polls
├── pubsub("events")                   — 3.2: internal event bus
├── reactiveLog("audit-trail")         — 3.2: append-only incident log
└── reactiveIndex("metric-index")      — 3.2: dual-key lookup (service + metric name)
```

### Visual view

- 5-service grid with live sparklines (CPU, memory, latency, error rate)
- Alert ticker (scrolling alerts with severity badges)
- Incident timeline (Gantt-style: open → ack → resolving → resolved)
- Circuit breaker status panel (closed/open/half-open per service)
- Metric query panel (search by service + metric name via `reactiveIndex`)

### Acceptance criteria

- **AC-1:** Simulated metrics stream at 10 events/second across 5 services. Dashboard sparklines update smoothly. `observe("metrics", { timeline: true })` shows <5ms latency between publish and visual update.
- **AC-2:** Set CPU threshold to 80%. When simulated CPU for "service-a" crosses 80%, an alert appears in the ticker within 1 second. The alert flows through `jobQueue("alerts")` → `jobFlow("escalation")`. Graph view shows the message traversing the queue nodes.
- **AC-3:** Alert flood protection: trigger 50 alerts in 1 second. `rateLimiter` suppresses duplicates. Only unique alerts (by service + metric) enter the queue. `observe("alert-flood", { structured: true })` shows suppressed count.
- **AC-4:** Circuit breaker: simulate "service-b" returning errors 5 times. Breaker opens (visual turns red). After cooldown (10s), breaker enters half-open (yellow). Next success → closed (green). Graph view shows breaker state transitions via `observe("service-b-breaker", { causal: true })`.
- **AC-5:** Incident pipeline: P1 alert triggers `gate("oncall-ack")`. If not acknowledged in 5 seconds (simulated SLA), `wait("sla-timer")` expires → `onFailure("escalate")` fires → incident auto-escalates. Visual shows escalation in the incident timeline. `traceLog()` records each step.
- **AC-6:** Manual alert: click "File Incident" button → `sensor("manual-alert")` pushes into the pipeline. It follows the same path as automated alerts. Graph view shows the sensor node activation.
- **AC-7:** Historical metrics: `collection("metric-history")` retains 1 hour of data (simulated). Metrics older than 1 hour evict reactively. Sparklines use historical data for rendering. `describe({ filter: n => n.type === "state" })` shows collection size bounded.
- **AC-8:** `reactiveIndex` query: type "service-a cpu" in the metric query panel. Index returns matching metrics in <1ms. Results update reactively as new metrics arrive (the query is a derived node, not a one-shot function).
- **AC-9:** `reactiveLog("audit-trail")` shows chronological incident events. `logSlice(log, -20)` renders the last 20 entries. New entries append without re-rendering old ones.
- **AC-10:** Cross-highlighting: hover over "service-a" in the grid → graph highlights all nodes related to service-a (its metrics, breaker, alerts, incident if active) → code pane scrolls to the service-a metric subscription setup.
- **AC-11:** Stress test: increase to 100 events/second for 60 seconds (6000 events). No dropped messages (verify via `observe("metrics", { structured: true }).values.length`). Main thread stays responsive (measure via `requestAnimationFrame` jank counter < 5 frames dropped).
- **AC-12:** `Graph.diff()` display: click "Snapshot" at two different times. The diff panel shows which nodes changed values, which edges were added/removed. Useful for "what changed in the last 30 seconds?" debugging.

---

## Demo 4: AI Documentation Assistant

**Domain layers:** 4.3 (memory), 4.4 (AI surface), 3.2b (distill), 3.2 (data structures), 3.1 (resilience), 3.3 (inspector)

**Story:** An AI assistant embedded in the GraphReFly docs site that helps developers find the right tools for their projects. It builds agentic memory from browsing patterns, searches the docs with vector similarity, and recommends library features based on the user's described use case.

**Framework:** Preact island (lightweight, embedded in docs site)

**LLM:** 3-tier `cascadingLlmAdapter` (§9.3d) with graceful degradation:

| Tier | Adapter | UX | Quality | Capability |
|------|---------|-----|---------|------------|
| **Full-power (BYOK)** | `createAdapter(userSettings)` | Settings panel, paste API key | Best — Claude/GPT/Gemini | Full: tool use, structured extraction, streaming |
| **Privacy/offline** | `webllmAdapter("gemma-4-e4b")` | 1-4GB download, then offline | Good — quantized 4B | Moderate: chat, summarization, basic extraction |
| **Zero-friction** | `chromeNanoAdapter()` | Instant, zero download | Basic — Gemini Nano 1.8B | Limited: simple Q&A, no tool use |
| **Keyword fallback** | FTS5 search (no LLM) | Always available | N/A | Keyword search only |

Per-tier `withBreaker` from `src/extra/resilience.ts` — breaker opens on repeated failures, cascade falls through. `filter` skips Chrome Nano for tool-use requests. Settings UI persists BYOK keys in `localStorage` (encrypted at rest via Web Crypto API). Tier selection is automatic — user just starts chatting. A status badge shows which tier is active.

**Predecessor:** callbag-recharge H2 design (WebLLM, three workers, FTS5 fallback). Upgraded from single-tier (WebLLM-only) to N-tier cascade per §9.3d.

### Architecture

```
pipeline("docs-assistant")
├── cascadingLlmAdapter("llm")            — 9.3d: N-tier LLM with automatic fallback
│   ├── tier[0]: createAdapter(byok)   — BYOK: user's own API key (Claude/GPT/Gemini)
│   │   └── withBudgetGate(caps)       — 9.3d: per-session spend cap (user-configurable)
│   ├── tier[1]: webllmAdapter(model)  — WebLLM: Gemma 4 E4B via WebGPU, cached in IndexedDB
│   │   └── withBreaker(threshold: 2)  — 3.1: OOM/WebGPU failure → fall through
│   ├── tier[2]: chromeNanoAdapter()   — Chrome Built-in AI: Gemini Nano, zero download
│   │   └── filter: skip tool-use reqs — Nano can't do structured tool calls
│   └── tier[3]: ftsOnly               — keyword search fallback, always available
├── chatStream("conversation")         — 4.4: streaming LLM responses
├── agentLoop("recommender")           — 4.4: analyze need → search docs → recommend
│   ├── toolRegistry("search-tools")   — 4.4: fts-search, vector-search, browse-api, list-examples
│   └── systemPromptBuilder()          — 4.4: inject library knowledge + user context
├── agentMemory("user-context")        — 4.4: what this user is building
│   ├── distill(conversation)          — 3.2b: extract user's project details, framework, pain points
│   ├── llmExtractor(prompt)           — 4.4: structured extraction of user intent
│   └── collection("profile")          — 4.3: scored user context memories
├── collection("docs-index")           — 4.3: reactive docs store
│   ├── vectorIndex("embeddings")      — 4.3: HNSW for semantic search
│   └── reactiveMap("fts")             — 3.2: full-text search fallback
├── knowledgeGraph("api-graph")        — 4.3: relationships between library features
│   ├── nodes: operators, sources, patterns, data structures
│   ├── edges: "composes", "alternative-to", "requires", "used-by"
│   └── reachable() for "what else might help?" recommendations
├── resilience
│   └── retry("llm-inference")         — 3.1: retry on OOM/timeout (per-tier, inside cascade)
├── pubsub("analytics")                — 3.2: track which docs pages users visit
└── reactiveLog("search-history")      — 3.2: append-only search log for improving recommendations
```

### Visual view

- Chat panel (bottom-right floating, expandable)
- Search results with relevance scores and source links
- "Recommended for you" sidebar based on agent memory
- API relationship graph (mini version of `knowledgeGraph`, clickable)
- Memory debug panel (toggle-able, shows what the assistant remembers about the user)
- **LLM tier selector** in settings: radio group — "Cloud (BYOK)", "Local only", "Offline", "No AI (keyword search)". Maps to §9.3d presets: `cloudFirstPreset`, `localFirstPreset`, `offlinePreset`, `grepOnlyPreset`. Active tier badge in the chat header.

### Acceptance criteria

- **AC-1:** User types "I'm building a real-time dashboard with React". Assistant responds with specific recommendations: `reactiveMap` for metrics, `fromTimer` for polling, `useSubscribe` hook for React binding. Each recommendation links to the relevant API doc page.
- **AC-2:** Follow-up: "What about handling API failures?" Assistant remembers the dashboard context (from `agentMemory`) and recommends `retry`, `withBreaker`, `rateLimiter` — not generic error handling, but specifically for the dashboard use case. Memory panel shows the extracted context: "user building real-time dashboard with React."
- **AC-3:** `knowledgeGraph` traversal: when recommending `reactiveMap`, the assistant also suggests `reactiveIndex` (related via "composes" edge) and `pubsub` (related via "alternative-to" for the pub/sub pattern). `reachable("reactiveMap", "downstream")` shows the recommendation chain.
- **AC-4:** `vectorIndex` search: user types "cancel previous request when new one comes in". Vector search finds `switchMap` (semantically similar to "cancel previous") even though the user didn't use the operator name. Relevance score shown.
- **AC-5:** Cascade degradation: simulate each tier failing in sequence. (a) Remove BYOK key → cascade skips tier 0, uses WebLLM. (b) Disable WebGPU → WebLLM breaker opens, cascade falls to Chrome Nano. (c) Non-Chrome browser → Nano unavailable, falls to FTS5. Each transition shows a status badge: "Using: Claude API" → "Using: Local AI (Gemma 4)" → "Using: Chrome AI" → "Using: Keyword search". `onFallback` events visible in debug panel.
- **AC-5b:** BYOK settings: user opens settings panel, selects provider (Anthropic/OpenAI/Google), pastes API key, picks model. Key persisted in `localStorage` (encrypted via Web Crypto). On save, cascade tier 0 re-initializes with new adapter. Requests immediately route through BYOK. Budget gate shows per-session spend.
- **AC-6:** Session persistence: refresh the page. Agent memory restores from IndexedDB. The assistant still knows the user is building a React dashboard. No need to re-explain context. BYOK key persists across sessions (encrypted in localStorage). WebLLM model cached in IndexedDB (no re-download).
- **AC-7:** Streaming responses: LLM output appears token-by-token. Code examples in responses render with syntax highlighting as they stream (not after completion). Streaming works across all tiers that support it (BYOK and WebLLM stream; Chrome Nano may not; FTS5 returns instantly).
- **AC-8:** Analytics: `pubsub("analytics")` tracks page visits. After the user browses 3+ API pages, the "Recommended for you" sidebar updates to show related operators. This is a derived node over the analytics topic + knowledge graph, not a hardcoded recommendation list.
- **AC-9:** Search history: `reactiveLog("search-history")` persists queries. The assistant uses this to avoid repeating recommendations. If the user searches for the same concept twice, the assistant says "You looked at this before — here's what changed since then" (or "here's a deeper dive").
- **AC-10:** Cross-highlighting in debug mode: toggle "Show graph" → the full assistant graph renders in a panel. Hover over a recommendation → graph highlights the `knowledgeGraph` node and the path that led to the recommendation. Hover over a memory → graph highlights the `distill` chain that extracted it. The cascade adapter's tier selection is visible as a node with live status.
- **AC-11:** Three-worker architecture: inference in Web Worker (no main-thread blocking), memory state in SharedWorker (survives tab close), model weights cached in Service Worker (no re-download). Verify: close tab, reopen → model loads from cache, memory intact. BYOK tier runs API calls in the main thread (no worker needed — just fetch).
- **AC-12:** `llmExtractor` structured output: extraction results are typed `{ framework: string, useCase: string, painPoints: string[], experienceLevel: string }`. Malformed LLM output is caught by validation and retried (not silently dropped). Graph view shows the extractor node's error/retry cycle. BYOK tier produces highest-quality extraction; lower tiers may produce partial results that merge into the profile over time.

---

## Testing Strategy

### Philosophy: inspection tools test themselves

The demos are not separate from testing — they ARE the test surface for the inspection layer. Every `observe()`, `describe()`, `traceLog()`, `toMermaid()`, `Graph.diff()`, and `reachable()` call in the demos is simultaneously:
1. A feature of the demo the user interacts with
2. An assertion that the inspection tool works correctly on a non-trivial graph
3. A stress test for edge cases (concurrent updates, large graphs, rapid state changes)

### Test layers

#### Layer 1: Unit tests (existing, extend per factory)

Each 4.x factory gets a test file following `test-guidance.md`:

```
src/__tests__/patterns/
├── orchestration.test.ts     ← exists
├── messaging.test.ts         ← 4.2
├── memory.test.ts            ← 4.3
├── ai-surface.test.ts        ← 4.4
└── cqrs.test.ts              ← 4.5
```

**What to assert:**
- Factory returns a `Graph` with expected topology (`describe()` output)
- Node types match (`state`, `derived`, `effect` in describe output)
- Edges are correctly wired
- Guards are correctly applied (allowed and denied actions)
- Meta nodes are registered and observable
- TEARDOWN propagation (factory `destroy()` cleans up all nodes)

#### Layer 2: Scenario tests (new)

Multi-step sequences that exercise factory composition:

```
src/__tests__/scenarios/
├── order-pipeline.test.ts         ← Demo 1 logic, no UI
├── agent-task-board.test.ts       ← Demo 2 logic, no UI
├── monitoring-dashboard.test.ts   ← Demo 3 logic, no UI
└── docs-assistant.test.ts         ← Demo 4 logic, no UI
```

**Each scenario test mirrors a demo's AC list** but runs headlessly (no DOM, no WebLLM). LLM responses are stubbed with deterministic fixtures. The test verifies the graph behavior, not the UI rendering.

**Example: order-pipeline.test.ts mirrors Demo 1 ACs:**
```ts
it("AC-1: 10 rapid orders all process without loss", () => { ... })
it("AC-2: high-value order pauses at approval gate", () => { ... })
it("AC-3: payment failure triggers retry with backoff", () => { ... })
it("AC-5: snapshot restore resumes in-progress orders", () => { ... })
it("AC-6: CQRS event replay produces identical projection", () => { ... })
```

#### Layer 3: Inspection stress tests (new)

Dedicated tests for the inspection layer under realistic load:

```
src/__tests__/inspection/
├── describe-under-load.test.ts
├── observe-concurrent.test.ts
├── diff-large-graphs.test.ts
├── mermaid-output.test.ts
└── trace-log-ring-buffer.test.ts
```

**What to assert:**
- `describe()` is consistent when called during batch drain (never sees DIRTY-only state)
- `observe({ structured: true })` counts match actual message counts (no lost events under concurrency)
- `observe({ causal: true })` correctly identifies trigger deps (not just "something changed")
- `observe({ timeline: true })` timestamps are monotonically increasing
- `Graph.diff()` on 500-node graphs completes in <10ms
- `toMermaid()` output is valid Mermaid syntax (parseable by mermaid-js)
- `traceLog()` ring buffer wraps correctly at capacity, oldest entries evict first
- `reachable()` traverses correct paths in mounted subgraph hierarchies

#### Layer 4: Adversarial tests (new)

Edge cases that the demos won't naturally hit but that correctness demands:

```
src/__tests__/adversarial/
├── concurrent-factory-compose.test.ts
├── guard-bypass-attempts.test.ts
├── snapshot-mid-batch.test.ts
├── topic-subscriber-during-drain.test.ts
└── collection-evict-during-read.test.ts
```

**What to assert:**
- Two factories sharing a mounted subgraph don't interfere (signals from factory A don't corrupt factory B's state)
- Guard enforcement cannot be bypassed by accessing node internals (`.down()` without actor still checks guard)
- `snapshot()` called during batch drain either waits for drain or produces a consistent snapshot (never partial)
- A `subscription()` added mid-drain receives messages from the correct offset (not from the beginning, not skipping)
- `collection()` eviction during a derived node's read phase doesn't cause stale references

### Test-inspection feedback loop

When a test or demo discovers an inspection tool gap, the workflow is:

1. **Observation:** "Demo 3 AC-4 shows the circuit breaker transitioning, but `observe({ causal: true })` says the trigger dep is the timer, not the error count. That's technically correct (the timer triggered the half-open check) but unhelpful for debugging."
2. **Issue filed:** inspection tool gap — causal trace should distinguish root cause from proximate cause
3. **Library fix:** improve causal trace to include a `rootCause` field or chain
4. **Test added:** adversarial test asserting the improved behavior
5. **Demo updated:** graph view now shows the root cause, not just the proximate trigger

This loop is the primary mechanism for improving the inspection layer. The demos are not just showcases — they are the ongoing test harness.

---

## Missing Building Blocks (to be exposed by demos)

### Known (from roadmap and design docs)

| Block | Needed by demo | Roadmap phase |
|-------|---------------|---------------|
| `topic()` / `subscription()` | Demo 1, 3 | 4.2 |
| `jobQueue()` / `jobFlow()` | Demo 1, 3 | 4.2 |
| `collection()` / `lightCollection()` | Demo 2, 3, 4 | 4.3 |
| `vectorIndex()` | Demo 4 | 4.3 |
| `knowledgeGraph()` | Demo 4 | 4.3 |
| `chatStream()` / `agentLoop()` | Demo 2, 4 | 4.4 |
| `fromLLM()` | Demo 2, 4 | 4.4 |
| `toolRegistry()` | Demo 2, 4 | 4.4 |
| `agentMemory()` / `llmExtractor()` | Demo 2, 4 | 4.4 |
| `cqrs()` / `command()` / `event()` / `projection()` / `saga()` | Demo 1 | 4.5 |
| `autoCheckpoint` + factory registry | Demo 1, 2, 3, 4 | 1.4b |

### Likely unknowns (predictions from demo design)

These will emerge during implementation. Documenting predictions so we can verify:

1. **Reactive cursor** — `subscription()` and `jobQueue()` both need a cursor that advances through a `reactiveLog`. Probably a shared primitive under 3.2 or a `cursor()` helper.

2. **Streaming node convention** — `chatStream()` needs partial value emission (token-by-token). Current `DATA` replaces the whole value. Need either: (a) `reactiveLog` internally (append chunks, derived concatenates), or (b) a convention like `DATA` with `{ partial: true, chunk: "..." }`, or (c) the `streamFrom` pattern designed but not implemented in callbag-recharge.

3. **Factory composition helper** — every 4.x factory creates a Graph, adds nodes, wires edges, sets meta. A `factoryBase(name, builder)` helper or established pattern prevents drift. Orchestration (4.1) already has this pattern in `pipeline()` + `registerStep()`.

4. **Cross-island state bridge** — demos in Astro islands need shared state. Options: (a) single graph, multiple islands subscribe to different subgraphs (simplest, requires graph in global scope), (b) `observe()` → custom events → another island's `restore()`, (c) SharedWorker holding the graph (most robust, most complex).

5. **Guard-aware describe for UI** — demos need to show "what can this actor do?" in the visual view. `describe(actor)` already filters, but demos need the inverse: "what is hidden and why?" — a `describe({ showDenied: true })` variant that includes hidden nodes with `{ denied: true, reason: "..." }`.

6. **Demo fixture system** — scenario tests need deterministic LLM responses. A `mockLLM(responses[])` adapter for `fromLLM()` that replays canned responses in order, with support for streaming (chunk-by-chunk emission with configurable delay).

7. **Time simulation** — Demo 3 has SLA timers and decay. Tests need `vi.useFakeTimers()` integration with `fromTimer`/`fromCron`/`wait`. The `monotonicNs()` clock in `core/clock.ts` needs a test-mode override.

---

## Execution Order

```
1. Stubs                    Write demo graph wiring as stubs to surface API shapes
                            (all 4 demos, no implementation, just types + TODO bodies)

2. Build 4.2 (messaging)   topic, subscription, jobQueue, jobFlow, topicBridge
                            + unit tests + scenario test: order-pipeline messaging subset

3. Build 1.4b              autoCheckpoint, factory registry, incremental snapshots
   (seamless persistence)   + unit tests + scenario test: snapshot round-trip under load

4. Build 4.3 (memory)      collection, lightCollection, vectorIndex, knowledgeGraph, decay
                            + unit tests + scenario test: monitoring-dashboard memory subset

5. Build 4.5 (CQRS)        cqrs, command, event, projection, saga, eventStore
                            + unit tests + scenario test: order-pipeline CQRS subset

6. Build 4.4 (AI surface)  chatStream, agentLoop, fromLLM, toolRegistry, agentMemory,
                            llmExtractor, llmConsolidator, systemPromptBuilder
                            + unit tests + scenario test: agent-task-board AI subset

7. Demo 1 (order pipeline) Full implementation with all 3 views, vanilla JS
                            Verify all 10 ACs

8. Demo 3 (monitoring)     Full implementation with all 3 views, Vue island
                            Verify all 12 ACs

9. Demo 2 (task board)     Full implementation with all 3 views, React island
                            Verify all 11 ACs (depends on WebLLM integration)

10. Demo 4 (docs assistant) Full implementation embedded in docs site, Preact island
                            Verify all 12 ACs (depends on WebLLM + vectorIndex)

11. Inspection stress tests Dedicated test suite from Layer 3 above
    + adversarial tests     Run against all 4 demo graphs headlessly
```

Demo 1 and 3 come before 2 and 4 because they don't require LLM integration, making them faster to ship and validate. The LLM demos (2, 4) build on the messaging + memory + CQRS foundations proven in demos 1 and 3.

---

## Three-Pane Shell — Built with GraphReFly (dogfooding)

The three-pane shell is itself a GraphReFly graph. This is not a cosmetic choice — the synchronized cross-highlighting is a reactive coordination problem: hover events propagate across panes, code scroll position derives from node selection, graph highlighting derives from hover state. Building it with the library dogfoods the exact primitives we're showcasing.

### Shell graph architecture

```
Graph("demo-shell")
│
│ ── Layout ──
├── state("pane/main-ratio")           — main pane width ratio (0.6–0.7, content-dependent)
├── state("pane/side-split")           — graph/code split ratio within side pane (0.5 default)
├── state("pane/fullscreen")           — which pane is fullscreen (null | "visual" | "graph" | "code")
├── state("viewport/width")            — window width (updated on resize)
├── derived("pane/main-width")         — viewport × main-ratio (or 100% if fullscreen=visual)
├── derived("pane/side-width")         — viewport × (1 - main-ratio) (or 100% if fullscreen=graph|code)
│
│ ── Reactive layout engine (Pretext-on-GraphReFly) ──
├── state("layout/font")               — code + graph label font config
├── derived("layout/graph-labels")      — measures all graph node labels via Canvas measureText()
│                                         (cached segments, pure-arithmetic width/height per label)
├── derived("layout/code-lines")        — measures code pane line heights for virtual scroll
│                                         (handles line wrapping at current pane width)
├── derived("layout/side-width-hint")   — suggests side pane width from widest graph label + padding
│
│ ── Cross-highlighting ──
├── state("hover/target")              — currently hovered node path (null when idle)
├── state("hover/source")              — which pane originated the hover ("visual" | "code" | "graph")
├── state("code/source")               — source code string
├── state("code/line-map")             — Map<nodePath, { startLine, endLine }>
├── derived("code/scroll-target")      — derives scroll line from hover/target + code/line-map
├── derived("graph/highlight-set")     — derives Set<nodePath> from hover/target + describe() edges
│                                        (highlights the hovered node AND its direct deps/dependents)
├── derived("visual/highlight-selector") — derives CSS selector from hover/target + nodeRegistry
├── derived("graph/mermaid")           — derives Mermaid string from graph.describe() of the DEMO graph
│                                        (re-renders when demo graph topology changes)
├── effect("graph/mermaid-render")     — calls mermaid.render() when mermaid source changes
├── effect("code/scroll")              — calls codePane.scrollToLine() when scroll-target changes
├── effect("visual/highlight")         — adds/removes CSS highlight class on visual elements
├── effect("graph/highlight")          — adds/removes CSS highlight class on Mermaid SVG nodes
│
│ ── Inspection ──
├── state("inspect/selected-node")     — node selected for detail panel (click, not hover)
├── derived("inspect/node-detail")     — describeNode() + observe({ structured: true }) for selected
├── derived("inspect/trace-log")       — traceLog() from demo graph, formatted for display
├── guard: read-only for the shell graph itself (demo graph has its own guards)
└── observe() on demo graph             — re-derive mermaid/detail when demo state changes
```

**Why this matters:** If the shell graph has bugs (stale highlights, scroll jank, missed hover events), those bugs are GraphReFly bugs. The shell IS an inspection stress test — it exercises `derived()` chains, `effect()` side-effects, `observe()` cross-graph subscription, and `describe()` topology rendering on every user hover.

### Shell graph inputs
- `demoGraph: Graph` — the demo's graph instance (observed, not owned)
- `codeSource: string` — the demo's store.ts source code
- `nodeRegistry: Map<string, { codeLine: number, visualSelector: string }>` — cross-reference map

### Panes
- **Visual pane:** demo-specific component (order form, kanban board, dashboard, chat). Emits hover events → `shell.set("hover/target", nodePath)`.
- **Code pane:** syntax-highlighted source with line numbers. `effect("code/scroll")` reacts to `derived("code/scroll-target")`. Emits hover on line → reverse-lookup via `code/line-map`.
- **Graph pane:** Mermaid diagram from `derived("graph/mermaid")`. `effect("graph/highlight")` adds CSS classes. Click on node → `shell.set("inspect/selected-node", path)` → detail panel renders `derived("inspect/node-detail")`.

### Cross-highlighting flow (all reactive, no imperative event wiring)

```
User hovers "Processing" badge in visual pane
  → visual pane calls shell.set("hover/target", "task/validate")
  → derived("code/scroll-target") recomputes → line 47
  → effect("code/scroll") fires → code pane scrolls to line 47, highlights lines 47-52
  → derived("graph/highlight-set") recomputes → {"task/validate", "input", "branch/value-check"}
  → effect("graph/highlight") fires → Mermaid SVG nodes get .highlighted class
  → derived("visual/highlight-selector") recomputes → ".order-card[data-step='validate']"
  → effect("visual/highlight") fires → adds .highlighted to matching DOM elements
```

All derived nodes use `equals` option for RESOLVED optimization — if hover/target doesn't change, nothing downstream fires. Diamond-safe: multiple effects read the same `hover/target` state without redundant recomputation.

### Acceptance criteria for the shell itself

- **Shell-AC-1:** The shell graph has ≤25 nodes. `describe()` output is clean and understandable. Verify: `Object.keys(shellGraph.describe().nodes).length <= 25`.
- **Shell-AC-2:** All panes render simultaneously without layout shift. Initial render completes within 100ms of graph construction. The layout engine computes all text dimensions before the first paint.
- **Shell-AC-3:** Cross-highlighting latency < 16ms (one frame). Measured: time from `shell.set("hover/target")` to last `effect` firing. Verify via `observe("hover/target", { timeline: true })` — delta between DATA timestamp and subsequent effect timestamps.
- **Shell-AC-4:** Graph pane re-renders Mermaid within 100ms of demo graph state change. `derived("graph/mermaid")` recomputes only when `describe()` topology actually changes (not on every DATA).
- **Shell-AC-5:** Code pane scroll-to-line works for files up to 500 lines. Smooth scroll animation, not jump. Virtual scroll uses `derived("layout/code-lines")` heights — no DOM measurement on scroll.
- **Shell-AC-6:** Full-screen toggle: click expand icon on any pane → that pane fills the viewport. `state("pane/fullscreen")` drives the transition. Other panes collapse with animation. Click again or press Escape → restores previous layout from `state("pane/main-ratio")` + `state("pane/side-split")`.
- **Shell-AC-7:** Main/side ratio is draggable. Side pane graph/code split is draggable. Both stored in state nodes. Side pane width defaults to `derived("layout/side-width-hint")` (computed from graph label widths) but user can override by dragging.
- **Shell-AC-8:** Mobile: panes stack vertically with tab switcher (Visual | Graph | Code). Cross-highlighting still works via tap (same `hover/target` state, different input method).
- **Shell-AC-9:** The shell graph itself is visible in a "meta" debug toggle — click "Show shell graph" and the shell's own `toMermaid()` renders, demonstrating recursion (a GraphReFly graph visualizing another GraphReFly graph).
- **Shell-AC-10:** Zero framework dependency in the shell graph logic. The `Graph("demo-shell")` + all derived/effect nodes are pure GraphReFly. Only the DOM effects (scroll, CSS class toggle, mermaid.render) touch the browser. Framework bindings (React/Vue/Preact) wrap the pane components, not the shell graph.
- **Shell-AC-11:** Reactive layout engine: graph node labels are measured via `derived("layout/graph-labels")` using Canvas `measureText()`. Node dimensions in the Mermaid diagram match the measured text — no clipping, no overflow. Measurement cache invalidates only when font or text changes (RESOLVED optimization).
- **Shell-AC-12:** Layout engine is extractable as a standalone pattern (`reactive-layout`). The `prepare → segments → line-breaks → height` pipeline is a self-contained Graph that other projects can use independently of the demo shell.
