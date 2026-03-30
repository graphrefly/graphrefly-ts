# GraphReFly Cross-Repo Audit Plan

> 16 batches, 7 phases, covering both `graphrefly-ts` and `graphrefly-py`.
> Each batch is a self-contained prompt for a fresh Claude Code session.

## How to use

1. Open a new Claude Code chat
2. `cd` to the directory listed for that batch
3. Paste the prompt verbatim — each prompt writes its findings directly to `~/src/graphrefly-ts/docs/batch-review/`
4. Review findings, then move to the next batch

Batches within the same phase are independent and can run in parallel sessions.

---

## Phase A — Spec Invariant Compliance

### Batch 1: Core Protocol Invariants (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing two GraphReFly implementations (TypeScript and Python) for compliance with the shared protocol spec.

READ FIRST (do not skip):
- ~/src/graphrefly/GRAPHREFLY-SPEC.md — sections §1.1 through §1.4 (message protocol, invariants, directions)
- src/core/messages.ts, src/core/batch.ts, src/core/node.ts (TS implementation)
- ~/src/graphrefly-py/src/graphrefly/core/protocol.py, ~/src/graphrefly-py/src/graphrefly/core/node.py (Python implementation)

For each invariant below, check BOTH repos. Report violations, inconsistencies, or ambiguities.

CHECKLIST — cite file:line for each finding:

1. §1.1 Message shape: All communication uses `[[Type, Data?], ...]` — always array of tuples. No single-tuple shorthand leaks through any public or internal API boundary.

2. §1.3.1 DIRTY precedes DATA/RESOLVED: Within the same batch, [DIRTY] comes before [DATA, v] or [RESOLVED]. Check that derived/compute nodes always emit DIRTY before DATA. Raw/external sources may emit DATA without DIRTY (compatibility path) — verify this is intentional where it occurs.

3. §1.3.2 Two-phase push: Phase 1 (DIRTY) propagates through the ENTIRE graph before phase 2 (DATA/RESOLVED) begins. Check batch() implementation — does it defer DATA while letting DIRTY through immediately?

4. §1.3.3 RESOLVED enables transitive skip: When a node recomputes and finds value unchanged, it sends [RESOLVED] not [DATA, v]. Verify the equals check and RESOLVED emission in both repos.

5. §1.3.4 COMPLETE and ERROR are terminal: After either, no further messages from that node. Check enforcement. Also check resubscribable opt-in path.

6. §1.3.5 Effect nodes complete when ALL deps complete: Not ANY. Verify in node settlement logic.

7. §1.3.6 Unknown message types forward unchanged: Check that unrecognized types are not silently dropped or error. Both default forwarding and onMessage interception paths.

8. §1.3.7 Batch defers DATA, not DIRTY: Inside batch, DIRTY propagates immediately, DATA deferred until batch exits. Verify batch implementation.

9. §1.4 Directions: DATA/DIRTY/RESOLVED/COMPLETE/ERROR flow down. PAUSE/RESUME/INVALIDATE/TEARDOWN flow up. Check that no message flows the wrong direction.

OUTPUT FORMAT:
For each item, report one of:
- PASS (both repos) — with brief evidence
- VIOLATION (repo, file:line) — what's wrong and what the spec requires
- INCONSISTENCY (TS vs Py difference) — describe the divergence
- AMBIGUITY — spec is unclear, suggest clarification

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-1.md
```

---

### Batch 2: Node Primitive Contract (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing two GraphReFly implementations for compliance with the node primitive contract in the shared spec.

READ FIRST (do not skip):
- ~/src/graphrefly/GRAPHREFLY-SPEC.md — sections §2.1 through §2.8 (node construction, interface, meta, fn contract, options, onMessage, diamond, sugar)
- src/core/node.ts, src/core/sugar.ts, src/core/meta.ts (TS)
- ~/src/graphrefly-py/src/graphrefly/core/node.py, ~/src/graphrefly-py/src/graphrefly/core/sugar.py, ~/src/graphrefly-py/src/graphrefly/core/meta.py (Python)

CHECKLIST — cite file:line for each finding:

1. §2.1 Construction table: node(deps?, fn?, opts?) produces 6 behavior patterns based on what's provided (no deps/no fn = manual source, no deps/with fn = auto source, deps+fn returns value = reactive compute, deps+fn uses down() = custom transform, deps+fn returns nothing = side effect, deps/no fn = passthrough wire). Verify each pattern works correctly in both repos.

2. §2.2 Interface completeness:
   - get() returns cached value, never throws, even when disconnected
   - status returns one of: "disconnected" | "dirty" | "settled" | "resolved" | "completed" | "errored"
   - down(messages) sends downstream
   - up(messages) sends upstream
   - unsubscribe() disconnects, retains cached value, status becomes "disconnected"
   - meta is an object of subscribable nodes
   - Source nodes (no deps) do NOT have .up() or .unsubscribe()

3. §2.3 Meta companion stores: Each meta key is a subscribable node. Meta nodes appear in describe() output and are individually observable.

4. §2.4 fn contract:
   - Returns value → cache + auto-emit [[DIRTY], [DATA, value]] or [[DIRTY], [RESOLVED]]
   - Returns nothing → side effect, no auto-emit
   - Uses down() explicitly → no auto-emit from return value
   - Returns cleanup function → called before next invocation or on teardown
   - Throws → [[ERROR, err]] downstream

5. §2.5 Options: Verify all options exist and work: name, equals, initial, meta, resubscribable, resetOnTeardown, onMessage.

6. §2.6 onMessage contract:
   - Called for every message from every dep
   - Return true → consumed, skip default handling
   - Return false → default dispatch
   - Throws → [[ERROR, err]] downstream
   - depIndex and actions (down, emit, up) provided correctly

7. §2.7 Diamond resolution: Shared ancestor → derived node runs once per upstream change after all deps settle. Check bitmask implementation. Assert single recompute + correct final value.

8. §2.8 Sugar constructors: state(), producer(), derived(), effect(), pipe() all create nodes (not distinct types). Verify they map to the correct node(deps?, fn?, opts?) configurations per the spec table.

OUTPUT FORMAT:
For each item, report one of:
- PASS (both repos) — with brief evidence
- VIOLATION (repo, file:line) — what's wrong and what the spec requires
- INCONSISTENCY (TS vs Py difference) — describe the divergence
- AMBIGUITY — spec is unclear, suggest clarification

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-2.md
```

---

### Batch 3: Graph Container Contract (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing two GraphReFly implementations for compliance with the Graph container spec.

READ FIRST (do not skip):
- ~/src/graphrefly/GRAPHREFLY-SPEC.md — sections §3.1 through §3.8 and Appendix B (Graph construction, node management, edges, composition, namespace, introspection, lifecycle, persistence)
- src/graph/graph.ts (TS)
- ~/src/graphrefly-py/src/graphrefly/graph/graph.py (Python)
- src/__tests__/graph/graph.test.ts — for context on what's already tested (TS)
- ~/src/graphrefly-py/tests/test_graph.py (Python)

