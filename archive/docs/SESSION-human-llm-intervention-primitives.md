# Session — Human/LLM Intervention Primitives (Hub-First Architecture)

**Date:** 2026-04-28
**Trigger:** Discussion sparked by an interview-style article comparing Agent tool calls to ordinary function calls (5 differences, 3 failure modes). The conversation evolved into mapping the four-class error taxonomy (transient / LLM-self-correctable / user-only / structural) onto graphrefly, then deep into the user-only intervention surface — where current `pipelineGraph.gate({ approver })` only supports binary approve/reject. User pushed back on multiple over-engineered framings until the architecture collapsed onto a `hub` + standard envelope + a small set of sibling presets.

**Precedent sessions:**
- `SESSION-reactive-collaboration-harness.md` (7-stage loop, valve, gate)
- `SESSION-patterns-extras-consolidation-plan.md` (preset/building-block separation, naming rules)
- `SESSION-harness-engineering-strategy.md` (positioning vs LangGraph and AG-UI)

---

## Core Principle: Hub-First, Sibling Presets, Schema-Carrying Envelope

The single insight that collapses the design: **all human/LLM intervention modes are users of one substrate — the messaging hub plus a standard message envelope** (with a `schema` field describing the expected response shape). Specialized factories (`humanInput`, `approvalGate`, `tracker`, etc.) are **siblings on this substrate, not parent/child of one another**. Inline editing, steering, parameter changes, and stream cancellation are not new primitives — they are usage patterns of `derived` + `switchMap` over the same substrate.

```
                ┌─────────────────────────────────────┐
                │  Substrate: hub + Message envelope  │
                │   { id, schema?, expiresAt?,        │
                │     correlationId?, payload }       │
                └─────────────────────────────────────┘
                              ▲
        ┌───────────┬─────────┼──────────┬──────────────┐
        │           │         │          │              │
   humanInput  approvalGate  tracker  boundaryDrain  steeringInjection
   →Node<T>    →GateCtrl     →Cursor  →Node<T[]>     (push to topic)
   (runtime    (design-time   (park   (LLM boundary  (edit prompt/
   LLM↔human)  graph veto)    queue)   batch read)   params/adapter)
```

**Boundary test for "is this a primitive or a usage pattern?"**: If you can implement it by composing existing operators (`derived`, `switchMap`, `bufferWhen`, `state`, `topic`) over the substrate, it is a usage pattern. Only `hub`+`envelope` and `valve` (with adapter abort) are true primitives.

---

## 1. The Four-Class Error Taxonomy → Intervention Surface

| Error class | Recovery mechanism | graphrefly status |
|---|---|---|
| 1. Transient (network, rate limit) | Auto-retry with backoff | ✅ `retry`, `circuitBreaker`, `adaptiveRateLimiter`, `cascade`, `fallback` (extra/resilience) |
| 2. LLM self-correctable | Feed error back to LLM | ⚠️ `ErrorClassifier` (`self-correctable | structural`) + default regex classifier present in `harness/defaults.ts`. **Auto re-feed wiring incomplete** — EXECUTE/VERIFY are still shells per `project_harness_closed_loop_gap` memory. |
| 3. User-only | Pause, ask human | Partial: `pipelineGraph.gate({ approver })` supports binary approve/reject. Other shapes (input, choice, edit, feedback) currently require hand-rolled `state<T \| undefined>` + gating. |
| 4. Structural exception | Bubble up | ✅ Terminal `ERROR` propagation; `graph.observe`/`harnessProfile` for diagnosis; dry-run equivalence rule catches before paid inference. |

The conversation then drilled into class 3 (user-only) — where the design surface had been most under-formed — and onto a fifth axis the article omitted: **proactive human intervention**, where the LLM is going off-track or in a loop and the human wants to halt or redirect without LLM solicitation.

---

## 2. Why "5 Specialized Human-Input Primitives" Was the Wrong Answer

Initial proposal: `humanInput` / `humanChoice` / `humanEdit` / `humanFeedback` (plus existing `approvalGate`). User rejected this on first principles:

> "LLM's questions vary at runtime — sometimes string, sometimes choice, sometimes feedback. The user shouldn't have to find the right shaped box on the page for each."

The correct framing is **chat-UI parity**: ChatGPT/Claude/Cursor all use **one input box** and the LLM phrases its question in natural language. The semantic typing belongs in the LLM's prompt and response parsing, not in the graph topology.

