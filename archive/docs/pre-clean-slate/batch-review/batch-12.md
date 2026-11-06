# Batch 12: Test Coverage Audit (Py)

Top summary: **#covered 21 · #weak 8 · #missing 5** (34 checklist items)

## Python-specific

- COVERED — Concurrency tests: concurrent `get()`, per-subgraph locks, write conflicts, thread-isolated batch state (`tests/test_concurrency.py:26-63`, `tests/test_concurrency.py:65-90`, `tests/test_concurrency.py:92-130`, `tests/test_protocol.py:179-199`)
- WEAK — Context manager cleanup: `with batch()` semantics and exception path are tested, but no explicit resource-leak assertions for timer/thread cleanup (`tests/test_protocol.py:44-63`, `tests/test_protocol.py:147-165`, `tests/test_extra_sources.py:74-90`, `tests/test_extra_sources.py:92-97`)
- COVERED — Async operator tests use asyncio patterns (`tests/test_extra_sources.py:99-113`, `tests/test_extra_sources.py:137-142`, `tests/test_extra_tier2.py:108-120`, `tests/test_extra_tier2.py:221-235`)
- COVERED — Guard/policy allow/deny precedence, wildcard, and composed policies (`tests/test_guard.py:26-37`, `tests/test_guard.py:152-180`, `tests/test_guard.py:182-188`)
- COVERED — Enum-based message types (not string comparison) (`tests/test_protocol.py:27-42`)
- COVERED — `pipe |` syntax (`tests/test_sugar.py:133-139`)

## Core Protocol & Node (§1, §2)

- WEAK — Message shape arrays-of-tuples at API boundaries: structural sanity exists, but lacks strict negative tests for tuple shorthand rejection (`tests/test_protocol.py:18-25`)
- COVERED — DIRTY before DATA/RESOLVED in two-phase push (`tests/test_core.py:82-99`, `tests/test_graph.py:1058-1074`)
- COVERED — Batch defers DATA, not DIRTY (`tests/test_protocol.py:44-77`)
- WEAK — RESOLVED on unchanged value is asserted, but downstream recompute-skip counter assertions are missing (`tests/test_core.py:284-302`)
- COVERED — Diamond: shared ancestor recomputes once with correct value (`tests/test_core.py:304-324`)
- COVERED — `fn` throw produces `[[ERROR, err]]` downstream (`tests/test_core.py:245-266`, `tests/test_core.py:326-343`)
- MISSING — COMPLETE/ERROR terminal behavior test: add `test_terminal_blocks_later_data_when_not_resubscribable` (emit terminal, then DATA; assert no post-terminal DATA and no status/cache reactivation)
- COVERED — Unknown types forward unchanged (`tests/test_core.py:366-381`)
- COVERED — Meta keys as subscribable nodes (`tests/test_core.py:475-505`)
- COVERED — `onMessage`: `true` consumes, `false` forwards, throw -> ERROR (`tests/test_guard.py:193-216`, `tests/test_guard.py:217-234`, `tests/test_guard.py:236-254`)
- COVERED — Resubscribable reconnection after COMPLETE (`tests/test_core.py:346-364`)
- COVERED — `resetOnTeardown` clears cache (`tests/test_core.py:236-243`)

## Graph (§3)

- COVERED — `add/remove/connect/disconnect` (`tests/test_graph.py:23-33`, `tests/test_graph.py:57-123`)
- WEAK — Edges-as-wires-only: connect validation exists, but no explicit "no transform on edge" behavioral test (`tests/test_graph.py:86-104`)
- WEAK — `describe()` shape checks exist, but no strict Appendix B JSON schema validation (`tests/test_graph.py:982-1008`)
- COVERED — `observe(name?)` stream semantics (`tests/test_graph.py:544-561`, `tests/test_graph.py:1010-1047`)
- COVERED — Mount and namespace resolution (`tests/test_graph.py:171-205`, `tests/test_graph.py:302-329`)
- COVERED — `signal()` and `destroy()` (`tests/test_graph.py:207-218`, `tests/test_graph.py:756-782`, `tests/test_graph.py:1098-1114`)
- COVERED — Snapshot round-trip (`tests/test_graph.py:793-802`, `tests/test_graph.py:1049-1056`)
- COVERED — `fromSnapshot()` constructs working graph (`tests/test_graph.py:826-845`, `tests/test_graph.py:918-931`, `tests/test_graph.py:1077-1096`)
- COVERED — Guard enforcement (`tests/test_guard.py:49-73`, `tests/test_guard.py:114-130`, `tests/test_guard.py:297-310`)

## Operators

- MISSING — Tier 1 operator matrix test: for each tier1 operator, assert happy path + DIRTY propagation + RESOLVED suppression + error/complete propagation + reconnect behavior
- MISSING — `merge` completion test: add `test_merge_completes_after_all_sources_complete` (first source COMPLETE should not terminate merged stream; terminate only after all sources COMPLETE)
- MISSING — Tier 2 operator matrix test: for each tier2 operator, assert teardown (timers/inner subs), reconnect freshness, and race-handling with protocol-level assertions
- WEAK — Diamond resolution through operator chains exists as value-only assertion; missing recompute-count assertion at convergence (`tests/test_extra_tier1.py:302-311`)

## General

- WEAK — One concern per test: several tests bundle multiple concerns (examples: `tests/test_graph.py:80-112`, `tests/test_graph.py:458-474`)
- WEAK — Protocol-level assertions are inconsistent; many operator tests check final values only (examples: `tests/test_extra_tier1.py:38-45`, `tests/test_extra_tier1.py:58-65`, `tests/test_extra_tier1.py:163-169`)
- MISSING — Regression tests with explicit spec references: add `tests/test_regressions.py` cases with stable bug names and section anchors (e.g., `spec §1.3.7`)