CHECKLIST — cite file:line for each finding:

1. §3.1 Construction: Graph(name, opts?) exists with correct signature.

2. §3.2 Node management: add(name, node), remove(name) (unregister + teardown), get(name) (shorthand for node(name).get()), set(name, value) (shorthand for down([[DATA, v]])), node(name) (returns node object).

3. §3.3 Edges: connect(fromName, toName) / disconnect(fromName, toName). Edges are PURE WIRES — no transforms. Verify no transform capability on edges.

4. §3.4 Composition: mount(name, childGraph) embeds child. Child nodes addressable under parent namespace. Lifecycle signals propagate parent → children.

5. §3.5 Namespace: Colon-delimited paths. Mount auto-prepends parent scope. Local names within graph. resolve(path) returns actual node.

6. §3.6 Introspection:
   - describe() returns JSON matching Appendix B schema (name, nodes, edges, subgraphs). Check actual output against the JSON schema in Appendix B.
   - observe(name?) returns subscribable source. observe() (no arg) gives all nodes prefixed with name.
   - Type inference in describe: state/derived/producer/operator/effect correctly inferred from node config.

7. §3.7 Lifecycle: signal(messages) broadcasts to all nodes. destroy() sends [[TEARDOWN]] to all.

8. §3.8 Persistence:
   - snapshot() → structure + current values as JSON
   - restore(data) → rebuild
   - Graph.fromSnapshot(data) → new graph
   - toJSON() → deterministic, sorted keys, returns PLAIN OBJECT (not string — verify ECMAScript note)
   - toJSONString() if implemented
   - Same state → same JSON bytes

9. Cross-check: Do the TS and Python implementations produce identical describe() and snapshot() output for equivalent graph structures? (Conceptually — actual key ordering may differ by language, but the schema and content should match.)

OUTPUT FORMAT:
For each item, report one of:
- PASS (both repos) — with brief evidence
- VIOLATION (repo, file:line) — what's wrong and what the spec requires
- INCONSISTENCY (TS vs Py difference) — describe the divergence
- AMBIGUITY — spec is unclear, suggest clarification

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-3.md
```

---

## Phase B — Pattern Consistency

### Batch 4: API Pattern Consistency (TS)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing the TypeScript GraphReFly implementation for internal API pattern consistency.

READ ALL source files (not tests):
- src/core/node.ts, sugar.ts, messages.ts, batch.ts, meta.ts, guard.ts, actor.ts
- src/graph/graph.ts
- src/extra/operators.ts, sources.ts, resilience.ts, backoff.ts, checkpoint.ts, cron.ts, pubsub.ts, reactive-base.ts, reactive-map.ts, reactive-log.ts, reactive-index.ts, reactive-list.ts
- src/index.ts, src/core/index.ts, src/graph/index.ts, src/extra/index.ts (barrel exports)

CHECK THE FOLLOWING — cite file:line for each finding:

1. CORE PRIMITIVES — Construction pattern:
   - Are node(), state(), derived(), producer(), effect(), pipe(), batch() all factory functions (not classes)?
   - Is Graph a class (per spec §3.1)?
   - Is the distinction clean and intentional?

2. EXTRA OPERATORS — All should be factory functions that accept a source node (or deps) and return a Node<T>:
   - map, filter, scan, reduce, take, skip, etc. — consistent signature pattern?
   - Do all follow curried form for pipe: `op(config)(source)` or direct `op(source, config)`? Which pattern and is it consistent?

3. EXTRA SOURCES — of, empty, never, throwError, fromPromise, fromIter, etc.:
   - All return Node<T>?
   - Consistent naming (from* prefix for adapters)?

4. RESILIENCE — CircuitBreaker, TokenBucket, withBreaker, rateLimiter, retry, backoff:
   - Which are classes vs factory functions? Is the choice consistent and justified?
   - Do classes follow same instantiation pattern?

5. DATA STRUCTURES — reactiveMap, reactiveLog, reactiveIndex, reactiveList, pubsub:
   - Factory functions or classes?
   - Consistent return type and API surface?

6. OPTIONS PATTERN:
   - Do all functions follow `(requiredArgs, opts?)` consistently?
   - Are options objects used (not positional args) for optional configuration?

7. NAMING:
   - camelCase for functions, PascalCase for classes/types consistently?
   - No mixed conventions?

8. RETURN TYPES:
   - Do operators consistently return Node<T> (or a documented wrapper)?
   - Any that return raw values, promises, or other unexpected types?

9. EXPORTS:
   - Are barrel exports (index.ts) complete — every public API exported?
   - Any internal-only symbols leaking?
   - Namespace exports (core, extra, graph) clean?

10. TYPE SAFETY:
    - Generic type parameters used consistently?
    - Any `any` types that should be narrower?

OUTPUT FORMAT:
For each item report:
- CONSISTENT — brief evidence
- INCONSISTENT (file:line vs file:line) — describe the divergence and recommend which pattern to standardize on
- CONCERN — potential issue worth discussing

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-4.md
```

---

### Batch 5: API Pattern Consistency (Py)

**Directory:** `~/src/graphrefly-py`

```
You are auditing the Python GraphReFly implementation for internal API pattern consistency.

READ ALL source files (not tests):
- src/graphrefly/core/node.py, sugar.py, protocol.py, meta.py, guard.py, subgraph_locks.py
- src/graphrefly/core/__init__.py
- src/graphrefly/graph/graph.py, __init__.py
- src/graphrefly/extra/tier1.py, tier2.py, sources.py, resilience.py, backoff.py, checkpoint.py, data_structures.py, cron.py
- src/graphrefly/extra/__init__.py
- src/graphrefly/__init__.py

CHECK THE FOLLOWING — cite file:line for each finding:

1. CORE PRIMITIVES — Construction pattern:
   - node(), state(), derived(), producer(), effect(), pipe(), batch() — all functions?
   - Graph — class?
   - Same class-vs-function decisions as TS? If different, is it justified by Python idioms?

2. PYTHON IDIOMS:
   - snake_case for functions/variables, PascalCase for classes consistently?
   - batch() uses context manager (with batch():) per spec §6.1?
   - pipe supports `|` operator per spec §6.1?
   - Resource cleanup via context managers where appropriate?

3. EXTRA OPERATORS:
   - Consistent signature pattern across tier1 and tier2?
   - Same curried-vs-direct pattern as TS, or different? If different, is it Pythonic?
   - All return Node?

4. CONCURRENCY MODEL:
   - Per-subgraph locks (spec §6.1) — does subgraph_locks.py implement correctly?
   - Thread safety: are shared mutation points protected?
   - Any asyncio integration? If so, is it consistent?

5. TYPE HINTS:
   - Present on all public functions?
   - Consistent style (PEP 604 unions vs Optional, etc.)?
   - Generic type parameters where needed?

6. EXPORTS (__init__.py):
   - All public APIs exported?
   - __all__ defined?
   - Internal symbols properly hidden (underscore prefix)?

7. CROSS-REPO CONSISTENCY:
   - For equivalent features, do TS and Python use the same pattern (class vs function)?
   - Are there unjustified divergences?
   - Message type representation: TS uses Symbol/string enum, Python uses Enum class (per spec §6.1)?

OUTPUT FORMAT:
For each item report:
- CONSISTENT — brief evidence
- INCONSISTENT (file:line vs file:line) — describe the divergence and recommend which pattern to standardize on
- CONCERN — potential issue worth discussing

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-5.md
```