Result: **one `humanInput` primitive** (free-form text channel between LLM and human), distinct from `approvalGate` which has a different role entirely.

### Why `approvalGate` is NOT a specialization of `humanInput`

A subsequent error in framing called `approvalGate` a "specialized humanInput with binary schema, latched". User caught this: the two have **different roles even though they share the substrate**.

| | `humanInput<T>` | `approvalGate` |
|---|---|---|
| Initiator | LLM or system, runtime decision | Designer wires it at a fixed topology point |
| Trigger | Node activation publishes prompt | Flow reaching the gate publishes prompt |
| Public return | `Node<T>` (response value as data) | `GateController` (controls edge propagation) |
| Downstream consumer | Reads T as data | Edge gates flow based on gate state |
| Latch | One-shot question | Typically latched (open stays open) |

They are **siblings on the same substrate**, not parent/child. Like `state` and `derived` are both built on the node protocol but neither is a specialization of the other.

---

## 3. Proactive Intervention Modes the Article Missed

Beyond LLM-asks-human (humanInput) and design-time-veto (approvalGate), the conversation surfaced modes commonly needed but rarely first-class in agent frameworks:

### a. Panic / Emergency stop

Currently the only way to halt an in-flight reactive collaboration session is `Ctrl+C` (kill the process). User wants minimal-scope, real-time, toggle-able cutoff.

**Already implemented**: `valve(source, { open: Node<boolean> })` is exactly this.

```ts
const killSwitch = state(true);                    // open by default
const safe = valve(llmOutput, { open: killSwitch });
killSwitch.set(false);  // panic — cut propagation
killSwitch.set(true);   // resume
```

Granularity is wherever the `valve` is placed: per-token-stream, per-LLM-call, per-subgraph, or at graph root. Multiple valves coexist trivially in a reactive model.

**Real gap**: `valve` cuts *propagation* but the in-flight LLM HTTP call keeps generating tokens (cost continues). The fix is **adapter-level AbortController hookup** so closing the valve also fires `abort()` on the in-flight request. This gap is shared with inline editing (§3d) and `switchMap`-driven steering — all need the same adapter abort path.

### b. Steering (redirect without halt)

Human pushes a corrective instruction; current generation should be abandoned in favor of new direction. `switchMap` — when upstream emits a new value, the inner stream is cancelled. Already shipped as a generic operator.

### c. Park-as-deferred (no halt at all)

User notices something worth tracking; doesn't want to interrupt the current run; files it for later. The article didn't cover this — LangChain calls it "Ambient Agents" (Lance Martin, 2025), and in industry it's done via async HITL with Kafka-style message buses.

**graphrefly fit**: messaging hub + topic + cursor reading. The `tracker()` factory pattern (memory: `project_reactive_tracker`) is exactly this — a cursor-based consumer of a `deferred` topic with no immediate effect on the main flow.

### d. Next-boundary injection

Human queues additional instructions while LLM is generating; instructions should be applied at the **next prompt boundary**, not interrupting the current token stream.

**Same mechanism as park — different consumer cadence**:

```ts
const injections = topic("injections");
const generationDone = derived([llmStream], ([s]) => s?.kind === "FINAL");
const nextTurnInputs = bufferWhen(injections, generationDone);
```

The hub-first architecture implies: **same topic, different cursor strategies, different consumer cadences**. Tracker reads continuously; LLM samples on `generationDone`; cron job consumer reads on a schedule. No new primitive — possibly a new operator (`bufferWhen(notifier)`) if we don't already have it.

### e. Inline mid-stream edit

Human edits a token in the LLM's emitted output; system reconstructs the prompt with the edit baked in and restarts generation. User initially guessed "stop LLM, re-input prompt = previous + already-emitted response + new options". Refined: not "new options" — **modified response prefix**.

```ts
const tokens = scan(llmStream, (acc, t) => acc + t, "");  // accumulate emitted tokens
const editedPrompt = derived(
  [originalPrompt, tokens, editSignal],
  ([p, accTokens, edit]) =>
    edit == null ? SENTINEL : reconstruct(p, accTokens, edit)
);
const llmStream = switchMap(editedPrompt, prompt => callLLM(prompt));
```

`switchMap` cancels the in-flight generation, the new derived value triggers a new call. **No new operators needed**, only the adapter-abort gap (§3a).

### f. Parameter / model / system-prompt changes (steering, generalized)

