---
SESSION: harness-engineering-strategy
DATE: April 6, 2026
TOPIC: Harness engineering gap analysis, three-wave announcement plan, eval system design, ecosystem infiltration strategy
REPO: graphrefly-ts (primary), graphrefly-py (parity scope)
---

## CONTEXT

Research into "harness engineering" — the defining 2026 trend (named by Mitchell Hashimoto ~Feb 2026, adopted by OpenAI, Anthropic, Martin Fowler) — revealed that GraphReFly already covers the execution substrate better than any competitor but has zero mindshare in the conversation. This session synthesizes the Cursor harness engineering research (`~/Downloads/cursor_harness_engineering_for_llms.md`), web research (SearXNG: 30+ articles from March-April 2026), project docs, and the eval infrastructure to produce a concrete strategy.

**Source material:**
- Cursor harness engineering chat export (April 6, 2026)
- `archive/docs/SESSION-first-principles-audit.md` — first-principles reasoning
- `archive/docs/SESSION-universal-reduction-layer.md` — universal reduction thesis
- `archive/docs/SESSION-agentic-memory-research.md` — SOTA memory research
- `archive/docs/SESSION-marketing-promotion-strategy.md` — existing marketing plan
- `evals/README.md` — eval infrastructure status
- External web research via SearXNG (April 6, 2026)

---

## PART 1: HARNESS ENGINEERING LANDSCAPE (April 2026)

### Definition convergence

From OpenAI, Anthropic, Fowler, and 30+ articles: harness engineering is the discipline of building the **deterministic, inspectable, improvable system** around a probabilistic LLM. Core loop: guides (feedforward) + sensors (feedback) + iterative improvement.

### Eight requirements for a harness

1. **Context/state control** — memory, compaction, persistence across sessions
2. **Execution boundary** — tool calling, runtime environment, sandboxing/permissions
3. **Control flow/orchestration** — planning, decomposition, retries, checkpoints
4. **Verification** — deterministic checks (tests/lints/contracts) + semantic checks (LLM-as-judge)
5. **Observability** — full traces/transcripts, causal diagnostics, performance/cost telemetry
6. **Policy/safety** — access control, constraint enforcement, compliance logging
7. **Human governance** — approval points, review UX, intervention/recovery
8. **Continuous harness improvement** — failure clustering → harness updates → re-eval

### Key external references

- OpenAI: "Harness engineering: leveraging Codex in an agent-first world" (openai.com)
- Martin Fowler: "Harness engineering for coding agent users" (martinfowler.com)
- arXiv: "Natural-Language Agent Harnesses" (2603.25723v1)
- arXiv: "Meta-Harness: End-to-End Optimization" (2603.28052v1)
- arXiv: "LLM Readiness Harness" (2603.27355)
- harness-engineering.ai — knowledge graph with 883 entities
- Aaron Levie (Box CEO): "The harness is the car. Nobody buys an engine."
- Meta acquired Manus for $2B — "not for the model, but for the harness"

---

## PART 2: GRAPHREFLY COVERAGE ANALYSIS

### Already covered (strongly)

| Requirement | GraphReFly feature | Phase |
|---|---|---|
| Context/state control | `autoCheckpoint`, `snapshot/restore`, `distill()`, `agentMemory()` | 1.4b, 3.2b, 4.4 |
| Execution boundary | Actor/Guard ABAC, `policy()`, `budgetGate` | 1.5, 8.1 |
| Control flow | `retry`, `backoff`, `withBreaker`, `checkpoint` adapters, `pipeline()` | 3.1, 4.1 |
| Observability | `describe()`, `observe()`, `annotate()`, `traceLog()`, `toMermaid()` | 1.3, 3.3 |
| Policy/safety | ABAC, `policyFromRules()`, scoped describe | 1.5, 1.4b |
| LLM composition | GraphSpec, `llmCompose()`, `llmRefine()`, `specDiff()` | 8.3 |
| Reduction layer | `stratify`, `funnel`, `feedback`, `scorer`, `budgetGate` | 8.1 |
| Domain templates | `observabilityGraph`, `issueTrackerGraph`, `contentModerationGraph`, `dataQualityGraph` | 8.2 |
| 20+ connectors | fromOTel, fromKafka, toPostgres, fromWebhook, toSSE, fromMCP, etc. | 5.2c, 5.2d |