---

## Phase C — callbag-recharge Pitfalls & Optimizations

### Batch 6: Core Design Lessons (TS + Py)

**Directory:** `~/src/callbag-recharge`

```
You are cross-referencing design lessons from callbag-recharge against both GraphReFly implementations to ensure known pitfalls and optimizations are addressed.

READ FIRST from this repo (callbag-recharge):
- docs/architecture.md (especially design invariants sections)
- docs/optimizations.md
- src/archive/docs/SESSION-8452282f-type3-breakthrough.md (two-phase push design)
- src/archive/docs/SESSION-8693d636-v4-output-slot.md (output slot optimization)
- src/archive/docs/SESSION-ce974b95-push-phase-memoization.md (RESOLVED/memoization)
- src/archive/docs/SESSION-f47ed59e-skip-dirty-cached-review-fixes.md (SKIP optimization)
- src/archive/docs/SESSION-callbag-native-promise-elimination.md (no raw Promise)
- CLAUDE.md (design invariants section)

THEN CHECK both GraphReFly repos:
- ~/src/graphrefly-ts/src/core/node.ts, batch.ts
- ~/src/graphrefly-py/src/graphrefly/core/node.py, protocol.py

CHECKLIST — cite file:line for each finding:

1. OUTPUT SLOT OPTIMIZATION (spec §6.2): null → single sink → Set<sink> storage. Saves ~90% memory for 0-1 subscriber nodes. Implemented in both repos?

2. SINGLE-DEP OPTIMIZATION (spec §6.3): When node has exactly one dep in unbatched path, MAY skip DIRTY and send DATA directly. Implemented? If not, is it a conscious decision?

3. EQUALS ASYMMETRY: On state: equals check skips emitting DIRTY entirely. On derived: sends DIRTY then RESOLVED (push-phase memoization). Both repos handle this correctly?

4. NO RAW PROMISE/FUTURE: Library code should not use `new Promise()`, `Promise.resolve().then()`, `asyncio.Future()`, or similar for reactive coordination. Check both repos for violations.

5. NO SETTIMEOUT FOR COORDINATION: No `setTimeout`, `queueMicrotask`, `asyncio.call_later` used for reactive coordination (only for genuine time-based operators like debounce/delay). Check both repos.

6. TWO-PHASE PUSH CORRECTNESS: The type-3 breakthrough established that DIRTY/RESOLVED is the correct protocol for glitch-free diamonds. Are there any code paths in either repo that bypass two-phase push when they shouldn't?

7. BATCH NESTING: callbag-recharge handles nested batch() correctly (only outermost batch triggers flush). Do both GraphReFly repos handle this?

8. TEARDOWN ORDERING: Resources (timers, subscriptions) must be cleaned up in correct order. Any potential leaks in either repo?

9. INSPECTOR.ENABLED PATTERN: callbag-recharge gates observer overhead behind a flag. Do GraphReFly repos have equivalent overhead gating for observe()?

10. DERIVED LAZINESS: Derived nodes should not compute at construction — only on first get() or first subscriber. Both repos correct?

OUTPUT FORMAT:
For each item:
- IMPLEMENTED (both) — brief evidence with file:line
- MISSING (repo) — what's missing and why it matters
- PARTIAL — implemented in one repo but not the other
- NOT APPLICABLE — explain why this doesn't apply to GraphReFly

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-6.md
```

---

### Batch 7: Operator Edge Cases (TS + Py)

**Directory:** `~/src/callbag-recharge`

```
You are cross-referencing operator edge cases from callbag-recharge tests against both GraphReFly implementations.

READ FIRST from this repo (callbag-recharge):
- src/__tests__/extra/edge-cases.test.ts (the big one — ~500 test cases)
- src/__tests__/extra/dedup-correctness.test.ts
- src/__tests__/extra/batch7-gaps.test.ts
- Scan for key patterns: error propagation, completion semantics, teardown cleanup, diamond behavior in operator chains

THEN CHECK operator implementations and tests in both GraphReFly repos:
- ~/src/graphrefly-ts/src/extra/operators.ts, sources.ts + src/__tests__/extra/operators.test.ts, sources.test.ts
- ~/src/graphrefly-py/src/graphrefly/extra/tier1.py, tier2.py, sources.py + ~/src/graphrefly-py/tests/test_extra_tier1.py, test_extra_tier2.py, test_extra_sources.py

CHECKLIST — for each operator category, identify edge cases tested in callbag-recharge but MISSING from GraphReFly tests:

1. MERGE: COMPLETE only after ALL inner sources complete (not ANY). Error from one source propagates immediately. Teardown of remaining sources on error.

2. SWITCHMAP: Inner subscription teardown on new outer emission. Outer completion waits for active inner. Error in inner propagates to output.

3. CONCATMAP: Queue semantics — inner sources run sequentially. Backpressure handling.

4. EXHAUSTMAP: Drop outer emissions while inner is active. No queue.

5. DEBOUNCE/THROTTLE: Timer cleanup on source completion. Timer cleanup on teardown. Leading vs trailing edge behavior.

6. BUFFER/BUFFERCOUNT/BUFFERTIME: Empty buffer on completion. Timer cleanup. Boundary conditions (exact count).

7. WINDOW/WINDOWCOUNT/WINDOWTIME: Inner window completion. Outer completion closes active window.

8. TIMEOUT: Cleanup when source completes before timeout. Reset on each emission.

9. TAKE/SKIP/FIRST/LAST: Completion after N items. Error propagation. Empty source handling.

10. COMBINE/ZIP/WITHLATESTFROM: Diamond glitches. Completion when one source completes. Error propagation.

11. CONCAT/RACE: Sequential vs first-wins semantics. Cleanup of losing sources in race.

12. DISTINCTUNTILCHANGED: Custom comparator. Reference vs value equality.

13. SHARE/CACHED/REPLAY: Refcount behavior. Late subscriber behavior. Cleanup on zero subscribers.

OUTPUT FORMAT:
For each operator, report:
- COVERED (both repos) — edge cases adequately tested
- GAP (repo, specific edge case) — missing test or missing implementation handling
- RISK — edge case exists in callbag-recharge that could bite GraphReFly users

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-7.md
```

---

### Batch 8: Data Structures & Resilience Lessons (TS + Py)