Same machinery as (e), but the editable input is sampling params (temperature, thinking_level), the adapter (model swap), or system prompt — not the response prefix. **The LLM call is just `(promptContent, params, adapter, systemPrompt) → stream` modeled as a `derived` over those four inputs**. Any of them changing fires `switchMap` cancellation and restart. The taxonomy of "what changed" is irrelevant to the topology.

### g. Parallel concurrent prompts

AG-UI's Interrupt-Aware Run Lifecycle draft has an Example 3 dedicated to this — multiple concurrent interrupts on the same run. **Free in reactive**: multiple `state` nodes coexist; nothing in graphrefly assumes a single pending prompt at a time.

### h. TTL / expiration

Each message in the prompts topic carries `expiresAt`. Consumers compose with `timeout` operator + fallback. AG-UI requires explicit protocol-level support (`expiresAt` field on Interrupt + RUN_ERROR on stale resume); we get it via standard composition.

### i. Cascading sub-agent cancellation

When a parent agent is killed, sub-agents cascade-cancel. Free in reactive: subscription cleanup propagates through subgraphs. AG-UI requires explicit "scoped state, tracing, cancellation" coordination.

### j. Background watcher LLM

A second LLM observes the first and can flag issues. Free in reactive: it's just another subgraph subscribing to the first's output topic.

### k. Generative UI (A2UI territory — out of scope)

LLM declares what UI components to render. Not done. Belongs in a later wave as an integration with Google's A2UI declarative format (§7).

---

## 4. The `responseSchema` Insight from AG-UI

AG-UI's [Interrupt-Aware Run Lifecycle draft](https://docs.ag-ui.com/drafts/interrupts) (Markus Ecker, 2026) introduces a `responseSchema` field on each interrupt:

```ts
type Interrupt = {
  id: string;
  reason: string;            // taxonomy: tool_call, input_required, policy_hold, ...
  message?: string;
  toolCallId?: string;
  responseSchema?: JsonSchema;
  expiresAt?: string;
  metadata?: Record<string, any>;
}
```

The schema simultaneously:

- Tells the **LLM** what response shape to expect when reading the response back (it can prompt the human accordingly).
- Tells the **UI** what form/widget to render — clients can build generic interrupt-rendering logic from schema alone.
- **Validates** the response payload before the agent sees it.

This unifies the would-be specializations:

| Use case | Schema |
|---|---|
| Approval | `{ approved: boolean }` |
| Approve-with-edits | `{ approved: boolean, edits?: T }` |
| Free input | `{ value: string }` or any T |
| Choice | `{ selected: oneOf [...] }` |
| Feedback | `{ verdict: "accept" \| "reject", reason: string }` |
| Multi-field | any JSON Schema |

**"Approve-with-edits" is not a specialized factory** — it is a schema convention used with `humanInput`. Belongs in docs/recipes, not API.

**Decision**: graphrefly's `Message<T>` envelope adds a `schema?: JsonSchema` field. `humanInput<T>` accepts schema; `approvalGate` is a sibling preset that also publishes via the substrate but with output shape `{ approved: boolean }` and returns a `GateController` rather than `Node<T>`.

---

## 5. The Architecture Crystallized

### True primitives (only two)

| Primitive | Role | Status |
|---|---|---|
| `hub` + standardized `Message` envelope (with `schema`) | Substrate for all task allocation, scheduling, and human/LLM coordination | Hub exists; envelope needs `schema` field added |
| `valve` (+ adapter abort hookup) | Runtime cut on a topology edge | `valve` shipped; **adapter AbortController gap is real and shared with §3a/d/e/f** |

### Sibling presets on the substrate

| Preset | Public return | Role |
|---|---|---|
| `humanInput<T>(prompt, schema?)` | `Node<T>` | LLM↔human runtime Q&A channel |
| `approvalGate` | `GateController` | Design-time veto on a topology edge |
| `tracker` | `Cursor` handle | Park-as-deferred queue consumer |
| `boundaryDrain` (composition pattern, not a factory) | `Node<T[]>` | Drain topic on boundary signal — for next-prompt injection |

### Usage patterns (not primitives)

- **Steering / inline edit / param change / model swap**: `derived([...editableInputs])` + `switchMap` over the LLM call. Free.
- **Background watcher**: a second subgraph subscribing to the first.
- **Parallel prompts**: just multiple coexisting humanInput nodes.
- **TTL**: `expiresAt` in envelope + `timeout` + `fallback`.

### Required topic naming convention

Standardize four well-known topic names in `patterns/messaging`:

| Topic | Carries | Consumed by |
|---|---|---|
| `prompts` | Outbound prompts (LLM-asked or system-asked) | UI / human-side |
| `responses` | Inbound responses, correlated by `correlationId` | humanInput, approvalGate readers |
| `injections` | Out-of-band instructions (proactive human input) | LLM (boundary drain), tracker (continuous) |
| `deferred` | Park-as-issue queue | tracker, post-run review |

UI discovers pending prompts by subscribing to a single well-known topic (`prompts`), not by scanning meta tags across the graph.

---

## 6. Real Gaps Identified

1. **Adapter AbortController hookup** — closing a `valve` or a `switchMap` cancellation does not yet propagate to the in-flight LLM HTTP call. Cost continues until completion. Shared by panic, steering, inline edit, parallel cancellations. **Highest-priority follow-up.** Belongs in `src/patterns/ai/adapters/_internal` and the adapter contract.
2. **`Message` envelope schema field** — add `schema?: JsonSchema` to the standard envelope so prompts/responses topics can carry response-shape declarations. Requires a tiny revision to `patterns/messaging` types.
3. **`bufferWhen(notifier)` operator** — needed for next-boundary injection (drain accumulated topic items when a boundary signal pulses). Verify whether existing buffer operators cover this; if not, add to `extra/operators/buffer.ts` (per consolidation plan §2).
4. **Standard topic naming preset** — provide `prompts`/`responses`/`injections`/`deferred` as named topic constants in `patterns/messaging` along with type-safe envelope helpers. Avoids each user inventing their own names.
5. **AG-UI translation adapter** — out of substrate scope, but a `compat/ag-ui/` or `patterns/integrations/ag-ui/` thin layer maps hub topic events 1:1 to AG-UI wire events. Does not add concepts; only translates format.
6. **A2UI generative UI capability** — separate, lower priority. Requires LLM nodes that emit A2UI JSON payloads (schema-constrained generation) into a `generativeUI` topic. Not core.
7. **Harness closed-loop wiring** (pre-existing gap from `project_harness_closed_loop_gap`) — EXECUTE/VERIFY shells need actuator + re-eval wiring so type-2 errors (LLM-self-correctable) auto-route. Not strictly part of this design but blocks the four-class error story from being end-to-end.

---

## 7. AG-UI vs A2UI — How They Fit

**AG-UI** (CopilotKit/community, 2025): event-based wire protocol over SSE/WebSocket/HTTP. Standardizes how an agent backend speaks to a user-facing app. Carries any typed event — token streams, tool calls, state deltas, interrupts, sub-agent traces. **Transport layer.**

**A2UI** (Google, December 2025; v0.9 April 2026): JSON declarative format describing a UI widget tree the agent wants rendered. Client renders using its trusted local widget catalog (security-first — agent never ships UI code). **Content/payload layer.**

Official metaphor: AG-UI is the postal service; A2UI is the letter inside the envelope. Together with **MCP** (agent ↔ tools, Anthropic) and **A2A** (agent ↔ agent, Google), they form a four-protocol stack where each owns one boundary.

### graphrefly's position

- **AG-UI building blocks** — graphrefly's reactive event model maps near-1:1: `graph.observe` on any node yields an event stream; topics map directly to AG-UI event categories. We get streaming chat, shared state, thinking steps, tool output streaming, custom events, parallel interrupts, sub-agent cancellation, and agent steering "for free" through reactive composition. The translation adapter (gap #5) is mechanical.
- **A2UI** — not done; not core. Belongs in a later wave as an upper-layer capability, separate from the substrate.

---

## 8. What This Conversation Corrected

### Initial framings rejected (and why)

