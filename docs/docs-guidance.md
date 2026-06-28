# Documentation guidance (cross-language)

This file is the **single source of truth** for documentation conventions across both **graphrefly-ts** and **graphrefly-py**. All operational docs live in this repo (graphrefly-ts).

Single-source-of-truth strategy: **language-neutral protocol and planning live in `~/src/graphrefly`**; **JSDoc/docstrings on exported APIs** document the package surface; **`examples/`** holds runnable code.

---

## Authority order

1. **`~/src/graphrefly/spec/rules.jsonl`** — protocol rules (the constitution); protocol behavior changes go through spec-amend first.
2. **`~/src/graphrefly/decisions/decisions.jsonl`** and **`~/src/graphrefly/plan/*.jsonl`** — design locks, sequencer, backlog, and cross-runtime status.
3. **JSDoc** (TS) / **Docstrings** (PY) on public exports — parameters, returns, examples, and remarks for current package APIs.
4. **`examples/*.ts`** (TS) / **`examples/*.py`** (PY) — runnable library code when an example is active clean-slate guidance.
5. **`README.md`** — install, quick start, and links.

---

## Design invariant documentation

- When documenting Phase 4+ APIs, never expose protocol internals (`DIRTY`, `RESOLVED`, bitmask) in primary API docs — use domain language (e.g. "the value updates reactively" not "emits DIRTY then DATA").
- JSDoc `@example` / docstring example blocks should demonstrate reactive patterns, not polling or imperative triggers.
- Reference `~/src/graphrefly/spec/rules.jsonl` and the relevant D# decisions when reviewing protocol-adjacent doc changes. Legacy `GRAPHREFLY-SPEC.md` prose is old-main migration material, not clean-slate authority.

---

## Browser / Node / Universal split (TS)

The TS library ships a **three-tier subpath convention** so browser and Node consumers get only the code they can run. Every new public TS API picks a tier at documentation time.

| Tier | Subpath shape | Contains | Allowed imports |
|------|--------------|----------|-----------------|
| **Universal** (default) | `@graphrefly/ts/<capability>` | Protocol, graph, operators, storage contracts, renderers, and DOM-free solutions | Zero `node:*`. Zero DOM globals. |
| **Node-only** | `@graphrefly/ts/<capability>/node` or focused node subpaths | Filesystem or Node runtime adapters | May import `node:*`. May import universal modules. |
| **Browser-only** | `@graphrefly/ts/<capability>/browser` or focused browser subpaths | IndexedDB, Canvas, DOM, browser workers, and other browser-only helpers | May use browser globals. May import universal modules. |

**Rule of thumb:** pick the lowest tier that can execute your code. A pattern factory that *mentions* `fileStorage` in its JSDoc but doesn't import it stays universal; a factory that *calls* `fileStorage()` must live under `<domain>/node`.

### When to create a new subpath vs extending an existing one

- New symbol fits an existing universal barrel (e.g. a new operator in `packages/ts/src/operators/index.ts`) → add it there, export it from the narrow package subpath, and document it in JSDoc.
- New symbol needs `node:*` or runtime-only storage/process APIs → extend the relevant focused node subpath (e.g. `packages/ts/src/sources/node.ts`, `packages/ts/src/storage/node.ts`) or create a reviewed `<domain>/node` subpath if one does not exist.
- New symbol needs DOM globals → same pattern under `<x>/browser`.
- New **domain** that needs its own package-style subpath → add a focused `packages/ts/src/<layer>/<domain>.ts` or `packages/ts/src/<layer>/<domain>/index.ts` entry after the package-layer decision is clear.

### Three files to update together when adding or moving a subpath

1. **`packages/ts/tsup.config.ts` — `entry` array**: add the source path with the `src/` prefix and `.ts` extension.
2. **`packages/ts/package.json` — `exports` map**: add the matching `./<subpath>` block pointing at the built ESM/CJS and DTS files. Both `import` and `require` conditions are required.
3. **`scripts/check-ts-package-exports.mjs`**: update package-export smoke coverage when the new subpath is public and should be build-checked from an external consumer perspective.

Cross-reference: the exports map is `sideEffects: false` — individual entries shouldn't rely on module-level side effects.

### Build-time package guardrails

