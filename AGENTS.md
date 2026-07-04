# graphrefly-ts — agent context (TypeScript implementation)

**GraphReFly** — reactive universal reduction layer (high fan-in/out → information reduction → push;
not LLM-limited, D1). This repo is the **TypeScript implementation** (`@graphrefly/ts`): a
self-contained package (substrate + sugar + operators), **no cross-language peer-deps** (D32).

> **This file points, it does not host.** The language-neutral authority — protocol spec,
> decisions, design sessions, conformance, formal model — lives in `~/src/graphrefly` (branch
> `clean-slate`). When anything here disagrees with that repo, **that repo wins.** Do not
> duplicate its content back into this file.

## Authority — where the truth lives (`~/src/graphrefly`)

Read `~/src/graphrefly/CLAUDE.md` first — it is the single-source index for the design.

| Concern | Source of truth |
|---|---|
| **Decisions (why)** — unified D# log | `~/src/graphrefly/decisions/decisions.jsonl` (read via `/decision-guard`) |
| **Design narrative** — full L0–L6 locks, F-* constraints, flags, spec-amendment list | `~/src/graphrefly/sessions/active/SESSION-clean-slate-redesign.md` (DS-1) |
| **Protocol rules (宪法)** | `~/src/graphrefly/spec/rules.jsonl` (changed via `/spec-amend`) |
| **Conformance scenarios (parity)** | `~/src/graphrefly/spec/conformance.jsonl` (driven via `/conformance`) |
| **Formal model** | `~/src/graphrefly/formal/*.tla` (+ MC configs) |
| **Sequencer (what next) / backlog / anti-patterns** | `~/src/graphrefly/plan/{phases,backlog,antipatterns}.jsonl` |
| **Guides (composition / docs / test / contribute)** | `~/src/graphrefly/guide/guide.jsonl` |
| **Rendered view** (progress / structure / gaps / search) | `~/src/graphrefly/dashboard/` (`node dashboard/build.mjs`) |

## Local documentation boundary (`docs/docs.jsonl`)

This repo's package-local docs policy lives in `docs/docs.jsonl`.

- `~/src/graphrefly` owns the shared `graphrefly.dev` public website shell, shared public
  documentation architecture, blog, guide records, protocol/rules views, and dashboard/control views
  (D563).
- `~/src/graphrefly-ts` owns only TypeScript package docs: `@graphrefly/ts` install and release
  notes, package README material, JSDoc on exported TS APIs, generated TS API reference artifacts,
  examples, demos, and package-local docs automation.
- `website/` is legacy/migration material plus the current TS API-doc generator host until that
  generator moves. Do not treat it as canonical ownership of the public site.

Sibling implementations (each self-contained, cross-language = wire bridge, not in-process):
`@graphrefly/rust` (`~/src/graphrefly-rs`), `@graphrefly/py` (`~/src/graphrefly-py`).

## Clean-slate floor (cite, never violate — full text in DS-1 / `rules.jsonl`)

- **Sacred (L0.7):** topology declarative/serializable/inspectable · wave protocol is a public spec ·
  wave protocol impl is **sync** · all fn go through the dispatcher.
- **8 verbs, closed set (D4):** `node` `graph` `batch` `state` + `producer` `derived` `effect` `mount`.
  Operators are `node` sugar, not verbs — per-language, never in parity (D6).
- **`ctx.up` / `ctx.down(msgs)` (D8):** one `msgs` array = one wave; may mix tiers. `ctx.up` is
  **control-tier only** (DIRTY/PAUSE/RESUME/INVALIDATE/TEARDOWN); DATA/RESOLVED/COMPLETE/ERROR are
  down-only (R-ctx-up). Handle = pure data `(pool_id, handle_id)`, no methods (D7).
- **7-tier const table + 10-message closed set (D9/D34, R-tier/R-msg-closed-set):** adding a tier
  or message type is a constitutional change.
- **graph = single-thread causal/concurrency domain (D22):** parallelism via pool callback or
  multi-graph + wire bridge; rewire intra-graph only.
- **parity = behavioral conformance (D24):** structural `Impl` + cross-track-ledger retired.
- **config dissolved (D26):** clock is graph-local (no global singleton); `messageTier` is a
  compile-time const table; `onMessage`/`onSubscribe` are substrate-fixed, not user-replaceable (D19).
- **Forced (F-*):** F-SYNC-CORE (async lives only in pools / wire-bridge) · F-DISPATCH-ALL (no
  inline-fn bypass) · F-NO-IMPL-DEFINED (spec-locked or explicitly undefined) · F-NO-WEDGE-CUT ·
  F-NO-LLM-ONLY · F-GRAPH-FIRST-API · F-PERF.

Durable values (memory `feedback_*`): no backward compat (pre-1.0) · no imperative triggers ·
single source of truth · **no autonomous decisions** (surface spec↔code conflicts, don't silently pick) ·
no implement without explicit approval · verify premise before greenfield.

## Workflow rules

- **spec-first** (F-NO-IMPL-DEFINED): any protocol behavior change → amend `~/src/graphrefly`
  `spec/rules.jsonl` + `formal/*.tla` + `spec/conformance.jsonl` **before** code (`/spec-amend`).
- **decision-first**: any architectural lock → a `D#` in `~/src/graphrefly/decisions/decisions.jsonl`
  before code (`/design-review` → user approval → append).
- **consistency gate**: `node ~/src/graphrefly/dashboard/build.mjs --check` (non-zero on broken
  links / orphans) after touching any spec/decision/plan jsonl.

## Commands

```bash
pnpm test          # full TS test suite
pnpm run lint      # biome + layer/typecheck gates
pnpm run lint:fix  # biome check --write
pnpm run build     # build the package
pnpm bench         # vitest bench (informational, not a CI gate — L5-Q1)

# Cross-repo note (when working in ~/src/graphrefly-rs from this thread):
# Rust toolchain is driven by `mise`; in agent shells, prefer:
#   mise exec -- cargo <cmd>
# Fallback if PATH is constrained:
#   ~/.cargo/bin/cargo <cmd>
```

## Skills (clean-slate)

Project-local skills under `.agents/skills/`:

- **decision-guard** — recall locked D#/values/floor before any decision question.
- **spec-amend** — spec-first protocol amendment (rules + TLA+ + conformance, then code).
- **conformance** — drive behavioral conformance scenarios green per runtime.
- **dashboard** — build / check the `~/src/graphrefly` docs dashboard + consistency gate.
- **dev-dispatch** — plan, align with spec, implement, self-test.
- **qa** — adversarial review, fixes, test + lint + build, doc touch-ups.
- **design-review** — Q5–Q9 design lens before coding new primitives.
