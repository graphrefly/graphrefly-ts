---
name: dev-dispatch
description: "Implement the requested feature or fix within project authority and verify affected behavior."
---

## Rules / decisions / work

Read `~/.codex/skills/project-governance/references/rules-decisions-work.md` before contract
analysis or record changes in this workflow. Implement against current rules and approved design
constraints; use work only for scope, acceptance and evidence. Reconcile affected documentation
through the proper owner. Never activate a rule or infer new semantics from a task completion or
passing test.

You are executing the **dev-dispatch** workflow for the **clean-slate GraphReFly** redesign.

This repo is **`@graphrefly/ts`** — the self-contained TypeScript implementation (D32). Clean-slate code lands in **`packages/ts/src/`**. The language-neutral authority (spec / decisions / plan / conformance / formal) lives in **`~/src/graphrefly`** (branch `clean-slate`) as jsonl — when this skill and that repo disagree, **that repo wins** (AGENTS.md). Sibling impls: `@graphrefly/rust` (`~/src/graphrefly-rs`), `@graphrefly/py` (`~/src/graphrefly-py`) — each self-contained; cross-language = wire bridge, never in-process (D32).

Use `packages/ts/src/` for the current runtime and the maintained owner JSONL for authority. Historical API descriptions do not override current contracts.

> **Ownership guard.** The current working directory is execution context, not architectural ownership. Before implementing anything that mixes Workspace, Canvas, or product-surface vocabulary, classify every new symbol as protocol, `@graphrefly/ts` library/solution, Canvas product, or docs-only. Canvas-owned lifecycle material such as `CanvasWorkspace*` DTOs/helpers, Canvas slot lifecycle lowering, lifecycle reason vocabularies, retention-pressure policy/status, selector adapters, component registries, and product lifecycle APIs belong in `~/src/graphrefly-canvas` unless an explicit D# says `@graphrefly/ts` owns that public API. Focused subpath exports and subpath smoke tests count as TS library API expansion; do not treat "root index unchanged" as sufficient.

The user's task/context is: $ARGUMENTS

### Mode detection
Use a focused workflow for routine fixes and a fuller plan for substantial changes. `--light` remains
supported. Neither mode requires another approval for work already authorized by the user; pause
for unresolved semantic/architectural decisions or an action outside the approved scope.

### Shared build and preview

Use `~/.codex/skills/bmad-build/SKILL.md` inside the selected implementation slice, retaining this
workflow's authority, sequencer and gates. Use `~/.codex/skills/bmad-checkpoint-preview/SKILL.md` for
human review: build-handoff mode during ordinary delivery; interactive mode for explicit checkpoint
or `--practice` requests. No prediction or teach-back is required.

### Workflow floor (non-negotiable)
- **decision-first and owner-first**: any architectural lock needs an origin-qualified `D#` in its unique owner ledger from `~/src/graphrefly/authority/ledgers.jsonl` BEFORE code (`/design-review` → user approval → append). Cross-project/protocol locks stay in root; TypeScript-only product or implementation locks live in `graphrefly-ts:decisions/decisions.jsonl`. A design lock alone is not implementation approval; the current implementation request can supply that approval.
- **spec-first** (F-NO-IMPL-DEFINED): any wave-protocol behavior change amends `spec/rules.jsonl` + `formal/*.tla` + `spec/conformance.jsonl` FIRST (`/spec-amend`), THEN code. Operators/sugar/inspection are per-language (D6/D24) — NOT spec, skip spec-amend.
- **no autonomous decisions**: surface spec↔code conflicts; don't silently pick. Review affected boundaries for multi-file rewrites.
- **verify premise**: design tables lag code — inspect the named symbols + check landed markers (`plan/phases.jsonl` status/notes) before designing new surface; correct stale premises from current evidence; ask only if the correction changes scope or a locked decision.
- **consistency gate**: after touching any `~/src/graphrefly` jsonl, run `node ~/src/graphrefly/dashboard/build.mjs --check` (non-zero on broken links / orphans).

### Code-intelligence routing

Use a current Codegraph index when it helps trace the affected symbols; use direct file reads or
`rg` for simpler lookups, unavailable tools, or stale/unindexed files. Reuse source already read.
Do not initialize an index merely to satisfy this workflow. Validate through the affected executable
checks and required gates; an index is context, not correctness evidence.

---

## Phase 1: Context & Planning

Load context and plan in a bounded pass. Read authority indexes first, then only the records and implementation
seams governing the frozen slice. Parallelize independent targeted reads; do not load the whole design history
merely because it is available.

