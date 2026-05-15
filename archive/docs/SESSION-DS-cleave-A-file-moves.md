# Cleave A — file-move lookup table (locked 2026-05-14)

**Provenance:** `SESSION-rust-port-layer-boundary.md` Units 6 + 8 (D193, D196, D197, D198, D200, D201, D202), user-locked 2026-05-14. This doc resolves the per-file open questions Unit 5's `extra/` row table did not enumerate. **This doc IS the brief for sub-slices A2 (pure-ts purification) and A3 (root shim cleave + Biome rule).**

**Single source of truth caveat:** locked semantics live in Units 6 + 8 of `SESSION-rust-port-layer-boundary.md` and the `extra/` row table in `~/src/graphrefly-rs/CLAUDE.md`. This doc only adds the per-file destination mapping needed to execute the cleave; if the parent docs change, update there first and reconcile here.

---

## Sub-slice order

| Sub-slice | Scope | Estimated diff |
|---|---|---|
| **A1 (this doc)** | Design lock — file-move lookup table + codemod plan + Biome rule design. No code changes. | 1 doc commit |
| **A2** | Purify `@graphrefly/pure-ts`. Move presentation OUT of `packages/pure-ts/src/` into root `src/{base,utils,presets,solutions,compat}/`. Delete 17 backward-compat shims at `extra/*.ts`. Rewrite pure-ts `tsup.config.ts` ENTRY_POINTS + `package.json` exports to substrate only. Codemod ~126 test imports. Pure-ts test suite stays green. | ~120 file moves + import-path codemod; one PR |
| **A3** | Root shim cleave + 4-layer structure + Biome custom rule. Root `src/index.ts` switches from blanket re-export to substrate-re-exports + own presentation content. New root `tsup.config.ts` ENTRY_POINTS for the 4 layers. New `package.json` exports + `peerDependencies`. Add `solutions/index.ts` curated barrel. Write + enable Biome custom rule for layer-boundary enforcement. | Separate PR |
| **A4** | Doc pass — CLAUDE.md § Layout refresh, `docs/optimizations.md` provenance entry, `archive/docs/design-archive-index.jsonl`. | Small PR |

---

## Locked classification (Q1–Q18, 2026-05-14)

User-acked all recommendations from prior turn. Recap inline for the codemod agent:

| # | File / folder | Locked destination |
|---|---|---|
| Q1 | `extra/resilience/*` (11 files) | All except `resilient-pipeline.ts` → `utils/resilience/`; `resilient-pipeline.ts` → `presets/resilience/` |
| Q2 | `extra/utils/{decay, ring-buffer, sizeof}` + `extra/timer.ts` | `ring-buffer.ts`, `sizeof.ts`, `timer.ts` stay in pure-ts (substrate-internal; used by `graph/graph.ts`/`graph/profile.ts`/`reactiveLog`/`reactiveSink`). `decay.ts` → `base/utils/` |
| Q3 | `extra/render/*` (13 files) | `base/render/` |
| Q4 | `extra/composition/*` (10 files) | `stratify.ts` stays substrate (already in Rust). Rest fan out: split `composite.ts` → `base/composition/{verifiable,distill}.ts`; `observable.ts`, `materialize.ts`, `topology-diff.ts`, `pubsub.ts`, `backpressure.ts`, `external-register.ts` → `base/composition/`; `audited-success-tracker.ts` → `utils/orchestration/` (alongside `tracker.ts`) |
| Q5 | `extra/sources/iter.ts` | Stays substrate. Rename folder to `extra/sources/sync/iter.ts` matching Unit 5 terminology. |
| Q6 | `extra/sources/event.ts` (mixed) | Split into: `extra/sources/event/timer.ts` (substrate, `fromTimer` only); `base/sources/event/cron.ts` (`fromCron` parser, consumes pure-ts `fromTimer`); `base/sources/event/dom.ts` (`fromEvent` + `fromRaf`) |
| Q7 | `extra/sources/async.ts` | All → `base/sources/async.ts`. Flag `share`/`replay`/`cached` removal as separate slice. |
| Q8 | `extra/sources/settled.ts` | `firstValueFrom`/`firstWhere`/`nodeSignal`/`reactiveCounter` → `base/sources/settled.ts`; `keepalive` → `base/meta/keepalive.ts` |
| Q9 | `extra/sources/fs.ts`, `extra/sources/git.ts` + root-level `extra/sources-fs.ts`, `extra/sources-process.ts`, `extra/git-hook.ts` | `base/sources/node/{fs,git,process,git-hook}.ts` (Node-only subpath) |
| Q10 | `patterns/_internal/{errors,index}.ts` | `errors.ts` → `utils/_errors/index.ts` (cross-utils shared error hierarchy); `index.ts` (`emitToMeta`) → `base/meta/emit-to-meta.ts` |
| Q11 | `patterns/{process,job-queue,surface,topology-view,reactive-layout,graphspec,demo-shell,domain-templates}` | All → `utils/<name>/` (single-domain primitives) |
| Q12 | `patterns/inspect/{audit,guarded-execution,lens}.ts` + `presets/inspect.ts` | `audit.ts` + `lens.ts` → `utils/inspect/`; `guarded-execution.ts` → `presets/inspect/`; `presets/inspect.ts` → `presets/inspect/composite.ts` |
| Q13 | `patterns/ai/*` | `adapters, agents, extractors, memory, prompts, safety, graph-integration, _internal.ts, node.ts, browser.ts` → `utils/ai/<subdomain>/`; `presets/{agent-loop, agent-memory}` → `presets/ai/`; `agents/presets.ts` → `presets/ai/agents.ts` (rename to avoid the bare `presets.ts` colocated with utils) |
| Q14 | `patterns/harness/*` | `strategy, profile, bridge, trace, defaults, types, auto-solidify, eval-verifier, actuator-executor, refine-executor` → `utils/harness/`; `presets/{harness-loop, refine-loop, spawnable}` → `presets/harness/` |
| Q15 | `extra/reactive-sink.ts` | `base/io/_sink.ts` (presentation — Promise/then/catch transport boundary) |
| Q16 | Backward-compat shims at `extra/*.ts` root (17 files; `extra/stratify.ts` deleted with the rest since `composition/stratify.ts` is the canonical home) | Delete cleanly. |
| Q17 | `compat/*` | Stays as `compat/<framework>/` (path unchanged; just lives under root shim, not pure-ts) |
| Q18 | `src/loader.ts` | Stays. Real loader when `@graphrefly/native` publishes. |

