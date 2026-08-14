---
name: dashboard
description: "Build / check the GraphReFly internal docs dashboard (jsonl single-source → generated HTML with progress, structure map, gaps, search). Use when the user wants to see global project state, regenerate the dashboard, run the docs consistency gate (broken links / orphans / coverage gaps), or after editing any jsonl in ~/src/graphrefly (decisions/plan/spec/sessions/guide). Triggers: 'build the dashboard', 'check docs consistency', 'what are the gaps', 'show progress', 'regenerate dashboard', 'doc gate'."
---

You are executing **dashboard** for the clean-slate GraphReFly redesign.

**Repo:** `~/src/graphrefly` (clean-slate branch). Canonical JSONL is federated by owner/class under D783; the dashboard resolves root ledgers and renders generated current/ownership views. Schema contract: `~/src/graphrefly/dashboard/README.md`.

## Code-intelligence routing

Running or interpreting the dashboard needs no source survey. When debugging or changing indexed generator
implementation, call `codegraph_explore` before raw source Read/`rg` for the named generator symbol, its
callers/dependents, tests, generated-output boundary, and blast radius. Treat returned source as already read.
Read jsonl authority, README/schema text, generated HTML, configs, git diff, untracked files, and stale or
unindexed files directly. If no live index exists, use direct inspection and never initialize one
autonomously. The generator and consistency gate remain the correctness evidence.

## What this skill does

1. **Run the generator:**
   - `node ~/src/graphrefly/dashboard/build.mjs` → writes `dashboard/dashboard.html` + prints counts / gaps / broken-links / orphans report.
   - `node ~/src/graphrefly/dashboard/build.mjs --check` → consistency gate only; **non-zero exit on broken links** (use as a pre-commit / CI gate).
2. **Interpret the report** for the user:
   - **counts** — aggregate root-ledger decision counts plus phases/rules/conformance/...
   - **authority** — ledger ownership, relocated-record integrity, current protocol, unresolved classification, supersession cycles and duplicate-current metrics.
   - **gaps** — designPhases (status=design|gap) · openDecisions · deferredBacklog · uncoveredRules (no conformance) · todoConformance (runtimes=todo). This answers "哪里还有缺口".
   - **broken links** — must be zero (session.locks → decision; phase.sessions → session; conformance.covers → rule; flowchart.explains → rule|D#). Legacy 3-digit D### / R# refs are external (old main), reported separately as OK.
   - **orphans** — decisions referenced by no session (informational).
3. **If broken links exist:** locate the offending jsonl row, fix the id reference (or add the missing record), re-run `--check`.

## When the jsonl changed

After any root JSONL edit run `--check`. After any owner-ledger edit also run
`npm --prefix ~/src/graphrefly run authority:check:workspace` to verify qualified identities,
relocation integrity and available sibling ledgers.

## UI styling

`build.mjs` emits a **placeholder shell** with the data model embedded. Visual design / interactive search is a separate `/frontend-design` pass — do NOT hand-style the HTML here; keep `build.mjs` focused on the data model + consistency checks. The dogfood endgame (phase CSP-8) rebuilds this dashboard *with GraphReFly itself* (jsonl producer → reactive views → HTML effect).

## Output

The counts + gaps + link-health report, a plain-language "where are the gaps / what's the progress" summary, and (unless `--check`) confirmation that `dashboard.html` was written. Flag any broken link as a blocker to fix before commit.
