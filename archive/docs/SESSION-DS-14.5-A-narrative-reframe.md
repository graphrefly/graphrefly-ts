---
SESSION: DS-14.5-A-narrative-reframe
DATE: May 4–5, 2026
TOPIC: Spec-as-projection narrative reframe + multi-agent subgraph ownership protocol. Catalog reframed from library headline to user-host concern. Wave 2 positioning shifts away from "harness builder" (collides with Archon 20.7K⭐) toward "spec is code's blueprint; multi-agent worktrees co-edit it without colliding."
REPO: graphrefly-ts (TS-primary; PY parity post-substrate)
SUPERSEDES: archive/docs/SESSION-harness-engineering-strategy.md (Wave 2 framing only — analysis sections preserved as historical context)
---

## CONTEXT

This session was triggered by user-supplied research on a Xiaohongshu post (`Riceneeder/sop-runtime` author abandoning his project after discovering `coleam00/Archon`). Competitive analysis surfaced two adjacent projects with massive distribution:

- **`coleam00/Archon`** — 20.7K⭐, tagline "**The first open-source harness builder for AI coding**." Direct collision with our planned Wave 2 positioning.
- **`nousresearch/hermes-agent`** — ~96K⭐ self-improving agent that auto-extracts Python "skills" from successful task completions. Direct realization of trajectory-to-artifact patterns.

The conversation surfaced a deeper mismatch: GraphReFly's `llmCompose` → catalog → spec workflow assumes spec is the LLM's authoring surface, but for code-aware agents (Claude Code, Codex) **code is the source of truth and spec should be its projection**, not the other way around. This reverses authoring direction and reduces catalog from library headline to user-host concern.

User reframe (locked decisions L1–L8 below) confirmed:
1. GraphSpec is code's projection, not LLM's input.
2. Catalog is user-host responsibility.
3. Multi-agent worktree co-editing is the differentiating Wave 2 narrative.
4. The library substrate (`factoryTag`, `decompileSpec`, `Graph.attachStorage`, `Actor / Guard ABAC`, messaging hub, DS-14 op-log changesets) already supports 80% of the new model — most work is narrative + a small amount of glue.

