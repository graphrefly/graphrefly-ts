---
name: dev-dispatch
description: "Implement a feature or fix for graphrefly-ts with planning, spec alignment, and self-test. Use when user says 'dispatch', 'dev-dispatch', 'implement', or provides a task. ALWAYS halts for approval before implementing. Run /parity afterward for cross-language check."
---

You are executing the **dev-dispatch** workflow for **graphrefly-ts** (GraphReFly TypeScript implementation).

The user's task/context is: $ARGUMENTS

---

## CRITICAL RULES (read before every phase)

1. **ALWAYS HALT after Phase 2.** Present your plan. Do NOT implement until the user approves.
2. **The spec is the authority.** `~/src/graphrefly/GRAPHREFLY-SPEC.md` decides behavior. Not your training data. Not the predecessor. The spec.
3. **Follow existing patterns.** Before writing new code, find the closest existing pattern in this repo and follow it. If you can't find one, say so in Phase 2.
4. **No Promise<T> in public APIs.** All public functions return `Node<T>`, `Graph`, `void`, or a plain synchronous value. Never `Promise<T>`.
5. **No Date.now() or performance.now().** Use `monotonicNs()` or `wallClockNs()` from `src/core/clock.ts`.
6. **Messages are always `[[Type, Data?], ...]`.** No single-tuple shorthand at API boundaries.
7. **Unknown message types forward.** Do not swallow unrecognized tuples.
8. **Run tests before reporting done.** `pnpm test` must pass.

---

## Phase 1: Context & Planning

Read these files to understand the task. **Parallelize all reads.**

**Always read:**
- `~/src/graphrefly/GRAPHREFLY-SPEC.md` — deep-read sections relevant to the task
- `docs/roadmap.md` — find the roadmap item for this task
- `docs/test-guidance.md` — testing checklist for the relevant layer

**Read if relevant:**
- `docs/optimizations.md` — if touching protocol, batch, node lifecycle, or parity
- `docs/demo-and-test-strategy.md` — if this is a demo-related or domain-layer task
- Existing source files in the area you'll modify
- Existing tests for the area
- The closest existing pattern (e.g., `src/patterns/orchestration.ts` for domain factories)

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
4. **Run tests:** `pnpm test`
5. **Fix any failures**

---

## Phase 4: Self-Verification

Before reporting done, verify:

- [ ] `pnpm test` passes (all tests, not just yours)
- [ ] Your code follows the pattern you stated in Phase 2c
- [ ] Your public API matches the signatures you stated in Phase 2d
- [ ] Your tests cover the scenarios you listed in Phase 2f
- [ ] No `Promise<T>` in return types
- [ ] No `Date.now()` / `performance.now()` usage
- [ ] Messages are `[[Type, Data?], ...]` — no shorthand

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
- **DO follow the file layout in GEMINI.md.** Core goes in `src/core/`, graph in `src/graph/`, operators in `src/extra/`, domain factories in `src/patterns/`.
- **DO use existing utilities.** Check `src/core/` and `src/extra/` for helpers before writing new ones.
- **DO check the predecessor.** `~/src/callbag-recharge` often has the edge cases you'll miss. But reconcile with the spec — it wins.