### Gaps identified

| Gap | Impact | Priority |
|---|---|---|
| `explainPath` (causal walkback) | THE differentiator — no competitor has this | P0 |
| `auditTrail` (mutation log) | Pairs with explainPath for compliance | P0 |
| `policyEnforcer` (reactive constraints) | Harness safety layer | P1 |
| `complianceSnapshot` (regulatory export) | Enterprise credibility | P1 |
| Public eval harness with CI | Engineering discipline proof | P0 |
| MCP Server package | Distribution — reaches all MCP clients | P0 |
| Harness scorecard page | Public trust signal | P1 |
| Demo 0 | Existential proof | P1 (gates Wave 3) |
| Framework infiltration packages | Ecosystem presence | P2 |

---

## PART 3: ANTI-STEALTH DECISION

**Considered:** Going stealth until "substantial moat" of integrations built.

**Rejected.** Reasons:
1. **Code isn't copiable in meaningful timeframe** — Phases 0-8 with hundreds of checked items, 20+ adapters, domain templates, GraphSpec compiler, ABAC, CQRS, agent memory... 6+ months of work. Can't replicate in under a year.
2. **The real moat isn't code — it's category ownership.** The harness engineering conversation is happening NOW (30+ articles in 8 weeks). Every week of silence = narrative hardens without GraphReFly in it.
3. **Integrations are already substantial.** 20+ connectors built. The Cursor research recommended 5.
4. **Stealth costs the only thing we're short on: mindshare.** Visibility is the gap, not code.

---

## PART 4: THREE-WAVE ANNOUNCEMENT PLAN

### Wave 1: "The Eval Story" (Weeks 1-3) — LOW RISK

**Announce:** "We built an eval system that found real schema bugs — and we fixed them."

**Deliverables:**
- Wire `pnpm eval` to CI (GitHub Actions)
- Multi-provider LLM client (Anthropic + OpenAI + Google)
- Multi-model matrix runner
- 5+ automated runs, trend data
- Blog: "How our eval harness found two schema bugs LLMs couldn't work around"

**Channels:** Dev.to, HN replies (not Show HN), r/AI_Agents, X thread, 小红书

### Wave 2: "The Harness Layer" (Weeks 4-9) — CLAIMS CATEGORY

**Announce:** "GraphReFly: the reactive harness layer for agent workflows."

**Deliverables:**
- §9.2: `explainPath`, `auditTrail`, `policyEnforcer`, `complianceSnapshot`
- §9.3: `@graphrefly/mcp-server` on npm + MCP registries
- §9.4: Harness scorecard page (weekly-updated KPIs)
- "GraphReFly vs LangGraph" comparison page
- README/website rewrite with harness vocabulary

**Channels:** HN replies, r/AI_Agents, r/ClaudeCode, X thread, 小红书, harness-engineering.ai

### Wave 3: "The Existential Demo" (Weeks 10-15) — FULL LAUNCH

**Announce:** "Describe an automation in English. Review it visually. Run it. Ask why."

**Deliverables:**
- Demo 0 (NL → GraphSpec → flow view → run → persist → explain)
- `@graphrefly/ai-sdk` middleware (Vercel AI SDK)
- `@graphrefly/langgraph` tools
- 3 golden template repos
- Demo 6: AI Agent Observatory

**Channels:** Show HN, Reddit original posts, 小红书, Product Hunt (v1.0), conference CFPs

---

## PART 5: EVAL SYSTEM DESIGN

### Two-tier architecture

**Tier 1 — Portable/manual (free, instant, internal-first):**
- Copy-paste prompts from `portable-eval-prompts.md` into any LLM chat
- Neutral rubric (no GraphReFly context — unbiased)
- Recording template for manual scoring
- Zero API cost — user's preferred model

**Tier 2 — Automated/API (cheap dev, expensive publish):**
- `LLMProvider` interface: `{ generate(prompt, opts): Promise<LLMResponse> }`
- Provider implementations: Anthropic, OpenAI, Google (via `llm-client.ts`)
- Budget tier: Haiku/GPT-4o-mini/Gemini-Flash for prototyping; Sonnet/GPT-4o/Gemini-Pro for publishable runs
- Multi-model matrix runner: `pnpm eval:matrix`
- CI: GitHub Actions `eval.yml` (weekly + manual dispatch)
- Regression gate: fail if validity drops >5% from baseline
- Cost tracking: token counts → estimated $ per run

