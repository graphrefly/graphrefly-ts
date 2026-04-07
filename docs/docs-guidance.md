# Documentation guidance (graphrefly-ts)

Single-source-of-truth strategy: **protocol spec lives in `~/src/graphrefly`**; **JSDoc on exported APIs** feeds generated docs; **`examples/`** holds all runnable code.

---

## Authority order

1. **`~/src/graphrefly/GRAPHREFLY-SPEC.md`** — protocol, node contract, Graph, invariants (cross-language, canonical)
2. **JSDoc** on public exports — parameters, returns, examples, remarks (source of truth for TS API docs)
3. **`examples/*.ts`** — all runnable library code (single source for recipes, demos, guides)
4. **`docs/roadmap.md`** — what is implemented vs planned
5. **`README.md`** — install, quick start, links

---

## Design invariant documentation

- When documenting Phase 4+ APIs, never expose protocol internals (`DIRTY`, `RESOLVED`, bitmask) in primary API docs — use domain language (e.g. "the value updates reactively" not "emits DIRTY then DATA").
- JSDoc `@example` blocks should demonstrate reactive patterns, not polling or imperative triggers.
- Reference the design invariants in **GRAPHREFLY-SPEC §5.8–5.12** when reviewing doc changes for Phase 4+ features.

---

## Documentation tiers

| Tier | What | Where it lives | Flows to |
|------|------|----------------|----------|
| **0 — Protocol spec** | `~/src/graphrefly/GRAPHREFLY-SPEC.md` | `~/src/graphrefly/` repo (sibling checkout) | Both sites via `sync-docs.mjs` |
| **1 — JSDoc** | Structured doc blocks on exports | `src/**/*.ts` | Generated API pages via `gen-api-docs.mjs` → `website/src/content/docs/api/` |
| **2 — Runnable examples** | Self-contained scripts using public imports | `examples/*.ts` | Imported by recipes + demos |
| **3 — Recipes / guides** | Long-form Starlight pages with context | `website/src/content/docs/recipes/` | Pull code from `examples/` via Starlight file imports |
| **4 — Interactive demos** | Astro/Starlight components with live UI | `website/src/components/examples/` | Import stores from `examples/`, handle UI only |
| **5 — `llms.txt`** | AI-readable docs | repo root → `website/public/` via `sync-docs.mjs` | Updated when adding user-facing primitives |
| **6 — `robots.txt`** | Search engine / AI crawler directives | repo root → `website/public/` via `sync-docs.mjs` | Updated when site structure changes |

### Unified code location rule

**All library logic lives in `examples/`.** Recipes, demos, and guides never duplicate inline code:

- **Recipe pages** import code via Starlight snippet: `import { Code } from '@astrojs/starlight/components'` or file imports
- **Interactive demos** import stores: `import { ... } from "../../examples/<name>"`
- **JSDoc `@example` blocks** (Tier 1) stand alone in IDE tooltips — they don't import from `examples/`

---

## How API docs are generated

API reference pages (`website/src/content/docs/api/*.md`) are **generated** from structured JSDoc on exported functions via `website/scripts/gen-api-docs.mjs`.

```bash
pnpm --filter @graphrefly/docs-site docs:gen              # regenerate all
pnpm --filter @graphrefly/docs-site docs:gen node map      # specific functions
pnpm --filter @graphrefly/docs-site docs:gen:check         # CI dry-run — exit 1 if stale
```

**Do NOT edit `website/src/content/docs/api/*.md` by hand** — edit the JSDoc in source, then run `docs:gen`.

To add a new function, register it in `website/scripts/gen-api-docs.mjs` in the `REGISTRY` object.

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

| Domain | Repo | Framework | Content |
|--------|------|-----------|---------|
| `graphrefly.dev` | graphrefly-ts | Astro/Starlight | TS API docs, spec, blog, comparisons |
| `py.graphrefly.dev` | graphrefly-py | Astro/Starlight | Python API docs, spec, Pyodide lab |

Both sites share the same Starlight theme with a `[TS] [PY]` language switcher in the header nav. DNS is on Cloudflare (proxy + CDN); hosting is GitHub Pages with GitHub Actions deployment.

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

`archive/docs/design-archive-index.jsonl` indexes all design session files (`SESSION-*.md`). See `archive/docs/DESIGN-ARCHIVE-INDEX.md` for schema and query examples.

When a new design session is completed, append an entry to `design-archive-index.jsonl` with `id`, `date`, `title`, `file`, `topic`, `decisions`, and optional fields (`roadmap_impact`, `related_files`, `missing_pieces`, `research_findings`, `structural_gaps`).

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
3. If the sibling repo (`graphrefly-py` / `graphrefly-ts`) is available, mirror the entry to its `archive/optimizations/*.jsonl` too.
4. The anti-patterns table and deferred follow-ups stay in `docs/optimizations.md` as living reference.

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

| Change | Update |
|--------|--------|
| New public API | JSDoc + export from barrel + register in `gen-api-docs.mjs` REGISTRY |
| Protocol or Graph behavior | `~/src/graphrefly/GRAPHREFLY-SPEC.md` (canonical) + JSDoc |
| New runnable example | `examples/<name>.ts` + optional recipe page |
| Phase completed | Archive done items to `archive/roadmap/*.jsonl`, update `docs/roadmap.md` |
| AI / LLM discovery | `llms.txt` (repo root) — synced to `website/public/` by build |
| Crawler directives | `robots.txt` (repo root) — synced to `website/public/` by build |
| GitHub repo metadata | `gh repo edit` — description, topics, homepage URL |
| npm metadata | `package.json` — description, keywords |
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

1. **Implementation** in `src/` + tests (`docs/test-guidance.md`)
2. **Structured JSDoc** on the exported function (Tier 1)
3. **Register** in `website/scripts/gen-api-docs.mjs` REGISTRY, run `docs:gen`
4. **Runnable example** in `examples/` (Tier 2) — if the feature warrants a standalone demo
5. **Recipe** on the site that imports from `examples/` (Tier 3) — for complex patterns
6. **Interactive demo** if warranted (Tier 4) — imports from `examples/`, handles UI only
7. **Update llms.txt** if the feature is user-facing (Tier 5)
8. **Roadmap** — mark items done

---

## File locations summary

| What | Where | Editable? |
|------|-------|-----------|
| Canonical spec | `~/src/graphrefly/GRAPHREFLY-SPEC.md` | Yes — coordinate across repos |
| Source of truth (JSDoc) | `src/core/*.ts`, `src/extra/*.ts`, `src/graph/*.ts` | Yes — primary edit target |
| API doc generator | `website/scripts/gen-api-docs.mjs` | Yes — add new entries to REGISTRY |
| Generated API pages | `website/src/content/docs/api/*.md` | **No** — regenerated from JSDoc |
| Sync script | `website/scripts/sync-docs.mjs` | Yes |
| Synced doc pages | `website/src/content/docs/*.md` | **No** — regenerated from `docs/` |
| Runnable examples | `examples/*.ts` | Yes — all library demo code lives here |
| Recipes | `website/src/content/docs/recipes/*.md` | Yes — import code from `examples/` |
| Roadmap | `docs/roadmap.md` | Yes |
| This file | `docs/docs-guidance.md` | Yes |
| Astro config (sidebar) | `website/astro.config.mjs` | Yes — update when adding pages |
