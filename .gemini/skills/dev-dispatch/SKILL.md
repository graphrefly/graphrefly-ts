---
name: dev-dispatch
description: "Implement a feature or fix for GraphReFly (TS + PY) with planning, spec alignment, and self-test. Use when user says 'dispatch', 'dev-dispatch', 'implement', or provides a task. ALWAYS halts for approval before implementing. Run /parity afterward for cross-language check."
---

You are executing the **dev-dispatch** workflow for **GraphReFly** (cross-language: TypeScript + Python). Operational docs live in graphrefly-ts (this repo). Implementation may target graphrefly-ts, graphrefly-py (`~/src/graphrefly-py`), or both.

The user's task/context is: $ARGUMENTS

---

## CRITICAL RULES (read before every phase)

1. **ALWAYS HALT after Phase 2.** Present your plan. Do NOT implement until the user approves.
2. **The spec is the authority.** `~/src/graphrefly/GRAPHREFLY-SPEC.md` decides behavior. Not your training data. Not the predecessor. The spec.
3. **Follow existing patterns.** Before writing new code, find the closest existing pattern in this repo and follow it. If you can't find one, say so in Phase 2.
4. **No async in public APIs.** TS: No `Promise<T>` in public APIs. PY: No `async def` / `Awaitable` in public APIs. All public functions return `Node<T>`, `Graph`, `void`/`None`, or a plain synchronous value.
5. **No raw time calls.** TS: No `Date.now()`/`performance.now()` — use `monotonicNs()`/`wallClockNs()` from `src/core/clock.ts`. PY: No `datetime.now()`/`time.time()` — use `monotonic_ns()`/`wall_clock_ns()` from `src/graphrefly/core/clock.py`.
6. **All durations and timestamps are nanoseconds.** Backoff strategies return `number` (ns). Use `NS_PER_MS` / `NS_PER_SEC` from `src/extra/backoff.ts` for conversions. Convert to ms only at `setTimeout`/`setInterval` call sites.
7. **Messages use tuple arrays.** TS: Messages are always `[[Type, Data?], ...]`. PY: Messages are always `list[tuple[Type, Any] | tuple[Type]]`. No single-tuple shorthand at API boundaries.
8. **Unknown message types forward.** Do not swallow unrecognized tuples.
9. **Thread safety is mandatory (PY).** All public PY APIs must be safe under concurrent access with per-subgraph RLock.
10. **No imperative polling or internal timers for composition.** Sources like `fromHTTP` must be one-shot reactive. If users need periodic behavior, they compose with `interval()`/`fromTimer()` externally. Only time-domain primitives (`fromTimer`, `interval`, `debounce`, `throttle`, `delay`, `timeout`, `bufferTime`, `windowTime`) and resilience retry/rate-limiting may use raw `setTimeout`/`setInterval`.
11. **No imperative triggers in public APIs.** Use reactive `NodeInput` signals instead of imperative `.trigger()` or `.set()` methods where possible.
12. **Run tests before reporting done.** TS: `pnpm test` must pass. PY: `cd ~/src/graphrefly-py && uv run pytest` must pass.

---

## Phase 1: Context & Planning

Read these files to understand the task. **Parallelize all reads.**

**Always read:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — deep-read sections relevant to the task
- `docs/roadmap.md` — find the roadmap item for this task (lives in this repo, graphrefly-ts)
- `docs/test-guidance.md` — testing checklist for the relevant layer (lives in this repo, graphrefly-ts)

**Read if relevant:**
- `docs/optimizations.md` — if touching protocol, batch, node lifecycle, or parity
- `docs/demo-and-test-strategy.md` — if this is a demo-related or domain-layer task
- Existing source files in the area you'll modify
- Existing tests for the area
- The closest existing pattern (e.g., `src/patterns/orchestration.ts` for domain factories)
- If the feature is PY-targeted, check the TS implementation at `src/` in this repo for reference

**Optional predecessor reference:**
- `~/src/callbag-recharge` — use for analogous operator behavior, edge cases, test ideas. Map to GraphReFly APIs. The spec wins on conflicts.

After reading, proceed to Phase 2. Do NOT start implementing.

---

## Phase 2: Architecture Discussion (HALT)

**STOP and present your plan to the user.** Include:

### 2a. What you understand the task to be
Restate the task in your own words. If anything is unclear, ask here.

### 2b. Files you will create or modify
List every file path. For new files, state where they go and why.

### 2c. The pattern you are following
Name the existing file whose structure you will mirror. Show how your new code maps to it. If no existing pattern fits, explain why and propose a structure.