**Directory:** `~/src/callbag-recharge`

```
You are cross-referencing data structure and resilience patterns from callbag-recharge against both GraphReFly implementations.

READ FIRST from this repo (callbag-recharge):
- src/data/ (reactiveMap, reactiveLog, reactiveIndex, reactiveList, pubsub) — implementations
- src/__tests__/data/ — all test files
- src/utils/ (withBreaker, retry, backoff, rateLimiter, eviction, stateMachine, transaction) — implementations
- src/__tests__/utils/ — all test files
- Look for: edge cases, race conditions, cleanup patterns, state transition bugs

THEN CHECK both GraphReFly repos:
- ~/src/graphrefly-ts/src/extra/reactive-map.ts, reactive-log.ts, reactive-index.ts, reactive-list.ts, pubsub.ts, resilience.ts, checkpoint.ts
- ~/src/graphrefly-ts/src/__tests__/extra/reactive-data-structures.test.ts, reactive-map.test.ts, resilience.test.ts, checkpoint.test.ts
- ~/src/graphrefly-py/src/graphrefly/extra/data_structures.py, resilience.py, checkpoint.py
- ~/src/graphrefly-py/tests/test_extra_data_structures.py, test_extra_resilience.py

CHECKLIST:

1. REACTIVE MAP:
   - TTL expiration edge cases (exact boundary, concurrent access)
   - Eviction policy (LRU, FIFO, size-based) correctness
   - Reactive notifications on set/delete/expire
   - Iterator invalidation during mutation

2. REACTIVE LOG:
   - Append-only invariant (no update/delete)
   - Slice/tail reactivity on append
   - Memory bounds / rotation

3. REACTIVE INDEX:
   - Dual-key correctness
   - Sort order maintenance on insert/delete
   - Range query edge cases

4. REACTIVE LIST:
   - Positional operations (insert at, remove at, move)
   - Index stability after mutations
   - Reactive notifications per operation

5. PUBSUB:
   - Lazy topic creation and cleanup
   - Subscriber lifecycle (add, remove, topic teardown)
   - Message delivery guarantees (at-least-once? at-most-once?)

6. CIRCUIT BREAKER:
   - State transitions: closed → open → half-open → closed/open
   - Failure threshold accuracy
   - Half-open: single test request, then transition
   - Timer cleanup on teardown

7. RETRY/BACKOFF:
   - Max retries enforcement
   - Backoff calculation (exponential, linear, fibonacci) correctness
   - Jitter modes
   - Cleanup on teardown during backoff wait

8. RATE LIMITER / TOKEN BUCKET:
   - Token refill accuracy over time
   - Burst capacity
   - Edge case: zero tokens, maximum tokens

9. CHECKPOINT:
   - Round-trip fidelity (save → restore produces identical state)
   - Adapter error handling (file not found, corrupt data)
   - Concurrent checkpoint safety

OUTPUT FORMAT:
For each item, report:
- COVERED (both repos) — edge cases adequately tested
- GAP (repo, specific edge case) — missing test or missing implementation handling
- RISK — edge case exists in callbag-recharge that could bite GraphReFly users

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-8.md
```

---

## Phase D — Documentation

### Batch 9: Documentation Audit (TS)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing the TypeScript GraphReFly documentation for correctness and completeness per docs-guidance.md.

READ FIRST:
- docs/docs-guidance.md (the standard)
- docs/roadmap.md (to verify implementation state matches checkboxes)

THEN AUDIT:

1. JSDOC COMPLETENESS — Read every exported function/class in:
   - src/core/node.ts, sugar.ts, batch.ts, messages.ts, meta.ts, guard.ts, actor.ts
   - src/graph/graph.ts
   - src/extra/operators.ts, sources.ts, resilience.ts, backoff.ts, checkpoint.ts, cron.ts, pubsub.ts, reactive-map.ts, reactive-log.ts, reactive-index.ts, reactive-list.ts

   For each export, check:
   - [ ] Has structured JSDoc with description (starts with verb)
   - [ ] Has @param for each parameter
   - [ ] Has @returns with type and description
   - [ ] Has at least one @example with ```ts code block
   - [ ] Optional: @remarks, @seeAlso, @optionsType, @option where appropriate

   List any exports MISSING required JSDoc tags.

2. GEN-API-DOCS REGISTRY — Read website/scripts/gen-api-docs.mjs:
   - Is every exported function registered in REGISTRY?
   - Any registered functions that no longer exist?

3. GENERATED API PAGES — Spot-check 5 generated pages in website/src/content/docs/api/:
   - Do they match the current JSDoc? (Or are they stale?)

4. EXAMPLES:
   - Does examples/basic-counter.ts still work with current API?
   - Are there features that warrant examples but have none?

5. ROADMAP ACCURACY:
   - Do checked items in docs/roadmap.md match what's actually implemented in src/?
   - Any items marked done that aren't, or implemented but not marked?

6. SPEC ALIGNMENT:
   - Does implementation match `~/src/graphrefly/GRAPHREFLY-SPEC.md`?
   - Any intentional deviations documented in roadmap or optimizations?

7. llms.txt:
   - Does it exist? Is it current?

OUTPUT FORMAT:
- COMPLETE — meets docs-guidance.md standard
- MISSING (file:export) — what's missing
- STALE (file) — needs regeneration or update
- DIVERGENCE — implementation vs `~/src/graphrefly/GRAPHREFLY-SPEC.md`

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-9.md
```

---

### Batch 10: Documentation Audit (Py)

**Directory:** `~/src/graphrefly-py`

```
You are auditing the Python GraphReFly documentation for correctness and completeness.

READ FIRST:
- docs/docs-guidance.md (the Python-specific standard)
- docs/roadmap.md (to verify implementation state)

THEN AUDIT:

1. DOCSTRING COMPLETENESS — Read every public function/class in:
   - src/graphrefly/core/node.py, sugar.py, protocol.py, meta.py, guard.py, subgraph_locks.py
   - src/graphrefly/graph/graph.py
   - src/graphrefly/extra/tier1.py, tier2.py, sources.py, resilience.py, backoff.py, checkpoint.py, data_structures.py, cron.py

   For each public function/class, check:
   - [ ] Has docstring
   - [ ] Documents parameters (Args: section or @param equivalent)
   - [ ] Documents return value
   - [ ] Has at least one usage example
   - [ ] Consistent docstring format throughout (Google style? NumPy style? Pick one)

   List any public APIs MISSING docstrings or with incomplete docstrings.

2. EXPORTS (__init__.py):
   - Does each __init__.py export all public APIs?
   - Is __all__ defined and accurate?

3. ROADMAP ACCURACY:
   - Do checked items in docs/roadmap.md match what's actually implemented?
   - Cross-reference with actual source files.

4. SPEC ALIGNMENT:
   - Does implementation match `~/src/graphrefly/GRAPHREFLY-SPEC.md`?
   - Cross-check behavioral parity with graphrefly-ts where both expose the same feature.

5. EXAMPLES:
   - Does examples/basic_counter.py work with current API?
   - Any features lacking examples?

6. README:
   - Does it exist? Is the quick start accurate?
   - Install instructions correct?

OUTPUT FORMAT:
- COMPLETE — meets docs-guidance.md standard
- MISSING (file:export) — what's missing
- STALE (file) — needs regeneration or update
- DIVERGENCE — implementation vs `~/src/graphrefly/GRAPHREFLY-SPEC.md`

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-10.md
```