**Source materials:**
- 2026-05-04 conversation transcript (this session opening)
- Xiaohongshu post by 顾泽恺 (sop-runtime author) + comment thread
- [`Riceneeder/sop-runtime`](https://github.com/Riceneeder/sop-runtime) (1⭐, abandoned-equivalent), [`coleam00/Archon`](https://github.com/coleam00/Archon) (20.7K⭐), [`nousresearch/hermes-agent`](https://github.com/nousresearch/hermes-agent) (~96K⭐)
- [`SESSION-first-principles-audit.md`](SESSION-first-principles-audit.md) PART 7 (SQL constraint argument — applies to NL-only path; reframe extends to code-aware path)
- [`SESSION-harness-engineering-strategy.md`](SESSION-harness-engineering-strategy.md) (Wave 2 framing being reframed)
- [`SESSION-DS-14-changesets-design.md`](SESSION-DS-14-changesets-design.md) (DS-14 substrate, locked 2026-05-05) — directly enables the L0–L3 ownership staircase

---

## PART 1: REFRAME — AUTHORING DIRECTION REVERSED

### Old model (NL-only / catalog-as-authoring)

```
User NL → LLM uses catalog as verb table → emits GraphSpec → compileSpec → run
                ↑
        catalog = LLM's input grammar
        spec = LLM's output (authoring surface)
```

Catalog must be hand-curated and shipped by the library. SQL-style argument: limit LLM's verb set to reduce error space. Valid for clients with no code access (Claude Desktop, MCP-only).

### New model (code-aware / spec-as-projection)

```
LLM modifies repo (writes fns / composition code) → factoryTag-stamped code emits GraphSpec automatically →
  spec lands in PR → human + reviewer LLMs use spec as blueprint → merge → run
                                  ↑
                            spec = code's projection
                            spec = verification & coordination surface, not authoring grammar
```

Catalog reduces to a binding map maintained by the user's host application (not the library). Library ships the round-trip (`factoryTag` + `decompileSpec`), the auto-checkpoint (spec persistence on topology change), the ownership protocol primitives, and the validate/lint tooling.

### Why this reframe is correct now

1. **Coding agents are the dominant 2026 LLM use case.** Claude Code, Codex, Aider — all operate on full repos with file system access. The "give the LLM a verb table because it can't see code" assumption is obsolete for these tools.
2. **Catalog maintenance is real friction.** Hand-curated `description` / `examples` / `configSchema` for every fn duplicates JSDoc and rots faster than code.
3. **Multi-agent worktree co-edit is the unsolved problem.** Archon ships isolated per-PR worktrees but each agent writes alone. Hermes auto-extracts but each agent compounds in isolation. Nobody offers structural multi-agent coordination on shared topology — exactly what reactive graph + ownership protocol enables.
4. **GraphReFly substrate already supports it.** `factoryTag` round-trip ships; `Actor / Guard ABAC` ships; messaging hub ships; `Graph.attachStorage` ships; DS-14 op-log changesets locked.
5. **Wave 2 positioning was colliding with Archon.** "First open-source harness builder for AI coding" is Archon's tagline at 20.7K⭐. Going head-on with the same phrase loses on day one.

### What's preserved from the old model

- **catalog still exists**, just as user-host concern, not library distribution headline
- **`llmCompose` still ships**, as a tool the user-host MCP wires for NL-only path (Claude Desktop, MCP-only clients)
- **SQL-style verb-set constraint still works** for that NL-only path
- **`@graphrefly/mcp-server` still ships**, reframed as toolkit + default-empty-catalog binary for inspection

---

## PART 2: L1–L8 DESIGN LOCKS (2026-05-04)

These were locked during the 2026-05-04 conversation triggered by Xiaohongshu research. Each lock sourced from the conversation thread directly.

| # | Lock |
|---|---|
| **L1** | GraphSpec authoring direction reversed. Code is source of truth; spec is auto-generated projection. `factoryTag` + `decompileSpec` round-trip already supports this. `llmCompose` retained as user-host MCP tool, not library headline. |
| **L2** | Catalog is user-host responsibility, not library headline. `@graphrefly/mcp-server` reframes from "distribution headline" to "toolkit + default-empty-catalog binary for inspection." Library ships `buildMcpServer({ catalog })` factory; users wire their own catalogs. Three-tier client capability fallback: (a) code-aware client → grep fn names from spec; (b) catalog-uploadable client → richer answers; (c) zero-context → guess from spec + descriptions only. |
| **L3** | Spec auto-checkpoint trigger: topology-change-only. Not per-wave (noisy), not at `messageTier ≥ 3` (different lifecycle from value snapshot). Extends `Graph.attachStorage` to persist `describe({ detail: "spec" })` snapshot alongside state checkpoint when topology changes (mount / unmount / `tagFactory` / `add` / `remove` / `setDeps`-when-shipped). |
| **L4** | Cross-language stays blueprint-only. Spec is JSON-portable for LLM context (PY agent reads TS-generated spec to understand topology), NOT executable across languages. No `graphrefly://` URI standardization. Cross-language executable spec defers to post-1.0 with `peerGraph(transport)` (Phase 8.5). |
| **L5** | Subgraph ownership staircase L0–L3. **L0 (static)** — spec annotation `meta.owner: string`; `validateOwnership(spec, prDiff)` lint helper enforces at PR time. **L1 (TTL)** — ownership claim carries `expiresAt`; expired claims auto-release. **L2 (heartbeat)** — claim renewed via heartbeat topic; missed N renewals → auto-release. **L3 (supervisor)** — central supervisor agent's decision **always wins regardless of timestamp** — option (b) "layered authorization", NOT version vector. |
| **L6** | Ownership protocol implementable as recipe + preset, NO new primitive. `ownershipController({ ttl, heartbeatNs?, supervisor? })` factory wires `messaging hub` + `topic.latest` + `derived` + existing `Actor / Guard ABAC`. Lives in COMPOSITION-GUIDE-PATTERNS as new section ("Multi-agent subgraph ownership protocol"). |
| **L7** | Wave 2 narrative reframe. Drop "harness builder" phrasing (collides with Archon's tagline at 20.7K⭐). New positioning: **"spec is code's blueprint; multi-agent worktrees co-edit it without colliding."** Differentiates from Archon (manual YAML workflow runner) and Hermes (auto-generated Python skill module). README + Wave 2 launch copy + Phase 16 §9.2 deliverables all rewriting. |
| **L8** | `validateSpec` becomes PR lint, not just runtime check. New `graphrefly check-spec` CLI subcommand: build graph in test/dev mode, call `describe({ detail: "spec" })`, deep-equal against committed spec. Drift fails CI. Lands with `@graphrefly/cli` (Phase 16 §9.3c). |

---

## PART 3: Q1–Q10 9Q WALK (2026-05-05)

The walk ran after DS-14 locked (2026-05-05). DS-14 substrate decisions resolved Q3 directly and simplified Q1/Q7/Q8 from design questions to implementation details. The remaining 6 (Q2/Q4/Q5/Q6/Q9 + new Q10) plus the 3 simplified all walked in this session.

### Q10 — `OwnershipChange.level: "L0"|"L1"|"L2"|"L3"` semantics

**Lock: (b) abstraction layer / priority.** Level decides who wins overrides; expiry/heartbeat is independent axis.

Reasoning:
- **Concerns separation.** Mechanism (how it expires) and priority (who wins) are different axes; mixing into one field reads like a hack.
- **DS-14's `override.previousActor + reason`** already gives full data for supervisor override; if level encodes priority, override is a clean "high-level invalidates low-level" data description.
- **Mechanism info goes elsewhere.** Future fields like `expiry: { kind: "ttl"; expiresAt } | { kind: "heartbeat"; lastBeatNs }` capture mechanism without bloating level.
- **(a) reading would force enum expansion.** Each new mechanism (e.g. lease-based) would expand level — but level's actual job is hierarchy, not mechanism enumeration.

L0–L3 names retained (DS-14 already shipped); rename to `static / agent / supervisor` deferred to polish if confusion surfaces.

### Q4 — Stale claim on agent crash with TTL > 0

**Lock: (a) honor TTL strictly.** L1 = pure TTL semantics. Crash recovery requires upgrading to L2.

Reasoning:
- **Staircase semantics clean.** L1 = TTL only; L2 = heartbeat; L3 = supervisor. Mixing crash detection into L1 erodes the staircase abstraction.
- **TTL is caller-explicit contract.** Caller chose TTL = N for a reason; framework releasing early violates contract.
- **Misjudgment cost > waiting cost.** Subgraph held N minutes by crashed agent: at most N-minute waste. Double-owner from false-positive crash detection: dirty writes, merge conflict, state corruption.
- **Mitigation in caller hand:** L1 TTL recommended ≤ 60s; need long holds → use L2 heartbeat. (Configured guidance written into COMPOSITION-GUIDE-PATTERNS.)

### Q2 — L2 heartbeat lifecycle

**Lock: (c) `heartbeat: NodeInput<unknown>` reactive trigger Node.** Caller passes any reactive trigger; library renews on each emission.

Reasoning (directly hits two memory feedbacks):
- `feedback_no_imperative` — user allergic to imperative triggers; (a) `claim.heartbeat()` method-call form rejected.
- `feedback_no_imperative_wrap_as_primitive` — (b) library-shipped timer producer would inevitably re-expose imperative escape hatch for "real activity" cases → anti-pattern.
- (c) is most idiomatic GraphReFly: simple case `heartbeat: fromTimer({ ms: 30_000 })`; activity-based `heartbeat: derived([toolCallsTopic.events], () => ...)`; testing with manual `state(0).set(1)` ticks.
- (b) also mixes substrate concerns by forcing library to pick a default timer source.

**Unified TTL semantics across L1/L2:** TTL = "max tolerance since last sign of life." L1 = nothing renews countdown; L2 = each heartbeat emission resets it. Same field, different drivers.

### Q7 — `meta.owner` runtime enforcement

**Lock: (b) hard-block via Actor/Guard ABAC.** Claim auto-mounts `policy({ allowed: [actor] })` Guard on the subgraph; release/override updates/swaps it.

Reasoning:
- **Aligns with our overall structural-correctness thesis.** Pure-doc enforcement is vibe-coding's residue; Q4 also collapses (it picks "consistency" over "liveness" precisely because runtime enforcement makes double-owner risk real).
- **Reuses existing ABAC primitive.** Ownership = dynamic actor assignment. Claim event triggers Guard policy update; Guard checks at write time as today; no new check infrastructure.
- **Performance is fine.** Only nodes with `meta.owner` annotation participate; no annotation = zero overhead. Guard check itself O(1) per write.
- **Side-effect: Guard becomes reactive-options widened.** `policy({ allowed: Node<readonly AgentId[]> })` — naturally aligns with DS-13.5.B widening pattern already shipped 2026-05-03.

### Q5 — `validateOwnership` PR lint scope

**Lock: (a) hard-fail + (i) `Override-Owner:` commit trailer for any committer.**

Rules:
- Edited node has no `meta.owner` → silent.
- Edited node has `meta.owner` AND PR author = owner → OK.
- Edited node has `meta.owner` AND PR author ≠ owner → **FAIL**.
- Override mechanism: `Override-Owner: <reason>` commit trailer (machine-readable; CI can grep).

Reasoning:
- **Mental model simplest.** Default zero lint (most nodes won't have owner); annotated subgraphs strictly enforced.
- **"Shared infra" naturally exempted** by not annotating; cleaner than maintaining a separate allow-list.
- **Override carries audit trail** (grep `Override-Owner:` to surface abuse).
- **Sub-flag (deferred to delta #5 implementation):** PR-diff-to-spec-node mapping mechanism — `meta.factory` resolution vs explicit `meta.ownerPath` glob — not locked today; settle when delta #5 opens.

### Q3 — Supervisor override delivery (resolved by DS-14)

**Resolution from DS-14: shared ownership topic with `kind: "override"` payload discriminant.** Carries `previousActor` + `reason`. NOT a separate priority topic, NOT a priority field. Subscribers narrow by `kind` value.

### Q1 — "Topology dirty" signal

**Lock: (b) explicit `_topologyVersion: number` counter** on Graph; bumped at every topology mutation (`add` / `remove` / `mount` / `unmount` / `tagFactory` / `setDeps`-when-shipped). O(1) per mutation.

Reasoning:
- O(1) per mutation vs O(graph_size) for diff-based detection.
- Aligns with DS-14 `BaseChange.version: number | string` substrate.
- Distinct from `_versioningLevel` / `_schemaVersion` (codec / migration concerns) — name disambiguates.

### Q8 — High-churn topology debounce

**Lock: (b) version-bump squelch at wave boundary.** Spec checkpoint write logic hooks into existing `registerBatchFlushHook` substrate; reads `_topologyVersion` once at wave end; skips if `=== lastPersistedVersion`. NO time-window debounce.

Reasoning:
- Wave boundary is the natural "this group of changes settled" signal — no new timer needed.
- Same-wave bump-and-collapse to identical version handled trivially.
- High-churn mount/unmount-in-loop spanning multiple waves writes once per wave (correct).
- Optional payload-equality fallback for the rare same-version-different-payload case; deferred until empirically observed.

### Q9 — User-host catalog convention location

**Lock: (c) soft convention.** Default `<repo>/catalog.ts` exporting `default GraphSpecCatalog`. Override via `package.json#graphrefly.catalogPath`.

Tooling fallback chain:
1. `package.json#graphrefly.catalogPath` field (if present)
2. `<repo>/catalog.ts` default
3. Not found → warning "no catalog detected; spec compilation will fail" + inspection-only tools (`describe` / `observe` / `explain`) continue working.

File format: TS module mandatory (closures can't JSON-encode). JSON-only catalog ruled out by reality.

### Q6 — README/narrative rewrite cadence

**Lock: (a) single PR with limited scope.**

In this PR:
- `README.md` — tagline change, "Why GraphReFly?" comparison column adjustments
- `CLAUDE.md` — canonical references table updated; harness-engineering-strategy marked SUPERSEDED
- `docs/roadmap.md` — Wave 2 / 3 framings rewritten
- `archive/docs/SESSION-harness-engineering-strategy.md` — SUPERSEDED banner added
- NEW `archive/docs/SESSION-DS-14.5-A-narrative-reframe.md` (this file)

Explicitly NOT in this PR:
- `~/src/graphrefly_github/profile/README.md` — separate repo, separate PR
- `packages/mcp-server/README.md` — rides delta #2 reframe PR
- Wave 1/2/3 blog drafts — post-substrate
- "GraphReFly vs Archon" comparison page — Phase 16 §9.2 deliverable

Reasoning: narrative is decoupled from substrate implementation; L1–L8 + Q1–Q10 locks are sufficient guidance to rewrite docs now. (b) staged risks inconsistent messaging window; (c) full defer prolongs the Archon collision.

---

## PART 4: IMPLEMENTATION DELTAS

| # | Work | Size | Phase | Dep |
|---|---|---|---|---|
| 1 | README + Wave 2 launch copy rewrite (this PR) | S | NOW | None |
| 2 | Phase 16 MCP server reframe (toolkit, not headline) | S | NOW (post-DS-14 lock) | None |
| 3 | `meta.owner` spec annotation in [GRAPHREFLY-SPEC.md](~/src/graphrefly/GRAPHREFLY-SPEC.md) | S | Phase 14.5 | None |
| 4 | COMPOSITION-GUIDE-PATTERNS §N "Multi-agent subgraph ownership" | M | Phase 14.5 | None |
| 5 | `validateOwnership(spec, prDiff)` lint helper | S | Phase 14.5 | (3) |
| 6 | `graphrefly check-spec` CLI subcommand | S | Phase 16 §9.3c | None |
| 7 | `Graph.attachStorage` spec-snapshot extension (topology-dirty triggered) + `_topologyVersion` counter | M | Phase 14.5 | Phase 14 changeset substrate stable |
| 8 | `ownershipController({ ttl, heartbeat?, supervisor? })` preset (L1+L2; L3 hook) | M | Phase 14.5 | (4), (7) |

---

## PART 5: PHASE 14 INTERACTION POINTS (RESOLVED BY DS-14)

DS-14's lock-down (2026-05-05) directly responded to all three interaction points DS-14.5.A flagged:

| Interaction point | DS-14 resolution |
|---|---|
| Op-log changeset `version` field | `BaseChange.version: number \| string` shipped; ownership claims ride same monotonic version mechanism |
| `lens.flow.mutations` high-frequency stream | `lens.flow.mutations` falls out for free — `lens.flow` is a `ReactiveMapBundle` consumer of the `mutations` companion (T1) |
| `restoreSnapshot mode: "diff"` lifecycle separation | **Lifecycle filter shipped** — `graph.restoreSnapshot({ mode: "diff", lifecycle: ["spec"\|"data"\|"ownership"] })`; cross-scope ordering invariant `spec → data → ownership` enforced at replay |

Additional DS-14 contributions to DS-14.5.A:
- `OwnershipChange` type pre-defined with `claim` / `release` / `override` kinds; `level: "L0"|"L1"|"L2"|"L3"` field on claim
- `mutate(act, opts)` factory (replaces `lightMutation` + `wrapMutation`) is the canonical mutation primitive ownership claims will use
- `mutations` companion bundle on every reactive primitive — ownership topic is just another `ReactiveLogBundle<OwnershipChange>` consumer

---

## PART 6: COMPETITIVE POSITIONING (POST-REFRAME)

| Project | Approach | Strength | Weakness |
|---|---|---|---|
| **Archon** (20.7K⭐) | Manually-authored YAML workflows; deterministic + AI nodes mixed; worktree-per-run | Determinism, audit trail, multi-platform reach | Workflows static — no learning loop; one agent per worktree |
| **Hermes** (~96K⭐) | Auto-extracts Python "skills" from successful runs; agentskills.io standard | Closed learning loop, real compounding | Acknowledged "black-box" auditability; one agent per skill |
| **GraphReFly** (post-reframe) | Reactive graph protocol; spec is code's projection; multi-agent ownership protocol on shared topology | `explainPath` causal chain (no competitor); reactive primitives; multi-agent worktree co-edit on shared graph | Pre-1.0; ecosystem smaller; new positioning needs proof points |

**Key differentiator (post-reframe):** GraphReFly is the only system where multiple coding agents can co-edit a shared topology with structural ownership boundaries, runtime conflict prevention via Actor/Guard, and complete causal traceability. Archon does worktree isolation (one agent per worktree); Hermes does skill compounding (one agent per skill). Neither does multi-agent coordination on shared state.

---

## PART 7: CROSS-REFS

- **Triggering conversation:** 2026-05-04 session (this file).
- **Implementation plan entry:** [`docs/implementation-plan.md` §14.5.11](../../docs/implementation-plan.md) — full delta sequencing + locks.
- **DS-14 substrate:** [`archive/docs/SESSION-DS-14-changesets-design.md`](SESSION-DS-14-changesets-design.md) — locked 2026-05-05; baked `OwnershipChange` + lifecycle filter directly.
- **Superseded narrative:** [`archive/docs/SESSION-harness-engineering-strategy.md`](SESSION-harness-engineering-strategy.md) — original "harness builder" framing; analysis sections preserved as historical context.
- **First-principles foundation:** [`archive/docs/SESSION-first-principles-audit.md`](SESSION-first-principles-audit.md) PART 7 — SQL constraint argument applies to NL-only path; this reframe extends to code-aware path.
- **Memory references:** `project_harness_engineering_strategy.md`, `project_dynamic_graph_visualization.md`, `project_universal_reduction_layer.md`.

---

## STATUS

- L1–L8 locked 2026-05-04
- Q1–Q10 walked + locked 2026-05-05
- Implementation deltas #1–#8 awaiting `/dev-dispatch` invocation per `feedback_no_implement_without_approval`
- This narrative-reframe PR (Q6=(a) scope) carries the documentation portion of delta #1
