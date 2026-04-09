# Documentation guidance (cross-language)

This file is the **single source of truth** for documentation conventions across both **graphrefly-ts** and **graphrefly-py**. All operational docs live in this repo (graphrefly-ts).

Single-source-of-truth strategy: **protocol spec lives in `~/src/graphrefly`**; **JSDoc/docstrings on exported APIs** feed generated docs; **`examples/`** holds all runnable code.

---

## Authority order

1. **`~/src/graphrefly/GRAPHREFLY-SPEC.md`** — protocol, node contract, Graph, invariants (cross-language, canonical)
2. **JSDoc** (TS) / **Docstrings** (PY) on public exports — parameters, returns, examples, remarks (source of truth for API docs)
3. **`examples/*.ts`** (TS) / **`examples/*.py`** (PY) — all runnable library code (single source for recipes, demos, guides)
4. **`docs/roadmap.md`** — what is implemented vs planned (covers both TS and PY)
5. **`README.md`** — install, quick start, links

---

## Design invariant documentation

- When documenting Phase 4+ APIs, never expose protocol internals (`DIRTY`, `RESOLVED`, bitmask) in primary API docs — use domain language (e.g. "the value updates reactively" not "emits DIRTY then DATA").
- JSDoc `@example` / docstring example blocks should demonstrate reactive patterns, not polling or imperative triggers.
- Reference the design invariants in **GRAPHREFLY-SPEC §5.8–5.12** when reviewing doc changes for Phase 4+ features.

---

## Documentation tiers

| Tier | What | TS | PY |
|------|------|----|----|
| **0 — Protocol spec** | `~/src/graphrefly/GRAPHREFLY-SPEC.md` | Both sites via `sync-docs.mjs` | Both sites via `sync-docs.mjs` |
| **1 — JSDoc / Docstrings** | Structured doc blocks on exports | `src/**/*.ts` → `gen-api-docs.mjs` → `website/src/content/docs/api/` | `src/graphrefly/**/*.py` → `gen_api_docs.py` → `website/src/content/docs/api/` |
| **2 — Runnable examples** | Self-contained scripts | `examples/*.ts` | `examples/*.py` (in graphrefly-py) |
| **3 — Recipes / guides** | Long-form Starlight pages | `website/src/content/docs/recipes/` | `website/src/content/docs/recipes/` (in graphrefly-py) |
| **4 — Interactive demos** | Live UI / Pyodide labs | `website/src/components/examples/` (Astro) | `website/src/content/docs/lab/` (Pyodide) |
| **5 — `llms.txt`** | AI-readable docs | repo root → `website/public/` | repo root (graphrefly-py) |
| **6 — `robots.txt`** | Crawler directives | repo root → `website/public/` | — |

### Unified code location rule

**All library logic lives in `examples/`.** Recipes, demos, and guides never duplicate inline code:

- **Recipe pages** import code via Starlight snippet: `import { Code } from '@astrojs/starlight/components'` or file imports
- **Interactive demos** import stores: `import { ... } from "../../examples/<name>"`
- **JSDoc `@example` blocks** (Tier 1) stand alone in IDE tooltips — they don't import from `examples/`

---

## How API docs are generated

### TypeScript

API reference pages (`website/src/content/docs/api/*.md`) are **generated** from structured JSDoc on exported functions via `website/scripts/gen-api-docs.mjs`.

```bash
pnpm --filter @graphrefly/docs-site docs:gen              # regenerate all
pnpm --filter @graphrefly/docs-site docs:gen node map      # specific functions
pnpm --filter @graphrefly/docs-site docs:gen:check         # CI dry-run — exit 1 if stale
```

**Do NOT edit `website/src/content/docs/api/*.md` by hand** — edit the JSDoc in source, then run `docs:gen`.

To add a new function, register it in `website/scripts/gen-api-docs.mjs` in the `REGISTRY` object.

### Python

PY API reference pages are generated from structured docstrings via `website/scripts/gen_api_docs.py` in `graphrefly-py`. Modules listed in `EXTRA_MODULES` (currently `extra/tier1.py`, `tier2.py`, `sources.py`, `backoff.py`, `checkpoint.py`, `resilience.py`, `data_structures.py`, …).

```bash
cd ~/src/graphrefly-py/website && pnpm docs:gen              # regenerate all
cd ~/src/graphrefly-py/website && pnpm docs:gen:check        # CI dry-run
```