- **"Five specialized humanInput factories"** — rejected. UX-incoherent (user shouldn't search for the right-shaped form); also makes type definition runtime-coupled in a way that's brittle.
- **"approvalGate is a specialization of humanInput"** — rejected. They share substrate but differ in role, initiator, and public return. Sibling presets, not parent/child.
- **"Steering is a separate intervention mode"** — collapsed into "an inline edit where the editable input is a parameter rather than response content". Same machinery (`derived` + `switchMap`).
- **"Three primitives: humanInput / approvalGate / valve"** — collapsed further. The substrate is the primitive; humanInput / approvalGate / tracker are sibling presets on it. Only `hub`+envelope and `valve` are truly primitive.

### Validated framings

- **Hub-first architecture** — messaging hub as the universal task allocation/scheduling base, for LLM tasks, human tasks, generic tasks alike (user's call).
- **Topic + cursor reading for multi-task pipeline reuse** — same mechanism powers tracker (deferred queue), boundary injection (LLM consumer with `generationDone` cursor), and ambient/async review (cron-cursor consumer).
- **Schema in envelope** — both LLM and UI see the same schema, response payload is validated against it. Eliminates the need for separate factory specializations.
- **Reactive advantages over LangGraph `interrupt`** — confirmed by [LangChain forum thread](https://forum.langchain.com/t/interrupt-vs-graph-taking-a-full-turn/172) where users found `interrupt()` makes nodes "really bloated" and refactored toward "let the graph run full START→END turns." This is exactly the reactive-waiting-by-default model graphrefly already has.

---

## 9. Implementation Sequencing (Not Implementing Now)

**Phase 0 — substrate fixes (small, mechanical):**
1. Add `schema?: JsonSchema` to `Message` envelope in `patterns/messaging` types
2. Add `bufferWhen(notifier)` operator to `extra/operators/buffer.ts` if not already covered
3. Define standard topic constants (`prompts`, `responses`, `injections`, `deferred`) in `patterns/messaging`

**Phase 1 — adapter abort path (high impact, not trivial):**
4. Adapter contract change: `LLMAdapter.call(spec) → { stream, abort }` so reactive-driven cancellation can fire `abort()`
5. Hook valve closure and `switchMap` inner-teardown to abort signal
6. Test: panic button stops generation cost, not just propagation

**Phase 2 — sibling presets:**
7. `humanInput<T>(prompt, schema?)` factory in `patterns/orchestration` (sibling to `approvalGate`)
8. `tracker` factory exposing cursor-based deferred queue API (formalize from `project_reactive_tracker` dogfood)
9. `boundaryDrain(topic, notifier)` composition helper (or document recipe if it's just `bufferWhen`)

**Phase 3 — AG-UI integration:**
10. `compat/ag-ui/` or `patterns/integrations/ag-ui/` translator: hub topics ↔ AG-UI event stream
11. Document the 1:1 event mapping table

**Phase 4 — A2UI (separate wave, not this design):**
12. Schema-constrained generation for A2UI payloads
13. `generativeUI` topic convention

**Out of scope for this design:** harness closed-loop (`project_harness_closed_loop_gap` is its own follow-up), A2UI generative UI capability (later wave).

---

## Open Questions

1. Should `humanInput` and `approvalGate` literally share an envelope publish path, or just conform to the same envelope shape independently? Sharing a path centralizes but couples; separate paths keep each preset minimal.
2. Where does the `responseSchema` validation happen — at envelope publish, at response receipt, or both? AG-UI does it at receipt before delivering payload; we should match unless we can cheaply validate twice.
3. Is `tracker` better named `parkedQueue` or `deferredTracker` to disambiguate from the harness `tracker()` retrospective dogfood pattern? They're related but not identical — the dogfood tracker is a richer construct.
4. Should `boundaryDrain` be a named factory or is it acceptable as a documented recipe (`bufferWhen(topic, generationDone)`)? Recipes don't compose well with discovery; factories add API surface. Lean toward recipe + named example unless we see ≥2 distinct callers.
5. Adapter abort: do we change the contract universally (breaking change to all adapter implementations) or add an optional `abortable: true` capability flag? Pre-1.0 we should just change it.

---

## Related Files

- `archive/docs/SESSION-reactive-collaboration-harness.md` — 7-stage loop, valve, gate
- `archive/docs/SESSION-patterns-extras-consolidation-plan.md` — preset/building-block separation, naming rules, gate-family disambiguation
- `archive/docs/SESSION-harness-engineering-strategy.md` — competitive positioning vs LangGraph
- `src/patterns/orchestration/pipeline-graph.ts:199-340` — current `gate()` implementation (binary)
- `src/patterns/messaging/` — current hub/topic primitives
- `src/extra/operators.ts` — `valve`, `switchMap`, buffer family
- `src/patterns/ai/adapters/` — site of adapter-abort gap
- `~/src/graphrefly/COMPOSITION-GUIDE.md` — composition patterns, lazy activation, SENTINEL
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` §5.8–5.12 — design invariants (no imperative triggers)
- `docs/optimizations.md` — backlog
- External: [AG-UI Interrupt-Aware Run Lifecycle draft](https://docs.ag-ui.com/drafts/interrupts), [A2UI v0.9](https://a2ui.org/)
