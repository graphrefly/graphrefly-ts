# Documentation guidance (graphrefly-ts)

Single-source-of-truth strategy: **`docs/GRAPHREFLY-SPEC.md` defines behavior**; **JSDoc on exported APIs** is the source of truth for TypeScript ergonomics until a generated docs site exists (see `docs/roadmap.md` Phase 7).

---

## Authority order

1. **`docs/GRAPHREFLY-SPEC.md`** — protocol, node contract, Graph, invariants (cross-language)
2. **JSDoc** on public exports — parameters, returns, examples, remarks
3. **`README.md`** — install, quick start, links to spec and roadmap
4. **`docs/roadmap.md`** — what is implemented vs planned

---

## Predecessor reference

The **callbag-recharge** repo at **`~/src/callbag-recharge`** has a full **JSDoc → generator → VitePress site** pipeline (`scripts/gen-api-docs.mjs`, `site/`, `examples/`). When graphrefly-ts adds similar tooling, mirror that structure where it fits; until then, prefer **strong JSDoc** and spec cross-links over maintaining duplicate markdown API pages.

A detailed copy of the older **documentation tiers** and file layout lives in that repo’s `docs/docs-guidance.md` — use it as a template when standing up `docs:gen` and a docs site here.

---

## JSDoc on exported functions (Tier 0)

Every **public** export should have a JSDoc block that matches how the team will generate docs later:

| Tag | Purpose |
|-----|---------|
| First paragraph | Short description (what it does) |
| `@param` | Each parameter (`@param name - Description.`) |
| `@returns` | Return value semantics |
| `@example` | At least one import + usage (use `@graphrefly/graphrefly-ts`) |
| `@remarks` | Optional: invariants, interaction with batch, errors |

Conventions to align with future generation:

- Description starts with a verb (“Creates…”, “Connects…”).
- Link related symbols in prose or `@see` when useful.
- For options objects, document fields in a table or `@param opts` sub-bullets.

---

## Spec vs code

- If **implementation** intentionally differs from the spec, **fix the implementation** unless the spec is wrong — then update **`docs/GRAPHREFLY-SPEC.md`** with a version note (see spec §8) and record the rationale in a short remark or design note in `archive/docs/` if needed.
- **`describe()` JSON shape** should stay aligned with **Appendix B** in the spec when Graph introspection lands.

---

## When to update which file

| Change | Update |
|--------|--------|
| New public API | JSDoc + export from `src/index.ts` (or layer barrel) |
| Protocol or Graph behavior | `docs/GRAPHREFLY-SPEC.md` (if spec-level) + JSDoc |
| Phase completed | `docs/roadmap.md` checkboxes |
| AI / LLM discovery | `llms.txt` (roadmap Phase 7) when introduced |

---

## Order of execution for new features

1. **Implementation** in `src/core/`, `src/graph/`, or `src/extra/` + tests (`docs/test-guidance.md`)
2. **JSDoc** on new exports
3. **Roadmap** — mark items done when the phase criteria are met
4. **Generated site / `docs:gen`** — when added to this repo, register symbols and run the generator per `~/src/callbag-recharge` patterns

---

## File locations summary (this repo)

| What | Where |
|------|--------|
| Behavior spec | `docs/GRAPHREFLY-SPEC.md` |
| Roadmap | `docs/roadmap.md` |
| This file | `docs/docs-guidance.md` |
| Agent context | `CLAUDE.md` |
| Design history | `archive/docs/` |