`packages/ts/tsup.config.ts` is the build entry allowlist. Package export checks live outside tsup:

1. `pnpm --filter @graphrefly/ts build` must emit every entry declared in `packages/ts/package.json`.
2. `scripts/check-ts-package-exports.mjs` smoke-checks selected public exports and root-forbidden names.
3. `pnpm run lint` also runs `scripts/check-no-raw-async.ts` and `scripts/check-typecheck.ts`.

If a universal entry starts importing `node:*` or browser globals, move that symbol to a focused node/browser subpath instead of weakening the package split.

### Writing JSDoc for node-only / browser-only APIs

- **Single-tier symbol:** JSDoc `@example` imports from the correct `@graphrefly/ts` subpath for that symbol.
- **Adapter with both tiers:** keep the dependency-light shape in the universal or adapter subpath, and put runtime-specific helpers in focused node/browser subpaths. Each file's JSDoc `@example` uses its own subpath; cross-reference the other via `{@link }` or a prose note.
- **Aggregator files** (`sources/node.ts`, `storage/browser.ts`, focused adapter/solution platform entries): have a `@module` docstring explaining what the aggregator is for and which runtime APIs it assumes.

---

## Documentation tiers

| Tier | What | TS | PY |
|------|------|----|----|
| **0 — Protocol spec** | `~/src/graphrefly/spec/rules.jsonl` plus rendered/prose protocol pages | TS site syncs curated prose pages via `sync-docs.mjs` | PY site syncs its own curated pages |
| **1 — JSDoc / Docstrings** | Structured doc blocks on exports | `packages/ts/src/**/*.ts`; TS API pages are currently a hand-vetted clean-slate allowlist | `src/graphrefly/**/*.py` → `gen_api_docs.py` → `website/src/content/docs/api/` |
| **2 — Runnable examples** | Self-contained scripts | `examples/*.ts` | `examples/*.py` (in graphrefly-py) |
| **3 — Recipes / guides** | Long-form Starlight pages | `website/src/content/docs/recipes/` | `website/src/content/docs/recipes/` (in graphrefly-py) |
| **4 — Interactive demos** | Live UI / Pyodide labs | `demos/` and `website/src/content/docs/demos/` | `website/src/content/docs/lab/` (Pyodide) |
| **5 — `llms.txt`** | AI-readable docs | repo root → `website/public/` | repo root (graphrefly-py) |
| **6 — `robots.txt`** | Crawler directives | repo root → `website/public/` | — |

### Unified code location rule

**Reusable library examples live in `examples/`; interactive demos live in `demos/`.** Recipes, demos, and guides should avoid duplicating long inline code:

- **Recipe pages** import code via Starlight snippet: `import { Code } from '@astrojs/starlight/components'` or file imports
- **Interactive demos** import stores: `import { ... } from "../../examples/<name>"`
- **JSDoc `@example` blocks** (Tier 1) stand alone in IDE tooltips — they don't import from `examples/`

---

## How API docs are generated

### TypeScript

The old TypeScript API generator was retired with the legacy root/pure-ts docs source. Current TS API reference pages are a small, hand-vetted clean-slate allowlist backed by real `@graphrefly/ts` export-map entries. Today that allowlist is focused on the Reactive Layout solution; it is not a full package API inventory. A replacement generator must fail closed from `packages/ts/package.json` exports plus an explicit allowlist; do not map old symbols to guessed subpaths.

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
| Curated protocol/spec pages | `~/src/graphrefly/` authority repo plus local site pages |
| `roadmap.md`, `optimizations.md`, etc. | `docs/` (this repo) |
| `robots.txt`, `llms.txt` | repo root → `website/public/` |

`sync-docs` runs automatically on TS site `pnpm dev` and `pnpm build` (via `predev`/`prebuild`). The TS site does not currently run a TS `docs:gen` step.

---

## Site architecture & domains

| URL | Repo | Framework | Content |
|-----|------|-----------|---------|
| `graphrefly.dev` | graphrefly-ts | Astro/Starlight | Unified site: homepage, hand-vetted TS API pages, spec, blog, comparisons |
| `graphrefly.dev/py/` | graphrefly-py | Astro/Starlight | Python API docs, Pyodide lab (proxied via Cloudflare Worker) |

