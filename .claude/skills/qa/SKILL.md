---
name: qa
description: "Adversarial code review, apply fixes, final checks (test/lint/build), and doc updates. Run after /dev-dispatch or any manual implementation. Use when user says 'qa', 'review', or 'code review'. Supports --skip-docs to skip documentation phase."
disable-model-invocation: true
argument-hint: "[--skip-docs] [optional context about what was implemented]"
---

You are executing the **qa** workflow for **GraphReFly** (cross-language: TypeScript + Python + Rust port).

Operational docs live in **graphrefly-ts** (this repo). The diff may include changes in `graphrefly-ts`, `graphrefly-py` (`~/src/graphrefly-py`), or **`graphrefly-rs`** (`~/src/graphrefly-rs` — the Rust port).

### Repo detection

Inspect the diff to detect which repo(s) are touched. If the diff includes paths under `~/src/graphrefly-rs/` (or the working directory IS `~/src/graphrefly-rs`), this is a **Rust-port QA pass** — see "Rust-port QA additions" callouts inline below for the doc reads, subagent prompt extensions, final-check commands, and Phase 4 doc updates that apply.

Context from user: $ARGUMENTS

### Flag detection

If `$ARGUMENTS` contains `--skip-docs`, skip Phase 4 (Documentation Updates).

---

## Phase 1: Adversarial Code Review

### 1a. Gather the diff

Run `git diff` to get all uncommitted changes. If there are also untracked files relevant to the task, read and include them.

**Rust-port QA additions** — if the diff is in `~/src/graphrefly-rs/`, ALSO read these as part of the context-load (they are the canonical authority + active deferred-concerns registry for the Rust port; QA must NOT contradict them, and SHOULD update them when the slice closes a deferred item):

- **`docs/implementation-plan-13.6-canonical-spec.md`** (graphrefly-ts) — single-document canonical spec post-Phase 13.6.A. The Rust port's behavior authority. Use rule IDs (`R<x.y.z>`) to cite spec rules in findings.
- **`docs/implementation-plan-13.6-flowcharts.md`** (graphrefly-ts) — Mermaid diagrams for all internal methods/processes. Cross-reference for call/data-flow shape during edge-case review.
- **`~/src/graphrefly-rs/docs/migration-status.md`** — milestone tracker. Read to know which slice this QA pass covers, what's claimed-as-landed, and what test counts to verify.
- **`~/src/graphrefly-rs/docs/porting-deferred.md`** — registry of audit-surfaced concerns deferred to evidence-driven slices. **DO NOT raise findings that match an existing deferred entry** — those are already-acknowledged divergences/limitations. DO raise findings that contradict a deferred entry's stated scope (e.g., a "deferred for now" item that the slice actually starts touching but didn't update).

### 1b. Launch parallel review subagents

Launch these as parallel Agent calls. Each receives the diff and the context from $ARGUMENTS (what was implemented and why).

**Subagent 1: Blind Hunter** — Pure code review, no project context:
> You are a Blind Hunter code reviewer. Review this diff for: logic errors, off-by-one errors, race conditions, resource leaks, missing error handling, security issues, dead code, unreachable branches. For Python code, also check thread safety (including free-threaded Python without GIL). Output each finding as: **title** | **severity** (critical/major/minor) | **location** (file:line) | **detail**. Be adversarial — assume bugs exist.

