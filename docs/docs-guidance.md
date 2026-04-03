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
| Phase completed | `docs/roadmap.md` checkboxes |
| AI / LLM discovery | `llms.txt` (repo root) — synced to `website/public/` by build |
| Crawler directives | `robots.txt` (repo root) — synced to `website/public/` by build |
| GitHub repo metadata | `gh repo edit` — description, topics, homepage URL |
| npm metadata | `package.json` — description, keywords |

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