---

## Phase E — Test Coverage

### Batch 11: Test Coverage Audit (TS)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing the TypeScript GraphReFly test suite for coverage gaps per test-guidance.md.

READ FIRST:
- docs/test-guidance.md (the standard — contains specific checklists)
- ~/src/graphrefly/GRAPHREFLY-SPEC.md (behavioral authority)

THEN READ ALL TEST FILES:
- src/__tests__/core/node.test.ts
- src/__tests__/core/sugar.test.ts
- src/__tests__/core/protocol.test.ts
- src/__tests__/core/lifecycle.test.ts
- src/__tests__/core/on-message.test.ts
- src/__tests__/core/perf-smoke.test.ts
- src/__tests__/exports.test.ts
- src/__tests__/graph/graph.test.ts
- src/__tests__/graph/validate-describe-appendix-b.ts
- src/__tests__/extra/operators.test.ts
- src/__tests__/extra/sources.test.ts
- src/__tests__/extra/reactive-data-structures.test.ts
- src/__tests__/extra/reactive-map.test.ts
- src/__tests__/extra/resilience.test.ts
- src/__tests__/extra/checkpoint.test.ts

CHECK AGAINST test-guidance.md CHECKLISTS:

CORE PROTOCOL & NODE (§1, §2):
- [ ] Message shape: emissions are arrays of tuples (no shorthand at API boundaries)
- [ ] DIRTY before DATA/RESOLVED in two-phase push
- [ ] Batch defers DATA, not DIRTY
- [ ] RESOLVED when value unchanged per equals — downstream skips recompute (assert with COUNTERS)
- [ ] Diamond: shared ancestor → derived runs ONCE per change, correct final value (assert BOTH count AND value)
- [ ] ERROR from fn → [[ERROR, err]] downstream
- [ ] COMPLETE/ERROR terminal — no further messages
- [ ] Unknown types forward (forward-compat test)
- [ ] Meta keys as subscribable nodes
- [ ] onMessage: return true consumes, return false forwards, throw produces ERROR
- [ ] Resubscribable: reconnection after COMPLETE
- [ ] resetOnTeardown: cached value cleared

GRAPH (§3):
- [ ] add/remove/connect/disconnect
- [ ] Edges are wires only (no transforms)
- [ ] describe() matches Appendix B JSON schema
- [ ] observe(name?) message stream
- [ ] Mount and namespace resolution
- [ ] signal() and destroy()
- [ ] Snapshot round-trip (same state → same JSON)
- [ ] fromSnapshot() constructs working graph
- [ ] Guard enforcement (if implemented)

OPERATORS:
- [ ] Each tier 1 operator: happy path + DIRTY propagation + RESOLVED suppression + error/complete propagation + reconnect
- [ ] merge: COMPLETE after ALL sources (not ANY)
- [ ] Each tier 2 operator: same + teardown (timers, inner subs) + reconnect freshness + races
- [ ] Diamond resolution through operator chains

GENERAL:
- [ ] One concern per test (no bundled scenarios)
- [ ] Protocol-level assertions (message sequences, not just final values)
- [ ] Regression tests have spec references

OUTPUT FORMAT:
For each checklist item:
- COVERED — test file:line
- MISSING — what specific test case is needed
- WEAK — test exists but doesn't assert the right thing (e.g., checks value but not recompute count)

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-11.md
```

---

### Batch 12: Test Coverage Audit (Py)

**Directory:** `~/src/graphrefly-py`

```
You are auditing the Python GraphReFly test suite for coverage gaps per test-guidance.md.

READ FIRST:
- docs/test-guidance.md (the Python-specific standard)
- ~/src/graphrefly/GRAPHREFLY-SPEC.md (behavioral authority)

THEN READ ALL TEST FILES:
- tests/test_core.py
- tests/test_protocol.py
- tests/test_sugar.py
- tests/test_concurrency.py
- tests/test_graph.py
- tests/test_guard.py
- tests/test_extra_tier1.py
- tests/test_extra_tier2.py
- tests/test_extra_sources.py
- tests/test_extra_resilience.py
- tests/test_extra_data_structures.py
- tests/test_perf_smoke.py
- tests/test_smoke.py
- tests/bench_core.py

CHECK AGAINST THESE CHECKLISTS:

PYTHON-SPECIFIC:
- [ ] Concurrency tests: concurrent get(), per-subgraph locks, write conflicts, batch isolation across threads
- [ ] Context manager cleanup: batch (with batch():), resource cleanup
- [ ] Async operator tests use proper event loop patterns (asyncio)
- [ ] Guard/policy tests: allow/deny precedence, wildcard, composed policies
- [ ] Enum-based message types (not string comparison)
- [ ] pipe | operator syntax tested

CORE PROTOCOL & NODE (§1, §2):
- [ ] Message shape: emissions are arrays of tuples (no shorthand at API boundaries)
- [ ] DIRTY before DATA/RESOLVED in two-phase push
- [ ] Batch defers DATA, not DIRTY
- [ ] RESOLVED when value unchanged per equals — downstream skips recompute (assert with COUNTERS)
- [ ] Diamond: shared ancestor → derived runs ONCE per change, correct final value (assert BOTH count AND value)
- [ ] ERROR from fn → [[ERROR, err]] downstream
- [ ] COMPLETE/ERROR terminal — no further messages
- [ ] Unknown types forward (forward-compat test)
- [ ] Meta keys as subscribable nodes
- [ ] onMessage: return true consumes, return false forwards, throw produces ERROR
- [ ] Resubscribable: reconnection after COMPLETE
- [ ] resetOnTeardown: cached value cleared

GRAPH (§3):
- [ ] add/remove/connect/disconnect
- [ ] Edges are wires only (no transforms)
- [ ] describe() matches Appendix B JSON schema
- [ ] observe(name?) message stream
- [ ] Mount and namespace resolution
- [ ] signal() and destroy()
- [ ] Snapshot round-trip (same state → same JSON)
- [ ] fromSnapshot() constructs working graph
- [ ] Guard enforcement

OPERATORS:
- [ ] Each tier 1 operator: happy path + DIRTY propagation + RESOLVED suppression + error/complete propagation + reconnect
- [ ] merge: COMPLETE after ALL sources (not ANY)
- [ ] Each tier 2 operator: same + teardown (timers, inner subs) + reconnect freshness + races
- [ ] Diamond resolution through operator chains