Docstrings use Google-style or NumPy-style consistently. Same semantic tags as TS JSDoc for cross-language alignment.

---

## How shared docs are synced

The spec and shared docs flow from their canonical locations into the Starlight site via `website/scripts/sync-docs.mjs`:

```bash
pnpm --filter @graphrefly/docs-site sync-docs              # copy spec + local docs
pnpm --filter @graphrefly/docs-site sync-docs --check      # CI dry-run — exit 1 if stale
```

| Source | Origin |
|--------|--------|
| `~/src/graphrefly/GRAPHREFLY-SPEC.md` | `~/src/graphrefly/` repo only (no in-repo copy) |
| `roadmap.md`, `optimizations.md`, etc. | `docs/` (this repo) |
| `robots.txt`, `llms.txt` | repo root → `website/public/` |

Both `sync-docs` and `docs:gen` run automatically on `pnpm dev` and `pnpm build` (via `predev`/`prebuild` hooks).

---

## Site architecture & domains

| URL | Repo | Framework | Content |
|-----|------|-----------|---------|
| `graphrefly.dev` | graphrefly-ts | Astro/Starlight | Unified site: homepage, TS API docs, spec, blog, comparisons |
| `graphrefly.dev/py/` | graphrefly-py | Astro/Starlight | Python API docs, Pyodide lab (proxied via Cloudflare Worker) |

One unified site at `graphrefly.dev`. The `[TS] [PY]` header nav links to `/py/api/` for Python-specific reference. The Python site is built from `graphrefly-py` with `base: /py/` and served via a Cloudflare Worker that proxies `/py/*` requests to `graphrefly-py`'s GitHub Pages. DNS is on Cloudflare (proxy + CDN); hosting is GitHub Pages with GitHub Actions deployment.

**Single source of truth for public assets:** `robots.txt` and `llms.txt` live at the repo root and are copied to `website/public/` by `sync-docs.mjs`. Do not edit the copies in `website/public/` — they are gitignored and regenerated on every build.

---

## Structured JSDoc on exported functions (Tier 1)

Every exported function must have a structured JSDoc block. The generator reads these tags and produces API pages.

### Required JSDoc tags