**Subagent 2: Edge Case Hunter** — Has project read access:
> You are an Edge Case Hunter. Review this diff in the context of **GraphReFly** (`~/src/graphrefly/GRAPHREFLY-SPEC.md`). First, read `archive/optimizations/cross-language-notes.jsonl` and collect all entries with `id` prefix `divergence-` — these are **confirmed intentional cross-language divergences** that must NOT be raised as findings. Then check: unhandled message sequences (DIRTY without follow-up, DATA vs RESOLVED), diamond resolution (recompute once), COMPLETE/ERROR terminal rules, forward-unknown-types, batch semantics (DATA deferred, DIRTY not), reconnect/teardown leaks, meta companion nodes, and graph mount/signal propagation when `Graph` is in scope. Also flag violations of design invariants (spec §5.8–5.12): polling patterns (busy-wait or setInterval/time.sleep loops on node values), imperative triggers bypassing graph topology, bare Promises/queueMicrotask/setTimeout (TS) or asyncio.ensure_future/create_task/threading.Timer (PY) for reactive scheduling, direct Date.now()/performance.now() (TS) or time.time_ns()/time.monotonic_ns() (PY) usage (must use core/clock.ts or core/clock.py), hardcoded message type checks instead of messageTier/message_tier utilities, and Phase 4+ APIs that leak protocol internals (DIRTY/RESOLVED/bitmask) into their primary surface. **If the change touches `src/patterns/` or `src/compat/`, verify the implementation against COMPOSITION-GUIDE.md categories (§1 lazy activation, §2 subscription ordering, §3 null guards, §5 wiring order, §7 feedback cycles, §8 SENTINEL gate).** **Browser / Node / Universal tier (TS):** if the change adds or moves code in `src/extra/` or `src/patterns/`, confirm (a) any new `node:*` import or `require("<builtin>")` / `fileStorage` / `sqliteStorage` / `child_process` / filesystem API lives in a `<x>/node` subpath source file, not on a universal path; (b) any new DOM global (`window`, `document`, `indexedDB`, `Worker`, `MessagePort` constructor calls) lives in a `<x>/browser` subpath; (c) new subpaths are registered in both `tsup.config.ts` `ENTRY_POINTS` (+ `nodeOnlyEntries` when node-only) and `package.json` `exports`; (d) JSDoc `@example` blocks import from the correct subpath — a Node-only adapter must not suggest the universal barrel in its example. See `docs/docs-guidance.md` § "Browser / Node / Universal split" for the convention. **If the diff is in `~/src/graphrefly-rs/` (Rust port):** review against the *single-document canonical spec* at `~/src/graphrefly-ts/docs/implementation-plan-13.6-canonical-spec.md` (NOT the older multi-file TS spec — they diverge per §11 Implementation Deltas). Cross-reference rule IDs (`R<x.y.z>`) in findings. Cross-reference call/data-flow shape via `~/src/graphrefly-ts/docs/implementation-plan-13.6-flowcharts.md`. Read `~/src/graphrefly-rs/docs/porting-deferred.md` and DROP findings that match an already-acknowledged deferred entry (perf-tier §10 simplifications, v1 dispatcher limitations, spec divergences acknowledged in v1, Phase 13.8 carry-forwards). Also flag Rust-specific invariants: `unsafe` usage (forbidden — `#![forbid(unsafe_code)]`); `unwrap()` / `expect()` on user-facing paths (only allowed in tests/build scripts/impossible-by-construction with comment); missing `#[must_use]` on public-fn returns; raw integer types where newtypes (`NodeId(u64)`, `HandleId(u64)`, `FnId(u64)`, `LockId(u64)`) should be used; refcount imbalance via `BindingBoundary::retain_handle` / `release_handle` pairs; lock-discipline asymmetry across the `parking_lot::Mutex<CoreState>` boundary (sink-fire-with-lock-held vs lock-released); `Send + Sync` violations on public types; async runtime introduction in `graphrefly-core` (forbidden — Core stays sync). For each finding: **title** | **trigger_condition** | **potential_consequence** | **location** | **suggested_guard**.

### 1c. Triage findings

Classify each finding into:
- **patch** — fixable code issue. Include the fix recommendation.
- **defer** — pre-existing issue, not caused by this change.
- **reject** — false positive or noise. Drop silently.