GENERAL:
- [ ] One concern per test (no bundled scenarios)
- [ ] Protocol-level assertions (message sequences, not just final values)
- [ ] Regression tests have spec references

OUTPUT FORMAT:
For each checklist item:
- COVERED — test file:line
- MISSING — what specific test case is needed
- WEAK — test exists but doesn't assert the right thing (e.g., checks value but not recompute count)

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-12.md
```

---

## Phase F — Design Fitness (Pre-Phase 4 Gate)

### Batch 13: Superset-Deps Pattern Verification (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
CONTEXT: GraphReFly consolidated callbag-recharge's dynamicDerived into the single node() primitive. The design decision (documented in archive/docs/SESSION-graphrefly-spec-design.md) is: declare the SUPERSET of all possible deps at construction, then the fn selectively reads from them at runtime. The bitmask tracks which deps are dirty, but the dep array is fixed.

You are verifying this pattern works correctly for Phase 4 use cases (orchestration, agent loops, conditional branches).

READ:
- archive/docs/SESSION-graphrefly-spec-design.md — the design decision and rationale
- ~/src/graphrefly/GRAPHREFLY-SPEC.md §2.1, §2.4, §2.7 (node construction, fn contract, diamond resolution)
- src/core/node.ts — how deps are stored, bitmask sized, fn invoked (TS)
- ~/src/graphrefly-py/src/graphrefly/core/node.py — same (Python)
- src/extra/operators.ts — switchMap, concatMap (these create dynamic inner subscriptions)
- ~/src/callbag-recharge/src/core/dynamicDerived.ts — how the predecessor solved this (if file exists, search for dynamicDerived)

VERIFY:

1. SUPERSET PATTERN WORKS: Create a node with deps [A, B, C] where fn only reads A and B initially, then reads A and C based on a condition. Does the bitmask handle this correctly? Does the node recompute only when relevant deps change? Or does it recompute on ANY dep change even if fn ignores that dep?

2. RESOLVED CORRECTNESS: If dep B changes but fn doesn't read B (reading A and C instead), and the computed value is the same, does the node emit RESOLVED? Or does it emit DATA with the same value (wasting downstream recompute)?

3. DIAMOND WITH SUPERSET: In a diamond A→B, A→C, node D has deps [B, C] but fn only reads B. A changes. D gets DIRTY from both B and C. D recomputes reading only B. Is the bitmask correctly cleared for C even though fn didn't read it?

4. GRAPH.CONNECT AS ALTERNATIVE: Can Graph.connect/disconnect be used to add/remove deps at runtime? If so, does the bitmask resize? Are there race conditions during the resize?

5. SWITCHMAP AS ESCAPE HATCH: switchMap creates new inner subscriptions dynamically. Does this cover the dynamicDerived use case adequately? What are the limitations (e.g., no diamond resolution across the switchMap boundary)?

6. PHASE 4 READINESS: For these specific use cases, assess if the superset pattern is sufficient:
   a. pipeline() with conditional branches (if condition, run branch A, else branch B)
   b. agentLoop() where available tools change per iteration
   c. orchestration where a node's inputs depend on runtime routing

7. DOCUMENTATION GAP: The superset-deps design decision is in archive/docs/ but NOT in the spec or any user-facing doc. Should it be? An AI trying to implement dynamic behavior won't know about this pattern unless told.

OUTPUT FORMAT:
For each item:
- VERIFIED — works correctly, with evidence (file:line or test scenario)
- BUG — doesn't work as expected, describe the failure
- LIMITATION — works but with caveats that need documentation
- GAP — missing capability needed for Phase 4

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-13.md
```

---

### Batch 14: RxJS/Callbag Semantic Alignment for AI Ergonomics (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are assessing whether GraphReFly operators behave consistently with RxJS and callbag conventions, specifically for AI ergonomics — when an LLM trained on RxJS/callbag docs uses GraphReFly, will it produce correct code?

READ:
- ~/src/graphrefly-ts/src/extra/operators.ts (all operators)
- ~/src/graphrefly-ts/src/extra/sources.ts (all sources)
- ~/src/graphrefly-py/src/graphrefly/extra/tier1.py, tier2.py, sources.py

For each operator below, compare GraphReFly behavior against RxJS conventions. Flag ONLY intentional divergences that could trip up an AI or developer coming from RxJS:

OPERATORS TO CHECK (high-impact for AI users):

1. switchMap — Does inner teardown happen synchronously on new outer emission? Does outer complete wait for active inner? (RxJS: yes to both)

2. mergeMap/flatMap — Concurrent limit parameter? (RxJS: optional concurrent param)

3. concatMap — Is it mergeMap(fn, 1)? (RxJS: yes)

4. exhaustMap — Drop while active, or queue? (RxJS: drop)

5. merge — Static merge(a, b) vs instance .pipe(merge(b))? Completion semantics? (RxJS: completes when ALL complete)

6. combineLatest/combine — Does it emit on EVERY dep change after all have emitted once? (RxJS: yes). Does it emit the initial combination when all deps have values? (RxJS: yes)

7. withLatestFrom — Does it only emit when primary emits? (RxJS: yes)

8. zip — Does it complete when ANY source completes? (RxJS: shortest)

9. scan — Seed required or optional? Behavior without seed? (RxJS: optional, first value becomes accumulator)

10. reduce — Does it emit only on complete? (RxJS: yes)

11. debounceTime/debounce — Config format? (RxJS: ms number vs duration selector)

12. throttle — Leading/trailing options? (RxJS: { leading: true, trailing: false } default)

13. take(0) — Does it complete immediately? (RxJS: yes, emits COMPLETE)

14. startWith — Synchronous emission? (RxJS: yes)

15. share/shareReplay — Refcount behavior? Reset on zero subscribers? (RxJS: configurable)

FOR EACH:
- ALIGNED — behaves like RxJS
- DIVERGENT (intentional) — different for good reason. Is the reason documented?
- DIVERGENT (accidental) — should probably align
- UNDOCUMENTED — behavior exists but no docs explain the nuance