One unified site at `graphrefly.dev`. The `[TS] [PY]` header nav links to `/py/api/` for Python-specific reference. The Python site is built from `graphrefly-py` with `base: /py/` and served via a Cloudflare Worker that proxies `/py/*` requests to `graphrefly-py`'s GitHub Pages. DNS is on Cloudflare (proxy + CDN); hosting is GitHub Pages with GitHub Actions deployment.

**Single source of truth for public assets:** `robots.txt` and `llms.txt` live at the repo root and are copied to `website/public/` by `sync-docs.mjs`. Do not edit the copies in `website/public/` — they are gitignored and regenerated on every build.

---

## Structured JSDoc on exported functions (Tier 1)

Every exported function should have a structured JSDoc block. TS JSDoc is the source for IDE/help text and for any future allowlist-based API generator; current TS site pages are hand-vetted markdown.

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
| `@category` | Module category | Match the D125 package layer, e.g. `core`, `graph`, `operators`, `sources`, `storage`, `adapters`, `orchestration`, `patterns`, `solutions`. |

### JSDoc conventions

- **Description:** One or two sentences. Start with a verb ("Creates", "Transforms").
- **@param:** Use `@param name - Description.` (the `- ` is stripped by the generator).
- **@example:** First example has no title (becomes "Basic Usage"). Additional examples have a title. Import from the narrowest real `@graphrefly/ts` subpath for the symbol.
- **@remarks:** One per bullet. Start with `**Bold keyword:**`.
- **Overloaded functions:** Put the structured JSDoc above the **implementation** (the declaration with a body).

---

## Archive indexes (JSONL)

`archive/optimizations/`, `archive/roadmap/`, and `archive/docs/` use JSONL as the machine-readable index format. One JSON object per line, searchable with `grep`, parseable with `jq` or `python3 -m json.tool --json-lines`.

### Roadmap archive

Both `docs/roadmap.md` (vision / wave context) and `docs/implementation-plan.md` (canonical pre-1.0 sequencer) feed the same `archive/roadmap/` JSONL set. Each file should keep **only active / open / load-bearing-historical content**. Once a phase, sub-section, or item group is fully landed and no longer informs in-flight work, move it to the appropriate `archive/roadmap/*.jsonl` file as a new JSONL line.

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
| `phase-11-cleanup.jsonl` | Phase 11 (2026-04-30 sequencing): deferred-item cleanup batch — ✅ DONE entries from §11.1–§11.11 |
| `phase-12-consolidation.jsonl` | Phase 12 (2026-04-30 sequencing): consolidation closure (`io/` body extraction, sibling-file relocation, `extends Graph` sweep, promptNode B.3 widening) |
| `phase-13-multi-agent.jsonl` | Phase 13 (2026-04-30 sequencing): multi-agent + intervention substrate (`Message<T>`, `selector`/`materialize`, `valve` abort, `humanInput`/`tracker`, `agent`/`AgentBundle`, `spawnable`, `settle`) |
| `push-model-migration.jsonl` | Push Model Migration (spec v0.1→v0.2): phases 1-3 (TS), phase 5 (LLM validation), inspection TS consolidation |

**JSONL schema:**

```json
{"id": "kebab-case-slug", "phase": "0.1", "title": "Short title", "items": ["completed item 1", "completed item 2"]}
```

**Workflow — `docs/roadmap.md` (vision / wave context):**

1. **New open items** go in `docs/roadmap.md` under the appropriate section (rare today; most new items belong in `implementation-plan.md`).
2. When a phase or item group is **completed**, move it from `docs/roadmap.md` to the appropriate `archive/roadmap/*.jsonl` file (append a new line) and replace the body with a one-line pointer (`> **DONE — archived to archive/roadmap/<file>.jsonl** (id: <slug>).`).
3. Items that remain open from completed phases stay in `docs/roadmap.md` under "Open items from completed phases."

**Workflow — `docs/implementation-plan.md` (canonical sequencer):**

