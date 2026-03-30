# Batch 9: TypeScript documentation audit (docs-guidance + registry + examples + roadmap + spec)

**Scope:** Per `docs/audit-plan.md` §514–565 — JSDoc on listed modules, `gen-api-docs.mjs` REGISTRY, generated API pages, `examples/`, `docs/roadmap.md`, `~/src/graphrefly/GRAPHREFLY-SPEC.md`, `llms.txt`  
**Date:** 2026-03-29  
**Standards read:** `docs/docs-guidance.md`, `docs/roadmap.md` (Phase 0–3 sections)

---

## Executive verdict

**NOT COMPLETE** — does not meet `docs-guidance.md` Tier 1 requirements for all audited exports. Additional issues: **REGISTRY drift** (dead and mismatched entries), **generator limitations** (`{@link}` stripped to empty text in `.md`), **stale or phantom API pages**, **broken runnable example**, **roadmap typo vs spec**, **`llms.txt` absent** (roadmap still unchecked).

---

## 1. JSDoc completeness (audited files)

`docs-guidance.md` requires, for exported functions: verb-led description, `@param` per parameter, `@returns`, and at least one `@example` with a ` ```ts ` block. The audit plan extends this to “every export”; **types, interfaces, and symbol constants** typically only have short line or block comments (no `@param` / `@returns` / `@example`), which is a **partial** match to the letter of the checklist.

### 1.1 Strong coverage (representative)

- `src/core/sugar.ts` — `state`, `producer`, `derived`, `effect`, `pipe`: structured JSDoc with `@param`, `@returns`, `@example`.
- `src/core/node.ts` — `node()`: full structured JSDoc + example (see §3 for generator artifact on `{@link}`).
- `src/core/dynamic-node.ts` — `dynamicNode`: meets Tier 1 (not in the audit-plan file list but is a **public** export via `src/core/index.ts`).
- Many `src/extra/operators.ts` entries registered in REGISTRY: generally have `@param` / `@returns`; some lack `@example` (e.g. `window`, `gate`).

### 1.2 MISSING or weak vs docs-guidance (functions / classes)

| Location | Export | Gap |
|----------|--------|-----|
| `src/core/batch.ts` | `isBatching` | No `@example`; description does not start with a verb (“Returns …” is acceptable as verb-led; still missing example per strict checklist). |
| `src/core/batch.ts` | `partitionForBatch` | No `@example`. |
| `src/core/messages.ts` | `isPhase2Message` | Has `@param`; **no `@returns`** in JSDoc. |
| `src/core/meta.ts` | `describeNode` | Prose block only — **no `@param` / `@returns` / `@example`**. |
| `src/core/guard.ts` | `policy` | Duplicate adjacent comment blocks; the first claims default **permit**, the second **deny**. Code returns **`false` when no rule matches** (`allowed` stays false). **no `@param` / `@returns` / `@example`**. |
| `src/core/guard.ts` | `accessHintForGuard` | No `@param` / `@returns` / `@example`. |
| `src/core/guard.ts` | `GuardDenied` | Class lacks full Tier-1 style table (no `@example`). |
| `src/core/actor.ts` | `normalizeActor` | **No JSDoc**. |
| `src/graph/graph.ts` | `Graph` | Class has one `@example`; **individual public methods** are not documented to Tier 1 (no per-method `@param` / `@returns` / `@example`). |
| `src/extra/operators.ts` | `gate` | One-line description; **no `@param`, `@returns`, `@example`**. |
| `src/extra/operators.ts` | `window` | **No `@example`**. |
| `src/extra/operators.ts` | `flatMap`, `combineLatest`, `debounceTime`, `throttleTime`, `catchError` | Alias **const** exports — one-line only; no examples. |
| `src/extra/sources.ts` | `fromTimer`, `fromIter`, `fromPromise`, `fromAsyncIter`, `of`, `empty`, `never`, `throwError`, `cached`, `shareReplay` | Mostly **one-line** descriptions; **missing structured `@param` / `@returns` / `@example`** (several have richer prose but still not Tier 1). |
| `src/extra/backoff.ts` | `decorrelatedJitter`, `withMaxAttempts` | Not in REGISTRY; JSDoc depth not verified to full Tier 1 in this pass. |
| `src/extra/cron.ts` | `parseCron`, `matchesCron` | Need spot-check for `@example` (not exhaustively verified here). |
| `src/extra/resilience.ts` | `circuitBreaker`, `tokenBucket`, `withBreaker`, etc. | Mixed; **interfaces** `CircuitBreaker`, `TokenBucket` are documented as types, not as generator targets. |

### 1.3 Types / symbols (checklist “N/A” or abbreviated)

- `src/core/node.ts` — Large set of exported **types** (`Node`, `NodeOptions`, `NodeFn`, …) and **`NodeImpl`**: not documented to the same standard as functions.
- `src/core/messages.ts` — **Symbol** constants use short `/** … */` lines — no `@example`.
- `src/graph/graph.ts` — Many exported **types** (`GraphDescribeOutput`, `ObserveResult`, …): brief or inline comments only.

---

## 2. GEN-API-DOCS REGISTRY (`website/scripts/gen-api-docs.mjs`)

The generator only resolves **exported function declarations** or **exported classes**. It does **not** resolve **interfaces**, **type-only** symbols, or **missing** names.

### 2.1 Registered but **not** found in source (warnings on `node scripts/gen-api-docs.mjs`)

| REGISTRY key | Issue |
|--------------|--------|
| `CircuitBreaker` | Exported as **`interface`**, not `class` — `findExportedClass` never matches. |
| `TokenBucket` | Same — **`interface`**. |
| `tokenTracker` | **No such export** in `src/extra/resilience.ts` (implementation is `tokenBucket` only). |
| `PubSubHub` | **Interface** only; factory is `pubsub()`. |

For these keys, `processFunction` returns `null` and **does not write** output — leaving **stale** `website/src/content/docs/api/*.md` files on disk if they pre-existed.

### 2.2 Public APIs **not** in REGISTRY (no generated page)

Non-exhaustive list of notable gaps:

- **`dynamicNode`** (`src/core/dynamic-node.ts`) — exported from package, good JSDoc, **not registered**.
- **`src/extra/sources.ts`** — **entire module** absent from REGISTRY (`fromTimer`, `fromCron`, `share`, …).
- **Operators:** `gate`, `windowCount`, `windowTime`, alias exports (`flatMap`, `combineLatest`, …).
- **Backoff:** `decorrelatedJitter`, `withMaxAttempts`.
- **Core:** `isBatching`, `partitionForBatch`, `emitWithBatch`, `metaSnapshot`, `describeNode`, `policy`, …

### 2.3 Registry naming vs exports

- `MemoryCheckpointAdapter` / `DictCheckpointAdapter` / … — registered as **classes**; verify each is a real `export class` (checkpoint module uses classes — OK).

---

## 3. Generated API pages (spot-check vs JSDoc)

Checked under `website/src/content/docs/api/` after understanding generator behavior.

| File | Assessment |
|------|------------|
| `node.md` | **STALE / corrupted display**: JSDoc uses `{@link Node}`; plain-text extraction leaves **empty tokens** → “Creates a reactive —” and parameter descriptions like “a (producer)”. Fix: generator should strip or resolve `{@link …}`, or authors should avoid `{@link}` in sentences meant for markdown. |
| `tokenTracker.md` | **STALE / orphan**: source has no `tokenTracker`; Returns section degrades to “A new .”. Should be removed or registry should point at a real `export function tokenTracker` alias. |
| `TokenBucket.md` / `CircuitBreaker.md` | **STALE**: generator cannot bind to interfaces; content is not maintained from current TS. |
| `map.md` (typical operator) | Generally **aligned** with source when the export is a function with full JSDoc. |
| `pubsub.md` vs `PubSubHub.md` | **`pubsub()`** regenerates; **`PubSubHub.md`** is not produced by current run (interface key). |

**Recommendation:** Run `pnpm --filter @graphrefly/docs-site docs:gen:check` in CI; fix REGISTRY keys; delete or replace phantom pages; harden `extractJSDocData` for `{@link}`.

---

## 4. Examples

### 4.1 `examples/basic-counter.ts` — **does not match current public API**

- Uses **`doubled.sinks.add(...)`**. The public `Node` interface exposes **`subscribe(sink, hints?)`**, not `sinks` (internal storage is `_sinks`).
- Uses **`type === 1`** for DATA instead of the **`DATA`** symbol from `messages` / documented protocol.

So the file is **misleading for copy-paste** even though it may sit outside `tsconfig` `include` and skip typechecking.

### 4.2 Features without dedicated examples

- **`dynamicNode`** — warrants a small `examples/` script (roadmap 0.3b is checked).
- **Graph + guard + actor** — no dedicated example in `examples/` visible in this audit.
- **Sources** (`fromCron`, `fromPromise`, …) — no Tier-2/3 examples folder entries beyond what recipes might import.

---

## 5. Roadmap accuracy (`docs/roadmap.md`)

- **Phase 0.3b (`dynamicNode`)** — Checked **done**; implementation exists (`src/core/dynamic-node.ts`, tests). **Aligned.**
- **Phase 3.1 `tokenTracker`** — Checked **done**; **no `tokenTracker` symbol in TS source** (only `tokenBucket`). **Misaligned** with code unless alias is added or roadmap wording is corrected to `tokenBucket` / “parity alias planned”.
- **Phase 1.2 “Colon-delimited namespace: `parent:child:node`”** — **Wrong vs code and spec**: `src/graph/graph.ts` and **`GRAPHREFLY-SPEC.md`** use **`::`** (double-colon) paths. **Roadmap should say `parent::child::node`.**

Otherwise, high-level Phase 0–2 checkboxes appear consistent with `src/` at a coarse level (this audit did not re-run the full test suite).

---

## 6. Spec alignment (`~/src/graphrefly/GRAPHREFLY-SPEC.md`)

- **Qualified paths:** Implementation uses **`::`**; spec § (paths) documents **double-colon** — **aligned**. Roadmap line above is the **documentation divergence**, not the implementation.
- **Batch / two-phase protocol:** Core `batch.ts` and tests are written against spec language — no contradiction flagged in this pass.
- **Intentional omissions** (roadmap 0.5): `subscribe` / `operator` sugar omitted in TS — **documented** in roadmap.

No separate “optimizations” doc cross-check was performed in this batch.

---

## 7. `llms.txt`

- **Does not exist** in repo root or `website/public/` (search in `graphrefly-ts`).
- `docs/roadmap.md` lists **`llms.txt` for AI agent discovery** as **unchecked** — **consistent** with absence.
- `docs-guidance.md` still describes Tier 5 as future maintenance when primitives are added.

---

## Output format summary

| Tag | Finding |
|-----|---------|
| **COMPLETE** | Subset only: e.g. `sugar.ts` factories, many registered operators, `pubsub()`. |
| **MISSING** | See §1.2 table; plus wholesale **sources.ts** Tier 1 gap; **Graph** method docs; **REGISTRY** gaps for `dynamicNode`, sources, etc. |
| **STALE** | `tokenTracker.md`, `CircuitBreaker.md`, `TokenBucket.md`, `PubSubHub.md`; any `{@link}`-damaged pages; phantom pages when `processFunction` returns null. |
| **DIVERGENCE** | Roadmap **§1.2 path separator** vs **spec + `graph.ts`** (`:` vs `::`); roadmap **`tokenTracker`** vs **code** (`tokenBucket` only). |

---

## Suggested next actions (priority)

1. Fix **REGISTRY**: remove or replace `tokenTracker`, `CircuitBreaker`, `TokenBucket`, `PubSubHub`; register **`circuitBreaker`**, **`tokenBucket`**, **`pubsub`** (or document interfaces differently).
2. Add **`export const tokenTracker = tokenBucket`** (or update roadmap) for py parity.
3. Repair **`examples/basic-counter.ts`** to use **`subscribe`** and **`DATA`**.
4. Normalize **roadmap** path wording to **`::`**.
5. Implement or generate **`llms.txt`** when ready; uncheck remains accurate until then.
6. Harden **gen-api-docs** `{@link}` handling and fail CI if REGISTRY keys miss exports.