THEN ASSESS:
- Are there enough docs/examples to cover the nuances for AI users?
- Should we add a "Coming from RxJS" guide?
- Are operator names discoverable? (e.g., would an AI search for "flatMap" and find "mergeMap"?)

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-14.md
```

---

### Batch 15: AI Debugging Tooling Gap Analysis (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are assessing whether GraphReFly's introspection tools (describe, observe) are sufficient for AI-assisted debugging, comparing against callbag-recharge's Inspector which had 28 methods specifically designed for AI use.

READ:
- ~/src/graphrefly/GRAPHREFLY-SPEC.md §3.6 (describe + observe)
- src/graph/graph.ts — describe() and observe() implementations
- src/core/meta.ts — describeNode(), metaSnapshot()
- ~/src/graphrefly-py/src/graphrefly/graph/graph.py — same

THEN READ the predecessor's Inspector for comparison:
- ~/src/callbag-recharge/src/core/inspector.ts (991 lines, 28 methods)

Key Inspector capabilities that GraphReFly may be missing:

CALLBAG-RECHARGE INSPECTOR HAD:
- observe() → ObserveResult with { values, signals, events, dirtyCount, resolvedCount, completedCleanly, errored, dispose, reconnect }
- timeline() → timestamped events with batch context
- causalityTrace() → which dep triggered recomputation, dep values at time of trigger
- observeDerived() → per-evaluation dep snapshots
- annotate(node, reason) / traceLog() → AI reasoning trace (ring buffer)
- snapshot() → JSON designed for AI consumption (includes trace)
- toMermaid() / toD2() → diagram export
- spy() → observe + console logging
- dumpGraph() → pretty-print for CLI
- tap() → transparent passthrough for visualization
- enabled flag → zero overhead when disabled

ASSESS CURRENT GRAPHREFLY CAPABILITIES:

1. describe() — Static snapshot. What does it give? What's missing for AI debugging? Can an AI answer "why did node X get value Y?" from describe() alone?

2. observe() — Live message stream. What does it give? Can an AI correlate events across nodes? Is there a structured result object (counts, terminal state) or just raw messages?

3. Meta companion stores — Are they sufficient for an AI to understand what a node DOES without reading source code?

IDENTIFY GAPS — for each, assess priority (must-have before Phase 4 vs nice-to-have):

4. STRUCTURED OBSERVE RESULT: observe() should return an object with { values, dirtyCount, resolvedCount, events } not just a raw stream. Priority?

5. CAUSAL TRACE: "Why did node X recompute?" — which dep triggered, what was the chain. Could be observe(name, { trace: true }). Priority?

6. TIMELINE: Timestamped events with batch context for post-mortem analysis. Priority?

7. DIFF: graph.diff(snapshotA, snapshotB) → which nodes changed, edges added/removed. Priority?

8. QUERY: Filtered describe() — graph.query({ status: "errored" }) or graph.describe({ filter: ... }). Priority?

9. REASONING TRACE: annotate(node, reason) for AI agents to record WHY they made decisions. Priority?

10. DIAGRAM EXPORT: toMermaid() / toD2(). Priority?

11. OVERHEAD GATING: enabled flag so all introspection is zero-cost in production. Priority?

12. LLM-SPECIFIC SURFACE: Is describe() output structured enough for reliable LLM parsing? Should there be graph.explain() for natural language? Priority?

OUTPUT FORMAT:
For each gap (4-12):
- PRIORITY: must-have-before-Phase-4 / should-have / nice-to-have
- EFFORT: S (half day) / M (1-2 days) / L (3+ days)
- RECOMMENDATION: specific API sketch or approach
- JUSTIFICATION: what Phase 4 use case needs this

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-15.md
```

---

### Batch 16: Integration Stress — Cross-Layer Interactions (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are the final audit pass. Read findings from prior batches, then design targeted test scenarios for cross-layer interactions that individual batches missed.

READ the batch review findings:
- docs/batch-review/batch-1.md through batch-15.md (read whichever exist)

THEN READ the key implementation files for cross-referencing:
- src/core/node.ts, src/core/batch.ts (TS)
- src/graph/graph.ts (TS)
- src/extra/operators.ts (TS)
- ~/src/graphrefly-py/src/graphrefly/core/node.py, protocol.py (Py)
- ~/src/graphrefly-py/src/graphrefly/graph/graph.py (Py)

DESIGN targeted test scenarios for these cross-layer interactions. For each scenario, explain what could go wrong and why prior batches might have missed it:

1. BATCH + GRAPH + DIAMOND:
   - Graph with diamond topology (A→B, A→C, B→D, C→D). Wrap A.set() in batch(). Does D recompute exactly once? Does describe() show correct status after batch exits? Does observe(D) see the correct message sequence?

2. BATCH + OPERATORS + GRAPH:
   - Graph containing operator nodes (e.g., a switchMap node wired via graph.connect). Source updates inside batch(). Does the operator's inner subscription lifecycle interact correctly with batch deferral?

3. GRAPH.SIGNAL + OPERATOR CLEANUP:
   - graph.signal([[PAUSE]]) on a graph containing debounce/delay nodes. Do timers actually pause? Or do they keep firing during pause?

4. MOUNT + SNAPSHOT + RESTORE:
   - Parent graph with mounted child. snapshot() → destroy() → fromSnapshot(). Are mount relationships preserved? Are cross-subgraph edges restored?

5. GUARD + OBSERVE + META:
   - Node with guard restricting observe to certain actors. Does observe() correctly filter? Does describe() with actor correctly hide restricted nodes? What about meta sub-nodes of a guarded node?

6. ERROR + DIAMOND + BATCH:
   - In a diamond, one path errors during batch. Does the other path still settle correctly? Does the downstream diamond node receive ERROR? Or does it hang waiting for the errored dep to settle?

7. CONCURRENT BATCH + GRAPH (Python only):
   - Two threads both calling graph.set() inside separate batch() contexts. Do per-subgraph locks prevent interleaving? Can a batch in thread A see partial state from thread B's batch?

8. OPERATOR CHAIN + RESOLVED PROPAGATION:
   - A → map(x => x) → filter(x => x > 0) → derived. A emits same value twice. Does RESOLVED propagate through the entire chain? Or does one operator break the RESOLVED chain by emitting DATA?

9. LARGE GRAPH PERFORMANCE:
   - Graph with 1000+ nodes in a linear chain. batch() update to the root. How many intermediate allocations? Does the output slot optimization actually help? Is there a stack overflow risk from deep recursion?

10. SNAPSHOT DETERMINISM UNDER MUTATION:
    - Call snapshot() while a batch is in progress (DIRTY propagated but DATA not yet flushed). Is the snapshot consistent? Does it capture dirty state or wait for settlement?

OUTPUT FORMAT:
For each scenario:
- RISK LEVEL: high / medium / low
- WHAT COULD GO WRONG: specific failure mode
- WHY BATCHES MISSED IT: which dimension boundary it crosses
- SUGGESTED TEST: pseudocode test case (10-15 lines) for both TS and Py

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-16.md
```

---

## Phase H — Reactive Output Consistency

### Batch 17: Output Type Consistency (TS + Py)

**Directory:** `~/src/graphrefly-ts`

```
You are auditing both GraphReFly implementations for output type consistency. The design invariant (established in callbag-recharge SESSION-callbag-native-promise-elimination.md and reinforced by GraphReFly spec §5.6 "Everything is a node") is:

  **Every public function in the library returns Node<T>, Graph, void, or a plain synchronous value — never Promise<T>, Future, Awaitable, or async.**

Promise/Future bridges exist only for end-users exiting reactive-land (e.g., firstValueFrom). Internally, system boundary calls (IndexedDB, fetch, fs) should be wrapped into reactive sources immediately.

