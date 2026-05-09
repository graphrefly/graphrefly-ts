---
name: rust-review
description: "Post-implementation quality review for Rust port slices. Produces behavioral trace, simplification delta, deferred gap audit, and parity test assessment. Use after /porting-to-rs completes a slice, or standalone when you want to verify a Rust module's correctness without reading Rust. Lighter than /qa — focuses on spec-fidelity and over-engineering detection."
disable-model-invocation: true
argument-hint: "[module or slice name, e.g. 'batch coalescing' or 'M1 Slice C']"
---

You are executing the **rust-review** workflow — a quality verification pass for a Rust port slice that does NOT require the user to read Rust.

Target: $ARGUMENTS

---

## Phase 1: Load Context

Read in parallel:

- `~/src/graphrefly-rs/docs/migration-status.md` — what's claimed as landed
- `~/src/graphrefly-rs/docs/porting-deferred.md` — known gaps
- `~/src/graphrefly-rs/docs/flowcharts.md` — Rust-port-specific shape diagrams (slice timeline, lock discipline, wave engine, refcount discipline). Read the diagrams matching $ARGUMENTS' slice; they're the fastest way to recall what's already in the impl.
- `docs/implementation-plan-13.6-canonical-spec.md` — sections relevant to $ARGUMENTS
- `docs/implementation-plan-13.6-flowcharts.md` — matching batch diagrams (TS spec semantics; pair with the Rust flowcharts for shape vs semantics)
- `docs/rust-port-decisions.md` — decisions already made
- The Rust source files for the module (`~/src/graphrefly-rs/crates/<crate>/src/`)
- The Rust test files for the module (`~/src/graphrefly-rs/crates/<crate>/tests/`)

---

## Phase 2: Behavioral Trace

For each public-facing behavior in the slice, produce a **behavioral trace table**:

```
Module: [name] (milestone)
Scenario: [1-line description]
Spec rules: R<x.y.z>, R<a.b.c>

Step | Event              | Internal state change        | Observable output
1    | ...                | ...                          | ...
```

Produce 2–5 traces per slice, covering:
- The happy path
- The most complex edge case (diamond, pause interaction, terminal cross-cut)
- Any scenario the parity tests cover

The user verifies these traces against the spec. If traces are correct, the impl is correct.

---

## Phase 3: Simplification Delta

Produce a table:

| # | TS pattern | Rust replacement | Simpler? | Notes |
|---|---|---|---|---|
| 1 | ... | ... | Yes/No/Same | ... |

Flag rows where Rust is MORE complex than TS as potential over-engineering.

For each "No" row, explain WHY it's more complex and whether that complexity is justified (type safety, thread safety, etc.) or unnecessary.

---

## Phase 4: Deferred Gap Audit

1. List all `#[ignore]` tests in the module's test files
2. Cross-reference against the deferred items in `porting-deferred.md`
3. Flag any deferred item that LACKS a corresponding `#[ignore]` test stub
4. Flag any deferred item that the current code may accidentally depend on (i.e., correctness hole)

---

## Phase 5: Parity Test Assessment

Check `packages/parity-tests/scenarios/`:
- Which scenarios cover this module's behavior?
- Which spec invariants from the module have NO parity scenario yet?
- Suggest 2–5 new parity scenarios that should be written (cite spec rule)

---

## Phase 6: Report

Present an in-conversation summary in this shape (the persistent file is written in Phase 8.1 using the **directive markdown** described below — write that file in the journal format, not the bare-tables format).

### Behavioral Traces
[traces from Phase 2]

### Simplification Delta
[table from Phase 3]

### Deferred Gaps
- **Covered:** N items with `#[ignore]` stubs
- **Missing stubs:** [list]
- **Potential correctness holes:** [list or "none"]

### Parity Test Coverage
- **Existing:** N scenarios
- **Missing:** [suggested new scenarios with spec rule]

### Overall Assessment
- Spec-fidelity: [high/medium/low + why]
- Over-engineering risk: [high/medium/low + which rows]
- Recommended actions: [bullet list]

---

## Phase 6.5: Journal directive vocabulary

The review website (`docs/review/site/`) renders reports as a structured engineering journal. To get rich cards, inline-rendered figures, and severity-coded findings, write the report file in Phase 8.1 using these **directive blocks** alongside ordinary markdown.

A directive block is delimited by `:::`. Attributes use `key="value"` form. Content between the open/close fences may itself be markdown — tables, paragraphs, lists are all parsed inside.