### Eval tiers

| Tier | What it tests | Treatment |
|---|---|---|
| L0 — Generation | Can LLM compose correct graph from NL? | GraphSpec vs Functions (contrastive) |
| L1 — Comprehension | Can LLM debug/modify/explain existing graph? | GraphSpec only (introspection advantages) |
| Dev-DX | Developer experience (vitest, no LLM) | N/A |

### Harness KPIs (scorecard metrics)

| KPI | Source | When available |
|---|---|---|
| First-pass GraphSpec validity | L0 eval | Wave 1 |
| Hallucination rate by model | L0 eval | Wave 1 |
| Schema gaps: open/resolved | Manual tracking | Wave 1 |
| Debug accuracy | L1 eval | Wave 1 |
| Causal trace completeness | `explainPath` coverage | Wave 2 |
| Checkpoint restore integrity | Existing vitest suite | Wave 1 |
| Policy violation escape rate | `policyEnforcer` tests | Wave 2 |

### The publishable story

"Our evals found that LLMs hallucinate when GraphSpec lacks feedback edges (T6) and subgraph templates (T8). We added both to the schema. Re-eval improved. Here are the numbers across 3 models."

This eval→fix→re-eval loop is genuinely unique. Nobody else is publicly showing this.

---

## PART 6: ECOSYSTEM INFILTRATION STRATEGY

### Priority order

| Priority | Channel | Mechanism | Reach | Effort |
|---|---|---|---|---|
| **1** | MCP Server | npm package + MCP registries (official, Cline, PulseMCP) | All MCP clients (Claude, Cursor, VS Code Copilot, ChatGPT, Cline, LangGraph, CrewAI, AI SDK) | LOW |
| **2** | Vercel AI SDK | `graphreflyMiddleware` wrapping any model with reactive state | Vercel/Next.js ecosystem | LOW-MED |
| **3** | LangGraph TS | Zod-validated tools (also consumed via MCP natively) | LangChain ecosystem | LOW |
| **4** | harness-engineering.ai | Submit to knowledge graph (883 entities) | Harness engineering community | TRIVIAL |
| **5** | A2A Agent Card | Google Agent-to-Agent protocol | Enterprise multi-agent | MED (defer) |

### MCP Server design (highest leverage)

Tools to expose:
- `graphrefly_create` — create graph from GraphSpec or NL
- `graphrefly_observe` — observe node/graph state (progressive detail levels)
- `graphrefly_reduce` — run reduction pipeline on input
- `graphrefly_explain` — causal chain for a decision
- `graphrefly_snapshot` — checkpoint/restore
- `graphrefly_describe` — topology introspection

### Distribution targets for MCP Server

- npm as `@graphrefly/mcp-server`
- Official MCP registry: `registry.modelcontextprotocol.io`
- Cline Marketplace: PR to `github.com/cline/mcp-marketplace` (reaches "millions")
- PulseMCP: 11,140+ servers indexed, ~71.5k weekly visitors
- Glama.ai, mcp.so, mcpmarket.com — community directories

---

## PART 7: COMPETITIVE POSITIONING

### "Nobody buys an engine"

Current positioning: GraphReFly is a reactive graph **engine**.
Required positioning: GraphReFly is the reactive **harness layer** for agent workflows.

**One sentence:** "GraphReFly makes agent workflows reactive, resumable, and causally explainable — the harness layer between your LLM and production."

### vs LangGraph

| Dimension | LangGraph | GraphReFly |
|---|---|---|
| Propagation | Pull-based state machine | Push-based reactive (two-phase, glitch-free) |
| Causal trace | State checkpoints (what happened) | `explainPath` (why it happened) |
| Composition | Graph nodes are steps | Graph nodes are any computation |
| Cycles | Manual loop control | `feedback()` with bounds |
| Security | Framework-level guards | Node-level ABAC (`Actor/Guard`) |
| LLM composition | Via LangGraph Studio | `GraphSpec` — LLM-editable, diffable, versionable |
| Schema gaps | Fixed by LangChain team | Found by eval, fixed in spec, verified by re-eval |

### Honest gap