READ FIRST:
- ~/src/graphrefly/GRAPHREFLY-SPEC.md §5.6 ("Everything is a node")
- ~/src/callbag-recharge/src/archive/docs/SESSION-callbag-native-promise-elimination.md (predecessor precedent)
- docs/batch-review/batch-4.md and batch-5.md (prior pattern consistency findings, if they exist)

THEN AUDIT ALL EXPORTS in both repos:

**TypeScript** — read every exported function/class in:
- src/core/node.ts, sugar.ts, batch.ts, messages.ts, meta.ts, guard.ts, actor.ts
- src/graph/graph.ts
- src/extra/operators.ts, sources.ts, resilience.ts, backoff.ts, checkpoint.ts, cron.ts, pubsub.ts, reactive-base.ts, reactive-map.ts, reactive-log.ts, reactive-index.ts, reactive-list.ts
- src/index.ts, src/core/index.ts, src/graph/index.ts, src/extra/index.ts

**Python** — read every public function/class in:
- src/graphrefly/core/node.py, sugar.py, protocol.py, meta.py, guard.py, subgraph_locks.py
- src/graphrefly/graph/graph.py
- src/graphrefly/extra/tier1.py, tier2.py, sources.py, resilience.py, backoff.py, checkpoint.py, data_structures.py, cron.py
- src/graphrefly/__init__.py, src/graphrefly/core/__init__.py, src/graphrefly/graph/__init__.py, src/graphrefly/extra/__init__.py

CHECKLIST — cite file:line for each finding:

1. PUBLIC RETURN TYPES — For every exported function, classify its return type:
   - Node<T> / Node[T] → CORRECT (reactive output)
   - Graph → CORRECT (container)
   - void / None → CORRECT (fire-and-forget effect or mutation)
   - Plain synchronous value (string, number, object) → CORRECT for pure queries (get(), snapshot(), describe(), toJSON())
   - Promise<T> / async function → VIOLATION
   - Awaitable / Coroutine / Future → VIOLATION (Python)
   List ALL violations.

2. ADAPTER INTERFACES — Check any adapter interface types (CheckpointAdapter, future adapter contracts):
   - Do method signatures return Node<T> or void? Or Promise<T>?
   - Are callbacks typed to accept reactive returns?

3. INTERNAL PROMISE USAGE — Even if the public API is correct, check for internal `new Promise()`, `Promise.resolve()`, `await`, `async def`, `asyncio.Future()` usage:
   - System boundary wrapping (IDB, fetch, fs) → FLAG but acceptable IF wrapped in fromPromise/producer at the call site
   - Reactive coordination (waiting for a node to settle, racing subscriptions) → VIOLATION
   - Classify each occurrence as BOUNDARY (acceptable) or COORDINATION (violation)

4. CALLBACK PARAMETER TYPES — For functions that accept user callbacks:
   - Does the type allow sync, Promise, Node, and AsyncIterable returns? (maximum flexibility via fromAny pattern)
   - Or does it restrict to Promise-only or sync-only?

5. CROSS-REPO CONSISTENCY — For equivalent features in TS and Py:
   - Do both return the same category (reactive vs async vs sync)?
   - Any cases where TS returns Node<T> but Py returns Awaitable, or vice versa?

6. FIRSTVALUEFROM / TO-PROMISE ESCAPE HATCH:
   - Does it exist as a user-facing export? (CORRECT — user escape hatch)
   - Is it used internally in any production code? (VIOLATION)

OUTPUT FORMAT:
For each finding:
- CORRECT (file:line) — return type is reactive/sync as appropriate
- VIOLATION (file:line) — returns Promise/Future/Awaitable when it should return Node<T>
- BOUNDARY (file:line) — internal Promise for system boundary, acceptable but should be wrapped
- INCONSISTENCY (TS file:line vs Py file:line) — cross-repo divergence
- CONCERN — type allows too-narrow callback inputs (should use fromAny pattern)

IMPORTANT: Write your complete findings to ~/src/graphrefly-ts/docs/batch-review/batch-17.md
```

---

## Execution Summary

| Phase | Batches | Can parallelize? | Est. tokens per batch |
|-------|---------|------------------|-----------------------|
| **A** | 1, 2, 3 | Yes (all 3) | ~60-80k read |
| **B** | 4, 5 | Yes (both) | ~50-70k read |
| **C** | 6, 7, 8 | 6 first, then 7+8 | ~70-100k read |
| **D** | 9, 10 | Yes (both) | ~50-70k read |
| **E** | 11, 12 | Yes (both) | ~60-80k read |
| **F** | 13, 14, 15 | Yes (all 3) | ~60-90k read |
| **G** | 16 | After all others | ~40-60k read (mostly findings) |
| **H** | 17 | After Option C refactor | ~60-80k read |

**Total: 17 sessions, 8 phases.**

- Phases A-E: Original audit (spec compliance, patterns, predecessor lessons, docs, tests)
- Phase F: Design fitness for AI ergonomics and Phase 4 readiness (superset deps, RxJS alignment, AI tooling)
- Phase G: Integration stress test using findings from all prior batches
- Phase H: Reactive output consistency — no Promise/Future in public APIs (both repos)

Each batch writes findings directly to `~/src/graphrefly-ts/docs/batch-review/batch-N.md`.

### Recommended execution order

```
Phase A (1,2,3) ──┐
Phase B (4,5) ─────┤
Phase C (6,7,8) ───┼── can overlap ──→ Phase F (13,14,15) ──→ Option C refactor ──→ Phase H (17) ──→ Inspector (3.3) ──→ Phase D (10) + Phase E (12) + Phase G (16)
Phase D (9) ───────┤
Phase E (11) ──────┘
```

Phase F can start as soon as Phase A and C are done (they provide context for the design questions).

Run Phase A (1,2,3) ──→ Hand in ──→ Fix spec violations + ambiguities
                                      (these are foundational — everything else depends on them)

Run Phase B+C (4-8)  ──→ Hand in ──→ Fix pattern inconsistencies + missing optimizations
                                      (now the core is solid, clean up the surface)

Run Phase D(9)+E(11) ──→ Hand in ──→ Fix doc gaps + test gaps (TS only)
                                      (docs and tests for the now-correct code)

Run Phase F (13-15)  ──→ Hand in ──→ Address design fitness findings

**Option C refactor** ──→ Eliminate all Promise returns from public APIs (checkpoint.ts + any others).
                          Build fromIDBRequest, fromIDBTransaction reactive primitives.
                          Update adapter interfaces to return Node<T>.
                          Apply same treatment to graphrefly-py (asyncio → Node).

Run Phase H (17)     ──→ Hand in ──→ Verify reactive output consistency across both repos
                                      (confirms Option C refactor is complete)

Build Inspector (3.3) remaining items ──→ timeline, causal, diagram, spy, dumpGraph

Run Phase D(10)+E(12)+G(16) ──→ Hand in ──→ Py docs + Py tests + integration stress
                                              (final passes, now everything is reactive-clean)