**Five directive kinds.** Use them; don't invent more.

### `::: trace` — wraps each behavioral trace from Phase 2

```markdown
::: trace id="T1" title="Pause-overflow ERROR synthesis" rules="R1.3.8.c, Lock 6.A" diagrams="11.1, 11.2"
| Step | Event | Internal state change | Observable output |
|------|-------|----------------------|-------------------|
| 1 | … | … | — |
| 2 | … | … | sink: `[Error(diag)]` |

Pre-Slice-F this was a silent drop. Now structured ERROR with `{nodeId, droppedCount, …}`.
:::
```

- `id` — short label (T1, T2…) used in the card's left badge.
- `title` — one-line scenario description.
- `rules` — comma-separated spec rule citations; each becomes a green spec chip.
- `diagrams` — comma-separated figure IDs; each becomes a clickable F-chip in the card header.
- Body: the step table + any commentary.

### `::: finding` — for caveats, limitations, optimization opportunities, correctness bugs

```markdown
::: finding kind="bug" title="Diamond resolution overflow at fan-in >32" severity="major"
where="crates/graphrefly-core/src/dispatcher.rs:142" rule="R5.8" status="open" recommendation="Switch to BigInt-backed mask"

Current bitmask is a `u32` and silently overflows when fan-in exceeds 32. Reproducer: `tests/wide_fanin_diamond.rs:T_diamond_w33`. TS uses `Uint32Array` + chained `BigInt` to support arbitrarily wide fans.
:::
```

- `kind` — one of:
  - `bug`     — correctness divergence from canonical spec (red ribbon)
  - `limit`   — known v1 limitation, deferred (amber ribbon)
  - `warn`    — same visual as `limit`; use when the issue isn't a deferral but a caveat the user should know
  - `opp`     — simplification or optimization opportunity (green ribbon)
  - `note`    — informational observation (steel-blue ribbon)
- `title`        — short headline.
- `severity`     — optional badge: `critical`, `major`, `minor`. Renders as a small uppercase tag.
- `where`        — file/line reference; renders as `<code>` inside a structured field block.
- `rule`         — single spec rule citation; renders as spec chip.
- `slice`, `status`, `recommendation` — additional optional structured fields.
- Body: prose explanation. Markdown allowed.

**Pick the kind carefully.** A finding with `kind="bug"` is a claim that the Rust impl is wrong against the canonical spec; reserve it for that. `kind="limit"` is for items already in `porting-deferred.md`. `kind="opp"` is for "Rust-simpler-than-TS" rows in the simplification delta worth surfacing as a card, OR for performance/cleanup opportunities the review uncovered.

### `::: figure` — embeds a flowchart inline at the point you want it to appear

```markdown
::: figure id="11.1" caption="Pause overflow ERROR synthesis path — lock-held edge"
:::
```

- `id` — must match a `### x.y` heading in `flowcharts.md`.
- `caption` — optional; falls back to no caption.
- Body — optional; if present, used as caption (overrides attribute).

The renderer embeds the actual Mermaid diagram in a captioned `<figure>` block with a "↗ enlarge" button. Subsequent `[F11.1](#fc-11.1)` chips in the same report scroll to this inline figure (with a brief flash highlight). If no `::: figure` is declared for a chip, the chip opens the diagram in a draggable modal — old behavior preserved.

**Place an `::: figure` directly after the trace card (or finding) that first cites it.** That way the diagram appears in the natural reading flow, not in a separate index.

### `::: stats` — visual metric tiles (use at the top of the report or section breaks)

```markdown
::: stats
- Tests: 411 → 438
- Slices closed — 5 (F, F /qa, G, E1, H)
- 🟢 Divergences resolved: 10+
- 🟡 Open deferred items: 5
- 🔴 Correctness holes: 0
:::
```

- One bullet per tile. `Label : Value` (`:`, `—`, `–`, or `-` separator). Optional leading `🔴`/`🟡`/`🟢`/`🔵` colors the tile's left ribbon.

### `::: assessment` — the verdict card (use at the very bottom of the report)

```markdown
::: assessment title="Overall assessment"
**Spec-fidelity:** very high. Closed >10 documented divergences.
**Over-engineering risk:** low. 2 Rust-adds-complexity rows; both forced by multi-thread.
**Correctness holes:** none.
**HALT:** no.
:::
```

