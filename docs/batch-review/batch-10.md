# Batch 10 — Documentation Audit (Py)

Scope: `graphrefly-py` docs audit per `docs/audit-plan.md` Batch 10.

Reviewed:

- `docs/docs-guidance.md`
- `docs/roadmap.md`
- `README.md`
- `examples/basic_counter.py`
- Public API modules listed in Batch 10 under `src/graphrefly/core`, `graph`, and `extra`
- Package export surfaces: `src/graphrefly/__init__.py`, `core/__init__.py`, `graph/__init__.py`, `extra/__init__.py`

---

- COMPLETE — `src/graphrefly/extra/tier1.py:27` (`map`) has structured docstring with `Args`, `Returns`, and `Examples`.
- COMPLETE — `src/graphrefly/extra/tier1.py:57` (`filter`) has structured docstring with `Args`, `Returns`, and `Examples`.
- COMPLETE — `src/graphrefly/extra/tier1.py:92` (`scan`) has structured docstring with `Args`, `Returns`, and `Examples`.
- COMPLETE — `src/graphrefly/extra/tier1.py:160` (`take`) has structured docstring with `Args`, `Returns`, and `Examples`.
- COMPLETE — `src/graphrefly/extra/tier1.py:663` (`combine`) has structured docstring with `Args`, `Returns`, and `Examples`.

---

- MISSING (`src/graphrefly/core/sugar.py:state`) — docstring exists but lacks parameter docs, return docs, and usage example.
- MISSING (`src/graphrefly/core/sugar.py:producer`) — docstring exists but lacks parameter docs, return docs, and usage example.
- MISSING (`src/graphrefly/core/sugar.py:derived`) — docstring exists but lacks parameter docs, return docs, and usage example.
- MISSING (`src/graphrefly/core/sugar.py:effect`) — docstring exists but lacks parameter docs, return docs, and usage example.
- MISSING (`src/graphrefly/core/sugar.py:pipe`) — docstring exists but lacks parameter docs, return docs, and usage example.

- MISSING (`src/graphrefly/core/node.py:node`) — docstring exists but is not structured (`Args`/`Returns`/example absent).
- MISSING (`src/graphrefly/core/node.py:SubscribeHints`) — missing class docstring.

- MISSING (`src/graphrefly/core/protocol.py:batch`) — docstring exists but lacks `Args`/`Returns`/example structure.
- MISSING (`src/graphrefly/core/protocol.py:is_batching`) — docstring lacks explicit return semantics and example.
- MISSING (`src/graphrefly/core/protocol.py:emit_with_batch`) — docstring lacks structured args/returns/example.

- MISSING (`src/graphrefly/core/meta.py:meta_snapshot`) — docstring lacks structured args/returns/example.
- MISSING (`src/graphrefly/core/meta.py:describe_node`) — docstring lacks structured args/returns/example.

- MISSING (`src/graphrefly/core/guard.py:policy`) — docstring lacks structured args/returns/example.
- MISSING (`src/graphrefly/core/guard.py:compose_guards`) — docstring lacks structured args/returns/example.

- MISSING (`src/graphrefly/graph/graph.py:Graph`) — class docstring present, but public methods are unevenly documented; top-level class docs are not sufficient for API-generation quality.
- MISSING (`src/graphrefly/graph/graph.py:reachable`) — has `Args` and `Returns` but no usage example.

- MISSING (`src/graphrefly/extra/tier2.py`) — most public operators (for example `switch_map`, `concat_map`, `flat_map`, `exhaust_map`, `debounce`, `throttle`, `timeout`, `window_time`) lack usage examples; several also lack complete `Returns` sections.

- MISSING (`src/graphrefly/extra/sources.py`) — many public source/sink functions (`of`, `empty`, `never`, `throw_error`, `from_iter`, `from_timer`, `from_any`, `for_each`, `to_list`, `first_value_from`, `share`, `replay`) have docstrings but no structured args/returns/examples.

- MISSING (`src/graphrefly/extra/resilience.py:CircuitOpenError`) — missing class docstring.
- MISSING (`src/graphrefly/extra/resilience.py`) — public APIs (`retry`, `with_breaker`, `token_tracker`, `rate_limiter`, `with_status`) lack full structured docs and examples.

- MISSING (`src/graphrefly/extra/backoff.py`) — public strategy helpers (`constant`, `linear`, `exponential`, `fibonacci`, `resolve_backoff_preset`) are missing usage examples; several are missing full args/returns structure.

- MISSING (`src/graphrefly/extra/checkpoint.py`) — checkpoint adapter classes and helper functions have docstrings but generally lack structured args/returns/examples needed by `docs-guidance.md`.

- MISSING (`src/graphrefly/extra/data_structures.py`) — public bundle classes and constructors (for example `ReactiveMapBundle`, `ReactiveLogBundle`, `ReactiveIndexBundle`, `ReactiveListBundle`, `PubSubHub`, `reactive_index`, `reactive_list`, `pubsub`, `log_slice`) are missing examples and often missing complete args/returns sections.

- MISSING (`src/graphrefly/extra/cron.py:CronSchedule`) — missing class docstring.
- MISSING (`src/graphrefly/extra/cron.py:parse_cron`, `matches_cron`) — docstrings present but not complete to standard (missing structured sections and examples).

- MISSING (docstring format consistency) — mixed styles across public surface (`Google` style in a subset of operators; many modules use short prose-only docstrings). This violates `docs/docs-guidance.md` requirement to pick one format and use it consistently.

---

- MISSING (`src/graphrefly/__init__.py`) — top-level package does not re-export the full graph API surface exposed by `src/graphrefly/graph/__init__.py` (for example `SpyHandle` is exported in `graph.__all__` but not in top-level `graphrefly.__all__`).

- COMPLETE (`src/graphrefly/core/__init__.py`) — `__all__` exists and matches imported public core symbols.
- COMPLETE (`src/graphrefly/graph/__init__.py`) — `__all__` exists and accurately exports graph container symbols.
- COMPLETE (`src/graphrefly/extra/__init__.py`) — `__all__` exists and includes public extra operators/sources/utils.

---

- STALE (`docs/roadmap.md`) — Phase 7 still marks `README` unchecked (`- [ ] README`) while `README.md` exists in repo root.
- STALE (`README.md`) — quick start currently only prints `__version__`; it does not demonstrate actual API usage and does not reflect the implemented Phase 0/1/2 surface (nodes, graph, operators, sources).
- STALE (`README.md`) — install guidance includes only `pip install graphrefly-py`; no mention of Python version requirement or optional dev setup (`mise`/`uv`) documented elsewhere.

---

- DIVERGENCE (implementation vs docs standard) — implementation contains broad public API coverage, but public docstrings do not meet the Tier 1 standard defined in `docs/docs-guidance.md` (structured params/returns/examples on each public API).
- DIVERGENCE (cross-repo parity note) — Python keeps `first_value_from` as a synchronous escape hatch while TS uses `firstValueFrom` returning `Promise`; this is a documented/acceptable language-ergonomic difference but should be explicitly called out in user-facing docs for parity clarity.
- DIVERGENCE (spec alignment confidence) — no direct behavioral contradiction to `~/src/graphrefly/GRAPHREFLY-SPEC.md` was identified during this docs audit pass, but documentation currently does not provide enough structured API-level detail to reliably verify spec alignment from docs alone.

---

## Summary

- Doc coverage is broad but structurally incomplete across much of the public API.
- Export surfaces are mostly accurate, with one notable top-level re-export gap (`SpyHandle`).
- Roadmap and README need freshness/accuracy updates to match current implementation maturity.