1. **New open items** go in `docs/implementation-plan.md` under the matching Phase 11–16 entry (or a new sub-phase / DS-# session if scope warrants).
2. When a sub-section item lands, mark it ✅ inline with the date.
3. When **every** item in a sub-section lands, mark the sub-section ✅ and tag with the date.
4. When a **whole Phase** lands (all sub-sections ✅, no open WAIT/POST-1.0 carries that still need this phase's context to be readable), archive it:
    - Append a JSONL line to the matching `archive/roadmap/phase-<n>-*.jsonl` (create the file the first time a phase lands), capturing the sub-section titles + a short summary per sub-section in the `items` array.
    - Replace the in-file Phase body with a 2–4-line summary + archive pointer (id, file). Keep the heading so cross-references from other phases / optimizations.md stay resolvable.
    - If a single item still has a follow-up (e.g. Phase 13.K's `topicBridge` gap), file it in `docs/optimizations.md` "Active work items" with a back-link, then archive the parent phase.
5. Tier 1–10 historical content predates this sequencing migration (locked 2026-04-30). Treat each Tier the same way: archive whole tiers when they no longer inform in-flight work; keep a 1–2-line summary + archive pointer in place. The "Deviations" sections at the top stay only as long as they're load-bearing for in-flight phases — once the referenced phases archive, the deviations archive with them.
6. Items that are still **WAIT** / **POST-1.0** / **PARKED** stay in the phase entry until they unblock or are demoted to the Parked table.

**The trigger to archive is "the body no longer informs anyone reading the file for what's next" — not a calendar date.** If a `/qa` or `/dev-dispatch` pass closes the last in-flight item from a phase, archive in the same pass.

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

- If **implementation** intentionally differs from the protocol rules, **fix the implementation** unless the rules are wrong — then run the spec-amend flow in `~/src/graphrefly` before changing code.
- Coordinate spec changes across both `graphrefly-ts` and `graphrefly-py`.

---

## Cleanup-tier safety checklist (Tier 10.x style entries)

Tier 10.x items that delete "redundant" / "paranoid" runtime guards or helpers must verify both code paths the guard could fire on, **not just the live one**. Two real misses motivated this rule (`extractStoreMap` Wave AM Unit 5; `mapFromSnapshot` Tier 10.1 — restored under Tier 9.1 /qa D2 after the snapshot-restore path lost defense-in-depth).

Before deleting a runtime check / type-narrowing helper, confirm:

1. **Live emit path** — does the upstream actually emit the typed shape? (Usually yes — the comment justifying deletion focuses on this.)
2. **Snapshot-restore path** — does `Graph.restore` / `JsonGraphCodec` round-trip the type cleanly? `Map` / `Set` / `Date` / typed-array values come back as plain `{}` / `[]` / `string` from the default codec; without the helper, downstream `.entries()` / `.size` / `.has()` calls silently return wrong values or throw.
3. **Plugin-supplied caches** — does anything in storage adapters, checkpoint/restore helpers, or a user codec deliver values via the same Node? Same concern as restore.
4. **Test coverage** — is there a regression test that exercises restore / hot-swap-cache for the affected Node? If not, add one BEFORE deletion.

If steps 2–3 pass via "ReactiveMap-style emit always emits a real Map," that's only the live path — restore is separate. Either restore the helper, or convert plain `{}` → `Map` in a `restore`-side hook on the typed Node.

---

## Migration shape preservation

When migrating a primitive (Tier 7/8/9.x patterns), behavior-preserving refactors must preserve **observable record/object shapes**. Stylistic improvements that change `Object.hasOwn(record, key)` results, JSON serialization, key presence/absence on hot fields, or key ordering count as autonomous decisions and require explicit user lock — they are NOT "while I'm in there" cleanups.

Examples that bit us during Tier 8 / Tier 9.1 (caught in /qa, not at land):

- Saga `aggregateId` from `{ aggregateId: ev.aggregateId }` (always present, possibly `undefined`) to `...(ev.aggregateId !== undefined ? ... : {})` (key absent when undefined). Cleaner spread idiom; silently breaks `Object.hasOwn` consumers and JSON serialization shape.
- `lightMutation` `freeze: false` opt-out copied from a memory-primitive precedent (where deep-freezing 768-dim vectors WAS a real tax). The framework default is `freeze: true`; the memory primitives explicitly override to `false` for the vector-payload case. Process state objects are tiny — copying the override pattern was the wrong default for the new caller and opened a post-record state-mutation hazard.

**Default to preservation.** If a shape change feels obviously cleaner, surface it as an explicit Q-question with the trade-off, not as a silent ride-along. Pre-1.0 doesn't mean "any change is fine" — it means "we can break breakingly when warranted."

---

## When to update which file

| Change | TS | PY |
|--------|----|----|
| New public API | JSDoc + narrow barrel export. Add or update TS site API markdown only when the symbol is part of the hand-vetted allowlist. **Pick the universal / node / browser tier** (see § Browser / Node / Universal split). | Docstring + `__init__.py` + `__all__` + `gen_api_docs.py` |
| New subpath | `packages/ts/tsup.config.ts` `entry` + `packages/ts/package.json` `exports` block + package-export smoke coverage when appropriate + JSDoc `@example` uses the new subpath | n/a (PY doesn't have this split yet) |
| Protocol or Graph behavior | `~/src/graphrefly/spec/rules.jsonl` via spec-amend + JSDoc/docstring on both |
| New runnable example | `examples/<name>.ts` | `examples/<name>.py` (in graphrefly-py) |
| Phase / sub-section item completed | Mark ✅ inline in `docs/implementation-plan.md` (or `docs/roadmap.md` for Wave-frame items) with the date. Also re-check `docs/optimizations.md` for any "Active work items" the landed work resolves and move those to the appropriate `archive/optimizations/*.jsonl`. |
| Whole Phase / Tier completed | Archive the body to `archive/roadmap/*.jsonl` (one JSONL line per sub-section), replace the in-file content with a 2–4-line summary + archive pointer. Open follow-ups (single residual items) move to `docs/optimizations.md` with a back-link. See § Roadmap archive — Workflow for `docs/implementation-plan.md`. |
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
1. Implementation in `packages/ts/src/` + tests (`docs/test-guidance.md`). **Decide tier** (universal / node / browser) and place the file accordingly; see § Browser / Node / Universal split.
2. Structured JSDoc on the exported function (Tier 1). `@example` imports from the correct subpath.
3. If introducing a new subpath: add to `packages/ts/tsup.config.ts` `entry`, add `packages/ts/package.json` `exports`, and extend package-export smoke coverage where appropriate.
4. If the symbol belongs in the public website allowlist, add or update a hand-vetted page under `website/src/content/docs/api/` and wire the sidebar explicitly.
5. Run `pnpm run build` and `pnpm run lint`; fix package/export or runtime-tier mistakes by moving the symbol to the right tier.
6. Runnable example in `examples/` (Tier 2)
7. Recipe / interactive demo if warranted (Tier 3–4)
8. Update `llms.txt` if user-facing (Tier 5)
9. Roadmap — mark items done

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
| Canonical protocol rules | `~/src/graphrefly/spec/rules.jsonl` | Yes, via spec-amend only |
| TS source of truth (JSDoc) | `packages/ts/src/**/*.ts` | Yes — primary TS edit target |
| PY source of truth (docstrings) | `~/src/graphrefly-py/src/graphrefly/*.py` | Yes — primary PY edit target |
| TS API pages | `website/src/content/docs/api/*.md` | Yes — hand-vetted allowlist, not generated full inventory |
| TS entry points | `packages/ts/tsup.config.ts` (`entry`) | Yes — update when adding a subpath |
| TS package subpath map | `packages/ts/package.json` `exports` | Yes — add `./<subpath>` block for every new subpath |
| PY API doc generator | `~/src/graphrefly-py/website/scripts/gen_api_docs.py` | Yes |
| PY generated API pages | `~/src/graphrefly-py/website/src/content/docs/api/*.md` | **No** — regenerated |
| Sync script | `website/scripts/sync-docs.mjs` | Yes |
| TS runnable examples | `examples/*.ts` | Yes |
| PY runnable examples | `~/src/graphrefly-py/examples/*.py` | Yes |
| Roadmap (both langs) | `docs/roadmap.md` | Yes — single source of truth |
| Optimizations (both langs) | `docs/optimizations.md` | Yes — single source of truth |
| This file | `docs/docs-guidance.md` | Yes — covers both TS and PY |
| TS Astro config | `website/astro.config.mjs` | Yes |