GraphReFly has stronger architecture. LangGraph has users, integrations, mindshare, and "hello world in 5 minutes." The eval story + MCP server + scorecard close this gap by proving quality and reducing adoption friction.

---

## PART 8: ROADMAP IMPACT

### New sections added to `docs/roadmap.md` (TS)

- §9.1 — Eval harness (presentable) — two-tier design, multi-provider LLM client, CI, scorecard
- §9.2 — Audit & accountability (moved from §8.4) — `explainPath`, `auditTrail`, `policyEnforcer`, `complianceSnapshot`
- §9.3 — MCP Server (`@graphrefly/mcp-server`)
- §9.4 — Harness scorecard (public)
- §9.5 — Demo 0 (moved from §7.3)
- §9.6 — Framework infiltration packages (AI SDK middleware, LangGraph tools, template repos)
- §9.7 — Demo 6: AI Agent Observatory (moved from §7.3b)
- Deferred section (§8.5-8.8, §6.2-6.3, demos 1-4, consumer track)

### New sections added to `docs/roadmap.md` (PY)

- §9.0 — Architecture debt (rearchitect feedback/funnel bridges) — blocks §9.2
- §9.2 — Audit & accountability (TS parity)
- §9.2b — Backpressure protocol (TS parity)
- Wave 3: PyPI publish, docs site, llms.txt

### Updated `archive/docs/SESSION-marketing-promotion-strategy.md`

- §15: Wave-based announcement plan, channel timing, anti-stealth rationale, revised pillar hierarchy, ecosystem infiltration timing

---

## PART 9: HARNESS ENGINEERING THREAD DISCOVERY

### How to find active harness engineering discussions

**Search queries (use these on each platform):**

| Platform | Search terms |
|---|---|
| HN (hn.algolia.com) | `harness engineering`, `agent harness`, `agent reliability`, `agent evaluation`, `LLM harness`, `coding agent infrastructure` |
| Reddit | `harness engineering` in r/AI_Agents, r/ClaudeCode, r/MachineLearning, r/LocalLLaMA, r/programming |
| X/Twitter | `"harness engineering"`, `"agent harness"`, `agent reliability 2026`, `coding agent infrastructure` |
| 小红书 | `Agent Harness`, `harness engineering`, `Agent 可靠性`, `AI Agent 基础设施`, `coding agent 工程化` |
| Dev.to | `harness engineering`, `agent reliability`, `agent evaluation` |
| LinkedIn | `harness engineering AI`, `agent harness engineering` |

**Key authors to follow/reply to:**
- Mitchell Hashimoto (coined the term)
- Martin Fowler (canonical article at martinfowler.com)
- Aaron Levie (Box CEO — "the harness is the car")
- Harrison Chase (LangChain/LangGraph)
- Sebastian Raschka ("Components of a Coding Agent" — magazine.sebastianraschka.com)
- Cobus Greyling (substack — "The Rise of AI Harness Engineering")
- Louis Bouchard (louisbouchard.ai — "Harness Engineering: The Missing Layer")
- Aakash Gupta (Medium — "2025 Was Agents. 2026 Is Agent Harnesses.")
- Hugo Nogueira (hugo.im — "The Agent Harness")
- HumanLayer team (humanlayer.dev — "Skill Issue: Harness Engineering")

**Key sites to monitor:**
- harness-engineering.ai — knowledge graph, latest articles
- nxcode.io — multiple harness engineering guides
- morphllm.com — "Agent Engineering: Harness Patterns, IMPACT Framework"
- rmax.ai — "Harness Engineering Is the Primary Lever"

**Reply strategy:** Lead with validation of the poster's pain point. Connect to a specific GraphReFly capability (not the whole architecture). Link to eval results or scorecard (once published). Keep it short, authentic, non-spammy. One reply per thread.

---

## FILES CHANGED

- `docs/roadmap.md` — added Harness Engineering Sprint (§9.1–9.7 + deferred section)
- `~/src/graphrefly-py/docs/roadmap.md` — added matching sprint (§9.0, §9.2, §9.2b)
- `archive/docs/SESSION-marketing-promotion-strategy.md` — added §15 (wave strategy)
- `archive/docs/SESSION-harness-engineering-strategy.md` — this file
- `archive/docs/DESIGN-ARCHIVE-INDEX.md` — index entry added