### Additional locks discovered during inventory

| # | Item | Decision |
|---|---|---|
| Q19 | `extra/timer.ts` (`ResettableTimer`) | **Substrate-internal.** Used by `graph/graph.ts`. Stays in pure-ts at `core/_internal/timer.ts` (alongside ring-buffer's destination — see Q20). |
| Q20 | Substrate-internal utilities — where in pure-ts? | New folder `packages/pure-ts/src/core/_internal/` for `ring-buffer.ts`, `sizeof.ts`, `timer.ts`. Use `_internal` (leading underscore) per the existing convention (`patterns/_internal/`, `extra/composition/_internal/` etc.). |
| Q21 | `extra/single-from-any.ts` (`singleFromAny`) — REAL, used by `extra/sources/async.ts` (going to presentation) AND `patterns/ai/adapters/middleware/replay-cache.ts` (going to utils/ai). | Presentation utility. → `base/composition/single-from-any.ts`. |
| Q22 | `extra/cron.ts` (REAL — `CronSchedule` interface + cron expression parser) | Presentation parser. → `base/sources/event/cron.ts` (merge with `fromCron` factory body extracted from Q6) |
| Q23 | `extra/storage-browser.ts` (REAL — IDB *sources* `fromIDBRequest` / `fromIDBTransaction`, not storage tiers) | Presentation. → `base/sources/browser/idb.ts` |
| Q24 | `extra/adaptive-rate-limiter.ts` (REAL) | Presentation. → `utils/resilience/adaptive-rate-limiter.ts` (companion to `rate-limiter.ts`) |
| Q25 | `extra/meta.ts` (REAL — `domainMeta`) | Presentation utility. → `base/meta/domain-meta.ts` |
| Q26 | `extra/node.ts` + `extra/browser.ts` (subpath barrels for Node-only / browser-only extras) | Rewrite as `base/index-node.ts` / `base/index-browser.ts` post-cleave; or just regenerate via tsup ENTRY_POINTS (no manual barrel needed if exports table handles it). Defer the final shape to A3. |
| Q27 | `extra/index.ts` (the main `extra/*` public barrel) | After A2, the substrate side keeps a narrower `extra/index.ts` exporting only substrate; presentation side gets its content as part of the new layered barrels (`base/index.ts`, `utils/index.ts`, etc.). |
| Q28 | Substrate peer-resolution mechanism (how `@graphrefly/graphrefly` picks `pure-ts` vs `native`) | **Open — deferred to A3 design.** Three candidates: (a) TS path mapping in consumer tsconfig (forces consumer config); (b) bundler alias (vite/webpack); (c) fixed peer on `@graphrefly/pure-ts` + npm `overrides` for native users. **A2 keeps the existing `export * from "@graphrefly/pure-ts"` shim wiring** — no change needed for A2's success. |

---

## File-move table — destination-organized

**Reading convention:** `OLD → NEW`. All OLD paths are relative to `packages/pure-ts/src/`. NEW paths are either same root (substrate stays) or relative to root `src/` (presentation moves). Test files mirror their source-file move (e.g., `__tests__/extra/foo.test.ts` → `__tests__/base/foo.test.ts`).

### Substrate (stays in `packages/pure-ts/src/`)

| Current | New (same package) | Notes |
|---|---|---|
| `core/*` | unchanged | All core. |
| `graph/*` | unchanged | All graph. |
| `extra/operators/*` | unchanged | Substrate per Unit 5. |
| `extra/data-structures/*` | unchanged | Substrate per Unit 5. |
| `extra/storage/*` | unchanged | Substrate per Unit 5 (Node tiers). |
| `extra/composition/stratify.ts` | unchanged | Substrate (already in Rust). |
| `extra/sources/iter.ts` | `extra/sources/sync/iter.ts` | Folder rename to match Unit 5 vocab. |
| `extra/sources/event.ts` (only `fromTimer`) | `extra/sources/event/timer.ts` | `fromCron`/`fromEvent`/`fromRaf` extracted out. |
| `extra/timer.ts` | `core/_internal/timer.ts` | Q19. Substrate-internal `ResettableTimer`. |
| `extra/utils/ring-buffer.ts` | `core/_internal/ring-buffer.ts` | Q2. |
| `extra/utils/sizeof.ts` | `core/_internal/sizeof.ts` | Q2. |

### Moves to `@graphrefly/graphrefly` (presentation; new root `src/` 4-layer structure)

#### `base/` — domain-agnostic infrastructure

| Current (`packages/pure-ts/src/`) | New (root `src/`) |
|---|---|
| `extra/io/*` (31 files: http, websocket, sse, webhook, kafka, nats, redis-stream, rabbitmq, pulsar, mcp, otel, prometheus, syslog, statsd, clickhouse-watch, drizzle, kysely, prisma, sqlite, csv, ndjson, to-clickhouse, to-csv, to-file, to-loki, to-mongo, to-postgres, to-s3, to-tempo, http-error, checkpoint, sink, _internal) | `base/io/*` |
| `extra/reactive-sink.ts` | `base/io/_sink.ts` (Q15) |
| `extra/composition/composite.ts` | **split**: `base/composition/verifiable.ts` + `base/composition/distill.ts` (Q4) |
| `extra/composition/observable.ts` | `base/composition/observable.ts` |
| `extra/composition/materialize.ts` | `base/composition/materialize.ts` |
| `extra/composition/topology-diff.ts` | `base/composition/topology-diff.ts` |
| `extra/composition/pubsub.ts` | `base/composition/pubsub.ts` |
| `extra/composition/backpressure.ts` | `base/composition/backpressure.ts` |
| `extra/composition/external-register.ts` | `base/composition/external-register.ts` |
| `extra/single-from-any.ts` | `base/composition/single-from-any.ts` (Q21) |
| `extra/mutation/*` | `base/mutation/*` |
| `extra/worker/*` (5 files) | `base/worker/*` |
| `extra/render/*` (13 files) | `base/render/*` (Q3) |
| `extra/meta.ts` (`domainMeta`) | `base/meta/domain-meta.ts` (Q25) |
| `patterns/_internal/index.ts` (`emitToMeta`) | `base/meta/emit-to-meta.ts` (Q10) |
| `extra/sources/settled.ts` `keepalive` export | `base/meta/keepalive.ts` (Q8) |
| `extra/sources/settled.ts` (remaining) | `base/sources/settled.ts` (Q8) |
| `extra/sources/async.ts` | `base/sources/async.ts` (Q7) |
| `extra/sources/event.ts` (`fromCron` + `fromEvent` + `fromRaf`) + `extra/cron.ts` | **split**: `base/sources/event/cron.ts` (parser + `fromCron`), `base/sources/event/dom.ts` (`fromEvent` + `fromRaf`) (Q6, Q22) |
| `extra/sources/fs.ts` + `extra/sources-fs.ts` | `base/sources/node/fs.ts` (Q9) — consolidate the two |
| `extra/sources/git.ts` + `extra/git-hook.ts` | `base/sources/node/git.ts` + `base/sources/node/git-hook.ts` (Q9) |
| `extra/sources-process.ts` | `base/sources/node/process.ts` (Q9) |
| `extra/storage-browser.ts` (IDB sources) | `base/sources/browser/idb.ts` (Q23) |
| `extra/utils/decay.ts` | `base/utils/decay.ts` (Q2) |

#### `utils/` — domain building blocks

| Current | New (root `src/`) |
|---|---|
| `patterns/messaging/*` (3 files) | `utils/messaging/*` |
| `patterns/orchestration/*` (4 files) | `utils/orchestration/*` |
| `extra/composition/audited-success-tracker.ts` | `utils/orchestration/audited-success-tracker.ts` (Q4) |
| `patterns/cqrs/index.ts` | `utils/cqrs/index.ts` |
| `patterns/memory/index.ts` | `utils/memory/index.ts` |
| `patterns/reduction/index.ts` | `utils/reduction/index.ts` |
| `patterns/inspect/audit.ts` | `utils/inspect/audit.ts` (Q12) |
| `patterns/inspect/lens.ts` | `utils/inspect/lens.ts` (Q12) |
| `patterns/inspect/index.ts` (less `guarded-execution.ts`) | `utils/inspect/index.ts` |
| `patterns/process/index.ts` | `utils/process/index.ts` (Q11) |
| `patterns/job-queue/index.ts` | `utils/job-queue/index.ts` (Q11) |
| `patterns/surface/*` (5 files) | `utils/surface/*` (Q11) |
| `patterns/topology-view/*` (3 files) | `utils/topology-view/*` (Q11) |
| `patterns/reactive-layout/*` (5 files) | `utils/reactive-layout/*` (Q11) |
| `patterns/graphspec/index.ts` | `utils/graphspec/index.ts` (Q11) |
| `patterns/demo-shell/index.ts` | `utils/demo-shell/index.ts` (Q11) |
| `patterns/domain-templates/index.ts` | `utils/domain-templates/index.ts` (Q11) |
| `patterns/ai/{adapters, agents, extractors, memory, prompts, safety, graph-integration}/` (less `agents/presets.ts`) | `utils/ai/<subdomain>/` (Q13) |
| `patterns/ai/_internal.ts` | `utils/ai/_internal.ts` (Q13) |
| `patterns/ai/index.ts` | `utils/ai/index.ts` |
| `patterns/ai/node.ts` | `utils/ai/node.ts` |
| `patterns/ai/browser.ts` | `utils/ai/browser.ts` |
| `patterns/harness/{strategy, profile, bridge, trace, defaults, types, auto-solidify, eval-verifier, actuator-executor, refine-executor}.ts` (10 files) | `utils/harness/*` (Q14) |
| `patterns/harness/index.ts` | `utils/harness/index.ts` |
| `extra/resilience/*` (less `resilient-pipeline.ts`) | `utils/resilience/*` (Q1) |
| `extra/adaptive-rate-limiter.ts` | `utils/resilience/adaptive-rate-limiter.ts` (Q24) |
| `patterns/_internal/errors.ts` | `utils/_errors/index.ts` (Q10) — shared across utils, internal-visibility-only |

#### `presets/` — opinionated compositions of utils

| Current | New (root `src/`) |
|---|---|
| `patterns/ai/presets/agent-loop.ts` | `presets/ai/agent-loop.ts` (Q13) |
| `patterns/ai/presets/agent-memory.ts` | `presets/ai/agent-memory.ts` (Q13) |
| `patterns/ai/agents/presets.ts` | `presets/ai/agents.ts` (Q13) |
| `patterns/harness/presets/harness-loop.ts` | `presets/harness/harness-loop.ts` (Q14) |
| `patterns/harness/presets/refine-loop.ts` | `presets/harness/refine-loop.ts` (Q14) |
| `patterns/harness/presets/spawnable.ts` | `presets/harness/spawnable.ts` (Q14) |
| `patterns/inspect/guarded-execution.ts` | `presets/inspect/guarded-execution.ts` (Q12) |
| `patterns/inspect/presets/inspect.ts` | `presets/inspect/composite.ts` (Q12 — rename) |
| `extra/resilience/resilient-pipeline.ts` | `presets/resilience/resilient-pipeline.ts` (Q1) |

#### `solutions/` — curated headline barrel (verticals deferred per D202)

| New file | Content |
|---|---|
| `solutions/index.ts` | Re-exports headline products from `presets/*`: `agentLoop`, `agentMemory`, `harnessLoop`, `refineLoop`, `spawnable`, `guardedExecution`, `resilientPipeline`. Plus any others the user adds in A3 review. **No vertical bundles yet** (deferred until consumer pressure per D202). |

#### `compat/` — external framework adapters (top-level, sibling to 4 layers)

| Current | New (root `src/`) | Notes |
|---|---|---|
| `compat/jotai/*` | `compat/jotai/*` | Path unchanged |
| `compat/nanostores/*` | `compat/nanostores/*` | Path unchanged |
| `compat/nestjs/*` | `compat/nestjs/*` | Path unchanged |
| `compat/react/*` | `compat/react/*` | Path unchanged |
| `compat/signals/*` | `compat/signals/*` | Path unchanged |
| `compat/solid/*` | `compat/solid/*` | Path unchanged |
| `compat/svelte/*` | `compat/svelte/*` | Path unchanged |
| `compat/vue/*` | `compat/vue/*` | Path unchanged |
| `compat/zustand/*` | `compat/zustand/*` | Path unchanged |
| `compat/index.ts` | `compat/index.ts` | Path unchanged |

---

## Backward-compat shim deletions (Q16)

These 17 files at `packages/pure-ts/src/extra/*.ts` are pure re-export barrels with no source. Delete during A2.

```
extra/adapters.ts              (→ io/index.js)
extra/backoff.ts               (→ resilience/backoff.js)
extra/backpressure.ts          (→ composition/backpressure.js)
extra/cascading-cache.ts       (→ storage/cascading-cache.js)
extra/composite.ts             (→ composition/composite.js)
extra/content-addressed-storage.ts (→ storage/content-addressed.js)
extra/external-register.ts     (→ composition/external-register.js)
extra/http-error.ts            (→ io/http-error.js)
extra/observable.ts            (→ composition/observable.js)
extra/operators.ts             (→ operators/index.js)
extra/pubsub.ts                (→ composition/pubsub.js)
extra/reactive-index.ts        (→ data-structures/reactive-index.js)
extra/reactive-list.ts         (→ data-structures/reactive-list.js)
extra/reactive-log.ts          (→ data-structures/reactive-log.js)
extra/reactive-map.ts          (→ data-structures/reactive-map.js)
extra/reactive.ts              (→ data-structures barrel)
extra/resilience.ts            (→ resilience/index.js)
extra/sources.ts               (→ sources/index.js)
extra/storage.ts               (→ storage/index.js)
extra/storage-core.ts          (→ storage/core.js)
extra/storage-node.ts          (empty after Audit 4)
extra/storage-tiers.ts         (→ storage/tiers.js)
extra/storage-tiers-node.ts    (→ storage/tiers-node.js)
extra/storage-tiers-browser.ts (→ storage/tiers-browser.js)
extra/storage-wal.ts           (→ storage/wal.js)
extra/stratify.ts              (→ composition/stratify.js)
```

That's 26 shims, not 17 — the prior count missed the storage tier family. **All deleted in A2.** Per "no backward compat" memory.

---

## Codemod plan (M2)

**Goal:** rewrite ~126 unique import paths across 134 test files + all source files that cross old/new boundaries, atomically.

**Approach:** single Node-based codemod script `scripts/codemod-cleave-A.ts`, executable via `pnpm tsx scripts/codemod-cleave-A.ts`. Auditable as one commit; not committed to repo permanently — runs once during A2.

**Script structure:**

```typescript
// scripts/codemod-cleave-A.ts
import { readdir, readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

// Map of OLD import-path-suffix → NEW import-path-suffix.
// Order matters: process longest-prefix-first to avoid premature matches.
const MOVES: Array<[from: string, to: string]> = [
  // Substrate folder renames
  ["extra/sources/iter.js", "extra/sources/sync/iter.js"],
  // Composition splits (composite.ts → verifiable + distill)
  // ... handled by per-symbol resolution below ...

  // Presentation: extra/io/* → base/io/*
  ["extra/io/", "base/io/"],
  ["extra/reactive-sink.js", "base/io/_sink.js"],

  // Composition (base layer)
  ["extra/composition/observable.js", "base/composition/observable.js"],
  ["extra/composition/materialize.js", "base/composition/materialize.js"],
  // ... etc, ALL composition rows from the table above ...

  // Patterns → utils
  ["patterns/messaging/", "utils/messaging/"],
  ["patterns/orchestration/", "utils/orchestration/"],
  ["extra/composition/audited-success-tracker.js", "utils/orchestration/audited-success-tracker.js"],
  // ... etc ...

  // Presets
  ["patterns/ai/presets/", "presets/ai/"],
  ["patterns/harness/presets/", "presets/harness/"],
  ["patterns/inspect/presets/", "presets/inspect/"],
  ["patterns/inspect/guarded-execution.js", "presets/inspect/guarded-execution.js"],
  ["extra/resilience/resilient-pipeline.js", "presets/resilience/resilient-pipeline.js"],

  // Backward-compat shim deletions: rewrite legacy → canonical
  ["extra/adapters.js", "base/io/index.js"],
  ["extra/operators.js", "extra/operators/index.js"],
  // ... 26 shims ...

  // Special-case symbol-level splits (composite.ts → 2 files)
  // Handled with import-statement parsing below.
];

// Symbol-level split: composite.ts split into verifiable + distill.
// For imports of the form `import { verifiable } from "...composite.js"`,
// rewrite to `from "...base/composition/verifiable.js"`. Same for distill.
const SYMBOL_SPLITS: Record<string, Record<string, string>> = {
  "extra/composition/composite.js": {
    verifiable: "base/composition/verifiable.js",
    VerifiableOptions: "base/composition/verifiable.js",
    VerifiableBundle: "base/composition/verifiable.js",
    VerifyValue: "base/composition/verifiable.js",
    distill: "base/composition/distill.js",
    DistillOptions: "base/composition/distill.js",
    DistillBundle: "base/composition/distill.js",
    Extraction: "base/composition/distill.js",
  },
  // ... event.ts split (fromTimer vs fromCron/fromEvent/fromRaf) ...
  // ... settled.ts split (keepalive vs rest) ...
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.name === "node_modules" || e.name === "dist") continue;
    if (e.isDirectory()) out.push(...await walk(p));
    else if (/\.(ts|tsx|js|jsx|mts|cts)$/.test(e.name)) out.push(p);
  }
  return out;
}

async function rewriteFile(path: string): Promise<boolean> {
  // 1. Parse import statements with a simple regex (sufficient — no AST needed).
  //    Match: `import [...] from "<path>";` and `import("<path>")`.
  // 2. For each match:
  //    a. If symbol-level split applies (importing from a split file), partition
  //       the import clause by symbol and emit one statement per destination.
  //    b. Otherwise, apply the longest matching MOVES prefix.
  // 3. Write back if changed.
  // ... implementation ...
}

async function main() {
  // Phase 1: move files (rename on disk). Build the new directory tree first.
  // ... mkdir -p new locations, mv files ...

  // Phase 2: rewrite imports across the whole monorepo.
  const roots = ["packages/pure-ts/src", "src", "packages/parity-tests", "packages/cli/src"];
  for (const root of roots) {
    const files = await walk(root);
    for (const f of files) await rewriteFile(f);
  }
}

main();
```

**Validation after codemod:**
1. `pnpm test:pure-ts` — all 2980 tests green.
2. `pnpm test:parity` — parity scenarios green (parity surface unchanged by cleave).
3. `pnpm lint` — Biome clean (the new layer rule from A3 is OFF during A2).
4. `pnpm build` — both pure-ts build + shim build emit clean dists.
5. `pnpm bench` — quick smoke (no perf regression expected from a pure file move).
6. Spot-check `pnpm --filter @graphrefly/cli test` — CLI consumer still resolves.

**Rollback plan:** A2 is one PR; reverting the PR reverts the cleave. The codemod script is not committed — only its output is. (Optional: commit the script under `archive/` for posterity.)

---

## Biome custom rule design (D201)

> **EXECUTION NOTE (2026-05-15):** Not built during A3 despite the agent's report (false claim — /qa caught it). Realized 2026-05-15 as a **zero-dep standalone script** `scripts/check-layer-boundary.ts` + baseline ratchet `scripts/layer-boundary-baseline.json`, wired into `pnpm lint` — GritQL (Biome 2.x plugin language) cannot express the import-rank comparison. /qa then found the cleave's 4-layer DAG is violated in **23 shipped-source spots** (classes A/B/C); all baselined + deferred to a dedicated next-batch slice. See D201 amendment in `docs/rust-port-decisions.md` + `docs/optimizations.md` "Cleave A layer-boundary residuals". The original design sketch below is retained for historical context; the rank model is what the script implements.

**Rule name:** `layer-boundary` (under custom plugin namespace `graphrefly`).

**Biome plugin model:** Biome 2.0+ supports custom rules via JS-based plugins (`biome.json` `plugins` array; rule files export an analyzer). Confirm exact extension shape via context7 lookup of `@biomejs/biome` docs at A3 start.

**Layer rank (numeric for comparison):**

| Layer | Rank |
|---|---|
| `@graphrefly/pure-ts` (any path) | 0 (substrate) |
| `@graphrefly/native` (any path) | 0 (substrate, alias) |
| `src/base/**` | 1 |
| `src/utils/**` | 2 |
| `src/presets/**` | 3 |
| `src/solutions/**` | 4 |
| `src/compat/**` | 5 |

**Rule logic (pseudocode):**

```typescript
// biome.json:
// {
//   "plugins": ["./scripts/biome-plugin-layer-boundary.js"]
// }

export const rule = {
  name: "layer-boundary",
  level: "error",
  visit(file, importStmt) {
    const sourceLayer = layerOf(file.path);
    const targetLayer = layerOf(importStmt.resolvedPath);

    // Substrate is always importable (rank 0 ≤ any).
    if (targetLayer === 0) return;

    // Within-layer free composition.
    if (sourceLayer === targetLayer) return;

    // Cross-layer must be top-down: source rank > target rank.
    if (sourceLayer < targetLayer) {
      report(`Layer-boundary violation: ${file.path} (layer=${layerName(sourceLayer)}) ` +
             `cannot import from ${importStmt.resolvedPath} (layer=${layerName(targetLayer)}). ` +
             `Imports must flow top-down: solutions → presets → utils → base → substrate.`);
    }
  },
};

function layerOf(path: string): number {
  if (path.startsWith("@graphrefly/pure-ts")) return 0;
  if (path.startsWith("@graphrefly/native")) return 0;
  if (path.includes("/src/base/") || path.endsWith("/src/base") || path.includes("/base/")) return 1;
  if (path.includes("/src/utils/") || path.includes("/utils/")) return 2;
  if (path.includes("/src/presets/") || path.includes("/presets/")) return 3;
  if (path.includes("/src/solutions/") || path.includes("/solutions/")) return 4;
  if (path.includes("/src/compat/") || path.includes("/compat/")) return 5;
  return -1; // unknown — skip rule
}
```

**Edge cases:**
- Tests in `__tests__/` belong to the layer of the file they test (e.g., `__tests__/base/foo.test.ts` is layer 1). Rule applies to test imports too — keeps tests honest about their dependencies.
- Within-layer circular imports are rejected by Biome's existing `noCycle` rule (or equivalent). Layer-boundary rule does not need to enforce this separately.
- `utils/_errors/` (shared error hierarchy) is within `utils/` — imports from any `utils/<domain>/` to `utils/_errors/` are intra-layer = allowed.

**Wiring in A3:**
1. Add `scripts/biome-plugin-layer-boundary.js` (or `.ts` compiled to JS) with the rule.
2. Update `biome.json` `plugins` array.
3. Run `pnpm lint` — should be clean if A2 was executed correctly.
4. Add CI check (already exists via `pnpm lint` in GH Actions).

---

## Agent delegation plan (M2 → "use cheaper agents")

A2 and A3 are decomposed into discrete agent-actionable subtasks. Each subtask has a measurable success criterion. **Owner = parent agent (Opus); workers = Sonnet sub-agents for mechanical steps; final review = Opus.**

### A2 subtask sequence

| Subtask | Owner | Output |
|---|---|---|
| **A2.1** Author `scripts/codemod-cleave-A.ts` | Sonnet (write script per the spec above) | One TS file, runs against repo, prints summary |
| **A2.2** Spot-check codemod on dry run (`--dry`) | Opus review | Sonnet reports the list of file moves + import rewrites; Opus eyeballs |
| **A2.3** Execute codemod live | Sonnet | New folder tree + rewritten imports |
| **A2.4** Update `packages/pure-ts/tsup.config.ts` ENTRY_POINTS — drop presentation entries | Sonnet | tsup config has substrate-only entries; presentation entries deleted |
| **A2.5** Update `packages/pure-ts/package.json` `exports` — drop presentation subpaths | Sonnet | pure-ts publishes substrate-only |
| **A2.6** Update `packages/pure-ts/src/index.ts` — substrate-only re-export | Sonnet | Main barrel emits substrate only |
| **A2.7** `pnpm test:pure-ts` green | Opus run + diagnose any failures | All ~2980 tests pass |
| **A2.8** `pnpm test:parity` green | Opus | Parity green |
| **A2.9** `pnpm build` green for both pure-ts and root shim | Opus | dists emit cleanly |
| **A2.10** Spot-check `pnpm --filter @graphrefly/cli test` | Sonnet | CLI consumer still resolves and passes |
| **A2.11** Commit + review diff | Opus | PR-ready commit; user-review opportunity before push |

### A3 subtask sequence

| Subtask | Owner | Output |
|---|---|---|
| **A3.1** Resolve Q28 (substrate peer-resolution mechanism) — small design session | Opus | Locked design for how `@graphrefly/graphrefly` chooses pure-ts vs native at install/build/runtime |
| **A3.2** Rewrite root `src/index.ts` per Q28 outcome | Sonnet | Root barrel composes substrate + presentation |
| **A3.3** Rewrite root `tsup.config.ts` ENTRY_POINTS for 4 layers + compat | Sonnet | New entries: `src/{base,utils,presets,solutions}/index.ts` + per-domain subpaths + `compat/<framework>/index.ts` |
| **A3.4** Rewrite root `package.json` `exports` + `peerDependencies` | Sonnet | New exports table + peer dep on `@graphrefly/pure-ts` (+ optional native) |
| **A3.5** Add `src/solutions/index.ts` curated barrel | Sonnet | Headline-product re-exports per D202 |
| **A3.6** Write Biome custom rule `layer-boundary` plugin | Sonnet | Plugin file matching the spec above |
| **A3.7** Wire plugin into `biome.json` + run `pnpm lint` | Sonnet | Lint clean OR list of violations for Opus to triage |
| **A3.8** `pnpm test`, `pnpm build`, `pnpm bench` all green | Opus | Validation gates |
| **A3.9** Commit + review | Opus | PR-ready |

### A4 subtask sequence

| Subtask | Owner | Output |
|---|---|---|
| **A4.1** Update `CLAUDE.md` § Layout to reflect the cleave + 4-layer model | Sonnet | Section refreshed |
| **A4.2** Add `docs/optimizations.md` provenance entry | Sonnet | One-line entry pointing to this doc + the SESSION doc |
| **A4.3** Append entry to `archive/docs/design-archive-index.jsonl` | Sonnet | One JSONL line |
| **A4.4** User review + final commit | Opus + user | Closeout |

---

## Validation gates summary

Per-sub-slice gates:

- **A1 (this doc):** user ack → commit doc.
- **A2:** `pnpm test:pure-ts && pnpm test:parity && pnpm build && pnpm lint && pnpm --filter @graphrefly/cli test` all green.
- **A3:** `pnpm test && pnpm build && pnpm lint && pnpm bench` all green, with Biome `layer-boundary` rule active.
- **A4:** docs review.

Any failure during A2/A3 surfaces to Opus, NOT auto-fixed by the worker agent — root-cause diagnosis (per "Debug process" memory) before re-running.

---

## Related files

- `archive/docs/SESSION-rust-port-layer-boundary.md` — parent design session (Units 1–8 locks)
- `~/src/graphrefly-rs/CLAUDE.md` § "extra/ row classification" — substrate-vs-presentation table
- `~/src/graphrefly-rs/CLAUDE.md` § "Layering predicate" — D193 single-rule predicate
- `docs/implementation-plan.md` Phase 13.9.A — prior cleave that landed root shim
- `archive/docs/SESSION-patterns-extras-consolidation-plan.md` — prior consolidation (sources/operators/storage/data-structures folder splits)

---

## Open questions for A3 (NOT blocking A2)

| # | Question | Required for |
|---|---|---|
| Q28 | Substrate peer-resolution mechanism (pure-ts vs native install-time pick) | A3.1 design session |
| Q29 | `src/extra/index.ts` post-cleave — does the substrate package still publish a top-level `extra/` barrel, or does it migrate everything to subpath imports? | A3.4 package.json design |
| Q30 | `src/extra/node.ts` and `src/extra/browser.ts` (Node-only / browser-only extras barrels) — keep them post-cleave for backwards compat or rely on tsup's per-entry export table? | A3.3 tsup config |

---

## POST-EXECUTION CORRECTIONS (executed 2026-05-15, slices A2–A4)

Cleave A was executed across A2 (substrate purification) + A3 (root shim cleave + Biome + CLI fix) + A4 (this doc pass). Reality diverged from the A1 plan in the following ways. **These corrections are authoritative; the Q1–Q30 tables above are the original plan, not the final state.**

### Reclassifications — A1 Q4/Q7/Q8 were WRONG (symbols are substrate, not presentation)

Discovered during A2 because `packages/pure-ts/src/graph/graph.ts` and `extra/operators/higher-order.ts` already depended on them pre-cleave — substrate cannot import presentation, so the A1 classification was unsound:

| Symbol | A1 said | Actual (corrected) | Evidence |
|---|---|---|---|
| `topology-diff` (`topologyDiff`, `DescribeChangeset`) | Q4 → `base/composition/` (presentation) | **substrate** → `packages/pure-ts/src/extra/composition/topology-diff.ts` | `graph.ts` line ~41 imports it for reactive `describe()` |
| `keepalive` | Q8 → `base/meta/` (presentation) | **substrate** → `packages/pure-ts/src/extra/sources/_keepalive.ts` | `graph.ts` uses it for self-pruning subscriptions in `describe()`/`explain()` |
| `fromPromise`, `fromAsyncIter`, `fromAny` | Q7 → `base/sources/async.ts` (presentation) | **substrate** → `packages/pure-ts/src/extra/sources/async.ts` | `extra/operators/higher-order.ts` uses `fromAny` via `sources/index.js` |

So **3 reclassifications**, not 4. `pubsub` was flagged by the A2 agent as a substrate *candidate* but A3 verified zero substrate consumers (`grep` of `core/`+`graph/` empty) and correctly kept it **presentation** at `src/base/composition/pubsub.ts` (`@graphrefly/graphrefly`) — matches the original A1 Q4 lock. (An earlier draft of this section + the batch report wrongly listed pubsub as substrate; corrected here.)

`src/base/sources/async.ts` re-exports the 3 async functions from `@graphrefly/pure-ts`; `defer/forEach/toArray/share/replay/cached/shareReplay` remain genuine presentation in that file. `core/_internal/{ring-buffer,sizeof,timer}.ts` is the substrate-internal home for utilities used by `graph/` (Q2/Q19/Q20 confirmed correct).

**ResettableTimer/RingBuffer duplication — RESOLVED 2026-05-15 (commit `4dd5758`).** A3 had created local presentation copies in `src/base/utils/`. Fixed by exporting `RingBuffer` + `ResettableTimer` from the public `@graphrefly/pure-ts/core` barrel (physical home stays `core/_internal/`, surfaced via `core/index.ts` like `describeNode`), deleting the 2 presentation copies + the dead `src/base/io/_ring-buffer.ts` shim, and rewiring 10 consumers to import from `@graphrefly/pure-ts/core`.

### Public-API renames (collision resolution at root barrel)

`src/index.ts` does `export * from "@graphrefly/pure-ts"` + `export * from "./{base,utils,presets,solutions}"`. Where a substrate symbol and a presentation symbol collided, the **substrate symbol kept the canonical name** and the presentation variant was disambiguated. These were applied during A3 and are **breaking public-API renames** (acceptable pre-1.0 per `feedback_no_backward_compat`; logged here for visibility):

| Old name | New name | Why |
|---|---|---|
| `timeout` (resilience factory in `utils/resilience`) | `withTimeout` | collides with substrate reactive operator `timeout` (`extra/operators/control.ts`) — operator keeps `timeout`. (Interim name was `deadline`; user-renamed to `withTimeout` 2026-05-15 commit `0e0bded` for `with*`-wrapper-family consistency.) |
| `withTimeout` (AI-middleware in `utils/ai/adapters/middleware`) | `withLLMTimeout` | freed by the resilience rename above colliding into it via `utils/ai` re-export — generic resilience keeps `withTimeout`, AI variant gets `LLM` prefix (commit `df7d32e`) |
| `withBreaker` (AI-middleware in `utils/ai/adapters/middleware`) | `withLLMBreaker` | collides with generic `withBreaker` in `utils/resilience/breaker.ts` — generic keeps the name |
| `Message<T>` (messaging) | `TopicMessage<T>` | barrel collision |
| `BudgetGateBundle` (AI) | `LLMBudgetGateBundle` | barrel collision with generic budget-gate bundle |

### Substrate public-API additions

Added to `@graphrefly/pure-ts` public barrels during A3 (presentation layer needs them; JSDoc already marked public): `sha256Hex` (→ `core` barrel), `sourceOpts`, `wrapSubscribeHook` (→ `extra` barrel), `describeNode` (→ `core` barrel; was in `core/meta.ts` but un-barreled).

### Q28 lock (was open for A3) — option (c)

`@graphrefly/graphrefly` declares `peerDependencies: { "@graphrefly/pure-ts": "*" }` and imports substrate literally. Native users install `@graphrefly/native` + add npm/pnpm `overrides` redirecting `@graphrefly/pure-ts`. No facade/runtime fallback.

### Test migration (STOP #2 resolved = Option B)

Presentation tests moved from `packages/pure-ts/src/__tests__/` to root `src/__tests__/<mirror>/`. New root `vitest.config.ts`; root `package.json` gained `test:graphrefly` integrated into `test`. Final counts: pure-ts 1165 (44 files), root presentation 1803 (91 files), parity 315/316 (+1 skipped), cli 8.

### Known issue (NOT introduced by cleave — pre-existing flake)

`packages/parity-tests/scenarios/storage-wal/tier-3-restore.test.ts` `'pure-ts' > restore replays state from WAL frames` is an **intermittent test-ordering flake** (`expected 21 to be 42`). Passes on isolated run and on repeated full-suite runs; the rust-via-napi variant always passes. Candidate for a separate test-isolation fix — does NOT block the cleave.

### Process notes (for future multi-agent slices)

Two agent failure modes recurred and cost rework: (1) Sonnet agents reported "all gates green" without actually running the full gate set (A2-b only verified build, not tests; A3 only verified build). (2) Agents left created files **untracked/uncommitted** in the worktree/main working tree (`test-helpers.ts` ×3 in A2; biome rule + `sha256Hex` + async fix in A3) so the work passed locally but broke on merge. Future cleave-style slices: require the agent to run every gate explicitly and `git status --porcelain` clean before claiming done.

### Commit chain (on main)

A2: `9905525` (codemod) → `1426808` (split) → `414a6dc` (fix imports) → `eea9bd3` (merge) → `179f018` (missing test-helpers).
A3: `ebd9c9c` (bulk) → `a48261b` (merge) → `f719ef6` (leaked residual) → `42589d1` (describeNode + rename test alignment + lint:fix) → `203704b` (untrack worktrees).
A4: this doc + CLAUDE.md Layout + optimizations.md provenance + design-archive-index entry.
/qa fixes: `703f335` (Group 2 A1–A4 — fromCron relocation, withLLMBreaker label, dead-file deletion, doc fixes). Adversarial pass = Blind Hunter + Edge Case Hunter.

---

## OPEN /qa FOLLOW-UPS (not yet landed — come back to these)

These were surfaced by the post-cleave adversarial /qa (2026-05-15) and **deliberately NOT landed from the cleave session** because they collide with a **parallel porting session** that had uncommitted D203 F18/F20 work in the shared working tree (`packages/parity-tests/impls/{pure-ts,rust,types}.ts`, `packages/pure-ts/src/extra/data-structures/reactive-index.ts`, two new scenario files, + uncommitted `docs/optimizations.md` / `rust-port-decisions.md` / `design-archive-index.jsonl` edits).

### N1 — substrate-contract gap (Group 1, user-approved option (a), NOT YET IMPLEMENTED)

**Decision (locked 2026-05-15, user-approved):** the 6 symbols the dedup fix (`4dd5758`) + A3 barrel additions exposed on `@graphrefly/pure-ts` public barrels — **`RingBuffer`, `ResettableTimer`** (core barrel), **`describeNode`, `sha256Hex`** (core barrel), **`sourceOpts`, `wrapSubscribeHook`** (extra barrel) — are NOT in the `Impl` parity contract (`packages/parity-tests/impls/types.ts`; verified grep-count 0). Presentation code (`src/utils/resilience/{retry,rate-limiter}.ts`, `src/base/sources/async.ts`, etc.) imports them from the substrate peer, so **`@graphrefly/graphrefly` breaks the moment `@graphrefly/native` is the substrate provider** (native only promises `Impl`).

**What to do (option (a)):** add these 6 to `packages/parity-tests/impls/types.ts` `Impl` (and the `pure-ts` impl adapter that satisfies it), so `@graphrefly/native` MUST expose them. **Fold into the D203 native-publish batch** (`~/src/graphrefly-rs/docs/migration-status.md` § "NEXT BATCH — Ship `@graphrefly/native`" — add as scope item 8).

**Why it wasn't done here:** `impls/types.ts` is the exact file the parallel porting session has open + modified. Landing N1 from the cleave session would clobber their live edits. **Action: relay N1 to / land it in the porting session**, not duplicated from here.

### Group 3 — pre-existing gaps (NOT cleave-introduced; the split made them visible)

Worth a ticket (recommend logging to `docs/optimizations.md` once the porting session's uncommitted edits to that file are committed — held to avoid cross-session doc entanglement):

- **Edge #2 — `replay`/`cached`/`shareReplay` double-deliver the most-recent value to late subscribers.** `wrapSubscribeHook` flushes the replay buffer via `before(sink)`, then `origSubscribe` also push-on-subscribes the wrapper's cache → last value delivered twice. `src/base/sources/async.ts` (`replay`) + `packages/pure-ts/src/extra/sources/_internal.ts:83` (`wrapSubscribeHook`). Test `src/__tests__/base/sources/sources.test.ts` only checks `slice(0,2)` so it misses the dup. Suggested: build the wrapper with `initial: undefined` (suppress push-on-subscribe; the buf flush IS the replay).
- **Edge #3 — `graph.destroy()` drops the async storage disposer's Promise.** `drainDisposers` is synchronous (`() => void | Promise<void>`), discards returned Promises; the async dispose only awaits when called directly, not via `destroy()`'s drain loop → in-flight WAL saves abandoned. `packages/pure-ts/src/graph/graph.ts` (`drainDisposers` ~742, `destroy()` ~4904, `async dispose` ~5591). Pre-existing ("fix: parity tests" era). Suggested: `destroyAsync(): Promise<void>` that awaits storage disposers, or warn on sync-drained Promise.

Minor / doc-only (note, no ticket needed): Edge #5/#9 `fromRaf`/`fromCron` use `performance.now()`/`new Date()` (pre-existing, browser-native API contract / structurally unavoidable for calendar match — consider injectable clock for tests); Edge #8 `distill` local `keepalive` shadow discards unsub (pre-existing from `composite.ts`); Edge #10 `defer` drops DIRTY-before-terminal in same batch (spec-violation defense); Edge #7/#11 observe/remove throw-site docs.