For each **patch** and **defer** finding, evaluate fix priority (most to least important):
1. **Spec alignment** — matches `~/src/graphrefly/GRAPHREFLY-SPEC.md` (or `docs/implementation-plan-13.6-canonical-spec.md` for Rust-port diffs — the canonical post-Phase 13.6.A consolidated spec)
2. **Semantic correctness** — protocol and node contract
3. **Completeness** — edge cases covered
4. **Consistency** — patterns elsewhere in graphrefly-ts (or graphrefly-rs for Rust-port diffs)
5. **Level of effort**

**Optional:** Compare tricky operator behavior with **callbag-recharge** at `~/src/callbag-recharge` for precedent — GraphReFly still wins on spec conflicts.

**Rust-port QA additions** — when triaging findings on `~/src/graphrefly-rs/` diffs:
- Cross-check every finding against `~/src/graphrefly-rs/docs/porting-deferred.md`. Findings that match an already-acknowledged deferred entry (perf-tier §10, v1 dispatcher limitation, spec divergence acknowledged in v1, Phase 13.8 carry-forward) → **reject** silently.
- Findings that contradict the canonical spec at `~/src/graphrefly-ts/docs/implementation-plan-13.6-canonical-spec.md` → **patch** (high priority — canonical wins over current TS impl per §11 Implementation Deltas).
- Findings about TS-vs-Rust behavior gaps → check whether TS is the reference or canonical is. The canonical spec wins; if Rust is closer to canonical than TS, the finding is `reject`.
- Findings about Rust-specific invariants (`unsafe` usage, refcount imbalance, `Send + Sync`, `unwrap` on user-facing paths) → **patch** (Rust's value over TS / PY is compiler-enforced safety; bypassing forfeits the win).

### 1d. Present findings (HALT)

Present ALL patch and defer findings to the user. Treat both equally. For each finding:
- The issue and its location
- **Recommended fix** with pros/cons
- Whether it affects architecture (flag these)
- Whether it needs user decision or can be auto-applied

Group findings:
1. **Needs Decision** — architecture-affecting or ambiguous fixes
2. **Auto-applicable** — clear fixes that follow existing patterns

**Cross-language decision log:** For **Needs Decision** items that are architectural or affect TS/Python parity, add them to **`docs/optimizations.md`** under "Active work items" (this repo is the single source of truth for both TS and PY). When resolved, archive to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log".

**Wait for user decisions on group 1. Group 2 can be applied immediately if user approves the batch.**

---

## Phase 2: Apply Review Fixes

Apply the approved fixes from Phase 1.

---

## Phase 3: Final Checks

Run all checks for the affected repo(s) and fix any failures (do NOT skip or ignore):

**TypeScript:**
1. `pnpm test` — all tests must pass
2. `pnpm run lint:fix` — fix lint issues
3. `pnpm run build` — checks for DTS errors AND runs `assertBrowserSafeBundles` (fails the build with a `via X → Y → Z` chain if any universal entry transitively imports `node:*` or a bare Node builtin). If it fails, move the offending symbol to a `<x>/node` subpath per `docs/docs-guidance.md` § "Browser / Node / Universal split", don't silence the guardrail.

**Python (if PY code was changed):**
1. `cd ~/src/graphrefly-py && uv run pytest`
2. `cd ~/src/graphrefly-py && uv run ruff check --fix src/ tests/`
3. `cd ~/src/graphrefly-py && uv run ruff format src/ tests/`
4. `cd ~/src/graphrefly-py && uv run mypy src/`

**Rust (if Rust code was changed in `~/src/graphrefly-rs/`):**
1. `cd ~/src/graphrefly-rs && cargo test -p graphrefly-core` — primary core tests
2. `cd ~/src/graphrefly-rs && cargo test` — default-members workspace (excludes binding crates by design)
3. `cd ~/src/graphrefly-rs && cargo clippy -p graphrefly-core --all-targets` — must be clean (`clippy::pedantic` + `rust_2018_idioms` warn-by-default per CLAUDE.md). Allows must have inline comments justifying them.
4. `cd ~/src/graphrefly-rs && cargo fmt --check` — apply `cargo fmt` if needed; verify clean
5. Verify `#![forbid(unsafe_code)]` is preserved at every crate root

When the diff touches binding crates:
- `cd crates/graphrefly-bindings-js && pnpm build` (napi-rs)
- `cd crates/graphrefly-bindings-py && maturin develop` (pyo3 — only when verifying py bindings, not part of default flow)
- `cd crates/graphrefly-bindings-wasm && wasm-pack build` (wasm-bindgen)

Do NOT use `cargo build --workspace` / `cargo test --workspace` unless all binding toolchains are installed; the workspace excludes them from default-members for this reason.

If a failure is related to an implementation design question, **HALT** and raise it to the user before fixing.

---

## Phase 4: Documentation Updates

**Skip this phase if `--skip-docs` was passed.**

**Authoritative checklist:** follow **`docs/docs-guidance.md`** end-to-end (authority order, Tier 0–5, JSDoc tag table, `gen-api-docs.mjs` REGISTRY, `docs:gen` / `docs:gen:check`, `sync-docs`, when to edit which file).

Update documentation when behavior or public API changed:

- **`docs/docs-guidance.md`** — if documentation *conventions* or generator workflow change, update this file so `/qa` and contributors stay aligned
- **`~/src/graphrefly/GRAPHREFLY-SPEC.md`** — only if the **spec** itself is intentionally revised (rare; use semver rules in spec §8)
- **`docs/implementation-plan.md`** — **canonical pre-1.0 sequencer.** When a phase / sub-section item lands, mark it ✅ in the matching Phase 11–16 entry (e.g. "11.1 EC2/EC7 — bridge `value == null` → `=== undefined` ✅ landed") and tag with the date. When all items in a sub-section land, mark the sub-section ✅. When a **whole Phase** lands (every sub-section ✅, no in-flight WAIT/POST-1.0 carries that still need this phase's body to be readable), **archive it**: append a JSONL line per sub-section to the matching `archive/roadmap/phase-<n>-*.jsonl` and replace the in-file body with a 2–4-line summary + archive pointer (id, file). Single residual follow-ups move to `optimizations.md` with a back-link. See `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/implementation-plan.md`". New deferred items surfaced by /qa go to `optimizations.md` (line-item state) and may also need a sub-bullet in the matching implementation-plan phase if they reshape its scope.
- **`docs/optimizations.md`** — add **new open decisions** under "Active work items" (line-item state for the new carry; cross-link from the matching implementation-plan.md phase if relevant). **Then actively sweep:** scan for any fully-resolved items (all sub-tasks DONE, no remaining TODOs) and archive them to `archive/optimizations/resolved-decisions.jsonl` per `docs/docs-guidance.md` § "Optimization decision log". Remove archived content from `optimizations.md` — it should contain only active/open items, anti-patterns, and deferred follow-ups.
- **Structured JSDoc** on exported public APIs (Tier 1 — parameters, returns, examples per `docs-guidance`; source of truth for generated API pages). `@example` imports must use the correct subpath for the symbol's tier (universal / `<x>/node` / `<x>/browser`).
- **New public symbols** — barrel export + **`website/scripts/gen-api-docs.mjs` REGISTRY** entry, then `pnpm --filter @graphrefly/docs-site docs:gen` (or `docs:gen:check` in CI). If the symbol introduced a new subpath, also update `tsup.config.ts` (`ENTRY_POINTS` + `nodeOnlyEntries` when node-only) AND `package.json` `exports`.
- **`docs/test-guidance.md`** — if new test patterns are established
- **`docs/roadmap.md`** — **vision / wave context only** per 2026-04-30 migration. Do NOT track item-level state here; that lives in `implementation-plan.md`. Only edit the roadmap when the strategic frame shifts (a wave completes, a positioning lock changes). When a wave or Phase 7.x / 8.x section is fully done, archive its body to `archive/roadmap/*.jsonl` and leave a one-line pointer per `docs/docs-guidance.md` § "Roadmap archive — Workflow for `docs/roadmap.md`". Most /qa cycles will not touch roadmap.md at all.
- **`CLAUDE.md`** — only if fundamental workflow/commands changed

Do **not** hand-edit **`website/src/content/docs/api/*.md`** — regenerate from JSDoc via `docs:gen` per **`docs/docs-guidance.md`**.

### Rust-port QA additions to Phase 4

When the diff is in `~/src/graphrefly-rs/`, also update these (in addition to or instead of the TS-side docs above):

- **`docs/implementation-plan-13.6-canonical-spec.md`** (graphrefly-ts) — only if QA surfaced a canonical-spec ambiguity that needs to be tightened. Rare; this is the post-Phase 13.6.A locked authority. If touched, also coordinate with the spec-amendment workflow per spec §8 semver rules.

- **`docs/implementation-plan-13.6-flowcharts.md`** (graphrefly-ts) — only if a new internal method / process / property was added that the flowcharts should visualize, OR if a 🟥 RED node (current-code-vs-canonical drift) was resolved by the slice (turn it into a non-red node). Add the rule-ID cross-reference for any new flowchart node.

- **`~/src/graphrefly-rs/docs/migration-status.md`** — **always update on Rust-port QA pass.** Reflect:
  - Test count post-QA (per-file breakdown helps future readers)
  - Audit fixes that landed (F1, F2, etc. style, mirroring the Slice A+B closing template)
  - Cross-link new entries in `porting-deferred.md` from the "Carried forward" pointer
  - If a milestone closes during QA, add the `## M<n> — closed YYYY-MM-DD` section per the established template
  - clippy / fmt / `#![forbid(unsafe_code)]` status

- **`~/src/graphrefly-rs/docs/porting-deferred.md`** — **always update on Rust-port QA pass.** Reflect:
  - **NEW deferred concerns** surfaced by QA but NOT fixed in this slice — add to the appropriate section ("Performance — §10 simplifications deferred", "v1 dispatcher limitations", "Spec divergences acknowledged in v1", or "Phase 13.8 carry-forward follow-ups"). Each entry needs **what / why-deferred / source** triple.
  - **CLOSED concerns** — if QA fixes resolve a previously-deferred entry, move that entry to the "Audit fixes landed in Slice X" section (or the closing section in `migration-status.md`) and remove from the active deferred list.
  - **Resolved Open Questions** — if a Part-6 SESSION question got resolved during the slice (via design call or impl), update the entry with `~~strikethrough~~` + the resolution note + the date (mirror the Phase 14 header note pattern).

- **TS-side `docs/optimizations.md`** — only if QA surfaced a CROSS-LANGUAGE design question that needs to be tracked alongside TS / PY work. Rust-only deferrals belong in `porting-deferred.md`, not `optimizations.md`.

- **TS-side `docs/implementation-plan.md`** — only if a Phase 13.7 / 13.8 / similar Rust-port-tracking sub-item closes; mark ✅ inline with date. The Rust port does NOT add new Phase 11–16 sub-bullets here; `migration-status.md` is the canonical Rust tracker.

- **Rustdoc on public API surface** — every new `pub fn` / `pub struct` / `pub enum` in `graphrefly-core` (and binding crates) needs a doc comment with at minimum: behavior summary, `# Panics` (if applicable), and a cross-reference to the canonical spec rule (`R<x.y.z>`) when the API encodes a spec invariant. Generated via `cargo doc -p graphrefly-core` (lands later in CI; smoke-check locally).

- **DO NOT update the legacy multi-file TS spec** (`~/src/graphrefly/GRAPHREFLY-SPEC.md` + `COMPOSITION-GUIDE-*.md`) for Rust-port-only findings. The Rust port targets the canonical-spec doc; the multi-file spec is effectively superseded for Rust purposes per the Phase 13.6.A consolidation.