Context index: read only the governing records and relevant implementation/tests below, reusing
material already loaded. Protocol/formal context is needed only when the changed behavior depends on it:
- `~/src/graphrefly/AGENTS.md` — the single-source authority index (read FIRST).
- `~/src/graphrefly/spec/rules.jsonl` — the protocol 宪法 (R-* rules); deep-read the rules your change touches.
- `~/src/graphrefly/authority/ledgers.jsonl` + the resolved owner ledger — the federated decision authority (or invoke `/decision-guard` to recall the governing origin-qualified D#/values/floor).
- `~/src/graphrefly/plan/phases.jsonl` — the CSP-* sequencer: find the phase this task belongs to, its `status` (done/impl/design), deps, and note. Read this FIRST among the plan files so you know whether you're on a ready phase or one still gated.
- `~/src/graphrefly/plan/backlog.jsonl` + `plan/antipatterns.jsonl` — deferred carries (B#) with triggers; anti-patterns to flag against.
- `~/src/graphrefly/spec/conformance.jsonl` — the behavioral scenarios (C-*) your change must keep green; locate exact test/source evidence for the arm you target; legacy `runtimes` fields are claims, not proof.
- `~/src/graphrefly/guide/guide.jsonl` — composition / test / docs / contribute guidance (G-composition / G-test / G-docs / G-contribute).
- `~/src/graphrefly/sessions/active/SESSION-clean-slate-redesign.md` (DS-1) — the L0–L6 design narrative + F-* constraints, when you need the why behind a lock.
- Any files the user referenced in $ARGUMENTS.
- The clean-slate source you'll modify: substrate = `packages/ts/src/{node,dispatcher,ctx,protocol,batch}/`; graph-layer = `packages/ts/src/graph/` (Graph + 8-verb sugar + operators + inspection describe/observe/profile).
- Existing tests: `packages/ts/src/__tests__/`.

**Frozen reference (D41):** `packages/pure-ts/**` and `~/src/callbag-recharge` are READ-ONLY prior art for analogous operator behavior / edge cases / test structure during a re-derive (D40 Catalog-first). Map concepts to the clean-slate substrate (`graph.node`/`ctx.down`/`ctx.deps`/`Graph`, `describe`/`observe` per R-graph-surface@1) — do NOT 1:1 port; the old substrate API and semantics differ. They are NOT the behavior authority — `spec/rules.jsonl` is.

While planning, validate proposed changes against the clean-slate floor (cite the rule/D#):
- **Sacred (L0.7):** topology declarative/serializable/inspectable · wave protocol is a public spec · wave protocol impl is **sync**.
- **8 verbs, closed (D4):** `graph` and its `node`/`state`/`batch` + `producer`/`derived`/`effect`/`mount`. Every node belongs to one graph (R-graph-domain@3, graphrefly-ts:D179): no standalone `node()`, no free `batch()`; `graph.batch(fn)` commits the body's writes as one wave and a throw commits nothing. **Operators are `node` sugar (D6), not verbs**, instantiated with `g.initNode(op, deps)` or `pipe(g, src, ...ops)` — per-language, never in parity (D24); real factory names show in `inspect()`. Adding a verb is a constitutional change.
- **Messages** (R-messages): an array of `[Type, Data?]` tuples; the type set is closed (START, PENDING, DATA, RESOLVED, INVALIDATE, COMPLETE, ERROR) and messages travel only downstream; there is no upward message and no tier table. A function's only output is `ctx.down(array)` (one call = one array) or `ctx.emit(...values)`, sugar for a few fixed DATA values; input-sized output builds the array and uses `ctx.down`. `ctx.down([])` sends nothing.
- **Waves** (R-wave@2): the kernel puts PENDING at the head of each array that carries a value or a terminal, runs a fan-in (a diamond included) once per wave after every pending dependency has settled, and sends RESOLVED for a pending node that sent nothing. Node output containing PENDING or RESOLVED is rejected. Every DATA is delivered unchanged (no equals-substitution).
- **Invocation** (R-invocation@2, graphrefly-ts:D185): `ctx.deps[i]` is one view per dependency `{ id, waves, terminal, value, has, invalidated }`; there are no parallel per-field arrays and no `depBatch`/`depLatest` helpers. A kernel node has no first-run gate (R-lifetime@2, graphrefly-ts:D184): its function runs on activation and on any later input, so it must not assume a dependency has a value; `derived`/`effect` sugar runs once every dependency has a value and then when one sent DATA.
- **No polling** (R-no-polling); **no imperative triggers** (R-no-imperative@2 — a controller acts only by writing a state node its target declares as a dependency; remove imperative paths when no caller depends); **no raw async** in the sync core (R-no-raw-async / F-SYNC-CORE — async lives only in sources, adapters, executors and the wire bridge).
- **Data moves via messages** (R-data-not-peek — never peek a dep's `.cache` to seed compute; `.cache` is a read-only accessor for external consumers). SENTINEL = absence-of-DATA (R-sentinel); read inputs through `ctx.deps[i].has`/`.value`/`.waves`.
- **The clock is graph-local** (no global singleton, D26/R-clock); `onMessage`/`onSubscribe` are substrate-fixed, not user-replaceable (D19). The dispatcher is one function table with no pools (graphrefly-ts:D187).
- **Primary-API clean** (R-primary-api-clean@2): value-level sugar (derived/effect/operators) never sees PENDING, RESOLVED or START and never writes a message; arrays, terminals as input and policies belong to the ctx-level node (`g.node`/`g.producer`). Sugar value-fn → ctx-fn wrapping happens in the graph layer (D27); a value-level `throw` becomes ERROR (D30, R-failure@3).
- **graph = single-thread concurrency domain (R-graph-domain@3):** each graph has its own wave, request queue and batch; parallelism via multiple graphs + wire bridge; rewire is intra-graph only. Requests made during a wave wait for it (R-request-order@2).
- **`ctx.state`** = per-node private state for the current lifetime (R-invocation@2); shared/observable state must be an explicit node + dep, not `ctx.state` (D23).
- **F-NO-WEDGE-CUT:** every primitive serves ≥2 segments (no LLM-only or single-segment wedge; F-NO-LLM-ONLY). **F-PERF:** budget every abstraction (thin node, default-off inspection).

**Targeting a sibling (py/rust):** if the task targets `@graphrefly/py` (`~/src/graphrefly-py`) or `@graphrefly/rust` (`~/src/graphrefly-rs`), read that package's local layout + its conformance arm status in `spec/conformance.jsonl`. The cross-language contract is **behavioral conformance (D24)**, not symbol parity. PY public APIs are synchronous (return `Node[T]`/`Graph`/value, no `async def`); async lives at the source/pool boundary only (F-SYNC-CORE).

---

## Phase 2: Resolve material decisions

Proceed with authorized implementation when existing decisions govern the behavior. Explain material
assumptions and tradeoffs briefly. Ask only when an unresolved choice changes product semantics,
public contract, architecture, or authorization. Preserve spec-first amendments and owner-ledger
approval for new locks; a locked design alone does not authorize implementation when the user deferred it.

## Phase 3: Implementation & Self-Test

Once implementation is authorized and material decisions are resolved:

1. Implement the changes.
   - Treat `~/src/graphrefly/spec/rules.jsonl` as non-negotiable for behavior; if code drifts from a rule, align to the rule — or surface the conflict, don't silently pick.
   - Cite the governing R-id / D# in test expectations.
2. Add meaningful behavior tests where needed (per `guide/guide.jsonl` G-test — unit / property / conformance layering):
   - Put tests in the most specific existing file under `packages/ts/src/__tests__/`.
   - Use `graph.observe(ids, sink)` (`{ id, msgs }` per delivered array) for live message assertions; assert at the node + message level otherwise. A behavioral-protocol change ALSO needs a `spec/conformance.jsonl` scenario (`/conformance`) and explicit activation under `authority/README.md`; passing tests never activate the rule automatically.
3. Run checks:
   - **TS:** `pnpm --filter @graphrefly/ts test` (vitest) + `pnpm run lint` (biome + layer/typecheck gates) + `pnpm run build` (tsup) as relevant.
   - **PY (if targeted):** the `@graphrefly/py` package's own test/lint/type gates in `~/src/graphrefly-py`.
   - **jsonl touched:** `node ~/src/graphrefly/dashboard/build.mjs --check` (consistency gate).
4. Fix any failures.

If implementation exposes an **open architectural question**, keep it unresolved and route it to design review; track its resolution work under the existing owner/work-admission process. Update only the authorized work or phase whose acceptance has actually passed. Rule activation is a separate explicit amendment under `authority/README.md`, never a consequence of marking work complete. Run the relevant consistency gates after record changes.

When done, briefly list files changed and new exports added. Apply the shared BMAD QA process with local gates, then provide the checkpoint preview trail.
Wait for review navigation only when interactive checkpoint mode was explicitly requested.