Each `**Label:**` line becomes a row in the verdict card. Recognized levels (`very high`, `high`, `medium`, `low`, `none`, `yes`, `no`) get a colored chip.

### Style guidance

- Don't replace ordinary section headings with directives. The report still has `## 1. Why this slice exists`, `## 2. Behavioral traces`, etc. Directives go *inside* those sections to render specific items as cards.
- Tables that don't fit a directive (e.g. the simplification delta) stay as plain markdown tables — the journal stylesheet already renders them well.
- One `::: figure` per diagram per report. Subsequent references should be `[F<x.y>](#fc-<x.y>)` chips.
- Don't put H2/H3 headings *inside* a directive — keep card content flat (paragraphs, tables, bullets, code).

---

## Phase 7: Maintain `flowcharts.md`

`~/src/graphrefly-rs/docs/flowcharts.md` is the standing visual aid for the repo and **the canonical source** for the review-site flowcharts. After reporting, sync it with the slice you just reviewed.

For **each new public method, state machine, or distinctive pattern** you traced in Phase 2 that isn't already diagrammed:

1. Add a Mermaid diagram (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, or `classDiagram`) under the appropriate batch section. Diagrams should depict *Rust port shape* (lock discipline, RAII, refcount discipline, ownership) — NOT protocol semantics, which belong in the TS spec flowcharts.
2. Cite the canonical spec rule (`R<x.y.z>`) the diagram visualizes — don't restate the spec.
3. Use the file's existing conventions: 🟨 YELLOW for v1 limitations / deferred items (link to `porting-deferred.md` entry by name), 🟦 BLUE for Rust-specific simplifications vs TS, solid arrows for control flow, dashed for data flow, dotted for optional paths.
4. Update the **slice → diagram map**, **spec rule → diagram map**, and **deferred items by diagram** tables at the end of the file.

For **deferred items that resolved in this slice**: remove the 🟨 callout from the relevant diagram, add a "resolved in Slice X" note, and remove the row from the deferred-items table.

For **diagrams that became stale** (impl changed shape, e.g. a lock-held callback lifted to lock-released): update the diagram in place and note the slice that changed it.

Keep diagrams concise — one diagram per concept. If a diagram grows past ~30 nodes, split it.

**Mermaid syntax pitfalls** (verified to fail in mermaid v10):
- `;` in sequenceDiagram message text (use `,` or `—` instead).
- `:` inside stateDiagram-v2 state descriptions when followed by `{...}` (use `note right of <state>` blocks instead).
- Generics with `<T>` inside class/state diagrams — use `~T~` (single token, no spaces, no commas inside).
- Stray `activate`/`deactivate` pairs across `alt`/`else` branches (mermaid counts them globally; either omit them or close every branch).
- Bracket labels `["…"]` containing parens or `::` — replace with `[…]` plain text or use entities.
- After authoring, run a sweep render check (Phase 8 step 3 below).

---

## Phase 8: Append a new review report + keep the review website fresh

The review site at `~/src/graphrefly-rs/docs/review/` is the persistent record across all `/rust-review` invocations. **Every run extends the record** — never rewrite earlier reports.

Layout (all relative to `~/src/graphrefly-rs/`):

```
docs/
├── flowcharts.md                  ← canonical (Phase 7 edits land here)
└── review/
    ├── README.md
    ├── reports-NNN-<slug>.md      ← Phase 8.1 adds new ones
    └── site/                      ← static HTML/CSS/JS (no build step)
        └── js/app.js              ← REPORTS array updated in Phase 8.4
```

### 8.1 Append a new report file

Add a new file `~/src/graphrefly-rs/docs/review/reports-NNN-<slug>.md` where `NNN` is the next zero-padded integer (e.g. if `reports-005-…md` exists, your new file is `reports-006-…md`). The slug is a short kebab-cased descriptor of $ARGUMENTS (e.g. `m4-storage-wal`, `slice-i-mount-cross-core`).

Required sections, mirroring the existing reports' shape — but render the *content within each section* using the journal directives from Phase 6.5:

1. **Header** — H1 + immediately-following `**Label:** value · **Label:** value` paragraphs (slices covered, landed dates, test count progression, any /qa rounds). The renderer auto-extracts those into a metadata strip — no directive needed. Optionally follow with a `::: stats` block to surface the headline numbers as tiles.
2. **Why this slice exists** — short premise paragraph (plain prose, no directive).
3. **Behavioral traces** — one `::: trace` block per scenario (Phase 2 output). Place a `::: figure id="x.y"` directly after the first trace that cites a given diagram so the figure renders inline.
4. **Simplification delta** — plain markdown table (Phase 3). For the most striking rows (Rust-simpler-than-TS wins, or Rust-harder-than-TS rows that need explanation), follow the table with a `::: finding kind="opp"` or `kind="note"` card.
5. **Deferred gaps audit** — short prose summary, then one `::: finding kind="limit"` per open item that warrants visual emphasis. Closed items can stay in a plain bullet list with ✅.
6. **Parity test coverage** — plain prose + numbered list of suggested scenarios.
7. **Recommended actions** — numbered list. For each non-trivial item, optionally a `::: finding kind="opp"` card with a `recommendation=` field.
8. **Overall assessment** — a single `::: assessment` block at the bottom. Lines like `**Spec-fidelity:** very high.` become rows.

**Reference flowcharts using markdown links of the form `[F<batch>.<n>](#fc-<batch>-<n>)`** (e.g. `[F7.2](#fc-7.2)`). The site renderer rewrites those into clickable chips. Inside trace cards, prefer the `diagrams="x.y, …"` attribute over inline chips — the renderer puts those in the card header. Do NOT use bare `[F7.2]` — markdown won't render it as a link.

### 8.2 Update the overview index

Edit `~/src/graphrefly-rs/docs/review/reports-000-overview.md`:
- Append a row to the **"Current state at a glance"** table for the slice you reviewed (status, test count, one-line note).
- Append a row to the **"Reports in this set"** table pointing at the new file.
- Update the review date in the header.

### 8.3 No flowcharts.md sync needed — site fetches canonical directly

The website at `docs/review/site/` fetches `../../flowcharts.md` (i.e. `~/src/graphrefly-rs/docs/flowcharts.md`) — there is no longer a sync'd copy. Phase 7 edits are picked up on browser refresh.

After Phase 7 edits, verify every diagram still renders. Either:
- (preferred) Run the review site via `preview_start` with the `rust-review` launch profile (port 8765, serves `~/src/graphrefly-rs/docs/`), then in the browser run a sweep — fetch `../../flowcharts.md`, parse each `### x.y` heading + next ` ```mermaid ` block, call `mermaid.render()` on each. Report any failures by `(id, batch, error)`.
- (fallback) Open each newly-added diagram individually in the running site by clicking its sidebar entry; confirm no error overlay appears.

If sweep finds failures, fix the diagram source in `~/src/graphrefly-rs/docs/flowcharts.md` directly and re-sweep until clean. Common fixes are listed under "Mermaid syntax pitfalls" in Phase 7.

### 8.4 No file-rename / no link-breakage rule

- Existing report filenames are immutable. Adding `reports-006-…md` is fine; renaming `reports-005-…md` to `reports-005-…-old.md` is not.
- The `REPORTS` array in `~/src/graphrefly-rs/docs/review/site/js/app.js` MUST be updated to include each new report file in chronological order (oldest first). The order in that array is the order in the sidebar.
- If a slice gets retroactively reorganized (rare), prefer adding a new short corrigendum report rather than mutating an old one. Past reports are dated artifacts.

### 8.5 Smoke-check the site before declaring done

After Phase 8.1–8.4:

1. `preview_start` with the `rust-review` profile (defined in `~/src/graphrefly-rs/.claude/launch.json`; serves on port 8765, document root is `docs/`).
2. Navigate to `http://localhost:8765/review/site/#<new-report-id>`; confirm the chips render and at least one chip opens its modal cleanly.
3. Confirm the new diagrams appear in the sidebar's "Flowcharts (canonical)" tree under their batch.
4. Page-scroll while a modal is open to confirm the body scrolls underneath (regression check).

If any of those fail, fix before reporting done. Each `/rust-review` run leaves the site in a working state.

---

## When to escalate

If during the review you find:
- A behavioral trace that CONTRADICTS the canonical spec → HALT, present the contradiction
- A simplification delta row suggesting the Rust impl added unnecessary machinery → suggest removal
- A deferred item that the current code depends on for correctness → flag as critical gap
- A flowchart diagram that contradicts the actual code (drift) → fix the diagram in Phase 7 and call out the drift in the report
- A mermaid sweep failure that you cannot fix in two attempts → leave the diagram in but note the failure in the report's "Recommended actions" so it gets followup attention
