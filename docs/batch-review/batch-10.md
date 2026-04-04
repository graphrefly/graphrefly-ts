# Batch 10 — Documentation audit (Python) — follow-up

Batch 10 targets `graphrefly-py` (`~/src/graphrefly-py`). This pass is a short cross-check from the TS docs work, not a full docstring audit.

## URL shape vs TypeScript site

The Python docs site (`website/py-api-sidebar.mjs`) uses snake_case path segments aligned with API slugs (e.g. `/api/from_event_emitter`), which matches typical static slug behavior and avoids the camelCase mismatch that affected `graphrefly.dev` TS API pages.

If you add mixed-case or symbolic export names to generated API markdown filenames, apply the same redirect pattern as in `graphrefly-ts`’s `astro.config.mjs` (slug stem → canonical slug).

## Suggested full Batch 10 execution

When running the full audit prompt from `docs/audit-plan.md`, work in `~/src/graphrefly-py`: verify docstrings on `core/`, `graph/`, and `extra/` per `docs/docs-guidance.md`, `__all__` accuracy, roadmap checkboxes, `examples/basic_counter.py`, and README install instructions.