| Tag | Purpose | Format |
|-----|---------|--------|
| *(first line)* | Description | Plain text. Start with a verb. |
| `@param` | Parameter docs | `@param name - Description.` |
| `@returns` | Return type description | `` @returns `ReturnType<T>` — description. `` |
| `@example` | Code examples (multiple allowed) | Optional title on first line, then `` ```ts `` code block. |

### Optional JSDoc tags

| Tag | Purpose | Format |
|-----|---------|--------|
| `@remarks` | Behavior detail bullets | One `@remarks` per bullet. Start with `**Bold title:**`. |
| `@seeAlso` | Cross-references | Comma-separated markdown links. |
| `@optionsType` | Name of options interface | `@optionsType NodeOptions` |
| `@option` | Options table row | `@option property \| type \| default \| description` |
| `@returnsTable` | Methods table for return type | `method \| signature \| description` |
| `@category` | Module category | `core`, `extra`, `graph` |

### JSDoc conventions

- **Description:** One or two sentences. Start with a verb ("Creates", "Transforms").
- **@param:** Use `@param name - Description.` (the `- ` is stripped by the generator).
- **@example:** First example has no title (becomes "Basic Usage"). Additional examples have a title. Include `import` from `@graphrefly/graphrefly-ts`.
- **@remarks:** One per bullet. Start with `**Bold keyword:**`.
- **Overloaded functions:** Put the structured JSDoc above the **implementation** (the declaration with a body).

---

## Archive indexes (JSONL)

`archive/optimizations/`, `archive/roadmap/`, and `archive/docs/` use JSONL as the machine-readable index format. One JSON object per line, searchable with `grep`, parseable with `jq` or `python3 -m json.tool --json-lines`.

### Roadmap archive

`docs/roadmap.md` contains **only active/open items**. All completed phases and items are archived to JSONL files in `archive/roadmap/`.

| File | Content |
|------|---------|
| `phase-0-foundation.jsonl` | Phase 0: scaffold, message protocol, node primitive, dynamic node, meta, sugar, tests |
| `phase-1-graph-container.jsonl` | Phase 1: Graph core, composition, introspection, lifecycle, persistence, actor/guard, tests |
| `phase-2-extra.jsonl` | Phase 2: Tier 1/2 operators, sources & sinks |
| `phase-3-resilience-data.jsonl` | Phase 3: resilience, caching, data structures, composite data, inspector, progressive disclosure |
| `phase-4-domain-layers.jsonl` | Phase 4: orchestration, messaging, memory, AI surface, CQRS |
| `phase-5-framework-distribution.jsonl` | Phase 5: framework bindings, compat layers, adapters, ORM, ingest, storage, worker bridge, LLM tools, NestJS |
| `phase-6-versioning.jsonl` | Phase 6: V0 id+version, V0 backfill, V1 cid+prev |
| `phase-7-polish.jsonl` | Phase 7: llms.txt, reactive layout, demo shell, streaming node convention |
| `phase-8-reduction-layer.jsonl` | Phase 8: reduction primitives, domain templates, LLM graph composition, backpressure |
| `phase-9-harness-sprint.jsonl` | Phase 9 + hotfix: collaboration loop primitives, eval tiers, schema fixes, rich catalog, harness sprint deliverables, equals/error hotfix |

**JSONL schema:**

```json
{"id": "kebab-case-slug", "phase": "0.1", "title": "Short title", "items": ["completed item 1", "completed item 2"]}
```

**Workflow:**

1. **New open items** go in `docs/roadmap.md` under the appropriate section.
2. When a phase or item group is **completed**, move it from `docs/roadmap.md` to the appropriate `archive/roadmap/*.jsonl` file (append a new line).
3. Items that remain open from completed phases stay in `docs/roadmap.md` under "Open items from completed phases."

### Design decision archive

`archive/docs/design-archive-index.jsonl` indexes all design session files (`SESSION-*.md`). Each entry has `id`, `date`, `title`, `file`, `topic`, `decisions`, and optional fields (`roadmap_impact`, `related_files`, `missing_pieces`, `research_findings`, `structural_gaps`). Predecessor entries have `"origin": "callbag-recharge"`.

When a new design session is completed, append an entry to `design-archive-index.jsonl`.

### Optimization decision log

`docs/optimizations.md` contains **only active work items, anti-patterns, and deferred follow-ups**. All resolved decisions and reference material are archived to JSONL files in `archive/optimizations/`.

### Archive structure

| File | Content |
|------|---------|
| `resolved-decisions.jsonl` | All resolved design decisions (gateway, streaming, AI, compat, core, patterns, layout, etc.) |
| `cross-language-notes.jsonl` | Cross-language implementation notes (§1–§22c): batch, settlement, concurrency, Graph phases, operators, etc. |
| `parity-fixes.jsonl` | Cross-language parity fixes (one-time alignment fixes) |
| `qa-design-decisions.jsonl` | QA review design decisions (A–L), resolved operator/source semantics, ingest adapter divergences |
| `built-in-optimizations.jsonl` | Built-in optimization descriptions and summary table |
| `summary-table.jsonl` | Cross-language summary comparison table |

### JSONL schema

Each `.jsonl` file has one JSON object per line. Common fields:

```json
{"id": "kebab-case-slug", "title": "Short title", "body": "Full markdown text"}
```

Additional fields vary by file: `phase`, `noted`, `resolved`, `section`, `status`.

### Workflow for new decisions

1. **New open decisions** go in `docs/optimizations.md` under "Active work items".
2. When a decision is **resolved**, move it from `docs/optimizations.md` to the appropriate `archive/optimizations/*.jsonl` file (append a new line).
3. The anti-patterns table and deferred follow-ups stay in `docs/optimizations.md` as living reference.
4. **All operational docs live in this repo (graphrefly-ts).** No need to mirror to graphrefly-py.

### Reading archived decisions

```bash
# Search for a topic across all archives
grep -i "batch" archive/optimizations/*.jsonl

# Pretty-print a specific file
cat archive/optimizations/resolved-decisions.jsonl | python3 -m json.tool --json-lines
```

---

## Spec vs code

- If **implementation** intentionally differs from the spec, **fix the implementation** unless the spec is wrong — then update **`~/src/graphrefly/GRAPHREFLY-SPEC.md`** with a version note (see spec §8).
- Coordinate spec changes across both `graphrefly-ts` and `graphrefly-py`.

---

## When to update which file

| Change | TS | PY |
|--------|----|----|
| New public API | JSDoc + barrel export + `gen-api-docs.mjs` REGISTRY | Docstring + `__init__.py` + `__all__` + `gen_api_docs.py` |
| Protocol or Graph behavior | `~/src/graphrefly/GRAPHREFLY-SPEC.md` (canonical) + JSDoc/docstring on both |
| New runnable example | `examples/<name>.ts` | `examples/<name>.py` (in graphrefly-py) |
| Phase completed | Archive done items to `archive/roadmap/*.jsonl`, update `docs/roadmap.md` (both in this repo) |
| AI / LLM discovery | `llms.txt` (repo root) — synced to `website/public/` by build |
| Crawler directives | `robots.txt` (repo root) — synced to `website/public/` by build |
| New blog post | `website/src/content/docs/blog/<slug>.md` — see blog post format below |

---

## Blog posts

Blog posts live in `website/src/content/docs/blog/` and use the `starlight-blog` plugin (v0.25.x).

### Frontmatter format

```yaml
---
title: "Post Title"
date: 2026-04-03T14:00:00
authors: [david]
tags: [architecture, performance]
---
```

### Date field rules

- **Always include a time component** (`T09:00:00`) in the `date` field — not just a bare date.
- Posts with the same date sort by time. The filename number (e.g. `14-output-slot.md`) implies publication order; the time must match that order.
- The sidebar and blog listing display **date only** (`MM/DD`) — the time is used solely for sort stability.
- When adding a new post on a date that already has posts, pick a time that slots it in the correct order relative to existing posts on that date.

### Naming convention

- Filename: `<number>-<short-slug>.md` (e.g. `26-missing-middle.md`)
- The number prefix preserves the chronicle order from the original callbag-recharge blog series. New posts continue the sequence.

### Tags

Use consistent tags across posts: `architecture`, `performance`, `correctness`, `design-philosophy`, `origins`, `announcements`.

---

## Order of execution for new features

**TypeScript:**
1. Implementation in `src/` + tests (`docs/test-guidance.md`)
2. Structured JSDoc on the exported function (Tier 1)
3. Register in `website/scripts/gen-api-docs.mjs` REGISTRY, run `docs:gen`
4. Runnable example in `examples/` (Tier 2)
5. Recipe / interactive demo if warranted (Tier 3–4)
6. Update `llms.txt` if user-facing (Tier 5)
7. Roadmap — mark items done

**Python:**
1. Implementation in `src/graphrefly/` + tests (`docs/test-guidance.md`)
2. Structured docstring on the exported function/class (Tier 1)
3. Add to `__all__`, run `cd ~/src/graphrefly-py/website && pnpm docs:gen`
4. Runnable example in `examples/` (Tier 2)
5. Recipe / Pyodide lab if warranted (Tier 3–4)
6. Update `llms.txt` when introduced (Tier 5)
7. Roadmap — mark items done (in this repo)

---

## File locations summary

| What | Where | Editable? |
|------|-------|-----------|
| Canonical spec | `~/src/graphrefly/GRAPHREFLY-SPEC.md` | Yes — coordinate across repos |
| TS source of truth (JSDoc) | `src/core/*.ts`, `src/extra/*.ts`, `src/graph/*.ts` | Yes — primary TS edit target |
| PY source of truth (docstrings) | `~/src/graphrefly-py/src/graphrefly/*.py` | Yes — primary PY edit target |
| TS API doc generator | `website/scripts/gen-api-docs.mjs` | Yes — add new entries to REGISTRY |
| PY API doc generator | `~/src/graphrefly-py/website/scripts/gen_api_docs.py` | Yes |
| Generated API pages | `website/src/content/docs/api/*.md` | **No** — regenerated |
| Sync script | `website/scripts/sync-docs.mjs` | Yes |
| TS runnable examples | `examples/*.ts` | Yes |
| PY runnable examples | `~/src/graphrefly-py/examples/*.py` | Yes |
| Roadmap (both langs) | `docs/roadmap.md` | Yes — single source of truth |
| Optimizations (both langs) | `docs/optimizations.md` | Yes — single source of truth |
| This file | `docs/docs-guidance.md` | Yes — covers both TS and PY |
| TS Astro config | `website/astro.config.mjs` | Yes |