Example: "Following `src/patterns/orchestration.ts` — `pipeline()` creates a Graph and adds nodes via `registerStep()`. My `topic()` will do the same: create a Graph, add internal nodes (`state("buffer")`, `derived("messages")`), return a bundle."

### 2d. Public API you will create
Show exact function signatures with types:
```typescript
function topic<T>(name: string, opts?: TopicOptions): TopicBundle<T>
```

### 2e. Internal graph topology (for domain factories)
If building a factory that returns a Graph, draw the internal node topology:
```
Graph("topic/{name}")
├── state("buffer") — reactiveLog internal
├── derived("messages") — logSlice(buffer, -retention)
└── ...
```

### 2f. Tests you will write
List the test file and test names:
```
src/__tests__/patterns/messaging.test.ts
- "publishes and subscribes"
- "late subscriber starts at current position"
- "retention: oldest messages evict"
- "TEARDOWN cascades to subscribers"
```

### 2g. Spec conformance check
For each invariant below, state whether your design complies and how:
- [ ] Messages are `[[Type, Data?], ...]`
- [ ] DIRTY before DATA/RESOLVED in two-phase push
- [ ] Unknown types forward
- [ ] No Promise<T> in return types
- [ ] Diamond resolution: recompute once after all deps settle
- [ ] Error handling: fn throws → `[[ERROR, err]]` downstream

### 2h. What you are NOT doing
Explicitly state what's out of scope. This prevents scope creep.

**WAIT for user approval. Do NOT proceed to Phase 3 until approved.**

---

## Phase 3: Implementation

After user approves:

1. **Implement the code** following your approved plan from Phase 2
2. **Create tests** following `docs/test-guidance.md`:
   - Put tests in the most specific existing file, or create a new file as stated in Phase 2
   - Use `graph.observe()` for message assertions where applicable
   - Assert both behavior AND topology (`describe()` output)
3. **Export the new public API:**
   - Add to the appropriate barrel export (`src/patterns/index.ts`, `src/extra/index.ts`, etc.)
   - Add to the package root export if user-facing
4. **Run tests:** TS: `pnpm test`. PY: `cd ~/src/graphrefly-py && uv run pytest && uv run mypy src/graphrefly/`.
5. **Fix any failures**

---

## Phase 4: Self-Verification

Before reporting done, verify:

- [ ] Tests pass — TS: `pnpm test`. PY: `cd ~/src/graphrefly-py && uv run pytest && uv run mypy src/graphrefly/`
- [ ] Your code follows the pattern you stated in Phase 2c
- [ ] Your public API matches the signatures you stated in Phase 2d
- [ ] Your tests cover the scenarios you listed in Phase 2f
- [ ] No async in public return types — TS: no `Promise<T>`. PY: no `async def` / `Awaitable`
- [ ] No raw time calls — TS: no `Date.now()`/`performance.now()`. PY: no `datetime.now()`/`time.time()`
- [ ] All durations/timestamps use nanoseconds; ms only at setTimeout call sites
- [ ] No internal polling loops — sources are one-shot reactive, compose with interval() for periodic
- [ ] Messages use correct format — TS: `[[Type, Data?], ...]`. PY: `list[tuple[Type, Any] | tuple[Type]]`

Report:
- Files created/modified
- New public exports
- Test results (pass count)
- Suggest running `/parity` to check Python alignment

---

## GUARDRAILS FOR FLASH-CLASS MODELS

These rules prevent common drift patterns. Re-read if unsure:

- **DO NOT add features beyond what was asked.** If the task says "implement `topic()`", implement `topic()`. Do not also implement `topicBridge()` unless asked.
- **DO NOT add docstrings, comments, or type annotations to code you didn't change.** Only comment where logic isn't self-evident.
- **DO NOT add error handling for impossible scenarios.** Trust internal code. Only validate at system boundaries (user input, external APIs).
- **DO NOT create helpers or abstractions for one-time operations.** Three similar lines are better than a premature abstraction.
- **DO NOT add backward-compat shims.** This is pre-1.0. Free to break APIs.
- **DO follow the file layout in the target repo's GEMINI.md/CLAUDE.md.** Core goes in `src/core/`, graph in `src/graph/`, operators in `src/extra/`, domain factories in `src/patterns/`.
- **DO use existing utilities.** Check `src/core/` and `src/extra/` for helpers before writing new ones.
- **DO check the sibling repo.** If implementing in PY, check the TS at `src/` in this repo. If implementing in TS, check PY at `~/src/graphrefly-py/src/graphrefly/`.
- **DO check the predecessor.** `~/src/callbag-recharge` often has the edge cases you'll miss. But reconcile with the spec — it wins.
