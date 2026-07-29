---
name: research
description: "Research a topic triggered by curiosity or a post the user saw. Uses web search to analyze latest trends, competitor landscape, user patterns, future demands, and how findings relate to GraphReFly's roadmap and gaps. Triggers: 'research', 'look into', 'what's the landscape for', 'I saw this post about', 'trend check', 'competitor analysis'."
---

You are executing the **research** workflow for **GraphReFly**.

The user has a topic they want to explore — triggered by curiosity, a post they saw, or a trend they want to understand. Your job is to research it thoroughly using web search, then ground the findings against GraphReFly's current position. The goal is to **facilitate a discussion** about library direction — surface facts, tensions, and open questions that the user can react to, not just deliver a static report.

**Today's date: use the current date from system context for all searches.**

User input: $ARGUMENTS

---

## Phase 0: Topic extraction

Parse `$ARGUMENTS` to determine:

1. **Topic** — the core subject to research (e.g. "reactive state management trends", "AI agent frameworks", "graph-based orchestration")
2. **Trigger** — what prompted this (a post URL, a screenshot, a thought). If a URL is provided, fetch it first with `mcp__searxng__web_url_read` or `WebFetch` to extract context.
3. **Angle** — what specifically interests the user (if stated). If not stated, default to: "how does this relate to GraphReFly's positioning?"

State the extracted topic, trigger, and angle before proceeding.

---

## Phase 1: Landscape research

Use `mcp__searxng__searxng_web_search` (preferred) or `WebSearch` to gather intel. Run **at least 4-6 searches** covering different angles. Suggested search patterns (adapt to topic):

1. **Trend pulse** — `"{topic}" trends 2025 2026` or `"{topic}" state of` 
2. **User pain points** — `"{topic}" problems OR frustrations OR "wish it could"` or reddit/HN discussions
3. **Competitor landscape** — `"{topic}" libraries OR frameworks comparison` or `"{topic}" vs` 
4. **Future direction** — `"{topic}" roadmap OR "what's next" OR future`
5. **Developer adoption** — `"{topic}" adoption OR migration OR "switched to"`
6. **Academic/deep** — `"{topic}" research OR paper OR architecture` (if relevant)

For each search, read 2-3 promising results using `mcp__searxng__web_url_read` or `WebFetch` to get substance beyond snippets.

---

## Phase 2: Read GraphReFly context

Read `~/src/graphrefly/CLAUDE.md` first as the authority index, then load only relevant rows from:

- `~/src/graphrefly/plan/phases.jsonl` and `plan/backlog.jsonl` for current sequence and deferred triggers;
- `~/src/graphrefly/decisions/decisions.jsonl` and the indexed active session for locked rationale;
- `~/src/graphrefly/spec/rules.jsonl`, `spec/conformance.jsonl`, and `guide/guide.jsonl` when the topic
  touches protocol, behavioral parity, composition, or public guidance;
- package-local `docs/docs.jsonl` for TypeScript documentation ownership and public package positioning.

For claims about current implementation, call `codegraph_explore` in the relevant indexed GraphReFly repo
before raw source Read/`rg`. Ask for exact symbols, end-to-end call paths, callers/dependents, tests,
public/export boundaries, and blast radius. Treat returned source as already read and query again only for
uncovered paths. Read authority jsonl, archived narrative, configs, git diff, untracked files, and
stale/unindexed files directly. If the index is absent or disabled, use direct inspection and never initialize
it autonomously. External web sources establish the landscape; Codegraph establishes what the repositories
actually implement.

---

## Phase 3: Structured analysis

Produce a report with these sections. Be **honest and specific** — don't flatter GraphReFly where it doesn't deserve it.

### 3.1 Trend summary

> What's happening in this space right now? What are the dominant patterns, tools, and conversations? Cite sources.

3-5 bullet points, each with a source link.

### 3.2 User patterns & demands

> What do developers/users actually want? What pain points keep surfacing? What's the "pull" signal?

Distinguish between:
- **Validated demand** (multiple sources, real adoption) 
- **Emerging signal** (early signs, small communities)
- **Hype** (lots of talk, unclear substance)

### 3.3 Competitor matrix

Build a comparison table:

| Competitor | Approach | Strengths | Weaknesses | Adoption signal |
|---|---|---|---|---|
| {name} | {1-line approach} | {2-3 points} | {2-3 points} | {GitHub stars, npm downloads, community size, or "unknown"} |

Include 3-6 competitors. For each, note the most interesting design decision they made.

### 3.4 GraphReFly positioning

Answer each honestly:

- **Where GraphReFly has genuine advantages** — be specific about which feature/design decision creates the edge. Reference rule/decision IDs and current code paths.
- **Where GraphReFly has gaps** — things competitors do that we don't, or user demands we can't meet yet. Reference phase/backlog IDs if they're planned.
- **Where it's unclear** — areas where we'd need to build something to know if our approach works better.

### 3.5 Lessons & insights

> What can we learn from this research? What surprised you?

3-5 numbered insights. For each:
- The insight itself
- Why it matters for GraphReFly specifically
- Whether it validates, challenges, or is orthogonal to our current direction

### 3.6 Plan alignment

Cross-reference findings with canonical `plan/phases.jsonl` and `plan/backlog.jsonl`:

| Finding | Plan alignment | Action |
|---|---|---|
| {trend/demand/gap} | {matches CSP phase / matches backlog trigger / no match / conflicts with locked D#} | {already planned / propose a phase or backlog record / revisit} |

---

## Phase 4: Recommendations & discussion prompts

End with two subsections:

### 4.1 Recommendations

A prioritized list of **at most 5** concrete recommendations:

1. **{Action}** — {why, grounded in research}. Priority: {high/medium/low}. Effort: {small/medium/large}.

Recommendations should be actionable — not "think about X" but "propose X for phase Y" / "draft a backlog
record with trigger Z" / "prototype X to validate assumption Z" / "write a comparison doc showing advantage
over Y". Ask before changing canonical records.

### 4.2 Discussion prompts

Surface **2-3 open questions** that the research raised but can't answer alone — things that depend on the user's judgment, taste, or strategic priorities. Frame these as genuine questions to spark discussion, not rhetorical ones. Examples:

- "Competitor X chose to do Y — do we think that's the right trade-off for our users, or does our reactive-first approach make Y unnecessary?"
- "There's emerging demand for Z, but it would pull us toward {direction}. Is that a direction we want to go?"
- "Our prior decision in SESSION-{name} assumed {thing} — this research suggests that assumption may be shifting. Worth revisiting?"

The goal is to leave the user with something to react to, not just a wall of information.

---

## Output discipline

- **Cite sources.** Every claim about the external world should have a URL or at minimum a named source.
- **Be honest.** "GraphReFly doesn't address this yet" is more useful than spin.
- **Date-stamp.** Note that this research reflects the landscape as of the current date.
- **Keep it scannable.** Use tables, bullets, and headers. Avoid walls of prose.
- **Don't implement.** This skill produces a research report. It does NOT modify code. It MAY suggest phase
  or backlog changes, but must ask before editing canonical records.
- **Invite discussion.** End on the open questions, not the recommendations. The user should feel pulled to respond, not just informed.
